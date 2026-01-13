import {
  resolveEffectiveMessagesConfig,
  resolveHumanDelayConfig,
} from "../agents/identity.js";
import { chunkText, resolveTextChunkLimit } from "../auto-reply/chunk.js";
import { formatAgentEnvelope } from "../auto-reply/envelope.js";
import { dispatchReplyFromConfig } from "../auto-reply/reply/dispatch-from-config.js";
import { createReplyDispatcherWithTyping } from "../auto-reply/reply/reply-dispatcher.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ClawdbotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { resolveStorePath, updateLastRoute } from "../config/sessions.js";
import { danger, logVerbose, shouldLogVerbose } from "../globals.js";
import { recordChannelActivity } from "../infra/channel-activity.js";
import { mediaKindFromMime } from "../media/constants.js";
import { fetchRemoteMedia } from "../media/fetch.js";
import { saveMediaBuffer } from "../media/store.js";
import { buildPairingReply } from "../pairing/pairing-messages.js";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../pairing/pairing-store.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import type { RuntimeEnv } from "../runtime.js";
import type { MatrixEvent, RoomMember } from "matrix-js-sdk";
import matrixSdk from "matrix-js-sdk/lib/matrix.js";

import { resolveMatrixAccount } from "./accounts.js";
import { createMatrixClient, startMatrixSync, stopMatrixSync } from "./client.js";
import { mapMatrixInboundEvent } from "./inbound.js";
import { decryptMatrixAttachment } from "./media.js";
import { sendMatrixMedia, sendMatrixText } from "./send.js";
import { readMatrixSyncState, updateMatrixSyncState } from "./state.js";
import { resolveChannelMediaMaxBytes } from "../channels/plugins/media-limits.js";

export type MonitorMatrixOpts = {
  accountId?: string;
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  setStatus?: (next: {
    accountId: string;
    connected?: boolean;
    lastError?: string | null;
    lastEventAt?: number | null;
  }) => void;
};

const { SyncState } = matrixSdk as {
  SyncState: typeof import("matrix-js-sdk").SyncState;
};

function resolveRuntime(opts: MonitorMatrixOpts): RuntimeEnv {
  return (
    opts.runtime ?? {
      log: console.log,
      error: console.error,
      exit: (code: number): never => {
        throw new Error(`exit ${code}`);
      },
    }
  );
}

function normalizeAllowEntry(entry: string): string {
  let value = entry.trim();
  if (!value) return "";
  if (value.toLowerCase().startsWith("matrix:")) {
    value = value.slice("matrix:".length).trim();
  }
  return value.toLowerCase();
}

function resolveAllowFrom(entries: Array<string | number>): string[] {
  return entries
    .map((entry) => normalizeAllowEntry(String(entry)))
    .filter(Boolean);
}

function normalizeAutoJoinEntry(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (normalized.startsWith("*:")) return null;
  if (
    normalized.startsWith("!*:") ||
    normalized.startsWith("#*:") ||
    normalized.startsWith("@*:")
  ) {
    const domain = normalized.slice(3).trim();
    return domain ? normalized : null;
  }
  if (
    normalized.startsWith("!") ||
    normalized.startsWith("#") ||
    normalized.startsWith("@")
  ) {
    return normalized;
  }
  return null;
}

function normalizeAutoJoinAllowlist(entries: string[]): string[] {
  return entries
    .map((entry) => normalizeAutoJoinEntry(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function extractMatrixDomain(value: string): string {
  const idx = value.indexOf(":");
  if (idx < 0) return "";
  return value.slice(idx + 1);
}

function matchesAutoJoinEntry(entry: string, candidate: string): boolean {
  const normalized = candidate.trim().toLowerCase();
  if (!normalized) return false;
  if (
    entry.startsWith("!*:") ||
    entry.startsWith("#*:") ||
    entry.startsWith("@*:")
  ) {
    const sigil = entry[0];
    if (!normalized.startsWith(sigil)) return false;
    const domain = extractMatrixDomain(normalized);
    const entryDomain = entry.slice(3);
    return Boolean(domain) && domain === entryDomain;
  }
  return normalized === entry;
}

function shouldAutoJoinInvite(
  allowlist: string[],
  candidates: string[],
): boolean {
  if (allowlist.length === 0) return false;
  for (const candidate of candidates) {
    for (const entry of allowlist) {
      if (matchesAutoJoinEntry(entry, candidate)) return true;
    }
  }
  return false;
}

async function resolveEffectiveAllowFrom(params: {
  cfg: ClawdbotConfig;
  accountId: string;
}): Promise<string[]> {
  const configured = resolveMatrixAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const baseAllow = resolveAllowFrom(configured.config.allowFrom ?? []);
  const storeAllow = await readChannelAllowFromStore("matrix").catch(
    () => [],
  );
  return Array.from(new Set([...baseAllow, ...storeAllow]));
}

export async function monitorMatrixProvider(
  opts: MonitorMatrixOpts = {},
): Promise<void> {
  const cfg = opts.config ?? loadConfig();
  const runtime = resolveRuntime(opts);
  const account = resolveMatrixAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.configured) {
    throw new Error(
      `Matrix account "${account.accountId}" is not configured (needs serverUrl, username, password).`,
    );
  }

  const client = await createMatrixClient({
    serverUrl: account.serverUrl,
    username: account.username,
    password: account.password,
    accountId: account.accountId,
  });
  const selfId = client.getUserId() ?? "";
  const maxBytes = resolveChannelMediaMaxBytes({
    cfg,
    resolveChannelLimitMb: ({ cfg, accountId }: { cfg: ClawdbotConfig; accountId: string }) =>
      cfg.channels?.matrix?.accounts?.[accountId]?.mediaMaxMb ??
      cfg.channels?.matrix?.mediaMaxMb,
    accountId: account.accountId,
  });

  const textChunkLimit = resolveTextChunkLimit(cfg, "matrix", account.accountId);
  const autoJoinAllowlist = normalizeAutoJoinAllowlist(
    account.config.autoJoinRooms ?? [],
  );
  const syncState = await readMatrixSyncState({ accountId: account.accountId });
  const hasSyncToken = Boolean(syncState?.nextBatch);
  const startupCutoff = Date.now();
  const lastEventTsByRoom = { ...(syncState?.lastEventTsByRoom ?? {}) };
  const recordInboundTimestamp = async (roomId: string, timestamp?: number) => {
    if (!timestamp) return;
    const lastSeen = lastEventTsByRoom[roomId] ?? 0;
    if (timestamp <= lastSeen) return;
    lastEventTsByRoom[roomId] = timestamp;
    await updateMatrixSyncState({
      accountId: account.accountId,
      patch: (prev) => ({
        ...(prev ?? {}),
        lastEventTsByRoom: {
          ...(prev?.lastEventTsByRoom ?? {}),
          [roomId]: timestamp,
        },
      }),
    });
  };

  const fetchMatrixMedia = async (mxcUrl: string, fileName?: string) => {
    const trimmed = mxcUrl.trim();
    if (!trimmed.startsWith("mxc://")) {
      throw new Error("Matrix media URL missing");
    }
    const accessToken = client.getAccessToken?.();
    if (!accessToken) {
      throw new Error("Matrix access token missing for media download");
    }
    const mxcPath = trimmed.slice("mxc://".length);
    const [serverName, mediaId] = mxcPath.split("/");
    if (!serverName || !mediaId) {
      throw new Error("Matrix media URL is invalid");
    }
    const url = `${account.serverUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;
    return await fetchRemoteMedia({
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
      filePathHint: fileName,
    });
  };

  const deliverReplies = async (payloads: ReplyPayload[], roomId: string) => {
    for (const payload of payloads) {
      if (payload.mediaUrl || payload.mediaUrls?.length) {
        const urls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
        for (const mediaUrl of urls) {
          await sendMatrixMedia({
            client,
            roomId,
            text: payload.text,
            mediaUrl,
            maxBytes,
            replyToId: payload.replyToId ?? undefined,
          });
          recordChannelActivity({
            channel: "matrix",
            accountId: account.accountId,
            direction: "outbound",
          });
        }
        continue;
      }

      const text = payload.text ?? "";
      const chunks = chunkText(text, textChunkLimit);
      for (const chunk of chunks) {
        await sendMatrixText({
          client,
          roomId,
          text: chunk,
          replyToId: payload.replyToId ?? undefined,
        });
        recordChannelActivity({
          channel: "matrix",
          accountId: account.accountId,
          direction: "outbound",
        });
      }
    }
  };

  const handleAutoJoinInvite = async (
    event: MatrixEvent,
    member: RoomMember,
  ) => {
    if (autoJoinAllowlist.length === 0) return;
    if (member.membership !== "invite") return;
    if (member.userId !== selfId) return;
    const roomId = member.roomId ?? event.getRoomId?.() ?? "";
    if (!roomId) return;

    const room = client.getRoom(roomId);
    const aliases: string[] = [];
    if (room?.getCanonicalAlias) {
      const alias = room.getCanonicalAlias();
      if (alias) aliases.push(alias);
    }
    if (room?.getAltAliases) {
      const alt = room.getAltAliases();
      if (Array.isArray(alt)) {
        aliases.push(...alt.filter(Boolean));
      }
    }
    const inviterId = event.getSender()?.trim() ?? "";
    const candidates = [roomId, ...aliases, inviterId].filter(Boolean);
    if (!shouldAutoJoinInvite(autoJoinAllowlist, candidates)) return;

    try {
      await client.joinRoom(roomId);
      logVerbose(`matrix auto-joined room ${roomId}`);
    } catch (err) {
      runtime.error?.(
        danger(`matrix auto-join failed (${roomId}): ${String(err)}`),
      );
    }
  };

  const handleMatrixEvent = async (payload: {
    event: Parameters<typeof mapMatrixInboundEvent>[0]["event"];
    room: Parameters<typeof mapMatrixInboundEvent>[0]["room"];
  }) => {
    if (typeof client.decryptEventIfNeeded === "function") {
      try {
        await client.decryptEventIfNeeded(payload.event);
      } catch (err) {
        const failed = payload.event.isDecryptionFailure?.() ?? false;
        if (shouldLogVerbose() || failed) {
          runtime.error?.(
            danger(
              `matrix decrypt failed (${payload.event.getId?.() ?? "unknown"}): ${String(err)}`,
            ),
          );
        }
        if (failed) return;
      }
    }
    if (payload.event.isDecryptionFailure?.()) {
      logVerbose(
        `matrix decrypt failed (${payload.event.getId?.() ?? "unknown"}): missing keys`,
      );
      return;
    }
    const inbound = mapMatrixInboundEvent({
      event: payload.event,
      room: payload.room,
    });
    if (!inbound) return;
    if (inbound.senderId === selfId) return;
    const lastSeen = lastEventTsByRoom[inbound.roomId];
    if (inbound.timestamp && lastSeen && inbound.timestamp <= lastSeen) {
      logVerbose(
        `matrix: skip old message ${inbound.eventId ?? "unknown"} (ts=${inbound.timestamp}, last=${lastSeen})`,
      );
      return;
    }
    if (
      inbound.timestamp &&
      !hasSyncToken &&
      !lastSeen &&
      inbound.timestamp < startupCutoff
    ) {
      logVerbose(
        `matrix: skip pre-start message ${inbound.eventId ?? "unknown"} (ts=${inbound.timestamp})`,
      );
      return;
    }
    await recordInboundTimestamp(inbound.roomId, inbound.timestamp);

    const joinedCount = payload.room.getJoinedMemberCount();
    const isDirect = joinedCount <= 2;
    const dmPolicy = account.config.dmPolicy ?? "pairing";

    if (isDirect && dmPolicy === "disabled") {
      logVerbose("matrix: drop dm (dmPolicy: disabled)");
      return;
    }

    let commandAuthorized = true;
    if (isDirect && dmPolicy !== "open") {
      const effectiveAllowFrom = await resolveEffectiveAllowFrom({
        cfg,
        accountId: account.accountId,
      });
      const normalizedSender = normalizeAllowEntry(inbound.senderId);
      const allowWildcard = effectiveAllowFrom.includes("*");
      const allowed =
        allowWildcard || effectiveAllowFrom.includes(normalizedSender);
      if (!allowed) {
        commandAuthorized = false;
        if (dmPolicy === "pairing") {
          const { code, created } = await upsertChannelPairingRequest({
            channel: "matrix",
            id: inbound.senderId,
            meta: inbound.senderDisplayName
              ? { name: inbound.senderDisplayName }
              : undefined,
          });
          if (created) {
            try {
              await sendMatrixText({
                client,
                roomId: inbound.roomId,
                text: buildPairingReply({
                  channel: "matrix",
                  idLine: `Your Matrix user id: ${inbound.senderId}`,
                  code,
                }),
              });
            } catch (err) {
              if (shouldLogVerbose()) {
                runtime.error?.(
                  danger(`matrix pairing reply failed: ${String(err)}`),
                );
              }
            }
          }
        } else {
          logVerbose(
            `Blocked unauthorized matrix sender ${inbound.senderId} (dmPolicy=${dmPolicy})`,
          );
        }
        return;
      }
      commandAuthorized = true;
    }

    recordChannelActivity({
      channel: "matrix",
      accountId: account.accountId,
      direction: "inbound",
    });
    opts.setStatus?.({
      accountId: account.accountId,
      lastEventAt: inbound.timestamp ?? Date.now(),
    });

    let mediaPath: string | undefined;
    let mediaType: string | undefined;
    let placeholder = "";
    if (inbound.media?.mxcUrl) {
      try {
        const fetched = await fetchMatrixMedia(
          inbound.media.mxcUrl,
          inbound.media.fileName,
        );
        let mediaBuffer = fetched.buffer;
        const encryptedFile = inbound.media.encryptedFile;
        if (encryptedFile) {
          mediaBuffer = decryptMatrixAttachment({
            ciphertext: fetched.buffer,
            encrypted: encryptedFile,
          });
        }
        const saved = await saveMediaBuffer(
          mediaBuffer,
          inbound.media.contentType ?? fetched.contentType,
          "inbound",
          maxBytes,
        );
        mediaPath = saved.path;
        mediaType = saved.contentType ?? inbound.media.contentType;
      } catch (err) {
        runtime.error?.(danger(`matrix media download failed: ${String(err)}`));
      }
    }

    const kind = mediaKindFromMime(mediaType ?? undefined);
    if (kind) {
      placeholder = `<media:${kind}>`;
    } else if (inbound.media) {
      placeholder = "<media:attachment>";
    }

    const bodyText = inbound.body || placeholder || "";
    if (!bodyText) return;

    const fromLabel = isDirect
      ? `${inbound.senderDisplayName ?? inbound.senderId} id:${inbound.senderId}`
      : `${inbound.roomName ?? "Matrix Room"} id:${inbound.roomId}`;
    const body = formatAgentEnvelope({
      channel: "Matrix",
      from: fromLabel,
      timestamp: inbound.timestamp ?? undefined,
      body: bodyText,
    });

    const route = resolveAgentRoute({
      cfg,
      channel: "matrix",
      accountId: account.accountId,
      peer: {
        kind: isDirect ? "dm" : "group",
        id: isDirect ? inbound.senderId : inbound.roomId,
      },
    });

    const ctxPayload = {
      Body: body,
      RawBody: bodyText,
      CommandBody: bodyText,
      From: isDirect ? `matrix:${inbound.senderId}` : `room:${inbound.roomId}`,
      To: `room:${inbound.roomId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isDirect ? "direct" : "group",
      GroupSubject: isDirect ? undefined : inbound.roomName,
      SenderName: inbound.senderDisplayName ?? inbound.senderId,
      SenderId: inbound.senderId,
      Provider: "matrix" as const,
      Surface: "matrix" as const,
      MessageSid: inbound.eventId ?? undefined,
      Timestamp: inbound.timestamp ?? undefined,
      MediaPath: mediaPath,
      MediaType: mediaType,
      MediaUrl: mediaPath,
      CommandAuthorized: commandAuthorized,
      OriginatingChannel: "matrix" as const,
      OriginatingTo: `room:${inbound.roomId}`,
    };

    if (isDirect) {
      const sessionCfg = cfg.session;
      const storePath = resolveStorePath(sessionCfg?.store, {
        agentId: route.agentId,
      });
      await updateLastRoute({
        storePath,
        sessionKey: route.mainSessionKey,
        channel: "matrix",
        to: inbound.senderId,
        accountId: route.accountId,
      });
    }

    if (shouldLogVerbose()) {
      const preview = body.slice(0, 200).replace(/\n/g, "\\n");
      logVerbose(
        `matrix inbound: from=${ctxPayload.From} len=${body.length} preview="${preview}"`,
      );
    }

    const { dispatcher, replyOptions, markDispatchIdle } =
      createReplyDispatcherWithTyping({
      responsePrefix: resolveEffectiveMessagesConfig(cfg, route.agentId)
        .responsePrefix,
      humanDelay: resolveHumanDelayConfig(cfg, route.agentId),
      deliver: async (payload) => {
        await deliverReplies([payload], inbound.roomId);
      },
      onReplyStart: async () => {
        try {
          await client.sendTyping(inbound.roomId, true, 20_000);
        } catch (err) {
          if (shouldLogVerbose()) {
            runtime.error?.(
              danger(`matrix typing failed: ${String(err)}`),
            );
          }
        }
      },
      onError: (err, info) => {
        runtime.error?.(
          danger(`matrix ${info.kind} reply failed: ${String(err)}`),
        );
      },
      onIdle: () => {
        void client.sendTyping(inbound.roomId, false, 0).catch((err) => {
          if (shouldLogVerbose()) {
            runtime.error?.(
              danger(`matrix typing stop failed: ${String(err)}`),
            );
          }
        });
      },
    });

    await dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });
    markDispatchIdle();
  };

  const emitter = client as unknown as {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
  };
  emitter.on("RoomMember.membership", (event, member) => {
    void handleAutoJoinInvite(event as MatrixEvent, member as RoomMember);
  });

  await startMatrixSync(client, {
    accountId: account.accountId,
    abortSignal: opts.abortSignal,
    onEvent: (payload) => {
      void handleMatrixEvent({ event: payload.event, room: payload.room });
    },
    onError: (err) => {
      runtime.error?.(danger(`matrix sync error: ${err.message}`));
      opts.setStatus?.({
        accountId: account.accountId,
        connected: false,
        lastError: err.message,
      });
    },
    onSyncState: (state) => {
      if (state === SyncState.Error) {
        runtime.error?.(danger("matrix sync entered error state"));
        opts.setStatus?.({
          accountId: account.accountId,
          connected: false,
          lastError: "Matrix sync entered error state",
        });
        return;
      }
      if (state === SyncState.Prepared || state === SyncState.Syncing) {
        opts.setStatus?.({
          accountId: account.accountId,
          connected: true,
          lastError: null,
          lastEventAt: Date.now(),
        });
      }
    },
  });

  if (opts.abortSignal) {
    opts.abortSignal.addEventListener(
      "abort",
      () => {
        stopMatrixSync(client);
      },
      { once: true },
    );
    await new Promise<void>((resolve) => {
      if (opts.abortSignal?.aborted) {
        resolve();
        return;
      }
      opts.abortSignal?.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });
  }
}

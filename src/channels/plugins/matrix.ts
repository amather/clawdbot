import { chunkText } from "../../auto-reply/chunk.js";
import {
  listMatrixAccountIds,
  type ResolvedMatrixAccount,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "../../matrix/accounts.js";
import { createMatrixClient } from "../../matrix/client.js";
import {
  resolveMatrixRoomId,
  sendMatrixMedia,
  sendMatrixText,
} from "../../matrix/send.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../../routing/session-key.js";
import { getChatChannelMeta } from "../registry.js";
import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "./config-helpers.js";
import { formatPairingApproveHint } from "./helpers.js";
import { resolveChannelMediaMaxBytes } from "./media-limits.js";
import { normalizeMatrixMessagingTarget } from "./normalize-target.js";
import { matrixOnboardingAdapter } from "./onboarding/matrix.js";
import {
  applyAccountNameToChannelSection,
  migrateBaseNameToDefaultAccount,
} from "./setup-helpers.js";
import { collectMatrixStatusIssues } from "./status-issues/matrix.js";
import type { ChannelPlugin } from "./types.js";

const meta = getChatChannelMeta("matrix");

export const matrixPlugin: ChannelPlugin<ResolvedMatrixAccount> = {
  id: "matrix",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "matrixUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^matrix:/i, ""),
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
  },
  reload: { configPrefixes: ["channels.matrix"] },
  onboarding: matrixOnboardingAdapter,
  config: {
    listAccountIds: (cfg) => listMatrixAccountIds(cfg),
    resolveAccount: (cfg, accountId) =>
      resolveMatrixAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultMatrixAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "matrix",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "matrix",
        accountId,
        clearBaseFields: [
          "serverUrl",
          "username",
          "password",
          "name",
          "autoJoinRooms",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.serverUrl,
      dmPolicy: account.config.dmPolicy,
      allowFrom: (account.config.allowFrom ?? []).map((entry) => String(entry)),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveMatrixAccount({ cfg, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^matrix:/i, "")),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId =
        accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        cfg.channels?.matrix?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.matrix.accounts.${resolvedAccountId}.`
        : "channels.matrix.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("matrix"),
        normalizeEntry: (raw) => raw.replace(/^matrix:/i, "").trim(),
      };
    },
  },
  messaging: {
    normalizeTarget: normalizeMatrixMessagingTarget,
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "matrix",
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      if (!input.serverUrl || !input.username || !input.password) {
        return "Matrix requires --server-url, --username, and --password.";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg,
        channelKey: "matrix",
        accountId,
        name: input.name,
      });
      const autoJoinRooms =
        Array.isArray(input.autoJoinRooms) && input.autoJoinRooms.length > 0
          ? input.autoJoinRooms
          : undefined;
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "matrix",
            })
          : namedConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            matrix: {
              ...next.channels?.matrix,
              enabled: true,
              serverUrl: input.serverUrl ?? next.channels?.matrix?.serverUrl,
              username: input.username ?? next.channels?.matrix?.username,
              password: input.password ?? next.channels?.matrix?.password,
              ...(autoJoinRooms ? { autoJoinRooms } : {}),
            },
          },
        };
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          matrix: {
            ...next.channels?.matrix,
            enabled: true,
            accounts: {
              ...next.channels?.matrix?.accounts,
              [accountId]: {
                ...next.channels?.matrix?.accounts?.[accountId],
                enabled: true,
                ...(input.serverUrl ? { serverUrl: input.serverUrl } : {}),
                ...(input.username ? { username: input.username } : {}),
                ...(input.password ? { password: input.password } : {}),
                ...(autoJoinRooms ? { autoJoinRooms } : {}),
              },
            },
          },
        },
      };
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: chunkText,
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error(
            "Delivering to Matrix requires --to <room:ROOM_ID|@user:server|matrix:room:ROOM_ID|matrix:@user:server>",
          ),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveMatrixAccount({ cfg, accountId });
      const client = await createMatrixClient({
        serverUrl: account.serverUrl,
        username: account.username,
        password: account.password,
        accountId: account.accountId,
      });
      const roomId = await resolveMatrixRoomId({ client, to });
      const result = await sendMatrixText({
        client,
        roomId,
        text,
      });
      return {
        channel: "matrix",
        messageId: result.eventId,
        conversationId: roomId,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      if (!mediaUrl?.trim()) {
        throw new Error("Matrix media send requires mediaUrl");
      }
      const account = resolveMatrixAccount({ cfg, accountId });
      const client = await createMatrixClient({
        serverUrl: account.serverUrl,
        username: account.username,
        password: account.password,
        accountId: account.accountId,
      });
      const roomId = await resolveMatrixRoomId({ client, to });
      const maxBytes = resolveChannelMediaMaxBytes({
        cfg,
        resolveChannelLimitMb: ({ cfg, accountId }) =>
          cfg.channels?.matrix?.accounts?.[accountId]?.mediaMaxMb ??
          cfg.channels?.matrix?.mediaMaxMb,
        accountId: account.accountId,
      });
      const result = await sendMatrixMedia({
        client,
        roomId,
        text,
        mediaUrl,
        maxBytes,
      });
      return {
        channel: "matrix",
        messageId: result.eventId,
        conversationId: roomId,
      };
    },
  },
  auth: {
    login: async ({ cfg, accountId, runtime }) => {
      const account = resolveMatrixAccount({ cfg, accountId });
      if (!account.configured) {
        throw new Error(
          "Matrix account is missing serverUrl/username/password",
        );
      }
      await createMatrixClient({
        serverUrl: account.serverUrl,
        username: account.username,
        password: account.password,
        accountId: account.accountId,
      });
      runtime.log(`Matrix login OK (${account.accountId}).`);
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      connected: false,
      lastEventAt: null,
    },
    collectStatusIssues: (accounts) => collectMatrixStatusIssues(accounts),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      baseUrl: snapshot.baseUrl ?? null,
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastEventAt: snapshot.lastEventAt ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.serverUrl,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastEventAt: runtime?.lastEventAt ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({
        accountId: account.accountId,
        baseUrl: account.serverUrl,
      });
      ctx.log?.info(
        `[${account.accountId}] starting provider (${account.serverUrl})`,
      );
      const { monitorMatrixProvider } = await import("../../matrix/index.js");
      return monitorMatrixProvider({
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        setStatus: ctx.setStatus,
      });
    },
  },
};

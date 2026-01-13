import type { MatrixClient, UploadResponse } from "matrix-js-sdk";
import matrixSdk from "matrix-js-sdk/lib/matrix.js";

import { mediaKindFromMime } from "../media/constants.js";
import { loadWebMedia } from "../web/media.js";
import { formatMatrixMessage } from "./format.js";

type MatrixSendResult = {
  eventId: string;
};

type MatrixRoomMessageContent = {
  msgtype: string;
  body: string;
  formatted_body?: string;
  format?: "org.matrix.custom.html";
  [key: string]: unknown;
};

const { EventType } = matrixSdk as {
  EventType: typeof import("matrix-js-sdk").EventType;
};

async function ensureKnownDevices(params: {
  client: MatrixClient;
  roomId: string;
}): Promise<void> {
  if (!params.client.isCryptoEnabled?.()) return;
  const room = params.client.getRoom(params.roomId);
  if (!room?.getJoinedMembers) return;
  const joined = room.getJoinedMembers();
  if (joined.length > 4) return;
  const userIds = Array.from(
    new Set(joined.map((member) => member.userId).filter(Boolean)),
  );
  if (userIds.length === 0) return;
  try {
    await params.client.downloadKeys(userIds, true);
  } catch {
    return;
  }
  for (const userId of userIds) {
    let devices: { deviceId: string }[] = [];
    try {
      devices = params.client.getStoredDevicesForUser(userId);
    } catch {
      continue;
    }
    for (const device of devices) {
      try {
        await params.client.setDeviceKnown(userId, device.deviceId, true);
      } catch {
        // Best effort: allow send to proceed if devices can't be marked.
      }
    }
  }
}

function buildReplyRelation(replyToId?: string): Record<string, unknown> | undefined {
  const id = replyToId?.trim();
  if (!id) return undefined;
  return {
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: id,
      },
    },
  };
}

function resolveUploadUrl(upload: UploadResponse): string {
  const contentUri =
    (upload as { content_uri?: string }).content_uri ??
    (upload as { contentUri?: string }).contentUri ??
    "";
  if (!contentUri) {
    throw new Error("Matrix upload failed: missing content_uri");
  }
  return contentUri;
}

export async function sendMatrixText(params: {
  client: MatrixClient;
  roomId: string;
  text: string;
  replyToId?: string;
}): Promise<MatrixSendResult> {
  const { body, formattedBody, format } = formatMatrixMessage(params.text ?? "");
  if (!body.trim()) {
    throw new Error("Matrix send requires non-empty text");
  }
  await ensureKnownDevices({ client: params.client, roomId: params.roomId });
  const content = {
    msgtype: "m.text",
    body,
    format,
    formatted_body: formattedBody,
    ...buildReplyRelation(params.replyToId),
  } as MatrixRoomMessageContent;
  const sendEvent = params.client.sendEvent.bind(params.client) as (
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
  ) => Promise<{ event_id: string }>;
  const res = await sendEvent(params.roomId, EventType.RoomMessage, content);
  return { eventId: res.event_id };
}

export async function resolveMatrixRoomId(params: {
  client: MatrixClient;
  to: string;
}): Promise<string> {
  let target = params.to.trim();
  if (!target) throw new Error("Matrix target is required");
  if (target.toLowerCase().startsWith("matrix:")) {
    target = target.slice("matrix:".length).trim();
  }
  if (target.toLowerCase().startsWith("room:")) {
    const roomId = target.slice("room:".length).trim();
    if (!roomId) throw new Error("Matrix room id is required");
    return roomId;
  }
  if (target.startsWith("!")) {
    return target;
  }
  if (target.startsWith("@")) {
    const userId = target;
    const selfId = params.client.getUserId();
    const rooms = params.client.getRooms();
    for (const room of rooms) {
      const joined = room.getJoinedMembers();
      if (joined.length > 2) continue;
      const hasUser = joined.some((member) => member.userId === userId);
      const hasSelf = selfId
        ? joined.some((member) => member.userId === selfId)
        : true;
      if (hasUser && hasSelf) {
        return room.roomId;
      }
    }
    const created = await params.client.createRoom({
      invite: [userId],
      is_direct: true,
    });
    return created.room_id;
  }
  throw new Error(
    "Matrix target must be room:<roomId> or a user id like @user:server",
  );
}

export async function sendMatrixMedia(params: {
  client: MatrixClient;
  roomId: string;
  text?: string;
  mediaUrl: string;
  maxBytes?: number;
  replyToId?: string;
}): Promise<MatrixSendResult> {
  await ensureKnownDevices({ client: params.client, roomId: params.roomId });
  const media = await loadWebMedia(params.mediaUrl, params.maxBytes);
  const arrayBuffer = media.buffer.buffer.slice(
    media.buffer.byteOffset,
    media.buffer.byteOffset + media.buffer.byteLength,
  ) as ArrayBuffer;
  const upload = await params.client.uploadContent(arrayBuffer, {
    type: media.contentType,
    name: media.fileName,
  });
  const mxcUrl = resolveUploadUrl(upload);
  const kind = media.kind;
  const msgtype =
    kind === "image"
      ? "m.image"
      : kind === "audio"
        ? "m.audio"
        : kind === "video"
          ? "m.video"
          : "m.file";
  const placeholder = (() => {
    if (params.text?.trim()) return params.text.trim();
    if (media.fileName) return media.fileName;
    const derivedKind = mediaKindFromMime(media.contentType ?? undefined);
    return derivedKind ? `<media:${derivedKind}>` : "<media:file>";
  })();
  const formatted = formatMatrixMessage(placeholder);
  const content = {
    msgtype,
    body: formatted.body,
    format: formatted.format,
    formatted_body: formatted.formattedBody,
    url: mxcUrl,
    info: {
      mimetype: media.contentType ?? undefined,
      size: media.buffer.length,
    },
    ...buildReplyRelation(params.replyToId),
  } as MatrixRoomMessageContent;
  const sendEvent = params.client.sendEvent.bind(params.client) as (
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
  ) => Promise<{ event_id: string }>;
  const res = await sendEvent(params.roomId, EventType.RoomMessage, content);
  return { eventId: res.event_id };
}

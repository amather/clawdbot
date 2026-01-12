import type { MatrixEvent, Room } from "matrix-js-sdk";

export type MatrixInboundMedia = {
  mxcUrl: string;
  contentType?: string;
  size?: number;
  fileName?: string;
  msgType?: string;
  encryptedFile?: {
    url?: string;
    key?: {
      alg?: string;
      kty?: string;
      key_ops?: string[];
      k?: string;
      ext?: boolean;
    };
    iv?: string;
    hashes?: { sha256?: string };
    v?: string;
  };
};

export type MatrixInboundMessage = {
  roomId: string;
  roomName?: string;
  senderId: string;
  senderDisplayName?: string;
  eventId?: string;
  timestamp?: number;
  body: string;
  replyToId?: string;
  media?: MatrixInboundMedia;
};

type MatrixMessageContent = {
  body?: string;
  msgtype?: string;
  url?: string;
  file?: {
    url?: string;
    key?: {
      alg?: string;
      kty?: string;
      key_ops?: string[];
      k?: string;
      ext?: boolean;
    };
    iv?: string;
    hashes?: { sha256?: string };
    v?: string;
  };
  info?: {
    mimetype?: string;
    size?: number;
  };
  "m.relates_to"?: {
    "m.in_reply_to"?: { event_id?: string };
  };
};

function resolveMatrixMedia(
  content: MatrixMessageContent,
): MatrixInboundMedia | undefined {
  const msgType = content.msgtype?.trim();
  const rawUrl = content.url?.trim() || content.file?.url?.trim();
  if (!rawUrl) return undefined;
  const contentType = content.info?.mimetype?.trim();
  const size =
    typeof content.info?.size === "number" ? content.info.size : undefined;
  const fileName = content.body?.trim() || undefined;
  return {
    mxcUrl: rawUrl,
    contentType: contentType || undefined,
    size,
    fileName,
    msgType,
    encryptedFile: content.file ? { ...content.file } : undefined,
  };
}

export function mapMatrixInboundEvent(params: {
  event: MatrixEvent;
  room: Room;
}): MatrixInboundMessage | null {
  const event = params.event;
  if (event.getType() !== "m.room.message") return null;
  const sender = event.getSender()?.trim();
  if (!sender) return null;
  const content = event.getContent<MatrixMessageContent>() ?? {};
  const body = content.body?.trim() ?? "";
  const media = resolveMatrixMedia(content);
  const replyToId =
    content["m.relates_to"]?.["m.in_reply_to"]?.event_id ?? undefined;
  const roomName = params.room.name?.trim() || params.room.getCanonicalAlias?.();

  return {
    roomId: params.room.roomId,
    roomName: roomName || undefined,
    senderId: sender,
    senderDisplayName: event.sender?.name?.trim() || undefined,
    eventId: event.getId() ?? undefined,
    timestamp: event.getTs(),
    body,
    replyToId,
    media,
  };
}

import { chunkText } from "../../../auto-reply/chunk.js";
import { resolveMatrixAccount } from "../../../matrix/accounts.js";
import { createMatrixClient } from "../../../matrix/client.js";
import {
  resolveMatrixRoomId,
  sendMatrixMedia,
  sendMatrixText,
} from "../../../matrix/send.js";
import { resolveChannelMediaMaxBytes } from "../media-limits.js";
import type { ChannelOutboundAdapter } from "../types.js";

export const matrixOutbound: ChannelOutboundAdapter = {
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
};

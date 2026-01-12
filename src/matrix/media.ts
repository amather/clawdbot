import crypto from "node:crypto";

import type { MatrixInboundMedia } from "./inbound.js";

function normalizeBase64(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4;
  if (padLength === 0) return normalized;
  return `${normalized}${"=".repeat(4 - padLength)}`;
}

function decodeBase64(value?: string): Buffer | null {
  if (!value) return null;
  const normalized = normalizeBase64(value);
  if (!normalized) return null;
  return Buffer.from(normalized, "base64");
}

function normalizeHash(value?: string): string {
  if (!value) return "";
  return normalizeBase64(value).replace(/=+$/, "");
}

export function decryptMatrixAttachment(params: {
  ciphertext: Buffer;
  encrypted: NonNullable<MatrixInboundMedia["encryptedFile"]>;
}): Buffer {
  const { ciphertext, encrypted } = params;
  const keyMaterial = decodeBase64(encrypted.key?.k);
  if (!keyMaterial) {
    throw new Error("Matrix attachment missing encryption key");
  }
  if (keyMaterial.length !== 32) {
    throw new Error(
      `Matrix attachment key length ${keyMaterial.length} is invalid`,
    );
  }
  if (encrypted.key?.alg && encrypted.key.alg !== "A256CTR") {
    throw new Error(
      `Matrix attachment encryption ${encrypted.key.alg} is not supported`,
    );
  }
  const iv = decodeBase64(encrypted.iv);
  if (!iv) {
    throw new Error("Matrix attachment missing IV");
  }
  if (iv.length !== 16) {
    throw new Error(`Matrix attachment IV length ${iv.length} is invalid`);
  }

  const expectedHash = normalizeHash(encrypted.hashes?.sha256);
  if (expectedHash) {
    const actualHash = crypto
      .createHash("sha256")
      .update(ciphertext)
      .digest("base64")
      .replace(/=+$/, "");
    if (expectedHash !== actualHash) {
      throw new Error("Matrix attachment hash mismatch");
    }
  }

  const decipher = crypto.createDecipheriv("aes-256-ctr", keyMaterial, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

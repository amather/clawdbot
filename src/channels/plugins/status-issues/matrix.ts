import type { ChannelAccountSnapshot, ChannelStatusIssue } from "../types.js";
import { asString, isRecord } from "./shared.js";

type MatrixAccountStatus = {
  accountId?: unknown;
  enabled?: unknown;
  configured?: unknown;
  running?: unknown;
  connected?: unknown;
  lastError?: unknown;
  lastEventAt?: unknown;
};

const SYNC_STALL_MS = 5 * 60_000;

function readMatrixAccountStatus(
  value: ChannelAccountSnapshot,
): MatrixAccountStatus | null {
  if (!isRecord(value)) return null;
  return {
    accountId: value.accountId,
    enabled: value.enabled,
    configured: value.configured,
    running: value.running,
    connected: value.connected,
    lastError: value.lastError,
    lastEventAt: value.lastEventAt,
  };
}

export function collectMatrixStatusIssues(
  accounts: ChannelAccountSnapshot[],
): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  const now = Date.now();
  for (const entry of accounts) {
    const account = readMatrixAccountStatus(entry);
    if (!account) continue;
    const accountId = asString(account.accountId) ?? "default";
    const enabled = account.enabled !== false;
    const configured = account.configured === true;
    if (!enabled || !configured) continue;

    const lastError = asString(account.lastError);
    if (lastError) {
      const lowered = lastError.toLowerCase();
      const kind =
        lowered.includes("auth") ||
        lowered.includes("login") ||
        lowered.includes("401")
          ? "auth"
          : "runtime";
      issues.push({
        channel: "matrix",
        accountId,
        kind,
        message: `Provider error: ${lastError}`,
      });
    }

    const running = account.running === true;
    const connected = account.connected === true;
    const lastEventAt =
      typeof account.lastEventAt === "number" ? account.lastEventAt : null;
    if (running && connected && lastEventAt) {
      const age = now - lastEventAt;
      if (age > SYNC_STALL_MS) {
        issues.push({
          channel: "matrix",
          accountId,
          kind: "runtime",
          message: `Matrix sync stalled (last event ${Math.round(
            age / 1000,
          )}s ago).`,
        });
      }
    }
  }
  return issues;
}

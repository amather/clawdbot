import type { ClawdbotConfig } from "../config/config.js";
import type { MatrixAccountConfig } from "../config/types.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../routing/session-key.js";

export type ResolvedMatrixAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  serverUrl: string;
  username: string;
  password: string;
  configured: boolean;
  config: MatrixAccountConfig;
};

function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const accounts = cfg.channels?.matrix?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listMatrixAccountIds(cfg: ClawdbotConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultMatrixAccountId(cfg: ClawdbotConfig): string {
  const ids = listMatrixAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): MatrixAccountConfig | undefined {
  const accounts = cfg.channels?.matrix?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as MatrixAccountConfig | undefined;
}

function mergeMatrixAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): MatrixAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.matrix ??
    {}) as MatrixAccountConfig & { accounts?: unknown };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function resolveMatrixAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedMatrixAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.matrix?.enabled !== false;
  const merged = mergeMatrixAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const serverUrl = merged.serverUrl?.trim() ?? "";
  const username = merged.username?.trim() ?? "";
  const password = merged.password?.trim() ?? "";
  const configured = Boolean(serverUrl && username && password);
  return {
    accountId,
    enabled,
    name: merged.name?.trim() || undefined,
    serverUrl,
    username,
    password,
    configured,
    config: merged,
  };
}

export function listEnabledMatrixAccounts(
  cfg: ClawdbotConfig,
): ResolvedMatrixAccount[] {
  return listMatrixAccountIds(cfg)
    .map((accountId) => resolveMatrixAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

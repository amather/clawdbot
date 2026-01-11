import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../routing/session-key.js";

export type MatrixAuthState = {
  accessToken: string;
  deviceId?: string;
  userId?: string;
  serverUrl?: string;
};

export type MatrixSyncState = {
  nextBatch?: string;
};

const AUTH_FILE = "auth.json";
const SYNC_FILE = "sync.json";
const STORAGE_FILE = "local-storage.json";

function resolveMatrixStateDir(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): string {
  const accountId = normalizeAccountId(
    params.accountId ?? DEFAULT_ACCOUNT_ID,
  );
  const env = params.env ?? process.env;
  const homedir = params.homedir ?? os.homedir;
  return path.join(resolveStateDir(env, homedir), "matrix", accountId);
}

function resolveMatrixAuthPath(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): string {
  return path.join(resolveMatrixStateDir(params), AUTH_FILE);
}

function resolveMatrixSyncPath(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): string {
  return path.join(resolveMatrixStateDir(params), SYNC_FILE);
}

export function resolveMatrixStoragePath(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): string {
  return path.join(resolveMatrixStateDir(params), STORAGE_FILE);
}

async function readJsonFile<T>(
  filePath: string,
  fallback: T,
): Promise<{ value: T; exists: boolean }> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return { value: JSON.parse(raw) as T, exists: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return { value: fallback, exists: false };
    return { value: fallback, exists: false };
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.promises.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
  });
  await fs.promises.chmod(tmp, 0o600);
  await fs.promises.rename(tmp, filePath);
}

export async function readMatrixAuthState(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): Promise<MatrixAuthState | null> {
  const { value } = await readJsonFile<MatrixAuthState | null>(
    resolveMatrixAuthPath(params),
    null,
  );
  return value && typeof value === "object" ? value : null;
}

export async function writeMatrixAuthState(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  state: MatrixAuthState;
}): Promise<void> {
  await writeJsonFile(resolveMatrixAuthPath(params), params.state);
}

export async function readMatrixSyncState(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): Promise<MatrixSyncState | null> {
  const { value } = await readJsonFile<MatrixSyncState | null>(
    resolveMatrixSyncPath(params),
    null,
  );
  return value && typeof value === "object" ? value : null;
}

export async function writeMatrixSyncState(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  state: MatrixSyncState;
}): Promise<void> {
  await writeJsonFile(resolveMatrixSyncPath(params), params.state);
}

type StorageSnapshot = Record<string, string>;

class MatrixFileStorage implements Storage {
  private data: StorageSnapshot;
  private readonly filePath: string;

  constructor(filePath: string, data: StorageSnapshot) {
    this.filePath = filePath;
    this.data = data;
  }

  get length(): number {
    return Object.keys(this.data).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.data);
    return keys[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.data[key] = value;
    this.flush();
  }

  removeItem(key: string): void {
    if (!(key in this.data)) return;
    delete this.data[key];
    this.flush();
  }

  clear(): void {
    this.data = {};
    this.flush();
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(
      dir,
      `${path.basename(this.filePath)}.${crypto.randomUUID()}.tmp`,
    );
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    fs.renameSync(tmp, this.filePath);
  }
}

export async function loadMatrixStorage(params: {
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): Promise<Storage> {
  const filePath = resolveMatrixStoragePath(params);
  const { value } = await readJsonFile<StorageSnapshot>(filePath, {});
  return new MatrixFileStorage(
    filePath,
    value && typeof value === "object" ? value : {},
  );
}

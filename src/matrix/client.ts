import {
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type SyncState as MatrixSyncState,
  type SyncStateData,
} from "matrix-js-sdk";
import matrixSdk from "matrix-js-sdk/lib/matrix.js";
import memoryStoreModule from "matrix-js-sdk/lib/store/memory.js";

import { computeBackoff, sleepWithAbort } from "../infra/backoff.js";
import {
  loadMatrixStorage,
  readMatrixAuthState,
  readMatrixSyncState,
  resolveMatrixCryptoStoreBasePath,
  writeMatrixAuthState,
  writeMatrixSyncState,
} from "./state.js";
import fs from "node:fs/promises";

const DEFAULT_SYNC_LIMIT = 20;
const SYNC_BACKOFF = {
  initialMs: 1500,
  maxMs: 30_000,
  factor: 1.8,
  jitter: 0.25,
} as const;

const { createClient, SyncState } = matrixSdk as {
  createClient: typeof import("matrix-js-sdk").createClient;
  SyncState: typeof import("matrix-js-sdk").SyncState;
};
const { MemoryStore } = memoryStoreModule as {
  MemoryStore: typeof import("matrix-js-sdk").MemoryStore;
};

let indexedDbReady = false;

async function ensureMatrixIndexedDb(params: {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): Promise<void> {
  if (indexedDbReady) return;
  if (typeof globalThis.indexedDB !== "undefined") {
    indexedDbReady = true;
    return;
  }
  const basePath = resolveMatrixCryptoStoreBasePath({
    env: params.env,
    homedir: params.homedir,
  });
  await fs.mkdir(basePath, { recursive: true, mode: 0o700 });
  if (!("window" in globalThis)) {
    (globalThis as typeof globalThis & { window: typeof globalThis }).window =
      globalThis;
  }
  if (!("location" in globalThis)) {
    (globalThis as typeof globalThis & { location: { origin: string } }).location =
      { origin: "file:///" };
  }
  const module = await import("indexeddbshim/src/node-UnicodeIdentifiers");
  const setGlobalVars =
    "default" in module ? module.default : (module as unknown as () => void);
  setGlobalVars(undefined, {
    databaseBasePath: basePath,
    checkOrigin: false,
  });
  indexedDbReady = true;
}

function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Matrix serverUrl is required");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return `https://${trimmed}`.replace(/\/+$/, "");
}

function resolveEnvValue(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const match = /^env:(.+)$/i.exec(trimmed);
  if (!match) return trimmed;
  const value = env[match[1]?.trim() ?? ""];
  return value?.trim() ?? "";
}

export async function createMatrixClient(params: {
  serverUrl: string;
  username: string;
  password: string;
  deviceId?: string;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): Promise<MatrixClient> {
  const serverUrl = normalizeServerUrl(params.serverUrl);
  const env = params.env ?? process.env;
  try {
    await ensureMatrixIndexedDb({ env, homedir: params.homedir });
  } catch (err) {
    console.warn(
      `[matrix] IndexedDB shim init failed; continuing with in-memory crypto store: ${String(
        err,
      )}`,
    );
  }
  const storage = await loadMatrixStorage({
    accountId: params.accountId,
    env,
    homedir: params.homedir,
  });
  const store = new MemoryStore({ localStorage: storage });

  const cached = await readMatrixAuthState({
    accountId: params.accountId,
    env,
    homedir: params.homedir,
  });
  let accessToken = cached?.accessToken?.trim() ?? "";
  let userId = cached?.userId?.trim() ?? "";
  let deviceId = params.deviceId?.trim() || cached?.deviceId?.trim() || "";

  if (!accessToken || !userId || cached?.serverUrl !== serverUrl) {
    const password = resolveEnvValue(params.password, env);
    if (!password) {
      throw new Error("Matrix password is required");
    }
    const loginClient = createClient({ baseUrl: serverUrl });
    const login = await loginClient.loginWithPassword(
      params.username,
      password,
    );
    accessToken = login.access_token;
    userId = login.user_id;
    deviceId = login.device_id ?? deviceId;
    if (!accessToken || !userId) {
      throw new Error("Matrix login failed: missing access token or user id");
    }
    await writeMatrixAuthState({
      accountId: params.accountId,
      env,
      homedir: params.homedir,
      state: {
        accessToken,
        userId,
        deviceId: deviceId || undefined,
        serverUrl,
      },
    });
  }

  const client = createClient({
    baseUrl: serverUrl,
    accessToken,
    userId,
    deviceId: deviceId || undefined,
    store,
  });
  try {
    await client.initRustCrypto({ useIndexedDB: true });
  } catch (err) {
    console.warn(
      `[matrix] Rust crypto store init failed; falling back to in-memory store: ${String(
        err,
      )}`,
    );
    await client.initRustCrypto({ useIndexedDB: false });
  }
  return client;
}

export async function startMatrixSync(
  client: MatrixClient,
  params: {
    accountId?: string | null;
    initialSyncLimit?: number;
    abortSignal?: AbortSignal;
    onEvent: (params: { event: MatrixEvent; room: Room }) => void;
    onError?: (err: Error) => void;
    onSyncState?: (state: MatrixSyncState, data?: SyncStateData) => void;
    env?: NodeJS.ProcessEnv;
    homedir?: () => string;
  },
): Promise<void> {
  const syncState = await readMatrixSyncState({
    accountId: params.accountId,
    env: params.env,
    homedir: params.homedir,
  });
  if (syncState?.nextBatch) {
    client.store.setSyncToken(syncState.nextBatch);
  }

  let restartAttempt = 0;
  let restarting = false;

  const onTimeline = (
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline?: boolean,
    _removed?: boolean,
    _data?: unknown,
  ) => {
    if (!room || toStartOfTimeline) return;
    params.onEvent({ event, room });
  };

  const scheduleRestart = async (err: Error) => {
    if (restarting) return;
    if (params.abortSignal?.aborted) return;
    restarting = true;
    restartAttempt += 1;
    params.onError?.(err);
    const delayMs = computeBackoff(SYNC_BACKOFF, restartAttempt);
    try {
      await sleepWithAbort(delayMs, params.abortSignal);
    } catch {
      restarting = false;
      return;
    }
    if (params.abortSignal?.aborted) {
      restarting = false;
      return;
    }
    try {
      await client.startClient({
        initialSyncLimit: params.initialSyncLimit ?? DEFAULT_SYNC_LIMIT,
      });
    } catch (startErr) {
      restarting = false;
      const error =
        startErr instanceof Error ? startErr : new Error(String(startErr));
      await scheduleRestart(error);
      return;
    }
    restarting = false;
  };

  const onSync = (
    state: MatrixSyncState,
    _prev: MatrixSyncState | null,
    data?: SyncStateData,
  ) => {
    params.onSyncState?.(state, data);
    const nextToken = data?.nextSyncToken?.trim();
    if (nextToken) {
      void writeMatrixSyncState({
        accountId: params.accountId,
        env: params.env,
        homedir: params.homedir,
        state: { nextBatch: nextToken },
      });
    }
    if (state === SyncState.Error) {
      const error =
        data?.error instanceof Error
          ? data.error
          : new Error("Matrix sync error");
      client.stopClient();
      void scheduleRestart(error);
    } else if (state === SyncState.Prepared || state === SyncState.Syncing) {
      restartAttempt = 0;
    }
  };

  const emitter = client as unknown as {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
  };
  emitter.on("Room.timeline", onTimeline as (...args: unknown[]) => void);
  emitter.on("sync", onSync as (...args: unknown[]) => void);

  const stopOnAbort = () => {
    client.stopClient();
  };
  params.abortSignal?.addEventListener("abort", stopOnAbort, { once: true });

  try {
    await client.startClient({
      initialSyncLimit: params.initialSyncLimit ?? DEFAULT_SYNC_LIMIT,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await scheduleRestart(error);
  }
}

export function stopMatrixSync(client: MatrixClient): void {
  client.stopClient();
}

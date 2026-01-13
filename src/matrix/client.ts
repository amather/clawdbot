import crypto from "node:crypto";

import type {
  ICryptoCallbacks,
  MatrixClient,
  MatrixEvent,
  SyncState as MatrixSyncState,
  Room,
  SyncStateData,
} from "matrix-js-sdk";
import type { CryptoStore } from "matrix-js-sdk/lib/crypto/store/base.js";
import type { LocalStorageCryptoStore as LocalStorageCryptoStoreType } from "matrix-js-sdk/lib/crypto/store/localStorage-crypto-store.js";
import localStorageCryptoStoreModule from "matrix-js-sdk/lib/crypto/store/localStorage-crypto-store.js";
import matrixSdk from "matrix-js-sdk/lib/matrix.js";
import type { SecretStorageKeyDescription } from "matrix-js-sdk/lib/secret-storage.js";
import memoryStoreModule from "matrix-js-sdk/lib/store/memory.js";

import { computeBackoff, sleepWithAbort } from "../infra/backoff.js";
import {
  loadMatrixStorage,
  type MatrixCryptoState,
  readMatrixAuthState,
  readMatrixCryptoState,
  readMatrixSyncState,
  updateMatrixSyncState,
  writeMatrixAuthState,
  writeMatrixCryptoState,
} from "./state.js";

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
const { LocalStorageCryptoStore } = localStorageCryptoStoreModule as {
  LocalStorageCryptoStore: typeof LocalStorageCryptoStoreType;
};

async function ensureOlmLoaded(): Promise<void> {
  const globalWithOlm = globalThis as typeof globalThis & { Olm?: unknown };
  if (globalWithOlm.Olm) return;
  const module = await import("@matrix-org/olm");
  const olm = "default" in module ? module.default : module;
  globalWithOlm.Olm = olm;
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

async function ensureMatrixVerificationReady(params: {
  client: MatrixClient;
  userId: string;
  password: string;
}): Promise<void> {
  const { client, userId, password } = params;
  let needsSecretStorage = false;
  let needsCrossSigning = false;

  try {
    needsSecretStorage = !(await client.isSecretStorageReady());
  } catch {
    needsSecretStorage = false;
  }

  try {
    needsCrossSigning = !(await client.isCrossSigningReady());
  } catch {
    needsCrossSigning = false;
  }

  if (needsSecretStorage) {
    await client.bootstrapSecretStorage({
      createSecretStorageKey: async () => ({
        keyInfo: { name: "Clawdbot" },
        privateKey: crypto.randomBytes(32),
      }),
    });
  }

  if (needsCrossSigning) {
    if (!password) {
      throw new Error("Matrix password is required for cross-signing setup");
    }
    await client.downloadKeys([userId], true);
    await client.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: async (makeRequest) => {
        try {
          await makeRequest(null);
          return;
        } catch (err) {
          const session = (err as { data?: { session?: string } })?.data
            ?.session;
          await makeRequest({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: userId },
            password,
            ...(session ? { session } : {}),
          });
        }
      },
    });
  }

  await client.checkOwnCrossSigningTrust({ allowPrivateKeyRequests: true });
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
  const resolvedPassword = resolveEnvValue(params.password, env);
  const storage = await loadMatrixStorage({
    accountId: params.accountId,
    env,
    homedir: params.homedir,
  });
  const store = new MemoryStore({ localStorage: storage });
  const cryptoStore: CryptoStore = new LocalStorageCryptoStore(storage);
  let cryptoState: MatrixCryptoState =
    (await readMatrixCryptoState({
      accountId: params.accountId,
      env,
      homedir: params.homedir,
    })) ?? {};

  const persistCryptoState = (patch: MatrixCryptoState): void => {
    cryptoState = {
      ...cryptoState,
      ...patch,
      crossSigningKeys: {
        ...cryptoState.crossSigningKeys,
        ...patch.crossSigningKeys,
      },
      secretStorageKey: {
        ...cryptoState.secretStorageKey,
        ...patch.secretStorageKey,
      },
    };
    void writeMatrixCryptoState({
      accountId: params.accountId,
      env,
      homedir: params.homedir,
      state: cryptoState,
    });
  };

  const encodeKey = (value: Uint8Array): string =>
    Buffer.from(value).toString("base64");
  const decodeKey = (value?: string): Uint8Array | null => {
    if (!value) return null;
    return Uint8Array.from(Buffer.from(value, "base64"));
  };

  const cryptoCallbacks = {
    getCrossSigningKey: async (type: string, _pubKey: string) => {
      const stored =
        cryptoState.crossSigningKeys?.[
          type as "master" | "self_signing" | "user_signing"
        ];
      return decodeKey(stored);
    },
    saveCrossSigningKeys: (keys: Record<string, Uint8Array>) => {
      const next: MatrixCryptoState["crossSigningKeys"] = {};
      for (const [keyType, keyValue] of Object.entries(keys)) {
        next[keyType as "master" | "self_signing" | "user_signing"] =
          encodeKey(keyValue);
      }
      persistCryptoState({ crossSigningKeys: next });
    },
    getSecretStorageKey: async (
      { keys }: { keys: Record<string, SecretStorageKeyDescription> },
      _name: string,
    ) => {
      const storedKey = decodeKey(cryptoState.secretStorageKey?.privateKey);
      if (!storedKey) return null;
      const storedKeyId = cryptoState.secretStorageKey?.keyId;
      if (storedKeyId && keys[storedKeyId]) {
        return [storedKeyId, storedKey] as const;
      }
      const candidates = Object.keys(keys);
      if (candidates.length !== 1) return null;
      return [candidates[0], storedKey] as const;
    },
    cacheSecretStorageKey: (
      keyId: string,
      _keyInfo: SecretStorageKeyDescription,
      key: Uint8Array,
    ) => {
      persistCryptoState({
        secretStorageKey: { keyId, privateKey: encodeKey(key) },
      });
    },
  } satisfies ICryptoCallbacks;

  const cached = await readMatrixAuthState({
    accountId: params.accountId,
    env,
    homedir: params.homedir,
  });
  let accessToken = cached?.accessToken?.trim() ?? "";
  let userId = cached?.userId?.trim() ?? "";
  let deviceId = params.deviceId?.trim() || cached?.deviceId?.trim() || "";

  if (!accessToken || !userId || cached?.serverUrl !== serverUrl) {
    if (!resolvedPassword) {
      throw new Error("Matrix password is required");
    }
    const loginClient = createClient({ baseUrl: serverUrl });
    const login = await loginClient.loginWithPassword(
      params.username,
      resolvedPassword,
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
    cryptoStore,
    cryptoCallbacks,
  });
  await ensureOlmLoaded();
  await client.initCrypto();
  // Allow sending to unverified devices; align with other providers' defaults.
  client.setGlobalErrorOnUnknownDevices(false);
  try {
    await ensureMatrixVerificationReady({
      client,
      userId,
      password: resolvedPassword,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Matrix self-verification failed";
    console.warn(`[matrix] ${message}`);
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
    room: Room,
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
    _prev: MatrixSyncState,
    data?: SyncStateData,
  ) => {
    params.onSyncState?.(state, data);
    const nextToken = data?.nextSyncToken?.trim();
    if (nextToken) {
      void updateMatrixSyncState({
        accountId: params.accountId,
        env: params.env,
        homedir: params.homedir,
        patch: (prev) => ({
          ...prev,
          nextBatch: nextToken,
        }),
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

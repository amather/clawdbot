import type { ClawdbotConfig } from "../../../config/config.js";
import type { DmPolicy } from "../../../config/types.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../../../routing/session-key.js";
import {
  listMatrixAccountIds,
  resolveDefaultMatrixAccountId,
  resolveMatrixAccount,
} from "../../../matrix/accounts.js";
import { formatDocsLink } from "../../../terminal/links.js";
import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
} from "../onboarding-types.js";
import { addWildcardAllowFrom, promptAccountId } from "./helpers.js";

const channel = "matrix" as const;

function setMatrixDmPolicy(cfg: ClawdbotConfig, dmPolicy: DmPolicy) {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.matrix?.allowFrom)
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      matrix: {
        ...cfg.channels?.matrix,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Matrix",
  channel,
  policyKey: "channels.matrix.dmPolicy",
  allowFromKey: "channels.matrix.allowFrom",
  getCurrent: (cfg) => cfg.channels?.matrix?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setMatrixDmPolicy(cfg, policy),
};

export const matrixOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  dmPolicy,
  getStatus: async ({ cfg }) => {
    const configured = listMatrixAccountIds(cfg).some((accountId) =>
      resolveMatrixAccount({ cfg, accountId }).configured,
    );
    return {
      channel,
      configured,
      statusLines: [
        `Matrix: ${configured ? "configured" : "needs credentials"}`,
      ],
      selectionHint: configured ? "configured" : "needs credentials",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
  }) => {
    const matrixOverride = accountOverrides.matrix?.trim();
    const defaultMatrixAccountId = resolveDefaultMatrixAccountId(cfg);
    let matrixAccountId = matrixOverride
      ? normalizeAccountId(matrixOverride)
      : defaultMatrixAccountId;
    if (shouldPromptAccountIds && !matrixOverride) {
      matrixAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "Matrix",
        currentId: matrixAccountId,
        listAccountIds: listMatrixAccountIds,
        defaultAccountId: defaultMatrixAccountId,
      });
    }

    const resolved = resolveMatrixAccount({
      cfg,
      accountId: matrixAccountId,
    });

    await prompter.note(
      [
        "Tip: passwords can be stored as env:MY_VAR.",
        `Docs: ${formatDocsLink("/channels/matrix", "matrix")}`,
      ].join("\n"),
      "Matrix credentials",
    );

    const serverUrl = String(
      await prompter.text({
        message: "Matrix server URL",
        placeholder: "https://matrix.org",
        initialValue: resolved.serverUrl || undefined,
        validate: (value) => (value?.trim() ? undefined : "Required"),
      }),
    ).trim();
    const username = String(
      await prompter.text({
        message: "Matrix username",
        placeholder: "@user:matrix.org",
        initialValue: resolved.username || undefined,
        validate: (value) => (value?.trim() ? undefined : "Required"),
      }),
    ).trim();
    const password = String(
      await prompter.text({
        message: "Matrix password",
        placeholder: "env:MATRIX_PASSWORD",
        validate: (value) => (value?.trim() ? undefined : "Required"),
      }),
    ).trim();

    let next = cfg;
    if (matrixAccountId === DEFAULT_ACCOUNT_ID) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          matrix: {
            ...next.channels?.matrix,
            enabled: true,
            serverUrl,
            username,
            password,
          },
        },
      };
    } else {
      next = {
        ...next,
        channels: {
          ...next.channels,
          matrix: {
            ...next.channels?.matrix,
            enabled: true,
            accounts: {
              ...next.channels?.matrix?.accounts,
              [matrixAccountId]: {
                ...next.channels?.matrix?.accounts?.[matrixAccountId],
                enabled:
                  next.channels?.matrix?.accounts?.[matrixAccountId]?.enabled ??
                  true,
                serverUrl,
                username,
                password,
              },
            },
          },
        },
      };
    }

    return { cfg: next, accountId: matrixAccountId };
  },
};

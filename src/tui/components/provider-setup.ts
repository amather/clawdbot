import {
  Input,
  type Component,
  truncateToWidth,
} from "@mariozechner/pi-tui";

import type { ClawdbotConfig } from "../../config/config.js";
import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
} from "../../routing/session-key.js";
import { resolveMatrixAccount } from "../../matrix/accounts.js";
import { theme } from "../theme/theme.js";

type MatrixSetupValues = {
  accountId: string;
  name?: string;
  serverUrl: string;
  username: string;
  password: string;
};

type MatrixSetupParams = {
  cfg: ClawdbotConfig;
  onSubmit: (values: MatrixSetupValues) => void;
  onCancel: () => void;
};

type MatrixSetupField = {
  id: "accountId" | "name" | "serverUrl" | "username" | "password";
  label: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
};

export function createMatrixSetupWizard(params: MatrixSetupParams): Component {
  return new MatrixSetupWizard(params);
}

class MatrixSetupWizard implements Component {
  private cfg: ClawdbotConfig;
  private input: Input;
  private fields: MatrixSetupField[];
  private index = 0;
  private error = "";
  private existingPassword = "";
  private onSubmit: (values: MatrixSetupValues) => void;
  private onCancel: () => void;

  constructor(params: MatrixSetupParams) {
    this.cfg = params.cfg;
    this.onSubmit = params.onSubmit;
    this.onCancel = params.onCancel;
    this.fields = [
      {
        id: "accountId",
        label: "Account id",
        placeholder: "default",
        required: false,
        value: DEFAULT_ACCOUNT_ID,
      },
      {
        id: "name",
        label: "Display name (optional)",
        placeholder: "Work Matrix",
        required: false,
      },
      {
        id: "serverUrl",
        label: "Matrix server URL",
        placeholder: "https://matrix.org",
        required: true,
      },
      {
        id: "username",
        label: "Matrix username",
        placeholder: "@user:matrix.org",
        required: true,
      },
      {
        id: "password",
        label: "Matrix password",
        placeholder: "env:MATRIX_PASSWORD",
        required: true,
      },
    ];
    this.input = new Input();
    this.input.onSubmit = (value) => this.handleSubmit(value);
    this.input.onEscape = () => this.onCancel();
    this.applyFieldValue();
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const field = this.fields[this.index];
    if (!field) return [];
    const lines: string[] = [];
    lines.push(theme.header("Matrix setup"));
    lines.push(
      theme.dim(
        truncateToWidth(
          `Step ${this.index + 1}/${this.fields.length} · Esc to cancel`,
          width,
          "",
        ),
      ),
    );
    lines.push("");
    const label = field.placeholder
      ? `${field.label} (${field.placeholder})`
      : field.label;
    lines.push(truncateToWidth(label, width, ""));
    if (this.error) {
      lines.push(theme.error(truncateToWidth(this.error, width, "")));
    }
    lines.push("");
    lines.push(...this.input.render(width));
    return lines;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  private applyFieldValue() {
    const field = this.fields[this.index];
    const value = field?.value ?? "";
    this.input.setValue(value);
    this.error = "";
  }

  private handleSubmit(raw: string) {
    const field = this.fields[this.index];
    if (!field) return;
    const value = String(raw ?? "");
    const trimmed = value.trim();
    if (field.required && !trimmed) {
      this.error = "Required";
      return;
    }
    field.value = trimmed;

    if (field.id === "accountId") {
      const normalized = normalizeAccountId(trimmed || DEFAULT_ACCOUNT_ID);
      field.value = normalized;
      this.applyExistingValues(normalized);
    }

    if (this.index >= this.fields.length - 1) {
      this.finish();
      return;
    }
    this.index += 1;
    this.applyFieldValue();
  }

  private applyExistingValues(accountId: string) {
    const resolved = resolveMatrixAccount({
      cfg: this.cfg,
      accountId,
    });
    const byId = (id: MatrixSetupField["id"]) =>
      this.fields.find((entry) => entry.id === id);
    const nameField = byId("name");
    const serverField = byId("serverUrl");
    const userField = byId("username");
    const passField = byId("password");

    if (nameField && !nameField.value && resolved.name) {
      nameField.value = resolved.name;
    }
    if (serverField) {
      serverField.value = resolved.serverUrl || serverField.value;
      serverField.required = !serverField.value?.trim();
    }
    if (userField) {
      userField.value = resolved.username || userField.value;
      userField.required = !userField.value?.trim();
    }
    if (passField) {
      this.existingPassword = resolved.password || "";
      passField.value = "";
      passField.required = !this.existingPassword;
    }
  }

  private finish() {
    const valueMap = new Map(
      this.fields.map((field) => [field.id, field.value ?? ""]),
    );
    const accountId = normalizeAccountId(
      valueMap.get("accountId")?.trim() || DEFAULT_ACCOUNT_ID,
    );
    const name = valueMap.get("name")?.trim() || "";
    const serverUrl = valueMap.get("serverUrl")?.trim() || "";
    const username = valueMap.get("username")?.trim() || "";
    const password =
      valueMap.get("password")?.trim() || this.existingPassword;

    if (!serverUrl || !username || !password) {
      this.error = "All required fields must be set.";
      this.index = this.fields.findIndex((field) => {
        if (field.id === "serverUrl") return !serverUrl;
        if (field.id === "username") return !username;
        if (field.id === "password") return !password;
        return false;
      });
      this.applyFieldValue();
      return;
    }

    this.onSubmit({
      accountId,
      name: name || undefined,
      serverUrl,
      username,
      password,
    });
  }
}

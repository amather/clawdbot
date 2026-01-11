# Matrix client support design doc

## Summary
Add Matrix as a first-class chat provider in Clawdbot with a consistent setup
experience across CLI, TUI, and UI surfaces. The initial scope targets a
username/password login against a Matrix homeserver (server URL), with parity
to other providers for config, status, and onboarding.

## Goals
- Provide Matrix as a selectable provider in all provider lists.
- Support login with server URL, username, and password.
- Persist configuration in `clawdbot.json` using existing provider patterns.
- Surface provider status via CLI (`providers status`, `gateway status`) and UI.
- Provide setup flows in CLI wizard, TUI, and web/macOS settings.

## Non-goals (initial release)
- SSO/OIDC flows.
- E2E encryption key management.
- Multi-account advanced routing beyond the existing provider model.
- Server admin or federation management tooling.

## User experience

### CLI setup
- `clawdbot providers add matrix` prompts for:
  - Homeserver URL
  - Username (localpart or full `@user:server`)
  - Password
- `clawdbot providers list` shows Matrix accounts.
- `clawdbot providers status` shows configured / reachable / authenticated.
- `clawdbot providers login matrix` re-auths if credentials are rotated.

### TUI setup
- Add Matrix to the providers list and setup action menu.
- TUI fields mirror CLI prompts (server, username, password).
- Status badge and last error surfaced in the TUI provider detail view.

### Web UI / macOS UI
- Add Matrix to provider list tiles.
- Settings form fields: server URL, username, password.
- Save and validate button states aligned with other providers.
- Show status (connected / auth error / needs login).

## Configuration model

### Proposed config shape (JSON5)
```json5
{
  providers: {
    matrix: {
      accounts: {
        default: {
          enabled: true,
          serverUrl: "https://matrix.example.com",
          username: "@alice:example.com",
          password: "env:CLAWDBOT_MATRIX_PASSWORD"
        }
      }
    }
  }
}
```

### Notes
- Reuse the existing provider config container patterns (accounts map, enabled).
- Support `env:` values for secrets, consistent with other providers.
- Avoid logging secrets; any debug output must redact passwords.

## Provider plugin architecture

### New provider plugin
- `src/providers/plugins/matrix.ts`
- Implements `ConnectionProvider` with:
  - Config schema validation
  - Account list and account id resolution
  - Login, logout, status checks
  - Message send/receive wiring

### Registry wiring
- Add Matrix to `src/providers/plugins/index.ts` and registry list.
- Define label, default sort order, and any setup hints.

### Provider lifecycle
- Startup: validate config, attempt login, and surface status.
- On error: emit actionable error codes/messages for UI and CLI.
- On config change: reload accounts with minimal disruption.

## Transport and protocol design

### Client
- Use the official Matrix JS SDK (`matrix-js-sdk`) as the primary client library.
  - It is the reference client SDK used by Element web/desktop.
  - Fits the repo constraints: Node 22+ and TypeScript, ESM-friendly.
  - Supports password login + sync loop + media, matching the requirement to
    log in with a real Matrix user account and send/receive messages.
  - Provides end-to-end encryption support (required for user-account flows).
- Map Matrix room events to Clawdbot message events.
- Alternative (bot/appservice mode only):
  - `matrix-bot-sdk` is a popular bot/appservice SDK, but it targets bot-style
    deployments and does not prioritize full client parity or E2E features.

### Identity and mapping
- Map Matrix user IDs to Clawdbot sender identities.
- Map Matrix room IDs to Clawdbot conversation IDs.
- Store minimal mapping state in existing provider state dir.

### Attachment handling
- Integrate Matrix media downloads/uploads into the media pipeline.
- Respect existing size limits and content-type handling.

## Alignment with existing providers (WhatsApp/Signal)

### Adopt existing patterns
- Follow the provider plugin shape and lifecycle used by WhatsApp/Signal.
- Use the same config container patterns (accounts map, enabled flag).
- Reuse provider status rendering and error reporting conventions.
- Use the shared media pipeline for attachments and content-type handling.
- Align CLI/TUI setup flows with existing provider auth prompts.
 - Treat Matrix as a user-account integration like WhatsApp (Baileys) and
   Signal (signal-cli): authenticate a real account, not an appservice bot.

### Areas that need different handling
- **Matrix sync loop:** Matrix uses sync tokens and incremental sync; we need a
  dedicated sync runner modeled after provider polling loops but adapted for
  Matrix event semantics.
- **Identity mapping:** Matrix user IDs and room IDs require explicit mapping
  to Clawdbot sender and conversation IDs; this is more explicit than some
  providers and may require a small interface extension to expose room metadata.
- **E2E encryption (v1):** Include encryption support from the start. This may
  require additional provider-level state management beyond what WhatsApp/Signal
  currently store, and may justify a provider-specific state adapter.

### Interface extensions (if needed)
- Provider interface should allow:
  - A long-running sync loop with checkpointing (sync token storage).
  - Explicit room metadata exposure (name, topic, member count).
  - Encryption key lifecycle hooks (bootstrap, rotation, recovery).

## UI and TUI design details

### UI fields
- Server URL (required, validated as URL)
- Username (required)
- Password (required, masked)
- Enabled toggle
- Status line (connected / needs login / error message)

### TUI workflow
- Providers list with Matrix entry
- Setup/edit form with inline validation
- Status panel updates on save and on reconnect attempts

### Control UI access
- Control UI remains served by the gateway; Matrix is a provider setting.
- Ensure provider configuration is reflected in the Control UI provider list.

## Security considerations
- Never log raw passwords or access tokens.
- Prefer `env:` secret references in docs and examples.
- Ensure config redaction in status output and diagnostics.

## Docs
- Add `docs/providers/matrix.md` with setup, troubleshooting, and limits.
- Add Matrix entry to provider index listings.
- Use root-relative links in `docs/**`.

## Testing plan
- Config schema validation for Matrix fields.
- Provider registry test update (list ordering, presence).
- Provider add/update flow tests (CLI/TUI).
- Status snapshot updates if providers are enumerated.

## Rollout plan
1. Add config schema and provider plugin scaffolding.
2. Wire into provider registry and CLI flows.
3. Update UI/TUI surfaces.
4. Add docs and tests.
5. Run `pnpm lint`, `pnpm build`, `pnpm test`.

## Decisions (confirmed)
- Choose a Matrix client library that fits repo constraints and license.
- Support device IDs and access tokens for re-login.
- Include a minimal E2E encryption story in v1.

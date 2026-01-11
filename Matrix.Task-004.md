# Matrix Task 004: CLI + TUI setup flows

## Goal
Provide Matrix setup via CLI and TUI, aligned with WhatsApp/Signal flows.

## Scope
- CLI provider add/login flows
- TUI provider setup screen and status
- Provider config wizard integration (if applicable)

## Steps
1) CLI provider auth prompts
   - Update `src/cli/provider-auth.ts` to add Matrix prompts:
     - Server URL
     - Username
     - Password (masked)
   - Ensure password is not echoed/logged.
   - Follow the same prompt/validation pattern as Signal/Telegram.

2) CLI provider add/update
   - Wire Matrix into `providers add` / `providers edit` flows:
     - `src/commands/providers/add.ts`
     - `src/commands/providers/add-mutators.ts`
   - Validate inputs (URL, username, password).
   - Ensure `applyAccountConfig` is used (from Task 002).

3) CLI provider login
   - Add `providers login matrix` path if present for other providers.
   - Trigger a re-auth / token refresh using stored credentials.
   - Ensure login errors surface in `providers status`.

4) TUI setup screens
   - Locate existing TUI provider config surface (if any).
   - If missing, add a new TUI command + view for provider setup:
     - Wire into `src/tui/commands.ts` and `src/tui/tui.ts`.
     - Add a simple form view under `src/tui/components` or `src/tui/views`.
   - Add Matrix to provider list in that TUI surface.
   - Provide setup/edit form with the same fields as CLI.
   - Display status and last error in TUI (reuse provider status hooks).

5) Onboarding wizard
   - Add Matrix as a provider option to the onboarding flow:
     - Check `src/wizard/onboarding.ts` and `src/commands/configure.ts`.
   - Ensure the wizard respects `--skip-providers`.

## Deliverables
- CLI prompts and provider add/edit/login flows updated.
- TUI screens list Matrix and allow configuration.

## Notes (alignment)
- Keep prompts and copy aligned with WhatsApp/Signal wording.
- Use the same validation helpers as other providers.

## Checklist
- [ ] CLI prompts added in `src/cli/provider-auth.ts`
- [ ] Matrix wired into `providers add` + `providers edit`
- [ ] `providers login matrix` path implemented
- [ ] TUI provider setup surface updated or created
- [ ] Onboarding flow includes Matrix option

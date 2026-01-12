# Matrix Task 005: UI surfaces (web/macOS/mobile)

## Goal
Expose Matrix configuration and status in all UI surfaces, keeping provider
lists and settings aligned with WhatsApp/Signal.

## Scope
- Web Control UI provider list + settings form
- macOS app provider list + settings form
- Mobile (iOS/Android) provider list + settings form (if applicable)

## Steps
1) Provider list entries
   - Add Matrix to provider list enumerations:
     - Web UI (`ui/src/ui/views/config-form.ts`, `ui/src/ui/controllers/config.ts`,
       `ui/src/ui/controllers/connections.ts`, `ui/src/ui/ui-types.ts`)
     - macOS app provider list (locate provider enum in `apps/macos/Sources`)
     - Mobile provider list (check `apps/ios` and `apps/android` if they expose providers)
   - Ensure ordering matches other providers.

2) Settings forms
   - Add fields:
     - Server URL
     - Username
     - Password (masked)
     - Enabled toggle
     - Auto-join room allowlist (room ids/aliases, wildcard support)
   - Persist to `matrix.accounts.<id>` using the standard config API.
   - Add a Matrix form state in web UI (similar to `signalForm` in
     `ui/src/ui/controllers/connections.ts`).
   - Use the same form layout and validation patterns as WhatsApp/Signal.
   - Keep advanced settings (auto-join list) grouped separately from core credentials.

3) Status rendering
   - Surface configured/connected/error state for Matrix accounts.
   - Show last error reason if available (auth, sync, media).
   - Reuse provider status hooks from the gateway where possible.
   - Note: auto-join only triggers for allowed rooms (no blind joins).

4) UI copy + labels
   - Follow WhatsApp/Signal phrasing for consistency.
   - Avoid exposing secrets in UI logs or status cards.

5) Cross-surface sync
   - Ensure provider list and settings are consistent across web/macOS/mobile.
   - Update any shared UI provider enums or maps once.

## Deliverables
- Matrix appears in UI provider lists and settings.
- Status and error surfaces reflect runtime state.

## Notes (alignment)
- Keep UI structure consistent with WhatsApp/Signal.
- Do not introduce unique UI flows unless required by Matrix specifics.

## Checklist
- [ ] Web UI provider list includes Matrix
- [ ] Web UI config form includes Matrix fields
- [ ] macOS app provider list + settings updated
- [ ] Mobile provider list + settings updated (if present)
- [ ] Status and error rendering for Matrix is visible in UI surfaces

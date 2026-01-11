# Matrix Task 003: Matrix client integration

## Goal
Implement the Matrix runtime: login, sync loop, send/receive, and media, using
`matrix-js-sdk` with user/password credentials.

## Scope
- Create Matrix client wrapper under `src/matrix/`.
- Implement sync loop and event handling.
- Wire outbound send and inbound message normalization.
- Integrate media upload/download with existing media pipeline.

## Steps
1) Matrix client wrapper
   - Add `src/matrix/client.ts` with:
     - `createMatrixClient({ serverUrl, username, password, deviceId? })`
     - `startMatrixSync(client, { onEvent, onError })`
     - `stopMatrixSync(client)`
   - Use `matrix-js-sdk` login APIs for user/password.
   - Cache access token + device ID to provider state dir (avoid re-login).
   - Initialize E2E via `initRustCrypto` and persist crypto state.

2) Provider state storage
   - Create `src/matrix/state.ts` for:
     - Sync token persistence (for incremental sync)
     - Device ID + access token cache
     - Encryption storage path and bootstrap state
   - Align state paths with existing provider state patterns.

3) Inbound event mapping
   - Add `src/matrix/inbound.ts` to map Matrix events into the shared
     provider envelope used by Signal/WhatsApp.
   - Map:
     - Room DM vs group -> `chatType`
     - Sender IDs -> Clawdbot sender identity
     - Message text -> text payload
     - Media events -> download + attach via media pipeline
   - Normalize room IDs into provider conversation IDs.

4) Outbound send
   - Add `src/matrix/send.ts`:
     - Send text (use chunking limits similar to Signal/WhatsApp).
     - Send media (upload -> send).
     - Reply/mention support if Matrix event context allows it.
   - Use `resolveProviderMediaMaxBytes` and shared media helpers.

5) Sync loop + resiliency
   - Ensure sync loop handles:
     - Backoff/retry on failures
     - Sync token persistence
     - Room membership updates
   - Emit provider status updates on auth failure or sync stall.

6) Provider plugin wiring
   - Extend `src/providers/plugins/matrix.ts` to:
     - Start the Matrix client on init.
     - Attach inbound event handler.
     - Register outbound send hooks.
     - Clean shutdown on reload and config changes.
   - Follow WhatsApp/Signal provider lifecycle patterns.

7) Status checks
   - Add `src/providers/plugins/status-issues/matrix.ts` (if pattern exists).
   - Surface:
     - Login failed / auth error
     - Sync stalled
     - Media upload failure

## Deliverables
- `src/matrix/client.ts`, `state.ts`, `inbound.ts`, `send.ts`.
- Matrix provider plugin wired to runtime.

## Notes (alignment)
- Use the same inbound/outbound envelope shaping as Signal/WhatsApp.
- Avoid introducing a new messaging model unless required by Matrix semantics.

## Checklist
- [ ] `src/matrix/client.ts` created with login + sync lifecycle
- [ ] `src/matrix/state.ts` handles tokens/sync/encryption state
- [ ] `src/matrix/inbound.ts` maps events to provider envelope
- [ ] `src/matrix/send.ts` supports text + media sends
- [ ] Matrix plugin starts/stops client and hooks inbound/outbound
- [ ] Status issues surfaced for auth/sync/media failures

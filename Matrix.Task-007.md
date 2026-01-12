# Matrix Task 007: E2EE support

## Goal
Enable end-to-end encrypted Matrix rooms and DMs so inbound messages decrypt
and replies work in encrypted sessions.

## Scope
- Persistent crypto state for matrix-js-sdk (device keys + sessions).
- Decrypt inbound events (`m.room.encrypted`) and route to existing inbound flow.
- Handle key sharing/to-device requests so encrypted sessions can be opened.
- Keep non-E2EE rooms working unchanged.

## Steps
1) Crypto storage
   - Use libolm + `LocalStorageCryptoStore` backed by file storage.
   - Persist crypto data in `local-storage.json`.
   - Ensure restart safety (reuse device id + keys).

2) Decryption pipeline
   - Detect encrypted events and attempt decryption.
   - Feed decrypted payloads into existing inbound mapping.
   - Log clear errors for decrypt failures (no secrets).

3) Key exchange
   - Use libolm key requests for missing sessions.
   - Allow replies when devices are unverified (mark known + disable errors).
   - Document cases where senders must share keys or verify the bot.

4) Config + docs
   - If needed, add config toggles (e.g., `matrix.e2ee.enabled`).
   - Document required client steps if any.

## Implementation notes
- Crypto store: `LocalStorageCryptoStore` over `MatrixFileStorage`
  (`~/.clawdbot/matrix/<account>/local-storage.json`).
- Cross-signing + secret storage bootstrap on startup to self-verify the
  Matrix device (removes "device not verified by its owner" warnings).
- Secret storage key + cross-signing private keys cached to
  `~/.clawdbot/matrix/<account>/crypto-secrets.json`.
- Decrypt inbound events before mapping; drop messages that fail decryption.
- Bot replies allow unverified devices (disable unknown-device errors).
- Pairing required for DM replies when `dmPolicy=pairing` (default).
- On DM send, prefetch devices + mark as known (best-effort) to reduce
  unknown-device send failures.
- Added Matrix device reset action (gateway + UI/TUI), which clears
  `auth.json`, `local-storage.json`, `sync.json`, `crypto-secrets.json`,
  and the legacy `crypto/` store for the account.

## Debugging notes (2026-01-12)
- IndexedDB shim + rust-crypto store threw `TransactionInactiveError`;
  switched to libolm + LocalStorageCryptoStore for persistence.
- Matrix clients will not send room keys to unverified devices by default.
  After device reset (delete `auth.json`), a fresh DM + pairing worked.
- Observed errors:
  - `The sender's device has not sent us the keys for this message.`
  - `This message was sent before this device logged in, and there is no key backup.`
- Suggested UI/TUI action: expose "Reset Matrix device" (re-login) and
  instructions for key sharing/verification.
  Reset should clear both auth and crypto store files for a clean device.
  Also consider a toggle for "Allow unverified devices" to document the
  default behavior of sending despite unknown devices.

## Deliverables
- Encrypted Matrix DMs and rooms receive replies.
- Crypto state survives restarts.
- Clear errors when decryption fails.

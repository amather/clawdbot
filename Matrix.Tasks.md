# Matrix protocol integration tasks

This file is the top-level tracker for the Matrix provider implementation.
Each task below links to a detailed design/implementation plan file.
If work is interrupted, restart from here and continue in order.

## Task index
- Matrix.Task-001.md — Library selection, dependency wiring, and config schema
- Matrix.Task-002.md — Provider plugin scaffold, DM policy, and setup hooks
- Matrix.Task-003.md — Matrix runtime: login, sync, send/receive, media
- Matrix.Task-004.md — CLI + TUI setup flows and provider tooling
- Matrix.Task-005.md — UI surfaces (web/macOS/mobile) and settings UX
- Matrix.Task-006.md — End-to-end targeting, tests, docs, verification
- Matrix.Task-007.md — Matrix E2EE support (crypto storage, device handling, decryption)

## Ordering rationale
1) Lock in the library and config schema before touching provider logic.
2) Build the provider plugin scaffold + DM policy/pairing alignment.
3) Implement the Matrix runtime (login, sync, send/receive, media).
4) Expose setup flows (CLI + TUI) so configuration can be driven interactively.
5) Update UI surfaces to keep provider lists and forms in sync.
6) Verify real targeting (Matrix user -> Clawdbot), then tests + docs.
7) Add E2EE support (crypto store, decrypt inbound, key sharing).

## General rules
- Always align implementation patterns with WhatsApp/Signal provider logic.
- Use `matrix-js-sdk` (user-account login) unless requirements change.
- Avoid logging secrets; redact or exclude passwords/tokens.
- Keep all config paths and UI labels consistent with existing provider naming.

## Progress checklist
- [ ] Matrix.Task-001.md complete (dependency + config schema)
- [ ] Matrix.Task-002.md complete (provider scaffold + setup hooks)
- [ ] Matrix.Task-003.md complete (runtime integration)
- [ ] Matrix.Task-004.md complete (CLI + TUI setup)
- [ ] Matrix.Task-005.md complete (UI surfaces)
- [ ] Matrix.Task-006.md complete (end-to-end targeting + tests/docs)
- [ ] Matrix.Task-007.md complete (E2EE support)

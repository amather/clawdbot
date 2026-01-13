# Matrix Task 006: Tests, docs, verification

## Goal
Finalize Matrix integration with end-to-end targeting, tests, documentation,
and verification steps.

## Human approval required
This task requires human approval and access to real Matrix accounts/rooms for
end-to-end validation. Do not proceed with the live targeting steps without
explicit approval from the owner.

## Scope
- End-to-end targeting validation (Matrix user -> Clawdbot)
- Unit/integration tests
- Provider docs
- Build/lint/test verification

## Steps
1) End-to-end targeting validation (must pass before release)
   - Configure Matrix via UI and CLI:
     - UI: add Matrix provider with server URL + username + password.
     - CLI: `clawdbot providers add matrix` and confirm config saved.
   - Verify DM policy + pairing alignment with WhatsApp/Signal:
     - Default DM policy is pairing.
     - `clawdbot pairing list matrix` shows pending pairs.
     - Approve via `clawdbot pairing approve matrix <CODE>`.
   - Send a message from a separate Matrix user to the bot:
     - Confirm it is ignored before pairing.
     - Confirm it is routed after pairing.
   - Send a message from the bot to a Matrix user:
     - Use CLI target format (`matrix:@user:server` or `matrix:room:<roomId>`).
   - Validate media send/receive (image upload + download).

2) Tests
   - Config schema tests for Matrix fields.
   - Provider registry tests to include Matrix.
   - Provider status tests (configured/unconfigured).
   - Minimal runtime tests for Matrix client wrapper (mocked).
   - Suggested locations:
     - `src/config/schema.test.ts`
     - `src/config/validation.ts` or `src/config/zod-schema.ts` tests
     - `src/providers/plugins/index.test.ts`
     - `src/providers/plugins/status.test.ts` (if present)

3) Docs
   - Add `docs/providers/matrix.md`:
     - Setup steps
     - Config reference
     - Troubleshooting
     - Limitations (E2E requirements, device management)
   - Update provider index pages to list Matrix.
   - Use root-relative links in `docs/**`.

4) Verification
   - Run `pnpm lint`.
   - Run `pnpm build`.
   - Run `pnpm test`.
   - Validate CLI flow:
     - `clawdbot providers add matrix`
     - `clawdbot providers status`
     - Send/receive messages in a test room.

## Deliverables
- Tests updated and passing.
- Docs updated and linked.

## Notes (alignment)
- Follow WhatsApp/Signal docs structure and wording.

## Checklist
- [ ] End-to-end Matrix message flow validated (pre/post pairing)
- [ ] Media send/receive validated
- [ ] Reply formatting uses Matrix `formatted_body` for markdown (safe HTML)
- [ ] Config schema tests updated
- [ ] Provider registry tests updated
- [ ] Status tests updated
- [ ] `docs/providers/matrix.md` added and linked
- [ ] `pnpm lint`, `pnpm build`, `pnpm test` run

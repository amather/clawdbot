# Matrix Task 001: Library + config schema

## Goal
Introduce the Matrix client dependency and add configuration schema support
that matches existing provider patterns (WhatsApp/Signal).

## Scope
- Add `matrix-js-sdk` dependency to `package.json`.
- Define config types and schema entries for Matrix accounts.
- Ensure config serialization supports `env:` secrets for passwords.
- Keep config naming consistent with other providers.

## Steps
1) Dependency add
   - Add `matrix-js-sdk` to `dependencies` in `package.json`.
   - Keep Node 22+ compatibility (same as repo baseline).
   - Do not update the Carbon dependency.

2) Config types (TypeScript)
   - Update `src/config/types.ts` to add Matrix provider shapes:
     - Top-level `matrix` section with `enabled`.
     - `matrix.accounts.<accountId>` with `enabled`, `name`, `serverUrl`,
       `username`, `password`, `dmPolicy`, `allowFrom`.
     - Optional top-level defaults: `matrix.dmPolicy`, `matrix.allowFrom`.
   - Mirror WhatsApp/Signal account naming and optional `name`.

3) Config schema (runtime validation)
   - Update `src/config/zod-schema.ts` to validate Matrix accounts.
   - Update `src/config/schema.ts` if it lists fields for UI/help text.
   - Required for login:
     - `serverUrl` (URL)
     - `username` (string)
     - `password` (string; allow `env:` values)
   - Optional:
     - `name`
     - `enabled`
     - `dmPolicy` (`pairing | allowlist | open | disabled`, aligned with Signal)
     - `allowFrom` (string array, supports "*" and Matrix IDs)
   - Confirm validation error style matches other providers.

4) Config helpers (accounts)
   - Create `src/matrix/accounts.ts` with helpers modeled after:
     - `src/signal/accounts.ts`
     - `src/web/accounts.ts`
   - Implement:
     - `listMatrixAccountIds(cfg)`
     - `resolveDefaultMatrixAccountId(cfg)`
     - `resolveMatrixAccount({ cfg, accountId })`
   - Use `DEFAULT_ACCOUNT_ID` and account map semantics from other providers.

5) Secret handling (redaction)
   - Confirm config redaction covers Matrix secrets:
     - Check `SENSITIVE_PATTERNS` in `src/config/schema.ts`.
     - Ensure Matrix password is not logged or exposed in snapshots.

## Deliverables
- `package.json` updated with `matrix-js-sdk`.
- Config type + schema updates.
- `src/matrix/accounts.ts` (or equivalent provider helper file).

## Notes (alignment)
- Match Signal/WhatsApp account config naming conventions.
- Do not introduce new config layout variants.

## Checklist
- [ ] `package.json` updated with `matrix-js-sdk`
- [ ] `src/config/types.ts` includes Matrix provider types
- [ ] `src/config/zod-schema.ts` validates Matrix account fields
- [ ] `src/config/schema.ts` includes Matrix fields where needed
- [ ] `src/matrix/accounts.ts` implemented and used
- [ ] Secret redaction verified for Matrix password

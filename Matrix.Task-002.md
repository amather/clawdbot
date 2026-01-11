# Matrix Task 002: Provider plugin scaffold

## Goal
Create the Matrix provider plugin scaffold aligned with WhatsApp/Signal
provider structure and plug it into provider registry/lists.

## Scope
- Add `src/providers/plugins/matrix.ts`.
- Register Matrix in provider indexes and registry.
- Implement config plumbing, DM policy, and setup hooks (no runtime yet).

## Steps
1) Provider plugin file
   - Create `src/providers/plugins/matrix.ts`.
   - Implement `ProviderPlugin<ResolvedMatrixAccount>` with:
     - `id: "matrix"`
     - `meta` from `getChatProviderMeta("matrix")`
     - `capabilities` set to at least `chatTypes: ["direct", "group"]`, `media: true`
     - `reload` config prefixes for `matrix`
   - Mirror structure and naming from `signal.ts` for consistency.

2) Config integration
   - Wire `config.listAccountIds`, `resolveAccount`, `defaultAccountId`,
     `setAccountEnabled`, and `deleteAccount`.
   - Add `isConfigured` logic that checks for required fields presence.
   - Add `describeAccount` data (accountId, name, enabled, serverUrl, username).
   - Add `resolveAllowFrom`/`formatAllowFrom` if Matrix uses the same DM allowlist
     pattern as WhatsApp/Signal (recommended for consistency).

3) Security + pairing alignment
   - Implement `security.resolveDmPolicy` to mirror WhatsApp/Signal defaults:
     - Default `dmPolicy: "pairing"`
     - `allowFrom` for explicit allowlist
     - Use `formatPairingApproveHint("matrix")`
   - Add `pairing` metadata if needed:
     - `idLabel` (e.g., `matrixUserId` or `matrixSenderId`)
     - Optional `notifyApproval` hook if Matrix supports auto-ack messages
   - Ensure all policy paths map to `matrix.accounts.<id>` when present.

4) Setup helpers
   - Add `setup` handlers:
     - `resolveAccountId`
     - `applyAccountName`
     - `validateInput` for `serverUrl/username/password`
     - `applyAccountConfig` to update `matrix.accounts.<id>`
   - Use `applyAccountNameToProviderSection` and `migrateBaseNameToDefaultAccount`
     patterns identical to WhatsApp/Signal.

5) Messaging target normalization (scaffold)
   - Add `messaging.normalizeTarget` placeholder to normalize:
     - `matrix:@user:server`
     - `matrix:room:<roomId>`
   - Follow the `normalizeTarget` pattern used by Signal.

6) Registry wiring
   - Add Matrix to `src/providers/plugins/index.ts`.
   - Add Matrix to `src/providers/registry.ts` with label and sort order.
   - Update any provider list tests to include `matrix`.

## Deliverables
- `src/providers/plugins/matrix.ts` scaffold (no runtime behavior yet).
- Registry updates listing Matrix in all provider surfaces.

## Notes (alignment)
- Keep provider layout and naming identical to Signal/WhatsApp patterns.
- Avoid introducing new provider metadata fields unless required.

## Checklist
- [ ] `src/providers/plugins/matrix.ts` created with base plugin shape
- [ ] Config hooks wired (`listAccountIds`, `resolveAccount`, etc.)
- [ ] DM policy + pairing defaults match WhatsApp/Signal
- [ ] `setup` handlers implemented (`resolveAccountId`, `applyAccountConfig`)
- [ ] Messaging target normalization scaffold added
- [ ] Registry lists Matrix in plugin index + provider registry

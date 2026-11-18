# Dua Workspace — Progress

Updated: 2026-11-18 (merged into `main` the same day; `module/workspace` stays open for Phase 3 onward)

## Completed

- [x] Plan approved by the owner (N-1 to N-17) and Foundation requests approved (M-1 to M-10).
- [x] Formatting baseline restored in its own commit (16 files, formatting only).
- [x] MODULES.md: ranges 1000–1099 (Invoice Desk) and 1100–1199 (Workspace) recorded; `workspace` registry row; `workspace_` prefix.
- [x] Brief `docs/modules/workspace.md`.
- [x] Phase 2: `supabase/migrations/1100_workspace_core.sql` and `supabase/tests/1100_workspace_core_test.sql`.
- [x] Local check: clean PostgreSQL 16, every migration applied in order, all 61 database test files pass (Workspace: roles, sharing, revocation, disabled and expired accounts, no admin override, direct-write refusal, ownership transfer, archive and delete, listing and search, personal folders, rich-text validation, function and grant hygiene).

## In progress / not yet accepted

- [ ] Apply `1100` to the shared project by hand and register it under version `1100` (owner action; see MODULES.md §12 and `docs/ops/f6-registry-reconciliation.md`). Read the live registry immediately before applying.
- [ ] CI run of `npm run verify` and `npm run test:db`. After the merge into `main`, lint and the format check pass; `npm test` has 15 failures that also fail on `main` (cover, service-worker, shell), none in Workspace.
- [ ] Phase 1 prototypes (CSP with ProseMirror, `wss:`, bundle size, grid on a phone) before Phases 4 and 9.

## Next

Phase 3: `1101_workspace_notes.sql` (note revisions, save and restore) with its tests and the domain validation module.

## Notes for the next session

- `workspace_role()` is the only place that decides access. Every new table and function must go through it.
- A `stable` function does not see changes made earlier in the same statement; tests that check state after a write must use a separate statement.
- Trigger-guard functions have execute revoked from public as well.
- The Invoice Desk migration rows are registered live as timestamps (`20261117…`) while the repo files are `1000`–`1003`; hand-apply with the repo number until Foundation re-registers them.

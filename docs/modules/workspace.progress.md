# Dua Workspace — Progress

Updated: 2026-11-18

## Completed

- [x] Plan approved by the owner (N-1 to N-17) and Foundation requests approved (M-1 to M-10).
- [x] Formatting baseline restored; ranges recorded in MODULES.md; brief written.
- [x] **Phase 2** — `1100_workspace_core.sql` + test. Applied to the shared project on 18 Nov 2026 by hand and registered as version `1100` (all 73 repo migrations match the live registry by name).
- [x] **Phase 3** (applied to the shared project 18 Nov 2026, registered as version `1101`; live function bodies hash-identical to the tested copy) — `1101_workspace_notes.sql` + `1101_workspace_notes_test.sql` (note revisions, save with conflict detection, restore, history, search, rename, member list, conflict resolution) and `1101_workspace_note_cases_test.sql` (37 shared validation cases).
- [x] Browser side of Phase 3: `domain/` (validation, permissions, revisions, documents) and `data/` (api, documents, sharing, notes, revisions) with four unit-test files (93 tests).
- [x] Local checks: clean PostgreSQL 16, every migration applied in order, all database test files pass (65). `npm run lint` and `prettier --check` pass.

## Known problems that are NOT from Workspace

- 15 unit tests fail on a clean `origin/main` at `90e22e7`, identically with and without Workspace: `cover.test.js` (4), `shell.test.js` (4), `ebill-held-page.test.js` (1), `service-worker.test.js` (6, including "file list is up to date: run `node tools/sw-precache.mjs`"). Foundation should look at these before the next CI run: `npm test` is red on main.

## Follow-ups noticed by the Supabase advisor (live project)

- The four trigger-guard functions (`workspace_documents_guard`, `_members_guard`, `_folders_guard`, `_note_revisions_guard`) have no pinned `search_path` (same as the existing `set_updated_at` and `activity_log_immutable`). They only use schema-qualified names, so pinning is safe: add `alter function … set search_path = public;` for all four to the next Workspace migration (`1102`).
- `workspace_save_keys` has RLS on and no policy: intentional (service role only), like `mgmt_save_keys` and `sales_save_keys`.
- The "signed-in users can execute SECURITY DEFINER function" warnings for the public Workspace functions are by design (they are the module's API; each checks the caller itself).

## Not yet done

- [ ] Phase 4: ProseMirror (needs the vendored bundle, M-8), editor, sharing and history screens, first route; register `workspace` in `js/modules/index.js` and link `css/workspace.css` in `index.html`.
- [ ] Phase 1 prototypes (CSP with ProseMirror, `wss:`, bundle size, grid on a phone).
- [ ] Block-level three-way merge for notes (`domain/conflicts.js`) with the conflict screens, Phase 9.
- [ ] Regenerate `sw.js` (M-6) when Workspace files are loadable by the app (Phase 4 onward).

## Notes for the next session

- `workspace_role()` is the only place that decides access. Every new table and function goes through it.
- A `stable` function does not see changes made earlier in the same statement; tests that check state after a write must use a separate statement.
- Edit `tests/fixtures/workspace-note-cases.json`, then run `node tools/workspace-note-cases.mjs`; a unit test fails if the generated SQL is stale. The browser and database validators must agree on every case.
- Editors cannot rename documents (owner only, per the approved matrix). Say so if that should change.
- Applying a migration by hand: read the live registry first, run the file as one batch, insert the registry row with the repo number in the same batch, then compare function bodies with comments stripped.

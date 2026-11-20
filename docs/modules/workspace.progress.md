# Dua Workspace — Progress

Updated: 2026-11-19

## Completed

- [x] Plan approved by the owner (N-1 to N-17) and Foundation requests approved (M-1 to M-10).
- [x] Formatting baseline restored; ranges recorded in MODULES.md; brief written.
- [x] **Phase 2** — `1100_workspace_core.sql` + test. Applied to the shared project on 18 Nov 2026 by hand and registered as version `1100` (all 73 repo migrations match the live registry by name).
- [x] **Phase 3** (applied to the shared project 18 Nov 2026, registered as version `1101`; live function bodies hash-identical to the tested copy) — `1101_workspace_notes.sql` + `1101_workspace_notes_test.sql` (note revisions, save with conflict detection, restore, history, search, rename, member list, conflict resolution) and `1101_workspace_note_cases_test.sql` (37 shared validation cases).
- [x] Browser side of Phase 3: `domain/` (validation, permissions, revisions, documents) and `data/` (api, documents, sharing, notes, revisions) with four unit-test files (93 tests).
- [x] Local checks: clean PostgreSQL 16, every migration applied in order, all database test files pass (65). `npm run lint` and `prettier --check` pass.

## Needs the owner (cannot be done from here)

- [ ] **Try it on a real phone and a desktop browser.** I could only run jsdom: layout, touch selection, the on-screen keyboard, toolbar scrolling, the bottom-sheet dialogs and the Content-Security-Policy are unverified in a real browser. What I did verify by reading the code and bundle: no inline styles or handlers, no network calls, no `eval`, and `innerHTML` only inside ProseMirror's clipboard parser on an inert document.
- [ ] Sign in as a user who has `workspace.use` + `workspace.create` (grant it to someone; no role carries it) and as a second user with only `workspace.use`; check create, share, edit from two devices, history, restore.

## Main-branch verification update (19 Nov 2026)

The earlier failure list is superseded: the Audit handover records the Home/shell/service-worker test fixes on main, with 1,562/1,562 unit tests and the full database suite passing locally. Deno and workflow lint were not run locally. Re-run the current full workflow before release.

## Follow-ups noticed by the Supabase advisor (live project)

- The four trigger-guard functions (`workspace_documents_guard`, `_members_guard`, `_folders_guard`, `_note_revisions_guard`) have no pinned `search_path` (same as the existing `set_updated_at` and `activity_log_immutable`). They only use schema-qualified names, so pinning is safe: add `alter function … set search_path = public;` for all four to the next Workspace migration (`1102`).
- `workspace_save_keys` has RLS on and no policy: intentional (service role only), like `mgmt_save_keys` and `sales_save_keys`.
- The "signed-in users can execute SECURITY DEFINER function" warnings for the public Workspace functions are by design (they are the module's API; each checks the caller itself).

## Not yet done

- [ ] Phase 5: workbooks and the spreadsheet grid (`1102`, which also pins `search_path` on the four trigger-guard functions).
- [ ] Phase 1 prototype checks in a real browser (CSP with `wss:` for Realtime, grid performance on a phone) before Phases 5 and 9.
- [ ] Router: a route with an id segment would allow shareable links (Foundation request, not made yet).
- [ ] Block-level three-way merge and the Compare screen for note conflicts (`domain/conflicts.js`), Phase 9.
- [ ] Register the service worker for Workspace and keep the note editable offline (M-2, M-3, M-6), Phase 8.

## Notes for the next session

- `workspace_role()` is the only place that decides access. Every new table and function goes through it.
- A `stable` function does not see changes made earlier in the same statement; tests that check state after a write must use a separate statement.
- Edit `tests/fixtures/workspace-note-cases.json`, then run `node tools/workspace-note-cases.mjs`; a unit test fails if the generated SQL is stale. The browser and database validators must agree on every case.
- Editors cannot rename documents (owner only, per the approved matrix). Say so if that should change.
- Applying a migration by hand: read the live registry first, run the file as one batch, insert the registry row with the repo number in the same batch, then compare function bodies with comments stripped.
- Workspace pages are tested by mocking the data layer (`tests/unit/workspace-pages.test.js`); the editor by running the real vendored ProseMirror in jsdom. Any change to the schema must keep `tests/unit/workspace-editor-model.test.js` passing: it proves the editor and the validators agree.
- Block ids: turning a paragraph into a heading keeps its id; splitting a block copies it and `docToNote` gives the copy a fresh id.

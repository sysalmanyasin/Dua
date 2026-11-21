# Dua Workspace — Progress

Updated: 2026-11-21 (review and the `1110` search_path follow-up; handover: `workspace.next-session.md`)

## Completed

- [x] Plan approved by the owner (N-1 to N-17) and Foundation requests approved (M-1 to M-10).
- [x] Formatting baseline restored; ranges recorded in MODULES.md; brief written.
- [x] **Phase 2** — `1100_workspace_core.sql` + test. Applied to the shared project on 18 Nov 2026 by hand and registered as version `1100` (all 73 repo migrations match the live registry by name).
- [x] **Phase 3** (applied to the shared project 18 Nov 2026, registered as version `1101`; live function bodies hash-identical to the tested copy) — `1101_workspace_notes.sql` + `1101_workspace_notes_test.sql` (note revisions, save with conflict detection, restore, history, search, rename, member list, conflict resolution) and `1101_workspace_note_cases_test.sql` (37 shared validation cases).
- [x] Browser side of Phase 3: `domain/` (validation, permissions, revisions, documents) and `data/` (api, documents, sharing, notes, revisions) with four unit-test files (93 tests).
- [x] Local checks: clean PostgreSQL 16, every migration applied in order, all database test files pass (65). `npm run lint` and `prettier --check` pass.

- [x] **Merged to `main`** at `468873a` on 19 Nov 2026 (after merging newer `main`; the conflicts were documentation only). Full suite on the merged result: 1,669 unit tests with one failure that also fails on clean `main` (`ebill-page.test.js`), lint, secret scan and vendor check clean, all 71 database test files pass locally on PostgreSQL 16. `prettier --check` fails only on `css/ebill.css`, which also fails on `main`.
- [x] Documents updated on 19 Nov: PROJECT_STATUS, MODULE_PROGRESS_REGISTER, ROADMAP, CHANGELOG, TESTING, SESSIONS, README (root and docs), DECISIONS (D-41–D-47), DATABASE_DESIGN, SECURITY_MODEL, ADMIN_GUIDE, USER_GUIDE, ARCHITECTURE, MODULES (route rule, registry row), the brief, and the new `workspace.design.md` and `workspace.next-session.md`.

- [x] **Phase 5, increment 1 (database only), 19 Nov 2026, branch `module/workspace-sheets` (from `main` at `7563cfd`):** `supabase/migrations/1102_workspace_sheets.sql` and `supabase/tests/1102_workspace_sheets_test.sql` (203 checks: permissions for every role, all implemented operation types, validation of every field, atomic rejection, conflicts including a partly applied batch, structure rules and limits, styles, sizes, pulling changes, restore points and a restore that returns the exact earlier state, the automatic restore point every 200 operations, the 50,000-cell limit, append-only logs, isolation between documents, privilege hygiene). The whole database suite passes locally on PostgreSQL 16 (74 test files, 86 migrations). **Not applied to the shared project and not merged:** waiting for the owner.
- [ ] For the owner: say whether to apply `1102` to the shared project now (procedure in `workspace.next-session.md` §5) and merge the branch.

## Needs the owner (cannot be done from here)

- [ ] Revoke the GitHub token that was shared in chat on 18 Nov 2026.
- [ ] **Try it on a real phone and a desktop browser.** I could only run jsdom: layout, touch selection, the on-screen keyboard, toolbar scrolling, the bottom-sheet dialogs and the Content-Security-Policy are unverified in a real browser. What I did verify by reading the code and bundle: no inline styles or handlers, no network calls, no `eval`, and `innerHTML` only inside ProseMirror's clipboard parser on an inert document.
- [ ] Sign in as a user who has `workspace.use` + `workspace.create` (grant it to someone; no role carries it) and as a second user with only `workspace.use`; check create, share, edit from two devices, history, restore.

## Known problems that are NOT from Workspace

- **Resolved by 21 Nov 2026:** on current `main` the full unit suite (1,873 tests), `prettier --check`, lint, the secret scan and the vendor check all pass. The two Emergency Billing problems below were fixed by that module's later work. Earlier note: `tests/unit/ebill-page.test.js` (cash received entry) failed on clean `main`, and `css/ebill.css` failed `prettier --check`. The earlier failures in cover, shell and service-worker tests were fixed on `main` by another session (see the Audit handover's main-branch verification note).

## Follow-ups noticed by the Supabase advisor (live project)

- **Done, 21 Nov 2026 (`1110_workspace_guard_search_path.sql`, applied to the live project by hand and registered as version `1110`).** The four trigger-guard functions (`workspace_documents_guard`, `_members_guard`, `_folders_guard`, `_note_revisions_guard`) have no pinned `search_path` (same as the existing `set_updated_at` and `activity_log_immutable`). They only use schema-qualified names, so pinning is safe: add `alter function … set search_path = public;` for all four to the next Workspace migration (`1102`).
- `workspace_save_keys` has RLS on and no policy: intentional (service role only), like `mgmt_save_keys` and `sales_save_keys`.
- The "signed-in users can execute SECURITY DEFINER function" warnings for the public Workspace functions are by design (they are the module's API; each checks the caller itself).

## Review, 21 Nov 2026

- Live project checked: migrations `1100` and `1101` are registered; 7 Workspace tables, all with row level security; 6 policies; 36 functions; 2 documents, none in the trash, none shared; permissions `workspace.use` and `workspace.create` exist, and one person holds `workspace.use`. This matches the docs.
- Advisor: the only Workspace-specific warning that is not by design was the four unpinned trigger guards (fixed in `1110`, see above). `workspace_save_keys` (RLS on, no policy) and the signed-in-callable SECURITY DEFINER warnings are intentional.
- Tests: all Workspace unit tests pass inside the full suite (1,873); all 76 database test files pass on PostgreSQL 16 (3,233 checks), including the new `1110` test. The two earlier "every Workspace function pins its search_path" checks no longer exempt the guards.
- `1110` applied live on 21 Nov 2026 (one batch with its registry row). Checked afterwards: no Workspace function lacks a pinned `search_path`, the guards are still attached and not callable from the browser. Function bodies match the tested copy except for comments inside four functions (`workspace_create_document`, `workspace_folder_remove`, `workspace_member_remove`, `workspace_note_node_ok`): identical once comments and whitespace are stripped. That difference predates `1110` and is harmless (comments lost when `1100`/`1101` were pasted by hand).
- Still not verified by anyone: the editor in a real browser on a phone and a desktop (all tests run in jsdom).

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

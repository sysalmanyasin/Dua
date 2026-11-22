# Dua Workspace — Progress

Updated: 2026-11-22 (Phase 5 increment 2: reference model and parity test; handover: `workspace.next-session.md`)

> **Current status (verified 22 Nov):** Notes are integrated. Sheets database migrations `1100`–`1102` and `1110`–`1111` are live; Phase 5 increment 2 browser reference model, fixtures and parity tests are merged to main (PR #66). This is not a finished Sheets feature: workbook/grid UI, Sheets data integration, formulas, offline queue, sync/conflict UI and attachments remain. Migration `1111_workspace_style_validator_fix` is present in main and appears as version `1111` in the live registry. See [22 Nov audit](../PROJECT_AUDIT_2026-11-22.md).

## Completed

- [x] Plan approved by the owner (N-1 to N-17) and Foundation requests approved (M-1 to M-10).
- [x] Formatting baseline restored; ranges recorded in MODULES.md; brief written.
- [x] **Phase 2** — `1100_workspace_core.sql` + test. Applied to the shared project on 18 Nov 2026 by hand and registered as version `1100` (all 73 repo migrations match the live registry by name).
- [x] **Phase 3** (applied to the shared project 18 Nov 2026, registered as version `1101`; live function bodies hash-identical to the tested copy) — `1101_workspace_notes.sql` + `1101_workspace_notes_test.sql` (note revisions, save with conflict detection, restore, history, search, rename, member list, conflict resolution) and `1101_workspace_note_cases_test.sql` (37 shared validation cases).
- [x] Browser side of Phase 3: `domain/` (validation, permissions, revisions, documents) and `data/` (api, documents, sharing, notes, revisions) with four unit-test files (93 tests).
- [x] Local checks: clean PostgreSQL 16, every migration applied in order, all database test files pass (65). `npm run lint` and `prettier --check` pass.

- [x] **Merged to `main`** at `468873a` on 19 Nov 2026 (after merging newer `main`; the conflicts were documentation only). Full suite on the merged result: 1,669 unit tests with one failure that also fails on clean `main` (`ebill-page.test.js`), lint, secret scan and vendor check clean, all 71 database test files pass locally on PostgreSQL 16. `prettier --check` fails only on `css/ebill.css`, which also fails on `main`.
- [x] Documents updated on 19 Nov: PROJECT_STATUS, MODULE_PROGRESS_REGISTER, ROADMAP, CHANGELOG, TESTING, SESSIONS, README (root and docs), DECISIONS (D-41–D-47), DATABASE_DESIGN, SECURITY_MODEL, ADMIN_GUIDE, USER_GUIDE, ARCHITECTURE, MODULES (route rule, registry row), the brief, and the new `workspace.design.md` and `workspace.next-session.md`.

- [x] **Phase 5, increment 1 (database only), 19 Nov 2026, branch `module/workspace-sheets` (from `main` at `7563cfd`):** `supabase/migrations/1102_workspace_sheets.sql` and `supabase/tests/1102_workspace_sheets_test.sql` (203 checks: permissions for every role, all implemented operation types, validation of every field, atomic rejection, conflicts including a partly applied batch, structure rules and limits, styles, sizes, pulling changes, restore points and a restore that returns the exact earlier state, the automatic restore point every 200 operations, the 50,000-cell limit, append-only logs, isolation between documents, privilege hygiene). The whole database suite passes locally on PostgreSQL 16 (74 test files, 86 migrations). Merged to `main` on 21 Nov 2026 and applied live and registered as version `1102` (21 Nov 2026; verified against the live project: 5 Sheets tables with row level security, 15 functions with pinned `search_path`, internal ones not callable by `anon` or `authenticated`).
- [x] Owner decision on `1102`: applied by hand and merged (21 Nov 2026).
- [x] **Phase 5, increment 2 (22 Nov 2026, branch `module/workspace-sheets-domain`, not merged, nothing applied live):** `js/modules/workspace/domain/spreadsheet.js` (browser reference model of `1102`), `tests/fixtures/workspace-sheet-cases.json` (10 operation sequences), `tools/workspace-sheet-cases.mjs` (records answers, generates the SQL), `supabase/tests/1102_workspace_sheet_parity_test.sql` (generated; 85 checks) and `tests/unit/workspace-spreadsheet.test.js` (47 tests: the fixture, the generated SQL being current, a local copy following pulled operations for every fixture case, the limits (20 sheets, 100 columns, 10,000 rows, 50,000 cells, 32,767 characters, 200-operation checkpoint), rollback of a refused batch, conflicts, duplicates, restore, helpers).
  - Verified before merge: the parity SQL passes on PostgreSQL 16 after every migration (85 checks), and also inside the whole database suite (`ALL DATABASE TESTS PASSED`, no FAIL or ERROR lines); a deliberately wrong expected answer makes it fail. Lint, `prettier --check`, secret scan and vendor check pass. Full unit suite: 1,979 of 1,980 pass; the one failure was in `ebill-page.test.js` (a dialog check) while the database suite ran at the same time; that file passes alone (56 of 56) and is not touched by this work, so it looks like a timing flake under load.
  - Not verified: any Sheets grid UI in a real browser or phone (no screen exists yet). Migration 1111 is now present in the live registry.
  - Finding: the style validator in `1102` accepted malformed styles; fixed by `1111` (see below).

## Needs the owner (cannot be done from here)

- [ ] Revoke the GitHub token that was shared in chat on 18 Nov 2026.
- [x] **Try it on a real phone and a desktop browser.** *Accepted by the owner after live testing, 21 Nov 2026 (reported in chat; no separate test log).* I could only run jsdom: layout, touch selection, the on-screen keyboard, toolbar scrolling, the bottom-sheet dialogs and the Content-Security-Policy are unverified in a real browser. What I did verify by reading the code and bundle: no inline styles or handlers, no network calls, no `eval`, and `innerHTML` only inside ProseMirror's clipboard parser on an inert document.
- [x] Sign in as a user who has `workspace.use` + `workspace.create` (grant it to someone; no role carries it) and as a second user with only `workspace.use`; check create, share, edit from two devices, history, restore.

## Known problems that are NOT from Workspace

- **Resolved by 21 Nov 2026:** on current `main` the full unit suite (1,873 tests), `prettier --check`, lint, the secret scan and the vendor check all pass. The two Emergency Billing problems below were fixed by that module's later work. Earlier note: `tests/unit/ebill-page.test.js` (cash received entry) failed on clean `main`, and `css/ebill.css` failed `prettier --check`. The earlier failures in cover, shell and service-worker tests were fixed on `main` by another session (see the Audit handover's main-branch verification note).

## Follow-ups noticed by the Supabase advisor (live project)

- **Done, 21 Nov 2026 (migration 1110).** The four trigger-guard functions (`workspace_documents_guard`, `_members_guard`, `_folders_guard`, `_note_revisions_guard`) now have pinned `search_path`. Migration `1110_workspace_guard_search_path.sql` is a separate applied migration. Earlier wording that suggested adding these changes to `1102` is stale.
- `workspace_save_keys` has RLS on and no policy: intentional (service role only), like `mgmt_save_keys` and `sales_save_keys`.
- Signed-in-callable SECURITY DEFINER warnings for public Workspace API functions are expected; each function checks the caller's Workspace role/permission.

## Review, 21 Nov 2026

- Notes-only live check (before Sheets migration 1102): migrations `1100` and `1101` were registered; 7 Notes tables, all with row level security; 6 policies; 36 functions; 2 documents, none in the trash, none shared; permissions `workspace.use` and `workspace.create` exist, and one person holds `workspace.use`.
- Later Sheets check (21 Nov): migration `1102` is live; 5 Sheets tables have RLS; 15 Sheets functions have pinned `search_path`; internal functions are not callable by `anon` or `authenticated`. Migration `1110` separately pins the four Notes trigger guards.
- Advisor: the only Workspace-specific warning that is not by design was the four unpinned trigger guards (fixed in `1110`, see above). `workspace_save_keys` (RLS on, no policy) and the signed-in-callable SECURITY DEFINER warnings are intentional.
- Tests: all Workspace unit tests pass inside the full suite (1,873); all 76 database test files pass on PostgreSQL 16 (3,233 checks), including the new `1110` test. The two earlier "every Workspace function pins its search_path" checks no longer exempt the guards.
- `1110` applied live on 21 Nov 2026 (one batch with its registry row). Checked afterwards: no Workspace function lacks a pinned `search_path`, the guards are still attached and not callable from the browser. Function bodies match the tested copy except for comments inside four functions (`workspace_create_document`, `workspace_folder_remove`, `workspace_member_remove`, `workspace_note_node_ok`): identical once comments and whitespace are stripped. That difference predates `1110` and is harmless (comments lost when `1100`/`1101` were pasted by hand).
- Real phone and desktop check of the editor: accepted by the owner on 21 Nov 2026 after live testing.

## Not yet done

- [ ] **Phase 5, increment 3 onwards — Sheets UI:** the domain model and parity fixture are done (increment 2); still to do: the data layer, the grid, the New workbook flow, and the operations the database answers "not available yet" (`move_rows`, `move_cols`, `duplicate_sheet`, `sort_range`).
- [x] Style validator fix written (owner said fix it, 22 Nov): `supabase/migrations/1111_workspace_style_validator_fix.sql` and `1111_workspace_style_validator_fix_test.sql` (20 checks). Whole database suite passes. **Not applied live yet: owner applies by hand, then it is registered as `1111`.**
- [ ] **Phase 5 onward:** formula engine; formatting, sort/filter and CSV.
- [ ] **Phase 8:** IndexedDB offline queue, retry/sync and sign-out cleanup (requires the Foundation sign-out hook).
- [ ] **Phase 9:** conflict detection/merge and compare UI for Notes and Sheets.
- [ ] **Phase 10:** attachments, after Storage/CSP/security design and owner approval.
- [ ] **Phase 11:** integrated cross-device acceptance and release checks.
- [ ] Check the Phase 1 browser prototypes in a real browser (CSP `wss:` for Realtime and grid performance on a phone) before enabling Realtime-dependent flows.
- [ ] Add router deep-link route with an id segment (Foundation request; not required for current Notes acceptance).
- [ ] Confirm the GitHub token shared in the 18 Nov session was revoked; treat it as exposed until confirmed.

The Sheets database migration `1102` is already merged and applied live. The remaining Phase 5 work is browser-side domain/data/UI, not another database-core migration.

## Notes for the next session

- `workspace_role()` is the only place that decides access. Every new table and function goes through it.
- A `stable` function does not see changes made earlier in the same statement; tests that check state after a write must use a separate statement.
- Edit `tests/fixtures/workspace-note-cases.json`, then run `node tools/workspace-note-cases.mjs`; a unit test fails if the generated SQL is stale. The browser and database validators must agree on every case.
- Editors cannot rename documents (owner only, per the approved matrix). Say so if that should change.
- Applying a migration by hand: read the live registry first, run the file as one batch, insert the registry row with the repo number in the same batch, then compare function bodies with comments stripped.
- Workspace pages are tested by mocking the data layer (`tests/unit/workspace-pages.test.js`); the editor by running the real vendored ProseMirror in jsdom. Any change to the schema must keep `tests/unit/workspace-editor-model.test.js` passing: it proves the editor and the validators agree.
- Block ids: turning a paragraph into a heading keeps its id; splitting a block copies it and `docToNote` gives the copy a fresh id.

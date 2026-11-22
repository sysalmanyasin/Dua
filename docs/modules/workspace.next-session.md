# Dua Workspace — start here (handover for the next session)

Updated 22 Nov 2026 after PR #66 merged the Workspace Sheets reference model to main. Earlier phase notes below are retained as dated handover history. Sessions have no memory (`docs/MODULES.md` §0.3): this file, the brief and the design record are what you have.

## 1. Where things stand

- **Notes are built, merged to `main` and registered** (`/workspace`, `/workspace/note`, nav order 86). Migrations `1100` and `1101` are applied to the shared Supabase project (`sdsynzsflubdxnelgthh`) and registered as versions `1100` and `1101`; their function bodies were verified identical to the tested copy (D-47).
- **Not built:** Sheets data layer, workbook/grid UI, formulas, CSV, offline editing/synchronisation/conflict screens and attachments. The reference/domain model and database parity tests are now merged to main; the New workbook action remains unavailable.
- **Not verified by anyone yet:** the editor in a real browser. All tests so far run in jsdom. The owner has to try it on a real phone and a desktop with two accounts. Do not start Phase 5 until the owner has said the Notes try-out is acceptable, or has said "go" anyway (rule N-17: each phase waits for a separate owner go).
- Current main baseline: `18283f17600be54d562a5eb3c40bf89906416b29` (PR #66 merged).

## 2. Read in this order

1. `docs/modules/workspace.md` — the brief and the 17 owner decisions (N-1 to N-17), structure, permissions, screens, phases.
2. `docs/modules/workspace.design.md` — the design for everything not built (Sheets storage, how operations are applied, offline sync, formulas, grid, attachments, phases 5–11, open risks).
3. `docs/modules/workspace.progress.md` — evidence and follow-ups.
4. `docs/MODULES.md` (rules every module obeys), `docs/DECISIONS.md` D-41 to D-47, `docs/SECURITY_MODEL.md` (Workspace section).
5. Code: `supabase/migrations/1100_workspace_core.sql` and `1101_workspace_notes.sql` are the pattern for every new Workspace table and function.

## 3. What exists (file map)

| Area | Files |
|---|---|
| Database | `supabase/migrations/1100_workspace_core.sql`, `1101_workspace_notes.sql`; tests `supabase/tests/1100_workspace_core_test.sql` (149 checks), `1101_workspace_notes_test.sql` (115), `1101_workspace_note_cases_test.sql` (37, **generated**) |
| Domain (pure) | `js/modules/workspace/domain/`: `validation.js` (note format, mirrors the database), `editorModel.js` (editor schema and converters), `autosave.js`, `permissions.js`, `revisions.js`, `documents.js` |
| Data layer | `js/modules/workspace/data/`: `api.js` (the only Supabase caller, friendly errors), `documents.js`, `sharing.js`, `notes.js`, `revisions.js` |
| Screens | `js/modules/workspace/ui/`: `home.js`, `note.js`, `noteEditor.js`, `sharing.js`, `history.js`, `panel.js`; `manifest.js`; `css/workspace.css` |
| Vendored | `vendor/workspace/prosemirror-bundle-1.0.0.mjs`, `LICENSES.txt`, `build/` (recipe) |
| Tests | `tests/unit/workspace-*.test.js` (8 files, 176 tests); shared cases `tests/fixtures/workspace-note-cases.json`; generator `tools/workspace-note-cases.mjs` |
| Docs | this folder `docs/modules/workspace*.md`; decisions D-41–D-47 |

Registered in `js/modules/index.js` (`'workspace'`), `index.html` (stylesheet link), `sw.js` (file list regenerated with `node tools/sw-precache.mjs`).

## 3a. Phase 5 increment 1 is merged to `main` and applied live

`supabase/migrations/1102_workspace_sheets.sql` and its test (203 checks) are merged to `main` (branch `module/workspace-sheets` merged and deleted on 21 Nov 2026). The migration is applied live and registered as version `1102` (21 Nov 2026; verified against the live project: 5 Sheets tables with row level security, 15 functions with pinned `search_path`, internal ones not callable by `anon` or `authenticated`). The four trigger guards are pinned by `1110`. **The Sheets UI is not built**: the reference model was added in increment 2 and is now merged; next is the data layer and UI. Payload formats and rules for the browser side are in `workspace.design.md` §4a. The shared status documents were brought up to date on 21 Nov 2026; keep them current with every increment.

## 3b. Phase 5 increment 2: reference model (22 Nov 2026, merged to main by PR #66)

- `js/modules/workspace/domain/spreadsheet.js` mirrors `workspace_apply_ops` and its helpers: same checks in the same order, same answers (`applied`, `conflict`, `rejected`, `duplicate`), same log and pull, restore points and restore. `applyRemote(wb, pulledOperation)` keeps a local copy current (it throws `ReplicaOutOfSync` when the copy has drifted or after a restore: load the workbook again). `loadWorkbook` / `addLoadedCells` / `addLoadedStyles` build a copy from `workspace_workbook_open`, `workspace_load_sheet` and the styles table.
- Parity: `tests/fixtures/workspace-sheet-cases.json` holds 10 operation sequences with expected answers. `node tools/workspace-sheet-cases.mjs --record` runs them through the model, stores the answers and rewrites `supabase/tests/1102_workspace_sheet_parity_test.sql`. The **database** is the oracle: that SQL file must pass on PostgreSQL (85 checks, run on 22 Nov 2026), so a wrong model cannot be recorded into a passing test. Mutation check: changing one expected answer makes the SQL test fail. After editing the fixture by hand, run the tool without `--record` to regenerate only the SQL; a unit test fails if the committed SQL is stale.
- **Not in this increment:** applying the person's own pending operations locally (optimistic edits, offline queue: Phase 8), formulas (Phase 6), any screen, any data-layer call. `sw.js` was not regenerated because nothing imports the model yet; run `npm run build:sw` when the first screen or data-layer file does.

## 4. What to do next

**Phase 5 — workbooks and grid** (full design in `workspace.design.md` §3, §4, §7, §9). Suggested increments, each its own reviewable change:

1. ~~**Database only:** `1102_workspace_sheets.sql`~~ — **built** (see 3a). Still to add: a parity fixture of operation sequences shared by the SQL tests and the JS reference model; and the operations not yet implemented (`move_rows`, `move_cols`, `duplicate_sheet`, `sort_range`), which are answered `rejected` today.
2. ~~**Domain model** (`domain/spreadsheet.js`) with a JS reference model that runs the same operation sequences as the SQL~~ — **built 22 Nov 2026** (see 3b). The parity fixture covers every implemented operation; `move_rows`, `move_cols`, `duplicate_sheet`, `sort_range` are still unbuilt in the database, so are only checked as "rejected".
3. **Next:** data layer (`data/workbooks.js`: open, load pages of cells and styles, pull, send batches with the **same operation ids resent until answered**, snapshots), then a read-only grid, then editing, then structure operations, then formats.
4. Enable "New workbook" on the home page and add the route `/workspace/sheet` (remember routes carry no ids: use the session-storage pattern in `domain/documents.js`, or ask Foundation for the router change).

Before Phase 5 and Phase 9, run the **Phase 1 prototypes** in a throwaway copy (not the repo): grid scrolling on a real phone, and whether `wss://*.supabase.co` needs a CSP change.

## 5. How to work here (what worked)

- **Branch from current `main`** (`git fetch` first). The old `module/workspace` ref was merged; recreate it.
- **Local checks:** `npm ci`, then `npm run lint`, `npx prettier --check .`, `npx vitest run`, `npm run check:secrets`, `npm run check:vendor` (`npm run verify` runs these but stops at the first failure). Database tests need PostgreSQL 16: `apt-get install postgresql`, start it, set `PGHOST=localhost PGUSER=postgres PGPASSWORD=…`, then `bash supabase/tests/run.sh` (applies every migration to a clean database, then every `*_test.sql`; takes about two minutes).
- **Applying a migration to the live project (owner has authorised hand-applying; confirm the owner still wants it each time):** (1) read the live registry first (`supabase_migrations.schema_migrations`) and check the new number is free; (2) send the whole file as **one** `execute_sql` batch (atomic) — never `apply_migration`, which registers a timestamp version (D-35); (3) end the batch with `insert into supabase_migrations.schema_migrations (version, name, statements) values ('<number>', '<name>', array['applied by hand from supabase/migrations/<file>'])`; (4) verify: compare an `md5(string_agg(proname || md5(prosrc), ',' order by proname))` over the new functions between live and the local test database (it must match exactly, comments inside function bodies included), count RLS tables, policies, grants, `anon` access; (5) run the Supabase security advisor and note anything new in `workspace.progress.md`. Invoice Desk is registered live under timestamp versions; that is known and not to be "fixed" by you.
- **Migrations are fix-forward:** never edit an applied file; add a new one in 1100–1199 (`1102` sheets, `1103` sync, `1104` attachments are reserved; `1110` pins the guard functions' search_path).
- **No secrets in the repo.** A GitHub token was pasted into the chat on 18 Nov 2026 and used for pushes; it was not stored, but the owner should revoke it. Push with a one-time URL and do not leave it in git config.
- **Commit style:** small commits per phase; update `workspace.progress.md` and the shared status files when a phase lands (PROJECT_STATUS, MODULE_PROGRESS_REGISTER, ROADMAP, CHANGELOG, TESTING, README); the owner asked for documents to be kept current every time.

## 6. Things learned the hard way (do not rediscover)

1. **`stable` functions do not see changes made earlier in the same statement.** A test that writes through one function and checks state with a `stable` function in the same `select` sees the old state. Use separate statements.
2. **The activity log is not readable by `authenticated`.** Tests read it after `reset role`.
3. **The router carries no ids** and allows only `^/[a-z0-9/_-]*$` in the hash. Open ids go in session storage under a `dua.` key (cleared at sign-out).
4. **Page lifecycle:** `mount(el, { ctx })` returns nothing; there is no unmount hook. Pages listen for `hashchange` to clean up (see `ui/note.js`). Panels appended to `<body>` close on `hashchange`.
5. **No inline styles or event attributes** (CSP `style-src 'self'`); style through classes or `el.style.x = …`. No `innerHTML` (lint bans it); build DOM with `html`/`render` from `js/shared/html.js`.
6. **jsdom needs three stubs for ProseMirror** (`Range.getBoundingClientRect`, `getClientRects`, `document.elementFromPoint`) — see the top of `tests/unit/workspace-editor.test.js`.
7. **`// @vitest-environment jsdom`** is needed in any test file that uses the DOM; in jsdom tests use `readFileSync(path)` for fixtures, not `new URL(..., import.meta.url)`.
8. **The editor must keep block ids.** Changing a block's type keeps its id (`keepIds` in `noteEditor.js`); splits copy it and `docToNote` gives the copy a fresh id. Ids are what makes merging by block possible in Phase 9.
9. **The validators must agree.** Edit `tests/fixtures/workspace-note-cases.json`, run `node tools/workspace-note-cases.mjs` to regenerate the SQL test, and keep `tests/unit/workspace-editor-model.test.js` passing: it proves the editor schema and both validators accept and refuse the same notes.
10. **Autosave resends the same operation id and content after a failed send.** Do not change this without reading D-45; it prevents a person conflicting with their own lost reply. The Sheets outbox in Phase 8 must do the same.
11. **Function privileges:** every new function needs `set search_path = public`, `revoke all … from public, anon, authenticated`, and an explicit grant only for what the browser may call (trigger functions get the revoke too). The hygiene checks at the end of the test files catch mistakes; copy them.
13. **FIXED by migration `1111` (written 22 Nov 2026, NOT yet applied live: apply by hand and register as version `1111`).** The style validator in `1102` was looser than it read. `workspace_style_valid` lets through a JSON null or a non-integer for `weight`, `size`, `halign`, `valign`, border sides, `numfmt.type`, `numfmt.decimals` and `numfmt.pattern`, because `not (null between 8 and 72)` is null, not true. Verified on PostgreSQL 16 (parity case 6, "known looseness"): `size: "big"`, `size: 8.5`, `weight: null`, `decimals: 2.5` and `numfmt: {}` are all stored. `1111` now refuses null and wrong-kind values for every key that is present (new writes only; rows stored earlier are not re-checked). The model and fixture case 6 were changed with it. Still **draw cells with `sanitizeStyle()`**, since a style stored before `1111` could hold the old values.
14. **Whole-call errors versus `rejected`.** An id outside the integer range in `insert_*`/`delete_*` makes PostgreSQL raise a plain error (not `WS001`), which undoes the whole batch and is not answered per operation. The model throws `CallRefused` for it; the data layer should never build such ids (`newIds` stays in range).
15. **Restore forgets blank markers.** `workspace_sheet_restore` deletes a restored sheet's cell rows (markers included) before writing the snapshot's cells, so after a restore the ids of deleted rows are no longer remembered as "used". Harmless today (client ids are random 31-bit numbers) but worth knowing if id reuse ever matters.
12. **Hand-typed SQL drifts.** When you must paste a migration into a tool call, include comments inside function bodies too, or the hash check will differ (it did once, harmlessly).

## 7. Known problems that are not from Workspace

**Update 21 Nov 2026:** the two problems below no longer apply; the full suite, `prettier --check`, lint and the other checks pass on current `main`. The `ai` nav-order note still stands.

- `tests/unit/ebill-page.test.js` ("can disable cash received entry without blocking PIN-authorized saving") fails on clean `main` (Emergency Billing work), so `npm test` is red until its owner fixes it.
- `css/ebill.css` fails `prettier --check` on `main` itself, so `format:check` is red until it is formatted (`npx prettier --write css/ebill.css`). Left alone because another session is working in that module.
- `docs/MODULES.md` still lists the planned `ai` module at nav order 85, the same number Invoice Desk uses; Workspace uses 86.

## 8. Needs the owner

- Revoke the GitHub token that was shared in chat.
- Try Notes on a real phone and a desktop: create, edit, share with a second account (give that account `workspace.use`; give the creator `workspace.use` + `workspace.create`), edit from both, force a conflict (edit the same note on two devices), history and restore, archive, delete and trash. Report what feels wrong.
- Say "go" for Phase 5, and answer the open questions in `workspace.design.md` §12.

## 9. Rules for the next session

- Follow `docs/MODULES.md`. Stay inside `js/modules/workspace/`, `css/workspace.css`, `vendor/workspace/`, `tests/…/workspace-*`, `supabase/migrations/11xx_*`, and the Workspace docs. Foundation-owned files only through the approved requests in `workspace.design.md` §10, and say which one you used.
- One phase at a time; stop for the owner's "go" between phases (N-17). Keep each change small enough to review.
- Never claim a check passed unless you ran it. State what you could not verify (real browser, real phone, CI).

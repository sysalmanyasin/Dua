# Dua Workspace — start here (handover for the next session)

> **Updated 27 Nov 2026 (read this first).** Workspace Notes are live and accepted. Sheets Phase 5 increments 1 to 6 (**increment 6, sheet management, is in the PR that carries this text; see 3g**) and **Phase 6 (the formula engine, merged as PR #96)** are built: database (`1102`, `1110`, `1111` live), reference model, data layer, grid with "New workbook", cell editing, and formulas shown in the grid and accepted by the editor. Everything up to cell editing is merged (PRs #66, #70, #77, #78, #82); the formula engine is in the PR that carries this text. **Start at section 10 (a prompt you can paste), then 3e, 3f and 4. Read the open risk in 3f before building row or column insertion.** Sections 1 to 3 and the first "4. Original file map" are the 19 Nov history. Continue from current `main`, never from commit `468873a`.

Written 19 Nov 2026 at the end of the session that built Phases 2–4. Sessions have no memory (`docs/MODULES.md` §0.3): this file, the brief and the design record are what you have.

## 1. Historical handover context

The 19 Nov instructions below describe the Notes-only checkpoint and predate Phase 5 increment 2. Use the updated status banner above and `workspace.progress.md` as the current source of truth.

## 2. Original handover notes (historical)

- **Notes are built, merged to `main` and registered** (`/workspace`, `/workspace/note`, nav order 86). Migrations `1100` and `1101` are applied to the shared Supabase project (`sdsynzsflubdxnelgthh`) and registered as versions `1100` and `1101`; their function bodies were verified identical to the tested copy (D-47).
- **Not built:** Sheets (workbooks, grid, formulas, CSV), offline editing, synchronisation and the conflict screens, attachments. The button "New workbook" is shown disabled.
- **Not verified by anyone yet:** the editor in a real browser. All tests so far run in jsdom. The owner has to try it on a real phone and a desktop with two accounts. Do not start Phase 5 until the owner has said the Notes try-out is acceptable, or has said "go" anyway (rule N-17: each phase waits for a separate owner go).
- `main` last known good point for Workspace: commit `468873a` (merge of Phase 4). Later commits on `main` may belong to other modules.

## 3. Original reading order

1. `docs/modules/workspace.md` — the brief and the 17 owner decisions (N-1 to N-17), structure, permissions, screens, phases.
2. `docs/modules/workspace.design.md` — the design for everything not built (Sheets storage, how operations are applied, offline sync, formulas, grid, attachments, phases 5–11, open risks).
3. `docs/modules/workspace.progress.md` — evidence and follow-ups.
4. `docs/MODULES.md` (rules every module obeys), `docs/DECISIONS.md` D-41 to D-47, `docs/SECURITY_MODEL.md` (Workspace section).
5. Code: `supabase/migrations/1100_workspace_core.sql` and `1101_workspace_notes.sql` are the pattern for every new Workspace table and function.

## 4. Original file map

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

`supabase/migrations/1102_workspace_sheets.sql` and its test (203 checks) are merged to `main` (branch `module/workspace-sheets` merged and deleted on 21 Nov 2026). The migration is applied live and registered as version `1102` (21 Nov 2026; verified against the live project: 5 Sheets tables with row level security, 15 functions with pinned `search_path`, internal ones not callable by `anon` or `authenticated`). The four trigger guards are pinned by `1110`. **The Sheets UI is not built** (confirmed by the owner 21 Nov 2026): the next work is increment 2 below. Payload formats and rules for the browser side are in `workspace.design.md` §4a. The shared status documents were brought up to date on 21 Nov 2026; keep them current with every increment.

## 3b. Phase 5 increment 2: the reference model (22 Nov 2026, merged as PR #66)

- `js/modules/workspace/domain/spreadsheet.js` mirrors `workspace_apply_ops` and its helpers: same checks in the same order, same answers (`applied`, `conflict`, `rejected`, `duplicate`), same log and pull, restore points and restore. `applyRemote(wb, pulledOperation)` keeps a local copy current (it throws `ReplicaOutOfSync` when the copy has drifted or after a restore: load the workbook again). `loadWorkbook` / `addLoadedCells` / `addLoadedStyles` build a copy from `workspace_workbook_open`, `workspace_load_sheet` and the styles table.
- Parity: `tests/fixtures/workspace-sheet-cases.json` holds 10 operation sequences with expected answers. `node tools/workspace-sheet-cases.mjs --record` runs them through the model, stores the answers and rewrites `supabase/tests/1102_workspace_sheet_parity_test.sql`. The **database** is the oracle: that SQL file must pass on PostgreSQL (85 checks, run on 22 Nov 2026), so a wrong model cannot be recorded into a passing test. Mutation check: changing one expected answer makes the SQL test fail. After editing the fixture by hand, run the tool without `--record` to regenerate only the SQL; a unit test fails if the committed SQL is stale.
- **Not in this increment:** applying the person's own pending operations locally (optimistic edits, offline queue: Phase 8), formulas (Phase 6), any screen, any data-layer call. `sw.js` was not regenerated because nothing imports the model yet; run `npm run build:sw` when the first screen or data-layer file does.

## 3c. Phase 5 increment 3: the data layer (22 Nov 2026, merged as PR #70 on 23 Nov)

- `js/modules/workspace/data/workbooks.js` (the only new file; plus eight messages in `data/api.js`). **Nothing imports it yet**, so `sw.js` was not regenerated: run `npm run build:sw` when the first screen imports it.
- `openWorkbookFull(docId)` → `{ wb, info, applied }`: opens, loads each sheet's styles and cells in pages (5,000), builds the copy with `loadWorkbook`/`addLoadedCells`/`addLoadedStyles`, then **pulls from the `head_version` it opened at** and applies with `applyRemote`, so a write that landed between pages is not missed. If the copy cannot absorb the pulled operations (a restore, drift) it opens again, up to three times. `pullAndApply(wb, docId)` → `{ status: 'ok', applied }` or `{ status: 'reload', reason }` (discard the copy and open again).
- `createOperationSender({ docId, deviceId })`: `enqueue`, `flush` (one attempt), `drain` (retries with 2 s to 60 s waits, injectable `sleep` and `jitter`), `pending`, `takeRefused`, `discardAll`. A batch that was not answered stays **in flight and is sent again byte for byte**; later changes wait for it. Failures are split into waiting-it-out (`isTransient`: no network, session expired, busy server) and never-going-to-work (no access, archived, refused envelope): the latter is **held, not dropped**, and blocks what follows until `takeRefused()`. Phase 8 should build the persistent outbox on this and store the batches before sending.
- Operations are checked before they leave (`checkOperation`): known type, uuid id, row and column ids whole numbers in 1 to 2,147,483,647, size. This is what keeps pitfall 14 from reaching the database.
- `createSnapshot`, `listSnapshots`, `restoreSnapshot` need a request key (a uuid made once per user action, like notes). After a restore the local copy must be opened again.
- The caller builds the operations (`buildOp`, `newIds`) and sets `base_seq` from `wb.head_seq`. The person's own changes are not applied locally here: after an answer, call `pullAndApply` and they come back like anyone else's (optimistic local editing is Phase 8).

## 3d. Phase 5 increment 4: the read-only grid (23 Nov 2026, merged as PR #77)

- **Files:** `ui/sheet.js` (the screen), `ui/gridView.js` (the grid), `domain/grid.js` (pure: `axisLayout`, `visibleRange`, `scrollToShow`, `displayCell`, `cellCss`, `describeCell`), route `/workspace/sheet` in `manifest.js`, "New workbook" and workbook opening in `ui/home.js`, a Sheets block at the end of `css/workspace.css`, `sw.js` regenerated. Tests: `workspace-grid.test.js`, `workspace-sheet-ui.test.js`.
- **How the grid works:** a scroll container with an invisible sizer as big as the sheet (native scrolling) and a sticky "stage" redrawn on every scroll with only the visible rows and columns plus 3 spare on each edge. Frozen rows and columns and the headers are drawn at fixed positions in layers above. Selection is by row and column **id**, so it survives a refresh.
- **Rules that bit (keep):**
  1. The CSP is `style-src 'self'`: **no inline `style` attributes**. Positions and cell styles are set with the DOM style API (`el.style.x = ...`) and cell text with `textContent`; never build cell HTML from strings. A test reads the source and fails on `innerHTML`, `cssText` or a style attribute.
  2. Cell styles always pass `sanitizeStyle` (the database can still hold older, looser styles).
  3. The grid sits on a fixed light canvas, so author colours stay readable in dark mode. Page chrome follows the theme.
  4. Prettier reformats the inside of `html` templates and adds whitespace; text that must be exact (tab labels) is built with `createElement`.
  5. In jsdom, assigning `location.hash` fires a `hashchange` a moment later, which the screen treats as "left the page". Let it pass (`await`) before mounting in a test.
  6. Paint order: later siblings paint on top, so scrolled headers must be added before frozen ones.
  7. Whole numbers are displayed exactly (13-digit barcodes); other numbers keep 15 significant digits.
- **Verifying in a real browser here:** jsdom has no layout. A throwaway harness (outside the repo) worked: `npm install puppeteer-core @sparticuz/chromium` in a temp folder (the npm package bundles Chromium), a tiny static server mapping `/` to the repo and serving a page with the app's CSP and stylesheets, and the data layer module replaced by a stub that builds a workbook with the model. Use `--no-sandbox`, `headless: 'shell'`.
- **Still not covered:** a real phone; a screen reader (the grid has `role=grid`, `aria-rowcount`, `aria-colcount`, `aria-selected` and per-cell indexes, but cells are not wrapped in `role=row` elements: do this before editing); long-press and double-tap; pinch zoom of the page; very wide cells; right-to-left text.
- **Next (increment 5, editing):** an edit bar for the active cell (the fallback the design names), then `set_cells` through `createOperationSender` with optimistic local apply (this is where Phase 8's local-first begins), then structure operations. Selection and the cell bar in `sheet.js` are the place to start.

## 3e. Phase 5 increment 5: cell editing (24 Nov 2026)

- **Files:** `domain/cellInput.js` (pure: `parseCellInput`, `editState`, `buildCellEdit`), `ui/cellEditor.js` (the edit bar), wiring in `ui/sheet.js` (it now owns the operation sender), edit-bar rules in `css/workspace.css`. Tests: `workspace-cellinput.test.js` (17), `workspace-sheet-edit.test.js` (27), `workspace-sheet-ui.test.js` (35).
- **What a person can do:** tap a cell, change its text in the bar, Save (or Enter; Shift+Enter adds a line; Escape restores). A viewer, an archived workbook and numbers too large or precise to type are shown but not editable, with the reason. (Formulas became editable in Phase 6: see 3f.)
- **Rules that bit (keep every one):**
  1. **A cell write replaces the cell's whole state.** `buildCellEdit` resends the existing `style_id`; leaving it out would strip the formatting. Clearing removes content only. Any new write path must do the same.
  2. **The base of a save is the version the edit started from** (`baseSeq` captured in `begin()`), not the newest. A change that arrives while typing is then met as a conflict instead of being overwritten.
  3. **Typed text becomes a number only if it is a plain number** (`00123`, `1e5`, `1,200`, Arabic digits stay text, at most 15 digits). `TRUE`/`FALSE` become booleans. A leading apostrophe forces text. `editState` shows stored text so that parsing it gives back the same cell.
  4. **Formulas** were refused in this increment and are accepted since Phase 6 (see 3f): `parseCellInput` returns `{ kind: 'formula', formula }` for a formula that parses, and `{ kind: 'invalid', reason, pos }` for one that does not.
  5. **An unanswered save is kept and resent with the SAME operation id**, and the box is locked until answered (D-45). "Discard" is explicit and says what it does. A lost reply after the server applied the change comes back as `duplicate`, never as a conflict with oneself.
  6. **A draft is never dropped silently:** moving cell, switching sheet, leaving the page (hash change) and closing the tab with unsaved text are refused or asked about.
  7. **Conflicts show both versions** with "Use mine" (sent again from a current copy) and "Keep theirs". A deleted row or column keeps the typed text in a message.
  8. **A `hidden` element inside the bar must stay hidden:** `.ws-formula [hidden] { display: none !important }`. Classes that set `display: flex` override the attribute otherwise. A test guards the rule in the stylesheet text.
  9. **jsdom cannot test layout or CSS cascade** (it applies rules in source order, ignores specificity and `!important`). Anything about visibility, paint order, scrolling or the CSP needs the real-browser harness (below).
- **Checked in a real Chromium 153 (harness, reference model as server):** edit saved with style kept, formula refused with nothing sent, draft blocks moving, a real conflict leaves the server value alone and "Keep theirs" resolves it, arrow keys and Page Down keep the selected cell in view, no CSP or script errors. Found and fixed: the conflict buttons were always visible.
- **Browser harness:** `docs/modules/workspace-browser-harness/` (README explains how to run it; the files are `.txt` so lint ignores them). Playwright is installed globally in this environment (`/opt/npm-tools`).
- **Not verified, and by whom it must be done:** a real phone (soft keyboard covering the bar, tap targets, IME, long text) - the owner; a screen reader and the grid's ARIA structure - see debt below; two real accounts editing at once - the owner; the edit flow against the real database - the data layer is proven live only by "New workbook" creating the first sheet (two live workbooks, each with `add_sheet` applied at version 1), and the reference model is tied to the database by the parity test.
- **Known debt carried forward (do these, do not forget them):**
  1. **Grid ARIA:** cells have `role=gridcell` and indexes but are not wrapped in `role=row` elements, and the edit box needs an accessible name tied to the selected cell. The 3d note said to fix this before editing; it was not done. Do it in increment 6 or 7 and test with a screen reader (owner) before Phase 11.
  2. **No offline queue.** The sender is in memory. A reload with an unsent change loses it (the box warns before leaving). Phase 8 builds the outbox on `createOperationSender`.
  3. **Optimistic local apply:** after a save the screen pulls and redraws; it does not apply the person's own change locally first. Fine online; Phase 8 revisits it.
  4. **Dates in the grid are provisional:** a number with a date format is read as days since 1899-12-30. Settle with CSV import (Phase 7).

## 3f. Phase 6: the formula engine (24 Nov 2026)

- **The contract is `docs/modules/workspace.formulas.md`** (written before the code, as the design requires). Change it and the code together, the same day.
- **Code** (`js/modules/workspace/domain/formulas/`, pure, no DOM, no network, no `eval`): `a1.js` (references, limits), `lexer.js`, `parser.js` (never throws; plain-English errors with positions), `values.js` (conversions, comparison, `roundHalfAway`), `functions.js` (11 functions), `evaluator.js`, `dependencies.js` (what a formula reads; iterative cycle components), `engine.js` (one sheet by position: incremental recalculation), `rewrite.js` (rewrite formula text for insert, delete and copy), `sheetCalc.js` (maps a sheet's stable ids to engine positions). Wiring: `domain/grid.js` (`displayCell` and `describeCell` take the calculator), `ui/gridView.js` (shows results, `####`), `ui/sheet.js` (builds the calculator per sheet and version), `domain/cellInput.js` and `ui/cellEditor.js` (accept formulas, show "Shows: result").
- **Rules that bit (keep every one):**
  1. **Errors are values and nothing throws** (`{ error: '#REF!' }`). A formula never ends as empty (empty shows 0). Results are never stored; only the formula text is.
  2. **Circular references come from the dependency graph, not from what happens to run**: `=IF(TRUE,1,A1)` in A1 is circular. Cycle members and everything that reads them show `#CIRC!`.
  3. **The engine's "what changed" report must be exact** (the screen redraws only those cells). The old value of each cell is captured **once**, before anything changes; capturing it twice for a cell edited twice in one batch gave wrong reports (found by the property test). Keep the property test (`workspace-formulas-engine.test.js`: incremental equals from scratch AND the exact report, 8 seeds x 250 rounds) green when you touch `engine.js`.
  4. **Unary minus binds tighter than `^`** (`-2^2` is 4) and `^` is left to right, as in Excel. COUNT and COUNTA never return an error from their arguments. A typed value is coerced strictly, a cell value only counts if it already is a number. `ROUND` is half away from zero on the 15-digit decimal reading (`ROUND(1.005,2)` is 1.01).
  5. **Unknown functions are allowed and show `#NAME?`**; a formula that cannot be parsed is refused by the editor with a reason and a place. Text that must start with `=` takes an apostrophe.
  6. **A number too wide for its column shows `####`** (a cut-off number such as "170,0..." looks like a different number); the bar has the full value. This only shows in a real browser (jsdom has no layout), so it has a stubbed jsdom test plus the harness check.
  7. **Same sheet only.** `Sheet2!A1` is a syntax error with a clear message (decision N-10). No dates, no text functions beyond `CONCAT`, no `%`, no whole-column references.
- **OPEN RISK: DECIDED 27 Nov 2026, option (a); migration 1112 is written and tested but NOT yet applied to the live database (see 3i). Do not ship the insert and delete UI until the owner has applied it.** Original text: (decide before row and column insertion ships, increment 7): formulas are stored as A1 text, but the database detects conflicts only per cell (`last_seq > base_seq`). A structure change (insert or delete rows or columns) does not touch cell versions. So if person A inserts a row and person B, whose copy is older, then saves a formula written for the OLD positions, the database accepts it and the formula silently points at the wrong cells. `rewrite.js` fixes the formulas that exist at the moment of the change, in the same batch, but cannot fix a formula that arrives afterwards. Options to decide with the owner: (a) a sheet-level structure version, and the database refuses (as a conflict) a write of a formula whose `base_seq` is older than the last structure change of that sheet; (b) the browser refuses to save a formula while its copy is behind a structure change it has not yet pulled (weaker: a race remains); (c) store references by id (a large redesign). (a) needs a new migration (next free number **1112**), a model change and a parity fixture. Do not ship insert or delete of rows or columns without choosing one.
- **How insert and delete must use `rewrite.js`:** in the SAME batch as the `insert_*` or `delete_*` operation, add one `set_cells` operation carrying the rewritten `formula` text of every changed formula cell (use the position of the first affected row or column: `rewriteForInsert(text, 'row', at, count)` and `rewriteForDelete(text, 'row', positionsOfDeletedRows)`). Each `set_cells` cell must also resend the cell's current `style_id` (a cell write replaces the whole cell). `sheetCalc` and the engine already recalculate from the result. `translateFormula(text, dRow, dCol)` is for copy and paste (increment 9).
- **Performance as measured** (desktop Chromium, about 1,900 formulas incl. 400 running totals): open 1 s including the stub server; save an edit and redraw about 110 ms; scrolling unchanged. The calculator is rebuilt whenever the sheet's version moves; `engine.update` (incremental) exists and is tested but the screen does not use it yet. Finding the dependents of a changed cell scans every formula that reads a range, so a sheet with tens of thousands of range formulas would be slow: measure before relying on it (2,500 running totals were fine in a test). A chain of 50,000 formulas is fine.
- **Checked:** 553 tests for formulas (a 282-case fixture file with invented numbers and hand-checked answers, parser, values with property checks, engine, rewrite with "numbers never change" properties, sheet adapter, a 60,000-input fuzz test, a static guard against `eval` and any DOM, network, storage or timers); 16 of 17 deliberate mutations caught (the 17th showed redundant code, removed); real Chromium (results, errors, `#CIRC!`, running totals, recalculation after an edit, no number cut short); one displayed average confirmed by an independent calculation.
- **Not verified:** a real phone, a screen reader, two accounts editing formulas together, formulas against the real database (the data layer is unchanged: a formula is just the `formula` field of a cell write, and the database already validates it starts with `=` and is at most 1,000 characters).

## 3g. Phase 5 increment 6: sheet management (27 Nov 2026)

- **Files:** `domain/sheetManage.js` (pure: name check, limits, `moveSheet`, the four operation builders, `readAnswer`), `ui/sheetManager.js` (the "Sheets" panel), wiring in `ui/sheet.js` (`runSheetOp`, the waiting-change banner), a `blocked()` hook in `ui/cellEditor.js`, a stacking fix in `ui/panel.js`, rules in `css/workspace.css`. No database change (the four operations already existed; no migration, next free number is still **1112**). Tests: `workspace-sheetmanage.test.js` (16), `workspace-sheet-manage-ui.test.js` (21), `workspace-panel.test.js` (4); `workspace-sheet-ui.test.js` updated.
- **What a person can do:** tap **Sheets** (next to the tabs) to open a list with Rename, move earlier (up), move later (down) and Delete per sheet, and **Add a sheet**; the **+** button next to the tabs adds a sheet directly. Buttons, not dragging, so it works with a thumb, a keyboard and a screen reader. A viewer or an archived workbook sees the list and nothing to change. Delete asks first and says it cannot be undone from here.
- **Rules that bit (keep every one):**
  1. **The early name check must equal the database.** Names are trimmed of spaces only (not tabs), 1 to 31 characters counted as characters, unique ignoring capitals, and a sheet may keep or recapitalise its own name. `workspace-sheetmanage.test.js` compares the check with the reference model for 26 awkward names, for add and for rename. The database stays the judge: the screen only says no early.
  2. **One sheet change goes through the same sender as cell saves, and never alongside another unanswered change.** An answer to a resent batch is matched by operation id (`readAnswer`); without that a cell save could be read as the answer to a sheet change and the reverse. `runSheetOp` refuses while a cell save is unanswered; the editor's `blocked()` hook refuses a cell save while a sheet change is waiting. Both directions have a test and a mutation check.
  3. **An unanswered sheet change is kept and resent with the SAME operation id** (D-45). A banner offers "Try again" and "Discard" (and says that a discarded change may already have reached the server). A lost reply comes back as `duplicate` and is read as the original answer, so a sheet is never added twice.
  4. **Reorder sends the full list of ids; the database rejects a list that misses a sheet.** If someone added a sheet in the meantime the person is told the sheets changed, and the list is refreshed. Deleting a sheet someone else already deleted says "no longer exists".
  5. **A sheet with unsaved text on it cannot be deleted** (the draft is never dropped silently, as in 3e).
  6. **Stacked dialogs:** `ui/panel.js` now lets only the top panel answer Escape and Tab. Before, a name dialog opened over the Sheets panel closed both on Escape. Found in the real browser; `workspace-panel.test.js` guards it.
  7. **Do not reuse the bare `.pill` class on a light surface:** it is white text (made for a dark background). The "Open" marker uses `pill ws-role` (the same fix as the role pill).
- **Checked in a real Chromium 153 on a 390 px phone screen** (`sheets.cjs` in the harness): tab row and buttons fit with no sideways page scroll; panel, add, rename, move (focus stays on the button), delete with the real dialogs; 20 sheets with 31-character names (no overflow, 40 px buttons, the panel scrolls, the tab strip scrolls and the buttons stay visible); the **+** button at 20 sheets explains why; dark mode readable; no CSP or script errors. Found and fixed: Escape closing two panels; the "Open" marker invisible.
- **Mutation checks:** 14 of 14 deliberate breaks of the new code were caught (name compared with capitals, own-name clash, limit off by one, last sheet deletable, move past an edge, duplicate read as failure, tab trimmed as a space, delete without waiting, same-name rename sent, focus restored while busy, both sender guards, panel stacking), plus a second try of the "last sheet" rule at two values.
- **Not verified:** a real phone (thumb reach, soft keyboard over the name dialog), a screen reader, two real accounts reordering at the same time, and the flow against the real database (the model is tied to it by the parity test; the live database was only read). Capital letters outside plain ASCII (for example a dotted capital I) are compared with the browser's lower-casing, PostgreSQL's `lower()` could differ for such letters; the database stays the judge and the screen then shows its refusal.
- **Known debt:** grid ARIA (rows) is still open (3e item 1); do it in increment 7 or 8. Sheet tabs are 33 px high (tap target) - the buttons beside them are 40 px.

## 3h. Excel-like entry (27 Nov 2026, after the owner tried increment 6 on a phone)

- **Why:** the owner found editing "not like Excel": tap a cell, tap the bar above, type, press Save, and a tap on another cell with typed text was refused. The bar is the formula bar; what was missing was the behaviour around it.
- **What changed** (`ui/cellEditor.js`, `ui/gridView.js`, `ui/sheet.js`; no database change):
  1. **Tap the selected cell again** (or press Enter or F2 on a hardware keyboard) puts the cursor in the bar, so the phone keyboard opens.
  2. **Typing on a selected cell** (hardware keyboard) replaces its content and starts editing; Ctrl, Alt and Meta combinations are left alone.
  3. **Enter saves and moves down one row, and the box stays focused** for the next entry. With nothing typed, Enter just moves down. Shift+Enter is still a new line. The Save button saves and stays.
  4. **Moving to another cell saves the typed text first** (it used to be refused). The move happens only if the save was applied. If the text cannot be saved (a formula that does not parse), the save meets someone else's change (the Use mine / Keep theirs choice is shown), the change is unsent (offline) or a save is in flight, the person stays on the cell and is told why. Nothing is dropped silently and no second save starts while one is unanswered (D-45 kept).
- **Rules that bit:** `doSave()` now resolves `true` only when the change was applied; every caller must treat anything else as "stay". `canCommit()` is false for a locked (unsent) draft and for a conflict, so moving can never resend over someone else's change.
- **Checked:** `workspace-sheet-edit.test.js` (the old "refuse to move" test was replaced by five tests of the new behaviour plus four for tap, type and Enter); real Chromium on a 390 px screen (`entry.cjs`): second tap focuses the bar, Enter moves down with the box still focused, moving saves, type-to-replace, 14 rows entered in a row with the selected cell always in view, no errors.
- **Not verified:** the real phone keyboard (a second tap on a cell opening it, "Enter" or "Next" key behaviour of the owner's keyboard), IME, and in-cell editing: the text is still edited in the bar above the grid, as in the Excel and Google Sheets phone apps. If the owner wants the text edited inside the cell, that is a separate increment.
- **Not built (asked for by the owner):** a toolbar ("ribbon"). The first buttons arrive with rows and columns (increment 7: insert, delete, size) and formats (increment 8: bold, colour, alignment, number format, borders).

## 3h. Excel-like entry (27 Nov 2026, from the owner's phone try-out)

The owner tried editing on a real phone and found it unlike a spreadsheet: tap a cell, tap the bar above, type, press Save, and moving to another cell was refused while text was unsaved. Changed in `ui/cellEditor.js`, `ui/gridView.js`, `ui/sheet.js` (no database change):

- **Tap the selected cell again** (or press Enter or F2 on a keyboard) to put the cursor in the bar; the keyboard opens on a phone. The bar is the formula bar; typing in the cell itself (an overlay on the cell) is NOT built, decide after the next phone try-out.
- **Typing on a selected cell replaces its content** (hardware keyboard; Ctrl, Cmd and Alt combinations are left alone).
- **Enter saves and moves down one row**, and the cursor stays in the bar so the next entry can be typed at once. Enter with nothing typed only moves down. Shift+Enter is still a new line.
- **Moving to another cell saves the typed text first**, then moves (it used to refuse). If the text cannot be saved (an unfinished formula, a conflict, an unsent change, offline) the person stays on the cell, with the reason in the bar. While a save is unanswered a tap elsewhere does not start a second save.
- **Kept rules:** the save is the same `buildCellEdit` write with the base the edit started from, an unanswered save is resent with the same operation id (D-45), nothing typed is dropped silently.
- **Tests:** `workspace-sheet-edit.test.js` (43), `workspace-sheet-ui.test.js`. **Real Chromium** (`entry.cjs`, 390 px, real taps and keys): tap, tap again, type, Enter moves down, moving saves, type-to-replace, 14 entries in a row keep the selected cell in view. **8 of 8 mutations caught.**
- **Run mutation checks on a COPY of the repo** (`tar` it to /tmp and symlink `node_modules`), never in place with a background process: a timed-out run once left a deliberately broken line in the working tree.
- **Not verified:** the phone keyboard itself (the owner), a screen reader.
- **Still missing from the owner's list:** a toolbar. Increment 7 adds structure buttons (insert and delete rows and columns, resize); increment 8 adds the formatting ribbon (bold, colours, alignment, number format).

## 3i. The structure guard (migration 1112, option (a)), 27 Nov 2026

**State: written and tested on PostgreSQL 16, NOT applied to the live database.** Apply only with the owner's explicit OK, by hand, as one `execute_sql` batch ending with the `schema_migrations` insert (never `apply_migration`, D-35), then verify the md5 of the two function bodies against the repo file. Until it is applied, the insert and delete UI must not ship.

- **Rule.** Each sheet has `structure_seq`: the seq of its last insert or delete of rows or columns, or of a restore.
  - `set_cells`: a cell that carries a **formula** is answered as a conflict of kind `structure` (not written) when its `base_seq` is older than `structure_seq`. Values and clears are not affected: they do not depend on positions. In a mixed write only the formula cells are refused.
  - `insert_rows`, `delete_rows`, `insert_cols`, `delete_cols`: when the payload carries `base_seq` and it is older than `structure_seq`, the whole operation is a `structure` conflict (the sender worked out its rewrite from positions that are no longer true). **The UI must always send `base_seq` in the payload of a structure operation**; without it the guard cannot act (it stays accepted so older callers and fixtures keep working).
  - A copy exactly AT the structure change is accepted (`base_seq = structure_seq`).
  - **The same-batch exemption.** The rewritten formulas travel in the SAME batch as the insert or delete (section 3f) and carry the same base as the insert, so the rule must not refuse them. It does not count a structure change made in the batch being applied: `workspace_documents.head_version` only moves at the end of a batch, so `structure_seq > head_version` identifies it. The model does the same with `wb.head_seq`. A stale insert followed by its rewrite is refused as a whole (the insert is refused first, so `structure_seq` does not move).
  - **Restore** (`workspace_sheet_restore`) sets `structure_seq` to the restore's seq on every sheet it rewrites, so a stale formula is refused even into a cell that was empty.
- **Files.** `supabase/migrations/1112_workspace_structure_guard.sql` (adds the column, replaces `workspace_apply_one` and `workspace_sheet_restore` with the 1102 text plus the rule; `create or replace` keeps their privileges; 1102 is not edited). `supabase/tests/1112_workspace_structure_guard_test.sql` (31 checks). Model: `structure_seq` and `staleForStructure` in `domain/spreadsheet.js`. Parity: two cases added to `tests/fixtures/workspace-sheet-cases.json` ("structure guard: formulas and structure changes from an older copy", "structure guard and restore points"), the SQL regenerated with `node tools/workspace-sheet-cases.mjs --record`; the 10 earlier cases are unchanged (additions only). Screen: `ui/cellEditor.js` handles a `structure` conflict (keeps what was typed, rebases on the refreshed copy, says rows or columns changed, lets the person check and save again).
- **Checked.** Both test suites above, the parity SQL (105 checks) against the real functions, **9 of 9 mutations of the SQL caught, 8 of 8 mutations of the model caught, 1 of 1 of the editor rebase**. The tests of a plain value and of a formula from an old copy at the screen use the model as the server.
- **Not verified.** The live database (never touched), a real phone, two real accounts racing, and the insert and delete UI itself (not built yet).
- **Edited outside the usual list, for the owner's information:** `supabase/tests/1112_workspace_structure_guard_test.sql`, `supabase/tests/1102_workspace_sheet_parity_test.sql` (generated) and `tools/workspace-sheet-cases.mjs` (run, not edited). They are Workspace only; the generated file is rewritten by the tool from the fixture.

## 4. What to do next (the road to completion)

The owner gave "go" for Phase 5 on 23 and 24 Nov 2026 ("go ahead", "Continue"). **Phase 6 and later each need a new, separate "go" (rule N-17).** Phase numbers and gates are in `workspace.design.md` §9. Each increment below is its own reviewable PR; keep the same method as increments 3 to 5: pure domain code first with exact tests, then data, then screen, then a real-browser check, then mutations, then docs.

**Phase 5 still to build (suggested order):**

6. ~~**Sheet management**~~ **Done: see 3g.**
7. **Row and column structure (next; needs the owner's decision on the open risk in 3f first):** insert above or below, delete (with confirmation and a count), resize by dragging or a size field. Operations `insert_rows`, `insert_cols`, `delete_rows`, `delete_cols`, `resize` exist. (Freeze panes is NOT here: see item 10.) New ids come from `newIds` (>= 1000, integer range). Deleting rows and columns turns other people's edits to them into `target_deleted` conflicts: show them. **Formulas:** rewrite them in the same batch (see 3f) and **resolve the open risk in 3f first**.
8. **Formats:** a style editor (bold, size, text and background colour, borders, alignment, number format) using `set_styles` and the style id of each cell. Styles are stored once per sheet (at most 500). Always `sanitizeStyle`; the database validator is `1111`.
9. **Range selection, copy and paste** (tab and newline text), fill and clear a range; large pastes are split into operations of at most 5,000 cells.
10. **The four operations the database answers "not available yet"** (`move_rows`, `move_cols`, `duplicate_sheet`, `sort_range`) **and freeze panes.** `frozen_rows` and `frozen_cols` are columns of `workspace_sheets` (0 to 100) but **no operation changes them** (only a restore does), so freezing needs a new operation type (add it to the operation-type check, the apply function, `OPERATION_TYPES` and the model); the screen already draws frozen rows and columns. All of this needs a new migration (next free number is **1112**; fix-forward, never edit an applied one; mirror in `domain/spreadsheet.js`; extend the parity fixture with `node tools/workspace-sheet-cases.mjs --record`, which must pass on PostgreSQL as the oracle; apply live only with the owner's explicit OK, by hand, one batch ending with the `schema_migrations` insert, D-35, verify the function-body md5).
11. **Accessibility and phone pass:** ARIA rows, screen reader (owner), low-end phone scrolling (owner), the soft keyboard over the edit bar.

**Phase 6 (formulas) is done: see 3f.** **Then the rest of the programme** (each phase, its own go): 7 formatting extras, sort/filter and CSV, 8 offline (IndexedDB, outbox, kill-tab test, aeroplane-mode phone test), 9 synchronisation and conflict screens (migration `1103`), 10 attachments (migration `1104`, Storage policies, Edge Function), 11 integration, security review of every policy and function, full regression, owner acceptance. Open owner questions are in `workspace.design.md` §12.

Before Phase 9, run the Phase 1 prototype for `wss://*.supabase.co` (whether the CSP needs a change) in a throwaway copy.

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
13. **FIXED by migration `1111` (applied live by hand and registered as version `1111`, 22 Nov 2026).** The style validator in `1102` was looser than it read. `workspace_style_valid` lets through a JSON null or a non-integer for `weight`, `size`, `halign`, `valign`, border sides, `numfmt.type`, `numfmt.decimals` and `numfmt.pattern`, because `not (null between 8 and 72)` is null, not true. Verified on PostgreSQL 16 (parity case 6, "known looseness"): `size: "big"`, `size: 8.5`, `weight: null`, `decimals: 2.5` and `numfmt: {}` are all stored. `1111` now refuses null and wrong-kind values for every key that is present (new writes only; rows stored earlier are not re-checked). The model and fixture case 6 were changed with it. Still **draw cells with `sanitizeStyle()`**, since a style stored before `1111` could hold the old values.
14. **Whole-call errors versus `rejected`.** An id outside the integer range in `insert_*`/`delete_*` makes PostgreSQL raise a plain error (not `WS001`), which undoes the whole batch and is not answered per operation. The model throws `CallRefused` for it; the data layer should never build such ids (`newIds` stays in range).
15. **Restore forgets blank markers.** `workspace_sheet_restore` deletes a restored sheet's cell rows (markers included) before writing the snapshot's cells, so after a restore the ids of deleted rows are no longer remembered as "used". Harmless today (client ids are random 31-bit numbers) but worth knowing if id reuse ever matters.
16. **The local head can sit behind the server's.** Rejected and conflicting operations take a seq but are not pulled, so after a pull `wb.head_seq` may be lower than the server's head. That is harmless (cells are never newer than the last pulled operation); do not "fix" it by guessing.
17. **Opening is not atomic.** Pages are read at slightly different moments. That is why `openWorkbookFull` pulls from the `head_version` it opened at; do not skip that step.
12. **Hand-typed SQL drifts.** When you must paste a migration into a tool call, include comments inside function bodies too, or the hash check will differ (it did once, harmlessly).

## 7. Known problems that are not from Workspace

- 24 Nov 2026: the full suite, lint, prettier and the other checks pass on the working tree; the earlier red `cover.test.js` was fixed on `main`. Re-check `main`'s CI at the start of a session before blaming a failure on your own change.
- `docs/MODULES.md` still lists the planned `ai` module at nav order 85, the same number Invoice Desk uses; Workspace uses 86.
- Security advisor, not Workspace: 255 warnings (24 Nov; it grows as other modules add functions) that signed-in users can call `SECURITY DEFINER` functions (how every screen reaches the database; each function checks permissions inside; the review is an open Foundation item), 23 notices for tables with row level security and no policy (reached only through functions), and **leaked-password protection is off** (a Supabase Auth dashboard switch only the owner can turn on). `rls_auto_enable()` was revoked from signed-in users by Foundation migration `0017` (applied live by hand, registered as `0017`; the repo copy arrived with the editing PR).

## 8. Needs the owner

- **Revoke every GitHub token ever pasted in chat** (18 Nov, 22 Nov, and the one used for the 22-24 Nov pushes: it still worked on 24 Nov). Give a new one only for a push and revoke it afterwards. Never store a token in the repo or git config.
- Try **editing** on a real phone: tap a cell, type, save, the soft keyboard over the bar, a long text, a draft and "Save or cancel first", then edit the same cell from two devices to see the conflict choice. Report what felt wrong.
- Say **"go"** for increment 6 onwards (Phase 5 go is on record), and a separate "go" before Phase 6 (formulas).
- Answer the open questions in `workspace.design.md` §12.
- Turn on **leaked-password protection** in the Supabase Auth dashboard (check the username/PIN staff login still works with it).

## 9. Rules for the next session

- Follow `docs/MODULES.md`. Stay inside `js/modules/workspace/`, `css/workspace.css`, `vendor/workspace/`, `tests/…/workspace-*`, `supabase/migrations/11xx_*`, and the Workspace docs. Foundation-owned files only through the approved requests in `workspace.design.md` §10, and say which one you used.
- One phase at a time; stop for the owner's "go" between phases (N-17). Keep each change small enough to review.
- Never claim a check passed unless you ran it. State what you could not verify (real browser, real phone, CI).

## 10. Prompt to start the next session (paste this)

```
You are continuing the Dua Workspace module (Sheets) for sysalmanyasin/Dua (GitHub) and Supabase project
sdsynzsflubdxnelgthh. Sessions have no memory: the repo docs are your memory.

FIRST, READ (in order)
1. docs/modules/workspace.next-session.md: the banner, section 3e, section 4 (the road to completion), 6 (pitfalls), 8, 9
2. docs/modules/workspace.md (brief, owner decisions N-1..N-17)
3. docs/modules/workspace.design.md sections 3, 4, 4a, 7, 9 (and 12 for open questions)
4. docs/MODULES.md, docs/DECISIONS.md D-41..D-47, docs/SECURITY_MODEL.md (Workspace)
5. js/modules/workspace/domain/spreadsheet.js, domain/cellInput.js, data/workbooks.js, ui/sheet.js, ui/cellEditor.js
   (patterns to copy); docs/modules/workspace-browser-harness/README.md (real-browser checks)

CURRENT STATE (24 Nov 2026)
- Live DB: Workspace migrations 1100, 1101, 1102, 1110, 1111 applied and registered; Foundation 0017 applied. Two live
  workbooks exist (created with New workbook). Check the live state yourself, read-only, before you start.
- Built and merged: database for Sheets, JS reference model with parity test, data layer (data/workbooks.js), read-only
  grid and New workbook, cell editing (increment 5), and the formula engine (Phase 6: domain/formulas/, shown in the grid and
  accepted by the editor). Confirm on main which of these PRs are merged.
- Not built: sheet management, row/column structure, formats, range select and copy/paste, the four unbuilt operations,
  grid ARIA rows, CSV (7), offline (8), sync and conflict screens (9), attachments (10), final review (11).

YOUR TASK: Phase 5, increment 6 (sheet management: add, rename, delete, reorder sheets), then increment 7 (row and column
structure) if the owner says go. Same method as before: pure domain code first, data, screen, real-browser check with the
harness, mutation checks, docs.

RULES
- Phase 5 and Phase 6 gos are on record. Phase 7 and later need a new go from the owner (rule N-17). Do not build offline or CSV.
- Before any row or column insert or delete, read the OPEN RISK in section 3f and get the owner's decision.
- Work only in js/modules/workspace/, css/workspace.css, vendor/workspace/, tests/**/workspace-*, supabase/migrations/11xx_*,
  docs/modules/workspace*, docs/modules/workspace-browser-harness/. Say which approved Foundation request you use if you need
  one. Changing anything else (for example the shared docs and sw.js) is limited to the status lines and `npm run build:sw`.
- Live database: READ-ONLY unless the owner says otherwise in this session. A migration is a NEW file (fix-forward, next free
  number 1112), tested on PostgreSQL 16, applied only with the owner's explicit OK, by hand, as one execute_sql batch ending
  with the schema_migrations insert (never apply_migration, D-35), then verify the function-body md5 against the repo file.
- Never claim a check passed unless you ran it. Run: npm ci, npm run lint, npx prettier --check ., npx vitest run,
  npm run check:secrets, npm run check:vendor, npm run build:sw (when a screen file is added), and bash supabase/tests/run.sh
  (needs PostgreSQL 16: apt-get update && apt-get install -y postgresql, start it, PGHOST=localhost PGUSER=postgres).
  Check in a real browser with the harness. Say what you could not verify (real phone, screen reader, two accounts).
- jsdom cannot test CSS or layout; do not trust it for visibility, paint order, scrolling or the CSP.
- Secrets: never store a token in the repo or git config. Ask the owner for a token only when you must push; push with a
  one-time URL, open a PR, and remind the owner to revoke the token. Do not merge a user-facing change unless the owner says so.

VERIFY AGAINST THE LIVE PROJECT (read-only) BEFORE AND AFTER YOU FINISH
- registry: select version from supabase_migrations.schema_migrations where version >= '1100'
- all workspace_* functions: search_path pinned, anon cannot execute, internal helpers not callable by authenticated
- get_advisors (security). Known, not Workspace: see section 7. Report, do not change.

END WITH
A short report: what you built, what you ran and its result, what you could not verify, the next increment, and what you
need from the owner.
```

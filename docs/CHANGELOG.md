# Changelog (everything built so far)

Dates are 2026. Counts are as of the end of each step.

## 23 Nov — Operations Redesign, Stage 3a (Task Master database layer)
- New migrations `1200_task_core`, `1201_task_lifecycle`, `1202_task_schedules`, `1203_task_reads` (tested locally; not applied yet: `docs/ops/f10-stage3a-apply-and-rollback.md`). Design and rules: `docs/DECISIONS.md` D-65.
- New security guard `1299_task_exposure_test.sql`. `0001_core_test` now expects a Junior to hold 6 permissions (adds `tasks.view_own`).
- No screens yet: My Tasks, the Owner's Tasks page, verification and the dashboard sections come in Stage 3b.

## 24 Nov — Sales Add Entry: auto-pull from the evening closing and Candela
- Opening Add Entry on a day with no record now fills itself, and a **Pull / Pull again** card does it on request (also on a saved day, where it overwrites only the fields it fills). It never saves: the person checks the numbers and presses Save.
- Mapping (checked on 23 Nov 2026): Cash Sale = the evening closing's System Cash Sales Total (207,202); Bank Alfalah = its Bank Alfalah machine (46,451); Bank Alfalah 2 = its Keenu machine (116,020); Cash Returns = Cash Sale − Candela cash rounded to the rupee (207,202 − 178,128 = 29,074); COMP SALE = Candela's total rounded (445,410); each credit client = Candela's credit for that customer (Askari 7,360.32, PARCO 4,048.14). Known full names are spelled out in `ALIASES` in `autofill.js` (LDA = Lahore Development Authority, PSO = Pakistan State Oil). A Candela customer with no matching field is listed with its amount, never guessed; nothing is created in Manage Fields.
- Sources are two new read-only published interfaces (docs/MODULES.md §8.1), so Sales still reads no other module's tables: `closing_day_feed` (migration `0222_closing_day_feed`, same read gate as the saved-closings list) and `candela_day_feed` (migration `0901_candela_day_feed`, `candela.view` only). Each source is asked separately: a person who may read only one gets that one, with a note about the other; a person who may read neither sees no card. No permission was widened.
- Code: `js/modules/sales/domain/autofill.js` (pure), `data/api.js` (`autofillSources`), `ui/entry.js`. Tests: `sales-autofill.test.js` (24), `sales-entry-autofill.test.js` (11), database tests `0222_closing_day_feed_test.sql` and `0901_candela_day_feed_test.sql`; the whole database suite passes on PostgreSQL 16. `sw.js` regenerated.
- **Migrations 0222 and 0901 were applied by hand on 24 Nov 2026** (RUNBOOK §4: the file's SQL plus its registry row in one batch, not `apply_migration`) and registered as `0222` and `0901`. Checked afterwards: both functions are `security definer` with `search_path=public`, `anon` and `public` cannot execute them, `authenticated` can; the live function bodies hash identically to the repo files (`closing_day_feed` 49ae45d4…, `candela_day_feed` e21bdb48…); the same queries on live data return the 23 Nov figures (207,202 / 46,451 / 116,020; Candela 178,128.42 / 445,409.81; Askari 7,360.32, PARCO 4,048.14); registry 113 rows, none with a timestamp version. The security advisor shows nothing new (both functions appear only in the generic signed-in-can-execute-SECURITY-DEFINER notice that covers every RPC).
- Not verified: a real phone, and the live data (names of the live credit customers against the live field labels).

## 22 Nov — Operations Redesign, Stage 2b (Business Intelligence, Staff sections, realtime)
- Owner Home: Business Intelligence for 7, 30 or 90 days with fair comparison; closings refresh the lists in real time.
- Staff Home: My Payroll (own closed payslips, read only, per-person permission `payroll.view_own`) and My Recent Activity.
- New migrations `0220_closing_ops_period`, `0702_ops_bi_summary`, `0109_mgmt_my_payslips` (applied live and registered on 23 Nov 2026: `docs/ops/f9-stage2b-apply-and-rollback.md`). New security guard `0749_ops_exposure_test.sql`; `0199` lists `mgmt_my_payslips`. `payroll.view_own` is granted person by person only..

## 22 Nov — Workspace Sheets: migration 1111 applied live
- Applied `1111_workspace_style_validator_fix` to the live project by hand as one `execute_sql` batch (not `apply_migration`, D-35), on the owner's instruction, and registered it as version `1111` in the same batch. Before: registry held `1100`, `1101`, `1102`, `1110`; no sheet, cell or style rows existed.
- Verified live: function body hash equals the repo file (`22dd6078…`); `search_path` pinned to `public`; `anon` and `authenticated` cannot execute it; `size "big"`, `size 8.5`, `weight null`, `numfmt.decimals 2.5`, a null border side and sizes 7 and 73 are refused; a full valid style, `{}` and `numfmt: {}` (type optional) still pass. Only the changed function and the registry were touched; the live Workspace data (2 notes) was not.
- Not re-run live: the database test files (they need a clean PostgreSQL; they passed on PostgreSQL 16 before).

## 23 Nov — Workspace Sheets: read-only grid and New workbook (Phase 5, increment 4; merged as PR #77)
- New route `/workspace/sheet` (`ui/sheet.js`): opens the workbook home chose, shows title, role, sheet tabs, a bar with the content of the selected cell, the grid, and Refresh (pulls what changed; opens again after a restore; also refreshes quietly when the person returns after a minute). A failed refresh never blanks the grid. A workbook with no sheet offers "Add a sheet" to owners and editors (the only write on this screen).
- New grid (`ui/gridView.js` with pure logic in `domain/grid.js`): draws only the rows and columns on screen (a 3,100-row sheet is about 170 cells in the page), native scrolling, frozen rows and columns, A/B/C and 1/2/3 headers, stored row heights and column widths, number formats (number, currency, percent, date), bold, size, colours, alignment and borders, tap or arrow keys to select. Cell text is always set as text. Styles go through `sanitizeStyle` and the DOM style API (the page's policy refuses inline style attributes). The grid always draws on a light sheet so an author's colours are readable in dark mode.
- Home: **New workbook** is enabled (for people with `workspace.create`); workbooks open in the grid. Route registered in `manifest.js`; `sw.js` regenerated (5 files).
- Tests: `workspace-grid.test.js` (19) and `workspace-sheet-ui.test.js` (35); whole suite 2,223 tests (318 Workspace in twelve files). Mutations of the code were each caught. Found by them: numbers over 12 digits were rounded (a barcode lost digits; now exact), and a failed "Add a sheet" message was wiped by the refresh that followed. Found only in a real browser (Chromium, throwaway harness outside the repo): the role pill was white on white, and scrolled column and row headers painted over the frozen ones.
- Not done: editing, formulas (shown as text), copy and paste, resize, accessibility beyond ARIA grid attributes and arrow keys, offline. Not verified: a real phone (grid scrolling, touch feel, iOS Safari), a screen reader. No migration; the live project was not touched.
- Live evidence (23 Nov, read-only look at the database): after the merge two workbooks were created with New workbook (14:04 and 18:46 UTC); each has one sheet and one `add_sheet` operation applied at version 1, so the data layer's sender and `workspace_apply_ops` worked from the real app. Whether the grid was tried on a real phone is not recorded.
- Known, not Workspace: `tests/unit/cover.test.js` fails on `main` itself (the Cover page text no longer matches the test) and `main`'s CI was already red before this PR. Not touched here (outside Workspace).

## 22 Nov — Workspace Sheets: data layer (Phase 5, increment 3; merged as PR #70 on 23 Nov)
- New `js/modules/workspace/data/workbooks.js`: open a workbook and build the local copy (`openWorkbookFull`: styles and cells page by page, then pull from the `head_version` it opened at so edits made while paging are not missed); `pullAndApply`; `createOperationSender` (batches of at most 200 operations / 3 MB; a batch that was not answered is kept and sent again with the SAME operation ids and content, D-45; a batch the server refuses is held, never dropped; `drain` waits 2 s to 60 s between failures); restore points (`createSnapshot`, `listSnapshots`, `restoreSnapshot`, owner only in the database). Operations are checked before sending (ids in integer range, envelope, size). Every call goes through `data/api.js`; eight new friendly messages added there.
- Tests: `tests/unit/workspace-workbooks.test.js` (41 tests) run the data layer against the JS reference model acting as the server. Five deliberate mutations were each caught. Whole suite 2,043 tests, lint, prettier, secrets, vendor checks and the whole database suite (3,643 checks) pass. No migration written or applied; the live project was only read. Not imported by any screen yet, so `sw.js` was not regenerated. Still no Sheets screens.
- Live read-only check before and after: registry 1100, 1101, 1102, 1110, 1111; all 51 `workspace_*` functions have a pinned `search_path`, none is callable by `anon`, internal helpers are not callable by signed-in users. Advisor: nothing new from Workspace (`workspace_save_keys` and `workspace_sheet_revisions` have row level security and no policy on purpose, reached only through functions); known and not Workspace: `rls_auto_enable()` executable by signed-in users, leaked-password protection off.

## 22 Nov — Operations Redesign, Stage 2a (Owner Action Centre and Recent Activity)
- New migrations `0219_closing_ops_feed`, `0700_ops_rules`, `0701_ops_action_items` (applied live and registered on 22 Nov 2026; procedure, verification and rollback in `docs/ops/f8-stage2-apply-and-rollback.md`).
- Home shows an Action Centre and Recent Activity to the Owner only; new shared refresh service with last-updated time and stale-data warning.
- Decisions D-56 to D-60 recorded (schedules, no evidence storage, in-app notifications, Groq free plan, activity defaults and deposit figure).

## 21 Nov — Operations Redesign, Stage 1 (audit and plan)
- Added `docs/OPERATIONS_REDESIGN_PLAN.md`: audit of the current app, gap analysis against the redesign brief, architecture decisions, Task Master / notifications / AI design, eleven owner decisions, stage-by-stage acceptance. Nothing in the redesign is built yet.
- Added migration `0015_core_trigger_search_path` (pins `search_path` on `set_updated_at` and `activity_log_immutable`, removes their PUBLIC execute right) with test `0015_core_trigger_search_path_test.sql`. Applied live and registered as `0015`.
- Added `tools/check-registry.mjs` (compares migration files with a read-only registry export) and `docs/ops/f7-registry-reconciliation.md` (guarded, reversible procedure for the 12 timestamp-versioned rows). Executed live: 13 rows renamed (incl. `0218`), 0 timestamp versions remain.

## 22 Nov — Workspace Sheets: browser reference model and database parity test (merged to main, PR #66)
- New `js/modules/workspace/domain/spreadsheet.js`: a pure model of the `1102` rules (apply operation batches with the same answers, conflicts, duplicates, log and pull, restore points, a local copy that follows pulled operations, A1 labels, cell input parsing, operation builders).
- New shared fixture `tests/fixtures/workspace-sheet-cases.json` (10 operation sequences) and tool `tools/workspace-sheet-cases.mjs`, which generates `supabase/tests/1102_workspace_sheet_parity_test.sql` (85 checks). Verified on PostgreSQL 16: the database and the model answer identically.
- Finding and fix: the `1102` style validator accepted some malformed styles (for example `size: "big"`). New migration `1111_workspace_style_validator_fix` (with a 20-check database test) refuses them; written on the owner's instruction and now recorded as live migration `1111` (verified in the 22 Nov live registry). No workbook/grid screen exists yet; future UI must use the existing style sanitization rules.
- Tests: 47 new unit tests; whole database suite passes. The live registry now includes `1111`; treat this migration as applied live. The audit query confirmed its registry row; do not reapply it. The reference model and fixtures/tests are merged to main; still no Sheets screens.

## 22 Nov — Migration registry: all versions four-digit; `0412` reconciled
- Read-only check of `supabase_migrations.schema_migrations`: 93 rows, all four-digit; 92 migration files on `main` plus live-only `0015`. The 12 timestamp rows reported by the 21 Nov audit were already numbered.
- Backup `supabase_migrations.schema_migrations_backup_20261122` (92 rows), then the guarded rename `20261122035159` → `0412` (exactly one row or nothing). Afterwards 93 rows, 0 timestamp rows. The 0015 source remains only on `ops-redesign-stage1`; add it to main without reapplying.
- Open: `0015_core_trigger_search_path` is registered live but its file exists only on the unmerged branch `ops-redesign-stage1`. The old backup `..._20261112` was dropped on 22 Nov 2026 at the owner's request; backups `..._20261121` (91 rows, origin not documented) and `..._20261122` (92 rows) remain and can be dropped after review.
- The earlier "13 timestamp rows / 90 files" wording in the entry below and in several docs was wrong and is corrected here.

## 22 Nov — Audit: Individual Audit compiles itself on submit (migration 0412, applied live)
- Migration `0412_audit_individual_autocompile.sql`: an Individual Audit round is compiled in the same transaction as the person's submit, so they can start the next one without waiting for the main auditor. New internal `audit_compile_round_core` (not callable by users); `audit_compile_round` still needs `audit.compile` and still compiles normal rounds by hand.
- No cross-round conflicts are raised in the individual engagement (owner decision AUD-14). `audit_reopen` refuses with `self_pick_open` when the person already has another open Individual Audit. No `audit.compiled` owner alert for individual rounds; the `audit.submitted` alert still fires.
- Screen: after submit the counting screen shows "Your result" (items, differences, value) and **Start another audit**.
- Applied to live DuaPharmaPlus with the Supabase `apply_migration` tool, which registered it as `20261122035159` (the RUNBOOK says to apply by hand under the repo number). The SQL is verified identical to the tested copy (function body hashes, D-47). The row was renamed to `0412` the same day (see the registry entry above).
- Tests: new `0412_audit_individual_autocompile_test.sql` (16 checks); full database suite and `npm run verify` (125 files / 1,933 unit tests) pass. Phone check (PHONE 4) pending.
- Documents updated: Audit brief (R8, AUD-14), progress, handover and phone tests; Audit 2.0 note; USER_GUIDE (new Audit section), ADMIN_GUIDE, BUSINESS_RULES, DECISIONS (D-50), SECURITY_MODEL, RUNBOOK, TESTING, ROADMAP, PROJECT_STATUS, MODULE_PROGRESS_REGISTER, README, PROJECT_PROGRESS.

## 21 Nov — Closing: Owner-only Shift ↔ Final change (PR #60, applied live)
- Migration `0218_closing_mode_change.sql`: `closing_change_mode`, `closing_is_admin_owner`, trigger `closings_mode_guard`. Only an admin at MFA level 2 may change a closing's type; the database refuses every other route, including the ordinary draft save.
- Draft: changes in place, figures and rows kept. Submitted: reopened through the existing `closing_reopen` as a new revision carrying the new type; original kept until the revision is submitted; resubmitted with the ordinary `closing_submit`. CLS-6 and CLS-7 hold. Audit: `closing.mode_changed` in the activity log.
- Screens: Review "Change to Final/Shift", ledger "Type" button (Owner only); other devices follow the change.
- Applied to live DuaPharmaPlus the same day (registry version `20261121182327`); no closing data changed. Owner try-out pending.
- Tests: new `0218_closing_mode_change_test.sql` (all database tests pass), `closing-mode-change.test.js` (18 tests).

## 21 Nov — Full module, CI and live Supabase audit
- Audited main commit `96694979e65242f5ee24eb86f215630686b552c8`: 13 registered modules, 707 repository files, 121 front-end test files / 1,891 recorded unit tests, 77 database test files and 89 migration files.
- Verified GitHub Actions CI run #401 (app, database, functions) and Pages deployment #226 succeeded on the same commit.
- Queried live DuaPharmaPlus: ACTIVE_HEALTHY on PostgreSQL 17.11; 124 public tables all with RLS; 337 public routines; six active Edge Functions, Inventory sync v24.
- Found 12 migrations whose repo four-digit versions are recorded in the live registry under timestamp versions. Corrected the stale claim that Closing 0214 was missing: it exists in both repository and live registry.
- Updated the master register, project status, roadmap, testing, architecture/security/database/runbook references and module progress/handover documents. Added `docs/PROJECT_AUDIT_2026-11-21.md`.
- Added missing Access and Tools module briefs; refreshed the owner guide with all 70 live permission keys and the current state of all 13 modules.
- Remaining work is acceptance, migration-registry reconciliation, security-advisor review, real backup restore, Workspace Sheets UI and operational hardening; see the audit and roadmap.

## 21 Nov — Workspace Sheets database applied live; documents brought up to date
- Migration `1102_workspace_sheets` is applied to the live project and registered as version `1102`. Checked live: 5 Sheets tables with row level security, 15 functions with pinned `search_path`, internal functions not callable by `anon` or `authenticated`, `1100`, `1101`, `1102` and `1110` all registered.
- Workspace Notes accepted by the owner after live testing. The Sheets screens are **not built** yet (domain model, data layer, grid, "New workbook").
- Supabase advisor (live): 14 tables with row level security and no policy (service-role-only by design), 2 unpinned `search_path` functions outside Workspace (`set_updated_at`, `activity_log_immutable`), signed-in-callable SECURITY DEFINER functions (by design, each checks the caller), leaked-password protection off.
- Documentation updated: README, PROJECT_STATUS, MODULE_PROGRESS_REGISTER, ROADMAP, DATABASE_DESIGN, CHANGELOG and the Workspace brief, progress and handover.

## 21 Nov — Branch cleanup and Workspace Sheets database merged
- Reviewed every branch against `main`. 18 were already fully merged and 8 more contributed nothing on trial merge (work already in `main`); all deleted. `module/workspace-sheets` held new work and was merged: migration `1102_workspace_sheets` (sheets, cells, styles, operation log, snapshots, apply/restore) with its 203-check database test. **Not yet applied to the live project.**
- `main` is now the only branch. Verified after merge: 1,891 unit tests (121 files), lint, Prettier, secret and vendor checks pass.
- Documentation updated: branch audit, project status, roadmap, sessions, testing, Workspace handover.

## 21 Nov — Workspace review and search_path follow-up
- Reviewed Workspace (Notes) against the live project: tables, security, permissions and tests match the docs.
- New migration `1110_workspace_guard_search_path` pins `search_path` on the four trigger-guard functions (Supabase advisor warning). No behaviour change; new database test and two tightened checks. Applied to the live project by hand and registered as `1110`.

## 21 Nov — Manager sheets as tables
- Staff Credit, Salary and Generic Sheet are now numbered tables with gridlines, a header row and a TOTALS row, like the old app. Salary and Generic keep the same typing, saving and live totals; Staff Credit opens a person's entries and forms under their row.
- On a phone the table scrolls sideways and the Name column stays in view. Incentive is unchanged.

## 21 Nov — Staff logins created from the Staff Registry (4-digit PIN)
- Owner creates a login from a registry person (username, Junior/Senior, 4-digit PIN); linked to the existing staff row, so no duplicates. Weak PINs refused. Set PIN and Unlock in Users & Access; registry shows who has no login.
- Lockout is now 5 wrong PINs for 1 hour. Older 6-digit PINs keep working until reset.
- Removed self sign-up: `request-access`, `claim-account`, access requests screen, setup codes (tables kept as history).
- Database: `0014_staff_logins_pin4` (one login per person; `access_locked_usernames()`). New server secret `PIN_PEPPER`.

## 21 Nov — Emergency Billing: full-screen audit and fix
- Bug fixed: in full screen the billing key handler swallowed Escape before any popup saw it, so Escape could not close Product Help (F5), held bills, Search receipt or the PIN question.
- Full screen now stays until the cashier presses Exit full screen. If the browser ends it (Esc in Firefox/Safari, a long Esc press, a print window) the full layout stays, an open popup is closed, and real full screen returns on the next click or key press. Removed screens ignore full-screen events.
- Tests: 8 full-screen tests (suite: 1,891 unit tests, all database tests pass) (replacing one that encoded the bug); checked in real Firefox.

## 21 Nov — Emergency Billing: Phase 5 complete and Phase 6 testing
- **Phase 5 (merged 20 Nov, PR #45):** partial-refund dialog (item and quantity, amount preview, retry-safe); receipts in the shop's own slip layout (Primary, Gift, Summary, Secondary; 58/80 mm; Duplicate on reprints and extra copies; offline bills carry a temporary-reference note) with live Print/Copies/Type controls, Search receipt, History reprint and offline printing; Settings > Receipt form with live preview, test slip and logo; reports and CSV/Excel/PDF exports with a pending/failed-invoice warning (files named `-INCOMPLETE`).
- **Database:** migrations `0633`, `0634`, `0640`, `0641` (20 Nov) and `0642` (receipt slip fields STN/NTN, POS number, slip title, footer to 400 characters) applied live by hand with the owner's approval and registered; read-only safety checks passed (no anon/public execute, helpers internal, RLS on).
- **Phase 6 (this entry):** new database test `0650` (300 random invoices, 1,054 random partial refunds add up to net to the paisa); preview-vs-database cross-check of 1,963 refunds found and fixed a 0.01 rounding difference (exact fractions now); large-data tests (30,000 products, 300-line bill, 5,000-invoice report); real Firefox print-engine check of the slips at 58 and 80 mm (found and fixed a pale background behind the slip); screenshot fixes (report totals, print controls spacing). Fixed the billing cash box not clearing when cash entry is switched off, and `css/ebill.css` Prettier.
- Tests: 1,874 unit tests in 120 files; 75 database test files (3,226 checks) pass.
- Remaining (owner): grant `ebill.*` rights (none granted live), fill in Settings > Receipt, real-device and real-printer checklist: `docs/modules/ebill-phase6.md`.

## 19 Nov — Workspace Phase 4: Notes editor, sharing and history
- Workspace Notes are now a registered module (`/workspace`, `/workspace/note`): home with search (titles and note text), Mine / Shared / Archived / Trash tabs and personal folders; rich-text editor (headings, bold, italic, underline, bulleted/numbered/checklists, links, undo/redo); autosave with same-operation-id retry; conflict banner (keep mine / use latest / copy mine); sharing dialog (owner/editor/viewer, transfer ownership, hide history from viewers); history with preview and owner-only restore; archive and delete.
- Vendored ProseMirror bundle (`vendor/workspace/`, nine MIT packages pinned at least 14 days old, reproducible esbuild recipe, licences, SHA-256 in `tools/check-vendor.mjs`). The editor schema is proved equal to the note validators by running the shared cases through the real library.
- `sw.js` file list regenerated (adds Workspace files and two stylesheets `main` had missed).
- Database: no new migration. Live registry: `1100` and `1101` applied by hand on 18 Nov 2026; function bodies verified identical to the tested copy.
- Tests: 176 Workspace unit tests; full suite after merging `main` 1,669 unit tests (one pre-existing failure in `ebill-page.test.js`, fixed 21 Nov), 71 database test files pass.
- Known: the router carries no ids, so the open note id lives in session storage (no deep links); `css/ebill.css` failed Prettier on `main` itself (fixed 21 Nov).
- Handover for the next session: `docs/modules/workspace.next-session.md`; remaining design: `docs/modules/workspace.design.md`.

## 19 Nov — Documentation reconciliation
- Added `docs/MODULE_PROGRESS_REGISTER.md` as the consolidated source for registered modules, backend-only work, live-status evidence, outstanding acceptance and all branch comparisons.
- Corrected stale status in README, canonical project status, roadmap, testing guide, shared module contract and module briefs/progress handovers: Manager 0108, Closing through 0211 (with 0214 live/source drift flagged), STR, Audit C1, Emergency Billing Phase 5, Invoice Desk integration and Workspace Phase 3 backend-only state.
- Reconciled the branch list: nine non-main refs are all 0 commits ahead of `main`; no branch should be merged again. Branch deletion was not performed.
- No application source, migrations, Supabase data, secrets or runtime configuration were changed.

## 4–5 Nov — Plan, rules and design
- Owner's fresh-build plan received; decisions confirmed (GitHub Pages, free Supabase, Candela stays the source of truth, midnight business day, username + PIN for staff).
- **Phase 0:** business rules read from the old code and written down (`BUSINESS_RULES.md`): closing calculation, sales TOTAL/DIFF, carry-forward, Final Closing, STR/audit rules, emergency billing.
- **Phase 1:** architecture, database design, security model, 22 decisions.

## 5 Nov — Phase 2: foundation (accepted by the owner)
- Database: people, roles, permissions (per-person allow/deny), settings with history, append-only activity log; admin MFA enforced in the database.
- Four Edge Functions: staff login with lockout, access requests, one-time setup codes, admin actions.
- App shell, router, module registry, sign-in / request / set-PIN / MFA screens, Users & Access page.
- CI (lint, tests, database tests, function checks); secret scan; vendored Supabase client.
- Live on the owner's new Supabase project; owner tested request → approve → PIN → sign-in → lockout.

## 5 Nov — Sales history
- Old backup studied: 2,379 days + 80 months. The old TOTAL formula reproduced 2,268 days; 110 old days held negative client values that the old app had stored as reductions; 30 days typed as April 2021 were April 2022; one day (25 Sep 2026) had a stale total. Owner decisions applied.
- One-time, token-protected import function; verified; removed.

## 5–6 Nov — Sales, first pages
Add Entry (live total, corrections with reason, safe retries), Daily Data, Index, Diff Report, Cash to Deposit (with 72 mm receipt), Last Day for staff; payment-method table; revisions; page-level permissions and sub-menus.

## 6 Nov — Daily Check List and design
Daily Check List (the owner's priority): all 19 sections and defaults carried over exactly from the old code, autosave, offline copy, conflict check, live stock figures, progress, Preview / Copy / Print / Email, shared dropdown lists. Design refresh: original fonts and logo, status bar, header, tab navigation, teal hero banners. Fixed: pages sharing one event container.

## 7 Nov — Sale Report, Cover, Dashboard, Gmail
- **Sale Report** with Customize Rows (saved per person), Till/Patty, print, copy; Monthly Target card (targets and preferences tables).
- **Cover (home):** greeting, key numbers, Needs attention, tiles per permission.
- **Dashboard:** 11 KPI cards (like-for-like comparisons), insights, Race the forecast, five charts with ranges/compare/year filter, summary table, top 10 days, weekday averages, best/worst months, year calendar. Summary views keep the phone's downloads small.
- **Send via Gmail** for the Sale Report and Daily Check List (send-only permission; recipients remembered).

## 10 Nov — Completing Sales, and documentation
- **Reports:** monthly report and Sale Book (year / all time), landscape print and Save as PDF.
- **Manage Fields, Targets page**, Add Entry opens on the next unrecorded day with a recent-entries list, Index shows target progress.
- Security: unsent drafts are cleared at sign-out.
- Merged with the other session's inventory-feed work; migration numbering and registry problem found, documented and worked around.
- This documentation set.

## Totals at 10 Nov
10 migrations · 33 tables / 6 views / 25 functions · 29 permissions · 5 Edge Functions · ~5,600 lines of JavaScript · 242 front-end tests · 195 database checks.


## 13 Nov — Foundation close-out and current status reconciliation

- Daily encrypted database backup workflow is live; first successful Google Drive backup was recorded on 13 Nov. Owner notifications, retry handling, backup self-diagnosis and the Tools status view are implemented.
- `public.rls_auto_enable()` execute was revoked from `PUBLIC` and `anon`; automatic RLS behaviour was checked. The remaining `authenticated` execute grant is documented as a platform/event-trigger limitation to review if the advisor continues to flag it.
- CI now lints workflow files with actionlint. The latest main project progress entry reports 357 unit/jsdom tests and a full database suite including Closing, Manager and Inventory.
- Manager migrations 0101–0103 are recorded as applied and checked live. Closing has a partial guided ledger UI; its remaining sections and submit/ledger workflows are still pending.
- Inventory's enhanced delta-feed migrations 0301–0304 and Edge Function v14 were applied and verified live on 12 Nov (their source reached `main` with the rest of the module; see the 17 Nov entry below).
- Local backup restore test passed 39/39 checks. A restore from a real Drive backup into a separate Supabase project remains outstanding.

## 17 Nov — Inventory complete
- Migrations 0301–0307 and Edge Function v23 are live, registered and on `main`. All six screens are built: Overview, Stock Ledger, Reorder, Excess Working, Health, Sync.
- `0307` ended the hourly "statement timeout" failures: the sync file now goes to the database as one whole request body instead of a named argument that PostgREST re-parsed (mean 4.8 s of the 8 s limit). Applied by hand and registered. The cron stays at minute 0.
- Home shows a Stock row (stock value, to reorder, not selling, excess) to people with `inventory.view`.
- Stock Ledger, Reorder and Excess Working export to Excel (a small writer, no library, values only), PDF (the browser print dialog, landscape) and CSV.
- Details and evidence: `docs/modules/inventory.progress.md`.

## 18 Nov — Branch consolidation, Audit, Emergency Billing, Workspace
- Merged into `main`: `feat/closing-staff-mobile-ux` (PR #32; its changes already matched `main`), `module/audit-a5` (A5, B1, `0408` fresh stock, Inventory `0308`), and `module/workspace` (brief, `1100_workspace_core.sql` and test; the Home page conflict was resolved in favour of `main` because the workspace change there was formatting only).
- Prettier applied to six Home/shell files that `main` had left unformatted, so the CI format check passes. `npm test` still shows 15 failures (cover, service-worker, shell), identical on `main` before this merge; recorded in `docs/PROJECT_STATUS.md`.
- Branches reduced to `main` plus three: `module/audit-a5`, `feature/backup-emergency-pos`, `module/workspace`. All others were deleted: 12 were fully merged; three held superseded, unmerged work (the 11 Nov session plan, an early inventory-sync design, and the first inventory-feed branch) and are kept as tags `archive/docs-session-plans`, `archive/design-inventory-delta-sync` and `archive/foundation-inventory-feed` (restore with `git checkout -b <name> <tag>`).
- Documents updated: PROJECT_STATUS, SESSIONS, ROADMAP, CHANGELOG, and the Audit, Emergency Billing and Workspace module files.

## Current status pointer

The dated entries above are historical. For the current module-by-module distinction between integrated, live, in-progress and pending, see [PROJECT_STATUS.md](PROJECT_STATUS.md). Do not use the 10 Nov totals as current totals.

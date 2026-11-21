# Changelog (everything built so far)

Dates are 2026. Counts are as of the end of each step.

## 21 Nov — Operations Redesign, Stage 1 (audit and plan)
- Added `docs/OPERATIONS_REDESIGN_PLAN.md`: audit of the current app, gap analysis against the redesign brief, architecture decisions, Task Master / notifications / AI design, eleven owner decisions, stage-by-stage acceptance. Nothing in the redesign is built yet.
- Added migration `0015_core_trigger_search_path` (pins `search_path` on `set_updated_at` and `activity_log_immutable`, removes their PUBLIC execute right) with test `0015_core_trigger_search_path_test.sql`. Not yet applied live.
- Added `tools/check-registry.mjs` (compares migration files with a read-only registry export) and `docs/ops/f7-registry-reconciliation.md` (guarded, reversible procedure for the 12 timestamp-versioned rows). Not yet executed.

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

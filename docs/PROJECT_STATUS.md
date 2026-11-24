# Project status — canonical snapshot

**Snapshot date:** 22 November 2026

> **Fresh verification supersedes conflicting values below:** main commit `18283f17600be54d562a5eb3c40bf89906416b29`; CI #444 and Pages #244 succeeded. Live DuaPharmaPlus is ACTIVE_HEALTHY on PostgreSQL 17.11, with 124/124 public tables under RLS, 341 public routines and 93 four-digit migration registry rows. Main has 92 migration SQL files; the already-applied live-only 0015 source exists on `ops-redesign-stage1`. Six Edge Functions are active, including two retired HTTP 410 endpoints. Workspace Sheets reference model and parity tests are merged; UI/data layer remain incomplete. See [22 Nov audit](PROJECT_AUDIT_2026-11-22.md).  
**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Code baseline inspected:** [`18283f1`](https://github.com/sysalmanyasin/Dua/commit/18283f17600be54d562a5eb3c40bf89906416b29)  
**Live application:** https://sysalmanyasin.github.io/Dua/  
**Recorded Supabase project:** DuaPharmaPlus (`sdsynzsflubdxnelgthh`)

This is the concise operational snapshot. For per-module evidence, migration notes, outstanding work and branch comparisons, see [MODULE_PROGRESS_REGISTER.md](MODULE_PROGRESS_REGISTER.md). Module-specific progress files remain the detailed evidence. Older dated entries in `PROJECT_PROGRESS.md` and `docs/CHANGELOG.md` are historical records.

## Status vocabulary

- **Integrated** — application source is on `main` and the module is registered in `js/modules/index.js`.
- **Backend / not registered** — database/domain work exists but the module is not exposed through the app registry.
- **Live (recorded)** — a dated module progress file records that the migration/function was applied and checked in DuaPharmaPlus; not a fresh check performed by this document.
- **Built; acceptance pending** — implementation and recorded tests exist, but owner/device acceptance remains.
- **In progress** — approved scope is only partly implemented.
- **Planned** — not implemented as an application module.

## Registered module status

| Module | Main status | Live status recorded in repository | Remaining work |
|---|---|---|---|
| Foundation / Access | Integrated; authentication, MFA gate, roles, per-person permissions and user access. | Foundation is recorded live and owner-accepted. | Production/staging separation, operational hardening and security-advisor follow-up. |
| Tools | Integrated; notifications, backup workflow and operations status. | Daily encrypted Drive backup and monitoring are recorded live. | Real Drive-backup restore into a separate empty Supabase project; keep monitoring. |
| Home | Integrated; Home 2.0 redesign in main. | Uses existing permission-aware summary RPCs; no new migration. | Real-device owner acceptance across staff permission levels. |
| Sales | Integrated; entry, checklist, dashboard, reports, targets, fields and Gmail-send flow. | Sales migrations and imported history recorded live. | Owner phone acceptance and real Gmail send from deployed origin; dependent extras remain decision-based. |
| Manager | Integrated; Staff Registry, Staff Credit, Salary, Generic, Incentive, Petty Detail, Expenses, Jazz Cash, Misc, Balance Tally, Inbox and reports. | Migrations 0101–0108 recorded applied/registered live. | Phone try-outs #2–#4; verify Credit Inbox using real Closing feed. Attendance is later. |
| Closing | Integrated; 14-section ledger, shared drafts/live sync, ledgers/feed, Closing Book/PDF, history, review/reopen and settings. | Live registry contains 0201–0218 by repo number. | Owner try-out #5, acceptance and decision on audit gate; preserve migration registry parity. |
| Inventory | Integrated; feed, six screens, Home stock row and Excel/PDF/CSV exports. | 0301–0308 plus 0309 company summary live; Edge Function v24 active. | Real-phone PDF check; remove legacy sync fallback after stable operation and verify failed-sync monitoring. |
| STR | Integrated; list, detail, report, zero-dispatch, archive and overdue notifications. | 0500–0504 and scheduled jobs live (fresh migration registry check). | Phone try-outs #1/#2, owner acceptance, supplier/pack metadata and Foundation presentation follow-ups. |
| Candela Sales | Integrated; four owner screens and staff-safe daily total pill. | 0900, 0901 (`candela_day_feed`, owner-only interface for Sales auto-pull) and initial history capture recorded live. | Owner phone acceptance and confirmation that hourly history capture continues. |
| Emergency Billing | Integrated; Phases 1–5: offline billing, sync, holds, history, partial refunds by item and quantity, corrections, receipt settings and printing (shop's own slip layout, 58/80 mm), Search receipt, reports and CSV/Excel/PDF exports with pending/failed warnings. | 0601/0602, 0610–0612, 0620–0622, 0630–0632, 0633, 0634, 0640, 0641 and 0642 recorded live (the last five applied 20–21 Nov 2026 with owner approval). | Phase 6 automated testing done (`docs/modules/ebill-phase6.md`). Remaining, owner: grant `ebill.*` rights (none granted live yet), fill in Settings > Receipt, real-device and real-printer acceptance. |
| Audit | Integrated; counting, compile/review, final snapshot, reports, expiry/racks and Barcode (scanner, hybrid counting, shared outbox). | 0401–0412 and Inventory 0308 are in the live registry; all are registered by repo number (`0412` was renamed from `20261122035159` on 22 Nov 2026). Individual Audit rounds compile themselves on submit (0412). | Real-phone PHONE 1/2/3/4 (`docs/modules/audit.phone-tests.md`), print/CSV checks and security review of callable RPCs. |
| Invoice Desk | Integrated and registered on main; three template-based invoice flows, product/history and 80mm print path. | 1000–1003 recorded live in its progress file. | Correct stale handover; run full checks and add E2E/RLS coverage; verify workbook layout/logo and real printer/browser acceptance. |
| Workspace (Notes) | Integrated and registered: home, search/folders, rich-text editor, autosave, sharing, history/restore and archive/delete. Notes accepted by owner after live testing (reported 21 Nov). Sheets: database live; browser reference model with a database parity test is merged (PR #66); the data layer `data/workbooks.js` is merged (PR #70); the read-only grid screen and New workbook are built on branch `module/workspace-sheets-grid` (23 Nov, not merged, not yet tried on a real phone). | 1100, 1101, 1102, 1110 and 1111 present in live registry (checked read-only 22 Nov). | Phase 5 Sheets editing (increment 5); later formula engine, offline queue, conflict merge and attachments. See `docs/modules/workspace.next-session.md`. |

## Not yet an application module

**Workspace Sheets** (workbooks, grid, formulas, CSV), Workspace offline editing and synchronisation, and attachments are designed (`docs/modules/workspace.design.md`) but not built.

**Unified Reports, assistant/AI and Android widgets** remain planned, not registered application modules.

## Operational and test status

| Area | Recorded evidence | Caveat |
|---|---|---|
| Unit tests | Repository records 1,891 unit tests across 121 files on the 21 Nov main snapshot. | Latest GitHub Actions CI run on commit `9669497` passed app, database and functions jobs; see `TESTING.md`. |
| Database suite | CI #401 database job passed on audited main commit `9669497`; 77 database test files are present. | Re-run on current main before release; do not add older module-specific counts. |
| Deno and workflow lint | CI #401 functions job and app workflow-lint steps passed on audited main. | Local run is optional; inspect the exact CI run after changes. |
| GitHub Actions | CI run #401 on commit `9669497` completed successfully: app, database and functions jobs all green. | Pages deployment run #226 on the same commit also succeeded. |
| GitHub Pages | Main is the deployment source. | Current real-device UI acceptance remains outstanding. |
| Backup | Daily encrypted Drive workflow and monitoring recorded live. | A real Drive-to-separate-Supabase restore drill remains outstanding; local 39/39 restore test is not a substitute. |
| Gmail | Send-only Gmail flow is implemented. | Actual send from deployed origin and Google Cloud origin authorization remain to be verified. |
| Migration registry | 108 migration files on `main` (including `0222` and `0901`) and 113 live registry rows (24 Nov 2026). Every file on `main` is registered under its repo version. Five live rows have no file on `main`: `0017`, `1200`, `1201`, `1202`, `1203` (their files are not on `main`; to be reconciled by the owner of those branches, do not re-apply). `0222_closing_day_feed` and `0901_candela_day_feed` were applied by hand on 24 Nov 2026. Earlier state (22 Nov 2026): 91 files and 92 rows. | No timestamp rows remain: all rows carry repo versions (the 12 the 21 Nov audit listed were already by number when checked; `0412` was renamed). The one extra live row is `0015_core_trigger_search_path`, whose file exists only on the unmerged branch `ops-redesign-stage1`. Backup of the registry before the rename: `supabase_migrations.schema_migrations_backup_20261122`. |
| Security | RLS, permission-checked RPCs, MFA gate, append-only logs and secret/vendor checks are implemented. | Separate production project, Playwright, Sentry, accessibility/low-end-device checks and remaining advisor findings remain. |

## Branch integration status (21 November 2026)

The branch list currently contains `main` plus two maintenance refs: `audit/actual-module-status-2026-11-21` (this documentation review) and `patch/workspace-1102-live-status` (PR #55 already merged; stale ref). No unmerged feature work is identified. Workspace Sheets migration `1102` is on `main` and applied live; Sheets screens are not built.

## Immediate priorities

1. Registry reconciled (22 Nov 2026). Remaining: put `0015_core_trigger_search_path.sql` on `main`, and drop the remaining registry backup tables (`..._20261121`, `..._20261122`) after review; the 12 Nov one was dropped on 22 Nov 2026. Keep applying migrations by hand under the repo number.
2. Run and inspect a fresh full GitHub Actions run on current `main`.
3. Complete real-device/owner acceptance across existing modules, plus Gmail send verification.
4. Emergency Billing: grant `ebill.*` rights and run the real-device/printer checklist; Workspace Notes accepted by the owner (21 Nov 2026); continue Workspace Phase 5 (Sheets editing; the model, data layer and read-only grid are built).
5. Perform the real encrypted Drive restore drill and plan a separate production Supabase project.
6. Expand into Reports, assistant and Android only after the above acceptance gates.

## Source of truth

- [Master Module Progress Register](MODULE_PROGRESS_REGISTER.md) — consolidated module, branch and remaining-work index.
- [Roadmap](ROADMAP.md) — ordered remaining work.
- [Testing](TESTING.md) — test scope, evidence and limits.
- [Module contract](MODULES.md) — build/security rules.
- [Runbook](RUNBOOK.md) — deployment, migrations, backup and restore.
- `docs/modules/*.progress.md` — detailed module evidence and handoffs.

Never infer that a feature is live because a screen, source file or migration exists. Use module evidence and fresh checks where needed.

# Project status — canonical snapshot

**Snapshot date:** 22 November 2026

> **Fresh verification supersedes conflicting values below:** `main` is at `18283f17600be54d562a5eb3c40bf89906416b29`; CI #444 and Pages #244 succeeded on this commit. Live `DuaPharmaPlus` is ACTIVE_HEALTHY on PostgreSQL 17.11, with 124/124 public tables under RLS, 341 public routines (283 SECURITY DEFINER; zero missing configured search paths), and 93 migration registry rows. The current repository has 92 migration SQL files; `0015_core_trigger_search_path` exists live but is absent from `main`. Six Edge Functions are active: four current functions and two retired 410 endpoints (`claim-account`, `request-access`). Workspace Sheets' reference/domain model is now merged on main; the data layer and UI remain unbuilt. See [22 Nov audit](PROJECT_AUDIT_2026-11-22.md). Do not rely on the older 21 Nov figures or statements where they conflict.  
**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Code baseline inspected:** [`9669497`](https://github.com/sysalmanyasin/Dua/commit/96694979e65242f5ee24eb86f215630686b552c8)  
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
| Candela Sales | Integrated; four owner screens and staff-safe daily total pill. | 0900 and initial history capture recorded live. | Owner phone acceptance and confirmation that hourly history capture continues. |
| Emergency Billing | Integrated; Phases 1–5: offline billing, sync, holds, history, partial refunds by item and quantity, corrections, receipt settings and printing (shop's own slip layout, 58/80 mm), Search receipt, reports and CSV/Excel/PDF exports with pending/failed warnings. | 0601/0602, 0610–0612, 0620–0622, 0630–0632, 0633, 0634, 0640, 0641 and 0642 recorded live (the last five applied 20–21 Nov 2026 with owner approval). | Phase 6 automated testing done (`docs/modules/ebill-phase6.md`). Remaining, owner: grant `ebill.*` rights (none granted live yet), fill in Settings > Receipt, real-device and real-printer acceptance. |
| Audit | Integrated; counting, compile/review, final snapshot, reports, expiry/racks and Barcode (scanner, hybrid counting, shared outbox). | 0401–0412 and Inventory 0308 are in the live registry; all are registered by repo number (`0412` was renamed from `20261122035159` on 22 Nov 2026). Individual Audit rounds compile themselves on submit (0412). | Real-phone PHONE 1/2/3/4 (`docs/modules/audit.phone-tests.md`), print/CSV checks and security review of callable RPCs. |
| Invoice Desk | Integrated and registered on main; three template-based invoice flows, product/history and 80mm print path. | 1000–1003 recorded live in its progress file. | Correct stale handover; run full checks and add E2E/RLS coverage; verify workbook layout/logo and real printer/browser acceptance. |
| Workspace (Notes) | Integrated and registered: home, search/folders, rich-text editor, autosave, sharing, history/restore and archive/delete. Notes accepted by owner after live testing (reported 21 Nov). Sheets: database live; reference/domain model and parity tests merged to main by PR #66 (22 Nov); no data layer or screens yet. | 1100, 1101, 1102 and 1110 present in live registry; 1102 was applied 21 Nov. | Phase 5 Sheets domain/data/grid; later formula engine, offline queue, conflict merge and attachments. See `docs/modules/workspace.next-session.md`. |

## Not yet an application module

**Workspace Sheets UI/data layer** (workbooks, grid, formulas, CSV), Workspace offline editing and synchronisation, and attachments are designed but not built. The reference model and DB parity fixtures are on main.

**Unified Reports, assistant/AI and Android widgets** remain planned, not registered application modules.

## Operational and test status

| Area | Recorded evidence | Caveat |
|---|---|---|
| Unit tests | Repository records 1,891 unit tests across 121 files on the 21 Nov main snapshot. | Latest GitHub Actions CI run #444 on commit `18283f1` passed app, database and functions jobs; see `TESTING.md`. |
| Database suite | CI #401 database job passed on audited main commit `9669497`; 77 database test files are present. | Re-run on current main before release; do not add older module-specific counts. |
| Deno and workflow lint | CI #401 functions job and app workflow-lint steps passed on audited main. | Local run is optional; inspect the exact CI run after changes. |
| GitHub Actions | CI run #401 on commit `9669497` completed successfully: app, database and functions jobs all green. | Pages deployment run #226 on the same commit also succeeded. |
| GitHub Pages | Main is the deployment source. | Current real-device UI acceptance remains outstanding. |
| Backup | Daily encrypted Drive workflow and monitoring recorded live. | A real Drive-to-separate-Supabase restore drill remains outstanding; local 39/39 restore test is not a substitute. |
| Gmail | Send-only Gmail flow is implemented. | Actual send from deployed origin and Google Cloud origin authorization remain to be verified. |
| Migration registry | 92 migration files on `main` and 93 live registry rows (22 Nov 2026). | All live rows use repository-style numeric versions. Live-only `0015_core_trigger_search_path` has no matching file on `main`; recover the exact source before further migrations. Do not reapply or fake a registry row. |
| Security | RLS, permission-checked RPCs, MFA gate, append-only logs and secret/vendor checks are implemented. | Separate production project, Playwright, Sentry, accessibility/low-end-device checks and remaining advisor findings remain. |

## Branch integration status (22 November 2026)

PR #66 merged the Workspace Sheets reference/domain model and parity fixtures into `main` on 22 Nov. The Sheets data layer and UI are still unbuilt. The 22 Nov audit branch is a documentation-only follow-up.

## Immediate priorities

1. Registry reconciled (22 Nov 2026). Remaining: put `0015_core_trigger_search_path.sql` on `main`, and drop the remaining registry backup tables (`..._20261121`, `..._20261122`) after review; the 12 Nov one was dropped on 22 Nov 2026. Keep applying migrations by hand under the repo number.
2. Run and inspect a fresh full GitHub Actions run on current `main`.
3. Complete real-device/owner acceptance across existing modules, plus Gmail send verification.
4. Emergency Billing: grant `ebill.*` rights and run the real-device/printer checklist; Workspace Notes accepted by the owner (21 Nov 2026); continue Workspace Phase 5 (Sheets data layer and grid; the reference model is done).
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

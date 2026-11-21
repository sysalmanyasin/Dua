# Project status — canonical snapshot

**Snapshot date:** 21 November 2026  
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
| Closing | Integrated; 14-section ledger, shared drafts/live sync, ledgers/feed, Closing Book/PDF, history, review/reopen and settings. | Live registry contains 0201–0214 by repo number; 0215–0217 and the refresh migration are recorded under timestamp versions (see audit). | Owner try-out #5, acceptance and decision on audit gate; preserve migration registry parity. |
| Inventory | Integrated; feed, six screens, Home stock row and Excel/PDF/CSV exports. | 0301–0308 plus 0309 company summary live; Edge Function v24 active. | Real-phone PDF check; remove legacy sync fallback after stable operation and verify failed-sync monitoring. |
| STR | Integrated; list, detail, report, zero-dispatch, archive and overdue notifications. | 0500–0504 and scheduled jobs live (fresh migration registry check). | Phone try-outs #1/#2, owner acceptance, supplier/pack metadata and Foundation presentation follow-ups. |
| Candela Sales | Integrated; four owner screens and staff-safe daily total pill. | 0900 and initial history capture recorded live. | Owner phone acceptance and confirmation that hourly history capture continues. |
| Emergency Billing | Integrated; Phases 1–5: offline billing, sync, holds, history, partial refunds by item and quantity, corrections, receipt settings and printing (shop's own slip layout, 58/80 mm), Search receipt, reports and CSV/Excel/PDF exports with pending/failed warnings. | 0601/0602, 0610–0612, 0620–0622, 0630–0632, 0633, 0634, 0640, 0641 and 0642 recorded live (the last five applied 20–21 Nov 2026 with owner approval). | Phase 6 automated testing done (`docs/modules/ebill-phase6.md`). Remaining, owner: grant `ebill.*` rights (none granted live yet), fill in Settings > Receipt, real-device and real-printer acceptance. |
| Audit | Integrated; counting, compile/review, final snapshot, reports, expiry/racks and Barcode (scanner, hybrid counting, shared outbox). | 0401–0411 and Inventory 0308 are in the live registry; later Audit migrations 0409–0411 are timestamp-registered. | Real-phone PHONE 1/2/3 (`docs/modules/audit.phone-tests.md`), print/CSV checks and security review of callable RPCs. |
| Invoice Desk | Integrated and registered on main; three template-based invoice flows, product/history and 80mm print path. | 1000–1003 recorded live in its progress file. | Correct stale handover; run full checks and add E2E/RLS coverage; verify workbook layout/logo and real printer/browser acceptance. |
| Workspace (Notes) | Integrated and registered: home, search/folders, rich-text editor, autosave, sharing, history/restore and archive/delete. Notes accepted by owner after live testing (reported 21 Nov). Sheets UI is not built. | 1100, 1101, 1102 and 1110 present in live registry; 1102 was applied 21 Nov. | Phase 5 Sheets domain/data/grid; later formula engine, offline queue, conflict merge and attachments. See `docs/modules/workspace.next-session.md`. |

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
| Migration registry | 89 migration files and 89 live registry rows. | 12 migrations are present in the repository under four-digit versions but registered live under timestamp versions; 0214 exists both in repo and live. Reconcile before relying on automatic migration ordering. |
| Security | RLS, permission-checked RPCs, MFA gate, append-only logs and secret/vendor checks are implemented. | Separate production project, Playwright, Sentry, accessibility/low-end-device checks and remaining advisor findings remain. |

## Branch integration status (21 November 2026)

The branch list currently contains `main` plus two maintenance refs: `audit/actual-module-status-2026-11-21` (this documentation review) and `patch/workspace-1102-live-status` (PR #55 already merged; stale ref). No unmerged feature work is identified. Workspace Sheets migration `1102` is on `main` and applied live; Sheets screens are not built.

## Immediate priorities

1. Reconcile the 12 timestamp-versioned live migration rows with their four-digit repository files; 0214 is present on both sides. Keep the registry safe for future ordered migration applies.
2. Run and inspect a fresh full GitHub Actions run on current `main`.
3. Complete real-device/owner acceptance across existing modules, plus Gmail send verification.
4. Emergency Billing: grant `ebill.*` rights and run the real-device/printer checklist; Workspace Notes accepted by the owner (21 Nov 2026); build Workspace Phase 5 (Sheets UI).
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

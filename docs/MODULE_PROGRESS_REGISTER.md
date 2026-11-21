# Dua — Master module progress register

**Snapshot:** 21 November 2026  
**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Main baseline:** [`96694979`](https://github.com/sysalmanyasin/Dua/commit/96694979e65242f5ee24eb86f215630686b552c8)  
**Live app:** https://sysalmanyasin.github.io/Dua/  
**Live Supabase project:** DuaPharmaPlus (`sdsynzsflubdxnelgthh`)

This register describes what is present in the source tree, what the live database registry and deployment tools confirm, and what remains. A route, migration file, test or owner report is not by itself proof of production acceptance.

## Status vocabulary

- **Integrated:** source is on `main` and registered in `js/modules/index.js`.
- **Live:** the live migration registry or deployed function inventory confirms the database/deployment artifact exists.
- **CI green:** GitHub Actions passed on the exact named commit.
- **Owner/device acceptance pending:** automated checks do not replace the owner's real-device workflow acceptance.
- **Partial:** part of the approved scope remains unbuilt.

## Registered modules — 13 in source order

| Module | Actual source state on main | Live/deployment evidence | Work left |
|---|---|---|---|
| **Home** | Home 2.0 is integrated; permission-filtered business and stock snapshots, daily progress, attention links and per-device favourites. | No new migration. CI #401 and Pages #226 green on audited main. | Owner acceptance on actual pharmacy phones; check layout and shortcuts with different permission sets. |
| **Sales** | Integrated: dashboard, monthly history, daily entry/correction, reports, daily data, checklist, diff, deposit and last-day routes. | Core/Sales migrations and imported history are present in the live baseline. | Owner phone acceptance; verify Gmail OAuth origin and one real send from deployed site. Review any remaining old-dashboard extras as separate scope decisions. |
| **Manager** | Integrated: overview, staff registry, credit, salary, generic, incentive, petty cash, expenses, JazzCash, inbox, reports and misc ledgers. Attendance is intentionally excluded. | Migrations 0101–0108 are live; Closing migration 0214 is also present in repo and live registry. | Owner try-outs #2–#4; exercise Credit Inbox with real Closing credit data. |
| **Access** | Integrated foundation module: authentication, MFA gate, users, roles, permissions and owner-created staff logins. | Live registry includes staff PIN migration 0014 under timestamp version 20261121032408; six Edge Functions are active. | Review staff-login operational edge cases, complete security hardening and plan production/staging separation. |
| **Tools** | Integrated operations page for alerts, backup state and feed health. | Backup and notification workflows are recorded live; active `notify-ntfy` function. | Restore a real encrypted Drive backup into a separate empty Supabase project; keep monitoring scheduled backup health. |
| **Closing** | Integrated 14-section closing flow, autosave/shared drafts, submit/reopen, credit/misc ledgers, Manager feed, Book/PDF, histories, review and settings. | 0201–0214 appear under repo versions. `closing_refresh_existing_drafts` and 0216/0217 are live under timestamp versions. | Owner phone try-out #5, formal acceptance, and owner decision on re-enabling the Inventory Audit requirement. |
| **Inventory** | Integrated six screens, Home stock summary, feed and Excel/PDF/CSV exports. | Live registry includes 0301–0309; `sync-inventory-from-dropbox` is active at Edge Function v24. | Real-phone PDF check; monitor failed syncs and runtime; identify Candela Dropbox publish timing; remove legacy RPC fallback only after stable operation. |
| **STR** | Integrated list/detail/report/zero-dispatch screens, archive and overdue jobs, per-person preferences. | Migrations 0500–0504 and scheduled archive/overdue jobs are live. | Owner phone try-outs #1/#2; supplier/pack metadata integration; small wording/icon follow-ups; formal acceptance. |
| **Candela Sales** | Integrated owner overview, daily history, credit-by-customer and reports; staff-safe daily-total pill. | Migration 0900 and initial history capture are live. | Owner phone acceptance; confirm hourly history continues to append and source feed remains reliable. |
| **Emergency Billing** | Integrated POS, PIN-checked save, device/discount controls, offline queue/sync, holds, history, partial refunds, corrections, receipt settings/printing, reports and exports. Phase 6 automated testing is documented complete. | 0601/0602, 0610–0612, 0620–0622, 0630–0634 and 0640–0642 are live. | Owner must grant intended `ebill.*` permissions, complete receipt settings, and test Android/Windows plus physical 58/80 mm printers. |
| **Audit** | Integrated Audit 2.0 hub, counting/outbox, Individual Audit, compile/review/corrections/conflicts, Final Snapshot, reports, expiry/racks and Barcode. | 0401–0411 and Inventory 0308 are live; 0409–0411 use timestamp registry versions. | PHONE 1/2/3 tests, scanner/offline acceptance, print/CSV checks, and RPC permission/security review. |
| **Invoice Desk** | Integrated three business-specific invoice templates, create/history/product screens and 80 mm browser print path. | 1000–1003 live under timestamp registry versions 20261117135131–20261117140223. | E2E save/product/history/RLS tests; compare output to source workbooks, verify embedded logo; Android/Windows and physical printer acceptance. |
| **Workspace** | Integrated Notes home/search/folders, rich-text editor, autosave, sharing, history/restore and archive/delete. | 1100, 1101, 1102 and 1110 in live registry; 1102 applied 21 Nov. Notes accepted by owner after live testing (reported in chat). | Build Sheets Phase 5 UI (domain model, data layer, grid, New workbook); then formulas, formatting/filter/CSV, offline queue, sync/conflict merge and attachments. |

## Workstreams not yet delivered as user-facing modules

| Workstream | Actual state | Next |
|---|---|---|
| Workspace Sheets | Database migration 1102 is live; there is no Sheets UI/domain model/data layer/grid or New workbook action. | Complete Phase 5 increment 2 onwards. |
| Unified Reports | Planned, not registered. | Define permission-safe source contracts after modules are accepted. |
| Assistant / AI | Planned, not registered. | Build only over deterministic, permission-safe interfaces. |
| Android shell/widgets | Later phase. | Plan after web workflows and device acceptance. |
| Attendance/geofencing | Deliberately deferred; not in current Manager scope. | Separate owner-approved project decision. |

## Repository and CI facts

- Audited main commit: `96694979e65242f5ee24eb86f215630686b552c8`.
- Repository tree: 707 files; 13 module folders with manifests.
- Front-end tests: 121 test files; repository snapshot records 1,891 passing tests.
- Database tests: 77 test files.
- Migrations: 89 SQL migration files.
- GitHub Actions CI run #401 on this commit: **success** for app, database and functions jobs.
- GitHub Pages deployment run #226 on the same commit: **success**.
- The exact run evidence and limits are in [TESTING.md](TESTING.md).

## Live Supabase facts checked 21 November 2026

- Project status: `ACTIVE_HEALTHY`; PostgreSQL 17.11.
- 124 public base tables; all 124 have RLS enabled.
- 337 public routines; 279 SECURITY DEFINER routines; zero SECURITY DEFINER routines missing a configured `search_path`.
- Six Edge Functions active: `staff-login` v33, `claim-account` v33, `admin-users` v33, `notify-ntfy` v12, `sync-inventory-from-dropbox` v24, `request-access` v33.
- 89 migration registry rows, same count as 89 repo migration files, but 12 repo migrations are registered under timestamp versions. The exact list is in [PROJECT_AUDIT_2026-11-21.md](PROJECT_AUDIT_2026-11-21.md).
- The live Supabase advisor flags security and performance items. A warning is not automatically a vulnerability; review each item against actual grants and function bodies before changing it.

## Migration registry drift — P0 before further database batches

Twelve files use a four-digit repository version but their live registry rows use timestamp versions: `0014`, `0215`, `0216`, `0217`, `0309`, `0409`, `0410`, `0411`, and `1000`–`1003`. The corresponding timestamp rows have the same migration names. **0214_closing_staff_see_all exists both in the repository and live registry**; the previous claim that its file was missing was wrong.

Do not blindly insert four-digit duplicates, rename applied versions, or run new migration batches through an unverified automatic pipeline. Create and review a safe reconciliation plan first.

## Branch refs at audit time

The GitHub branch list contained `main`, `audit/actual-module-status-2026-11-21` (this documentation review) and `patch/workspace-1102-live-status` (PR #55 already merged; stale ref). No unmerged feature work was identified. Do not describe the branch list as “main only” while those refs remain.

## Priority work left

1. **P0 — Migration safety:** reconcile the 12 timestamp-versioned migrations and verify the future migration apply process.
2. **P0 — Security:** review 219 authenticated-callable SECURITY DEFINER RPCs for explicit permission checks and least-privilege grants; pin search paths on the two flagged trigger functions; consider enabling leaked-password protection with the PIN login design in mind.
3. **P0 — Backup recovery:** perform a real encrypted Drive backup restore into a separate empty Supabase project.
4. **P1 — Operational performance:** review 124 unindexed foreign keys, five RLS initplan warnings, one duplicate permissive policy and 28 unused indexes using workload evidence.
5. **P1 — Owner acceptance:** complete phone/printer/Gmail acceptance across Sales, Home, Manager, Closing, Inventory, STR, Candela, Audit, Emergency Billing and Invoice Desk.
6. **P1 — Workspace Sheets:** build the user-facing Phase 5 grid on the already-live database.
7. **P2 — Architecture/operations:** separate production and staging projects; add Playwright E2E, Sentry, accessibility and low-end Android checks.
8. **P3 — Future modules:** Unified Reports, assistant/AI, Android widgets and Attendance only after current workflows are accepted.

## Source of truth

- [PROJECT_STATUS.md](PROJECT_STATUS.md): concise operating snapshot.
- [ROADMAP.md](ROADMAP.md): ordered remaining work.
- [TESTING.md](TESTING.md): automated test evidence and boundaries.
- [MODULES.md](MODULES.md): architecture and security contract.
- [RUNBOOK.md](RUNBOOK.md): operations, deployment and migrations.
- `docs/modules/*.progress.md`: detailed module history and handovers.

Historical dated notes remain useful as history, but current status statements at the top of module progress files supersede older session snapshots.
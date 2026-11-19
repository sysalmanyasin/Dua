# Dua — Master module progress register

**Snapshot:** 19 November 2026  
**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Default branch:** `main`  
**Code baseline inspected:** [`a1737f1`] (documentation commits in this update follow that baseline)(https://github.com/sysalmanyasin/Dua/commit/a1737f14931e032809fc94e138673bf28ddbf8ef)  
**Live app:** https://sysalmanyasin.github.io/Dua/

This is the consolidated index of what is actually present in `main`, what the module progress records say is deployed, and what remains. It does not claim that a feature is production-accepted merely because code or a migration exists.

## How to read status

- **Integrated**: application source is present on `main` and registered in `js/modules/index.js`.
- **Backend / not registered**: database or domain code exists, but the module is not exposed through the application module registry.
- **Live (recorded)**: the module progress record documents that the migration/function was applied and checked in DuaPharmaPlus. This is documentary evidence, not a fresh connection to Supabase during this audit.
- **Built; acceptance pending**: implementation and recorded tests exist, but owner/device acceptance remains.
- **In progress**: part of the approved scope is not implemented or not integrated.
- **Planned**: not yet implemented as an application module.

## Registered application modules on main

The source registry currently contains these 12 IDs, in order: `home`, `sales`, `manager`, `access`, `tools`, `closing`, `inventory`, `str`, `candela-sales`, `ebill`, `audit`, `invoice-desk`.

| Module | Main/source state | Live/deployment evidence in module docs | Remaining work / acceptance |
|---|---|---|---|
| **Home** | Integrated; Home 2.0 replaces the previous Home page in place. | No new migration; reads existing permission-filtered summaries. | Verify current UI on the actual pharmacy phones. Home progress says final browser/device acceptance and CI evidence should be reconfirmed. |
| **Sales** | Integrated; entry, daily data/checklist, reports, targets, fields, dashboard/Cover and Gmail-send flow exist. | Sales schema and imported history are recorded live. | Real-device owner acceptance; verify Google Cloud authorized origin and an actual Gmail send from the deployed origin. Payments/checklist auto-fill and other old-dashboard extras remain dependency/decision items. |
| **Manager** | Integrated; Staff Registry, Staff Credit, Salary, Generic, Incentive, Petty Detail, Expenses, Jazz Cash, Misc Sections, Balance Tally, dashboard, Credit Inbox and reports are described in the progress record. | Migrations `0101`–`0108` are recorded applied and registered in DuaPharmaPlus. | Owner phone try-outs #2–#4; test Credit Inbox with real Closing feed data. Attendance is deliberately later. |
| **Access** | Integrated foundation module: authentication, user/access administration, roles and per-person permissions. | Foundation is recorded live and owner-accepted. | Operational hardening, production/staging separation and remaining security-advisor housekeeping. |
| **Tools** | Integrated foundation/operations module, including notifications and backup status. | Daily encrypted backup workflow and monitoring are recorded live. | Complete a restore drill from an actual encrypted Drive backup into a separate empty Supabase project; continue monitoring. |
| **Closing** | Integrated; guided 14-section ledger, submit, credit/misc ledgers, Manager feed, Closing Book/PDF, CC/RBD/MEDIQ history, review/reopen and settings are recorded built on main. | Progress records migrations `0201`–`0211` and their live application. A separate live migration `0214_closing_staff_see_all` was reported by Manager progress but is absent from the repository; reconcile before any further Closing migration. | Owner try-out #5 and formal acceptance; decide whether to re-enable the inventory-audit requirement. Verify the live migration registry/source parity. |
| **Inventory** | Integrated; feed and six screens: Overview, Stock Ledger, Reorder, Excess Working, Health and Sync; Home stock summary and Excel/PDF/CSV exports. | Feed migrations `0301`–`0307`, Inventory interface `0308`, and Edge Function v23 are recorded live. | Real-phone PDF print-dialog check; after clean operation, remove the legacy-call fallback and confirm failed-sync counts/alerts. |
| **STR** | Integrated and registered; list, detail, report and zero-dispatch screens, read-only feed integration and per-person preferences. | Migrations `0500`–`0504` and archive/overdue jobs are recorded live. | Owner phone try-outs #1/#2 and acceptance; confirm supplier/pack metadata integration and Foundation wording/icon follow-ups. |
| **Candela Sales** | Integrated; owner Overview, Daily History, Credit by Customer and Reports, plus staff-safe “Candela today” pill. | Migration `0900` and initial history capture are recorded live. | Owner phone try-out; confirm subsequent hourly syncs continue appending history. Older history import is optional and source-dependent. |
| **Emergency Billing** | Integrated; Phases 1–4: POS, PIN-checked save, devices/limits, offline queue/sync, held bills, history, whole-invoice refunds and corrections. | `0601`, `0602`, `0610`–`0612`, `0620`–`0622`, `0630`–`0632` are recorded live. | Phase 5 remains incomplete: migrations `0633`, `0634`, `0640`, `0641` are in the repo but documented as not live; partial-refund, receipt/settings/search and reports/export UI are not built. Then Phase 6 device/end-to-end hardening. |
| **Audit** | Integrated; A1–A5, B1, B2 and C1 Expiry tracking are built. Includes counting/outbox, Individual Audit, compile/review/corrections/conflicts, Final Snapshot, reports/CSV/print/PDF, audit trail, alerts, expiry register/racks. | Audit migrations `0401`–`0410` and Inventory `0308` are recorded live. | Real-phone PHONE 1/PHONE 2 tests and print/CSV acceptance; C2 Barcode is paused pending owner go, vendored scanner libraries and Foundation OD-6; then D hardening. |
| **Invoice Desk** | Integrated and registered on `main`; three business templates, create/history/product screens and 80mm browser print path are present. The old progress note incorrectly says it was not merged. | Migrations `1000`–`1003` are recorded live in the module progress note. | Re-run full main verification and DB suite with this code; add end-to-end authorization/save/history tests; compare prints with source workbooks; include Safari Book Land logo; Android/Windows and physical printer acceptance. |

## Work in the repository but not yet an application module

| Workstream | Current state | Next work |
|---|---|---|
| **Dua Workspace (Notes & Sheets)** | Database core `1100`, Notes backend `1101`, domain/data layers and tests are present. Progress records both migrations applied live. It is **not** in `js/modules/index.js`; no user-facing Workspace screens/manifest are integrated. | Phase 1 browser/security prototypes; Phase 4 editor, sharing/history UI and first route; register the module only when the approved UI slice is ready. Sheets and later conflict UI remain future phases. |
| **Unified Reports** | Planned, not a registered module. | Define data contracts and scope after source modules are stable. |
| **Assistant / AI** | Planned, not a registered module. | Only after deterministic permission-safe data interfaces exist. |
| **Android widgets / Android shell** | Later phase, not part of current web-app module registry. | Plan separately after web app acceptance. |

## Branch audit (19 November 2026)

GitHub reported 10 branches including `main` when compared with the pre-documentation code baseline `a1737f1` on 19 Nov 2026. Each non-main branch was **0 commits ahead of main**; each was behind main. The behind counts in the table are measured against that baseline and will increase as documentation commits land; the important invariant is that ahead=0. These are stale pointers, not unmerged work. Do not merge them again.

| Branch | Ahead | Behind | Assessment |
|---|---:|---:|---|
| `feature/backup-emergency-pos` | 0 | 16 | Stale; Phase 1–4 code is already on main; Phase 5 work must continue from current main. |
| `fix/closing-a11y-and-bug-audit` | 0 | 20 | Stale pointer; no unique commits. |
| `fix/closing-carry-preview-live-deltas` | 0 | 30 | Stale pointer; no unique commits. |
| `fix/closing-refresh-on-draft-open` | 0 | 24 | Stale pointer; no unique commits. |
| `fix/closing-reopen-cash-and-deltas` | 0 | 22 | Stale pointer; no unique commits. |
| `fix/closing-signed-rows` | 0 | 13 | Stale pointer; no unique commits. |
| `module/audit-a5` | 0 | 75 | Stale pointer; Audit A5/B1 work is on main. |
| `module/audit-b2` | 0 | 15 | Stale pointer; Audit B2/C1 work is on main. |
| `module/workspace` | 0 | 36 | Stale pointer; Workspace 1100/1101 and domain/data work are on main. |

**Action:** retain or delete stale branch refs only after the owner decides; this documentation update does not delete branches. New work must branch from current `main`.

## Verification evidence and limits

- The 19 Nov Audit progress/handover update records local `npm run verify` checks passing, **1,562/1,562 unit tests**, and the full database suite passing.
- Deno Edge Function checks and workflow lint were not run locally in that session.
- The GitHub commit-status endpoint returned no status entries for inspected HEAD `a1737f1`; therefore this register does **not** claim that a fresh GitHub Actions run is green.
- Live Supabase state, Gmail delivery, scheduled backup success and physical-device behaviour are based on dated module/runbook records, not a fresh production connection or device test in this documentation pass.
- Test counts in old module progress files are historical snapshots and must never be added together.

## Immediate priority order

1. Reconcile this register with the live Supabase migration registry, especially Closing `0214`, and preserve exact repo-numbered migration history.
2. Run/inspect a fresh full GitHub Actions run on current `main`.
3. Complete owner phone acceptance for Sales, Manager, Closing, Inventory, STR, Candela Sales, Audit and Invoice Desk.
4. Complete Emergency Billing Phase 5 and Workspace's first user-facing Notes slice.
5. Perform the real encrypted Drive restore drill and separate production-project plan.
6. Only then expand into Reports, assistant and Android work.

## Source-of-truth rules

- This register is the cross-module index; module-specific progress files remain the detailed evidence and handover.
- `docs/PROJECT_STATUS.md` is the concise operational snapshot.
- `docs/ROADMAP.md` is the ordered action list.
- `docs/TESTING.md` is the test evidence and verification boundary.
- `docs/MODULES.md` is the build/security contract, not a progress diary.
- `PROJECT_PROGRESS.md` and dated sections of `docs/CHANGELOG.md` are historical records; do not rewrite old events to make them look current.
- Never mark a module complete/live solely because a route, source file or migration exists. Require integrated code, reproducible tests, live verification where applicable and owner acceptance.

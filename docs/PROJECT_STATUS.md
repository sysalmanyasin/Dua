# Project status — canonical snapshot

**Snapshot date:** 19 November 2026  
**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Code baseline inspected:** [`a1737f1`] (documentation commits follow)(https://github.com/sysalmanyasin/Dua/commit/a1737f14931e032809fc94e138673bf28ddbf8ef)  
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
| Home | Integrated; Home 2.0 redesign in main. | Uses existing permission-aware summary RPCs; no new migration. | Real-device acceptance and fresh CI confirmation. |
| Sales | Integrated; entry, checklist, dashboard, reports, targets, fields and Gmail-send flow. | Sales migrations and imported history recorded live. | Owner phone acceptance and real Gmail send from deployed origin; dependent extras remain decision-based. |
| Manager | Integrated; Staff Registry, Staff Credit, Salary, Generic, Incentive, Petty Detail, Expenses, Jazz Cash, Misc, Balance Tally, Inbox and reports. | Migrations 0101–0108 recorded applied/registered live. | Phone try-outs #2–#4; verify Credit Inbox using real Closing feed. Attendance is later. |
| Closing | Integrated; 14-section ledger, submit, ledgers/feed, Closing Book/PDF, history, review/reopen and settings are recorded built. | Module progress records 0201–0211 as applied/live. Manager progress reports live migration 0214 absent from repository; reconcile before another Closing migration. | Owner try-out #5, acceptance, live registry/source parity, decision on audit gate. |
| Inventory | Integrated; feed, six screens, Home stock row and Excel/PDF/CSV exports. | 0301–0308 and Edge Function v23 recorded live. | Real-phone PDF check; remove legacy sync fallback after stable operation and verify failed-sync monitoring. |
| STR | Integrated; list, detail, report, zero-dispatch, archive and overdue notifications. | 0500–0504 and scheduled jobs recorded live. | Phone try-outs #1/#2, owner acceptance, supplier/pack metadata and Foundation presentation follow-ups. |
| Candela Sales | Integrated; four owner screens and staff-safe daily total pill. | 0900 and initial history capture recorded live. | Owner phone acceptance and confirmation that hourly history capture continues. |
| Emergency Billing | Integrated; Phases 1–4 including offline billing, sync, holds, history, whole-invoice refunds and corrections. | 0601/0602, 0610–0612, 0620–0622 and 0630–0632 recorded live. | Phase 5 incomplete: 0633/0634/0640/0641 are documented in repo but not live; partial refund, receipt/settings/search and exports UI not built. Then Phase 6 hardening. |
| Audit | Integrated; slices A1–A5, B1, B2, C1 expiry/racks and C2 Barcode (Center, scanner, hybrid counting, shared outbox). | 0401–0410 and Inventory 0308 recorded live; `0411_audit_barcode` written and DB-tested but NOT yet applied live (apply it before using barcodes; the app works without it). | Apply 0411 and confirm; real-phone PHONE 1/2/3 (`docs/modules/audit.phone-tests.md`) and print/CSV checks; then hardening. |
| Invoice Desk | Integrated and registered on main; three template-based invoice flows, product/history and 80mm print path. | 1000–1003 recorded live in its progress file. | Correct stale handover; run full checks and add E2E/RLS coverage; verify workbook layout/logo and real printer/browser acceptance. |
| Workspace (Notes) | Integrated and registered on main (19 Nov 2026, Phase 4): home with search and personal folders, rich-text editor with autosave, sharing (owner/editor/viewer), history and restore, archive/delete. **Sheets are not built.** | 1100–1101 recorded live and checked against the tested copy (18 Nov 2026). | Real-phone and two-account owner acceptance (jsdom only so far); Phase 5 Sheets; later offline and conflict-merge phases. See `docs/modules/workspace.next-session.md`. |

## Not yet an application module

**Workspace Sheets** (workbooks, grid, formulas, CSV), Workspace offline editing and synchronisation, and attachments are designed (`docs/modules/workspace.design.md`) but not built.

**Unified Reports, assistant/AI and Android widgets** remain planned, not registered application modules.

## Operational and test status

| Area | Recorded evidence | Caveat |
|---|---|---|
| Unit tests | 19 Nov Audit handover records 1,562/1,562 passing locally. | This is a dated local result, not a fresh run performed during this documentation update. |
| Database suite | Same handover records the full local database suite passing. | Re-run on current main before release; do not add older module-specific counts. |
| Deno and workflow lint | Present in CI workflow. | Not run locally in the cited 19 Nov session. |
| GitHub Actions | CI workflow defines app, database and Edge Function checks. | The commit-status endpoint returned no status entries for inspected HEAD; a fresh green Actions run is not independently confirmed here. |
| GitHub Pages | Main is the deployment source. | Current real-device UI acceptance remains outstanding. |
| Backup | Daily encrypted Drive workflow and monitoring recorded live. | A real Drive-to-separate-Supabase restore drill remains outstanding; local 39/39 restore test is not a substitute. |
| Gmail | Send-only Gmail flow is implemented. | Actual send from deployed origin and Google Cloud origin authorization remain to be verified. |
| Migration registry | Most module progress files record repo-numbered live migrations. | Closing 0214 live/repository drift is explicitly unresolved. Verify registry and source parity before future applies. |
| Security | RLS, permission-checked RPCs, MFA gate, append-only logs and secret/vendor checks are implemented. | Separate production project, Playwright, Sentry, accessibility/low-end-device checks and remaining advisor findings remain. |

## Branch integration status (19 November 2026)

GitHub reports 10 branches including `main`. All nine non-main branches are 0 commits ahead of `main` and behind it; none contains unique commits to merge. They are stale refs, not active development bases. See [the full comparison table](MODULE_PROGRESS_REGISTER.md#branch-audit-19-november-2026). This update does not delete branches; owner approval is required for cleanup.

## Immediate priorities

1. Reconcile Closing migration 0214 and the live Supabase registry with repository migrations before further database changes.
2. Run and inspect a fresh full GitHub Actions run on current `main`.
3. Complete real-device/owner acceptance across existing modules, plus Gmail send verification.
4. Complete Emergency Billing Phase 5; accept Workspace Notes on real phones, then start Workspace Phase 5 (Sheets).
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

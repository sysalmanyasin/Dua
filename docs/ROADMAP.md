# Roadmap — remaining work

**Status snapshot:** 19 November 2026. This file lists unfinished work only; it is not a list of all implemented features. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the concise snapshot and [MODULE_PROGRESS_REGISTER.md](MODULE_PROGRESS_REGISTER.md) for module-by-module evidence and branch status.

## P0 — Reconcile deployment and repository state

1. **Closing migration drift:** Manager progress reports live migration `0214_closing_staff_see_all`, but no matching migration file is present in the repository. Inspect the live registry and SQL definition, recover/document the exact source, add a forward-safe repository migration or reconciliation note as appropriate, and add a database test. Do not reapply or invent a migration.
2. **Fresh main CI:** run/inspect a full GitHub Actions workflow on current `main`, including app, database, Deno Edge Function checks and workflow lint. The latest recorded local result is 1,562/1,562 unit tests plus the database suite; Deno and workflow lint were not run locally.
3. **Real backup restore drill:** download an actual encrypted Drive backup and restore it into a separate empty Supabase project. The local 39/39 round-trip test and upload checksum do not prove the real restore path.
4. **Separate production project:** staging and live currently share DuaPharmaPlus according to the runbook. Plan a controlled project split, secrets/Vault/cron recreation and data/config validation before broader launch.
5. **Branch housekeeping:** nine non-main refs are 0 commits ahead of main and behind it. Owner may delete or archive them after checking they are no longer needed; do not merge stale refs.

## P1 — Owner acceptance and production confidence

1. **Sales / Gmail:** complete owner phone acceptance; add the deployed origin in Google Cloud and verify a real send from the owner's account.
2. **Manager:** complete phone try-outs #2–#4; test Credit Inbox against real Closing credit-feed data.
3. **Closing:** complete owner try-out #5, validate PDF/book and correction flows, decide whether the Inventory Audit requirement should be enabled, and formally accept.
4. **Inventory:** check PDF print dialog on actual pharmacy phones; monitor minute-0 sync and failed-sync count; remove old-call fallback only after clean operation is confirmed.
5. **STR:** phone try-outs #1/#2, supplier/pack metadata integration and owner acceptance.
6. **Candela Sales:** owner phone try-out and confirm hourly history continues to append.
7. **Audit:** PHONE 1 offline count/reconnect; PHONE 2 two-person/two-round end-to-end; print/PDF and CSV on phone and desktop.
8. **Invoice Desk:** rerun full repository and database verification; add save/product/history/RLS E2E tests; compare all three rendered invoices to source workbooks; include Safari Book Land logo; Android/Windows browser and physical 80mm printer tests.
9. **Home:** real-device acceptance of Home 2.0 and its permission-filtered shortcuts.

## P2 — Finish active module scope

### Emergency Billing
- Obtain owner approval before applying migrations `0633`, `0634`, `0640`, `0641` to DuaPharmaPlus; they are documented as present in the repository but not live.
- Build partial-refund-by-line/quantity UI and history status/amount presentation.
- Build receipt settings, 58/80mm receipt printing, copies/types, receipt search and history reprint.
- Build date-wise reports and CSV/Excel/PDF exports, including pending/failed offline invoice warnings.
- Complete Phase 6 end-to-end and real-device tests (restart persistence, interrupted sync, duplicates, deactivation, large catalogue, receipts, migration safety and RLS).

### Audit
- C2 Barcode is paused until the owner says go. It requires vendored scanner libraries and Foundation request OD-6 (shared outbox/sign-out guard).
- After C2, complete D hardening: offline end-to-end, accessibility, low-end-phone behaviour, data-use review and formal acceptance.
- Optional later improvements: expiry-register CSV/print and expiry-by-month summary.

### Workspace (Notes & Sheets)
- Complete Phase 1 prototypes: CSP compatibility with vendored ProseMirror, `wss:` connectivity, bundle-size measurement and grid performance on a phone.
- Phase 4: Notes editor, sharing, history/revisions UI and first route; add manifest/registry/CSS only when this slice passes its gate.
- Later phases: block-level conflict UI, Sheets grid/formula engine, import/export and remaining sharing/offline flows according to the approved brief.
- Workspace is not a registered or user-ready module today.

### Closing / Manager / STR
- Treat the core implementations as built; prioritize acceptance and documented integration gaps rather than rebuilding their existing screens.
- Reconcile Closing 0214 before adding more Closing migrations.
- STR supplier/pack metadata and presentation follow-ups should not block unrelated module acceptance.

## P3 — Quality and future modules

- Playwright browser end-to-end suite and Sentry production error monitoring.
- Accessibility audit, low-end Android performance and long-running/offline testing.
- Broader security review and remaining Supabase advisor findings.
- Quarterly restore drills after the first successful real Drive restore.
- Unified Reports after source-module data contracts are stable.
- Read-only assistant only after deterministic, permission-safe interfaces exist; business calculations remain in trusted code/database.
- Android widgets and Attendance/geofencing are later projects, not prerequisites for accepting the current web app.

## Decisions still requiring the owner

- Whether to delete/archive the nine stale branch refs.
- Whether/when to split staging and production Supabase projects.
- Whether the Closing Inventory Audit gate should be re-enabled.
- Whether to approve Emergency Billing migrations 0633/0634/0640/0641 live.
- Audit C2 Barcode start date and Foundation OD-6 ownership.
- Senior vs Junior permission differences.
- Whether to port Bar Race, briefing email and other Sales extras.
- Whether Attendance/geofencing returns in the Android phase.

Do not mark a roadmap item complete because a design, route or migration file exists. Require integrated code, reproducible tests, live verification where applicable and owner acceptance.

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
- **Done (21 Nov 2026):** Phase 5 (partial refunds by item and quantity, receipt settings and printing in the shop's own slip layout, Search receipt, reports and CSV/Excel/PDF exports with pending/failed warnings) and migrations `0633`, `0634`, `0640`, `0641`, `0642`, all applied live with the owner's approval. Phase 6 automated testing (money fuzz, preview-vs-database cross-check, large data, real print-engine layout, screenshots).
- **Owner actions:** grant the `ebill.*` rights (none are granted yet), fill in Settings > Receipt, and run the real-device and real-printer checklist in `docs/modules/ebill-phase6.md` section 3.
- Open decisions: whether counter "Return" bills are wanted (refunds are a manager action in History today); Settings "Device settings" panel (last sync, pending/failed counts).

### Audit
- C2 Barcode is paused until the owner says go. It requires vendored scanner libraries and Foundation request OD-6 (shared outbox/sign-out guard).
- After C2, complete D hardening: offline end-to-end, accessibility, low-end-phone behaviour, data-use review and formal acceptance.
- Optional later improvements: expiry-register CSV/print and expiry-by-month summary.

### Workspace (Notes & Sheets)
- **Done (Phases 2–4, merged 19 Nov 2026):** database core and Notes backend (`1100`, `1101`), Notes editor, sharing, history/restore, home with search and folders; registered at `/workspace`.
- **Now:** owner acceptance of Notes on real phones with two accounts (`workspace.use` + `workspace.create`, and `workspace.use` only). Run the Phase 1 browser prototypes (CSP `wss:`, grid performance on a phone).
- **Next (Phase 5):** workbooks and the spreadsheet grid (`1102`: sheets, cells with stable row/column ids, styles, operation log, snapshots).
- **Then:** formula engine (6), formatting/sort/filter/CSV (7), IndexedDB offline queue with sign-out hook (8), synchronisation and conflict merge screens (9), attachments (10), integration and acceptance (11). Details and acceptance gates: `docs/modules/workspace.design.md`.

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
- Emergency Billing: grant the `ebill.*` rights and complete the real-device and printer checklist (`docs/modules/ebill-phase6.md`).
- Audit C2 Barcode start date and Foundation OD-6 ownership.
- Senior vs Junior permission differences.
- Whether to port Bar Race, briefing email and other Sales extras.
- Whether Attendance/geofencing returns in the Android phase.

Do not mark a roadmap item complete because a design, route or migration file exists. Require integrated code, reproducible tests, live verification where applicable and owner acceptance.

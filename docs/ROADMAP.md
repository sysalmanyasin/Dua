# Roadmap — remaining work

**Status snapshot:** 22 November 2026. This file lists unfinished work only. Current verified state and evidence: [22 Nov code/live audit](PROJECT_AUDIT_2026-11-22.md). This file lists unfinished work only; it is not a list of all implemented features. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the concise snapshot and [MODULE_PROGRESS_REGISTER.md](MODULE_PROGRESS_REGISTER.md) for module-by-module evidence and branch status.

## P0 — Deployment, migration and security confidence

1. **Migration registry numbering:** **Reconciled on 22 Nov 2026; source parity still open:** the live registry has 93 four-digit rows; main has 92 migration files and none uses a timestamp version (the 12 timestamp rows listed in the 21 Nov audit were already numbered when checked; `0412` was renamed from `20261122035159`). `0015_core_trigger_search_path.sql` is applied and registered live and its file arrives in `main` with the Operations Redesign merge (never reapply it); `0219`, `0700` and `0701` were applied by hand on 22 Nov 2026. Do not edit applied migrations or insert duplicate rows. Migration `0214_closing_staff_see_all` is present in both repository and live registry; the old missing-file warning was incorrect.
2. **Security advisor review:** review the 220 authenticated-callable SECURITY DEFINER functions for explicit permission checks and least-privilege grants; migration 0015 has fixed the two trigger search-path findings live; its source must be reconciled into main. The advisor currently flags leaked-password protection as disabled; assess compatibility with staff PIN sign-in before enabling. Do not blanket-revoke RPCs without mapping required clients.
3. **Real backup restore drill:** restore an actual encrypted Drive backup into a separate empty Supabase project. The local 39/39 round-trip and upload checksum do not prove the real restore path.
4. **Separate production project:** plan a controlled production/staging split, secrets/Vault/cron recreation and data/config validation before broader launch.
5. **Performance hygiene:** prioritize 124 unindexed foreign keys and five RLS initplan warnings; review 23 unused indexes only after representative workload observation. The advisor also reports one duplicate permissive policy on `payment_methods`.
6. **CI baseline:** current audited `main` commit `18283f1` has green CI run #444 and Pages deployment #244. Continue checking the exact commit after every merge.

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
- Individual Audit rounds compile themselves on submit (migration 0412, live 22 Nov 2026); remaining: PHONE 4 on a real phone.
- C2 Barcode is implemented and integrated on `main`; migration 0411 is live and registered by repo number. Remaining work is real-device scanner/offline acceptance and hardening, not initial implementation.
- After C2, complete D hardening: offline end-to-end, accessibility, low-end-phone behaviour, data-use review and formal acceptance.
- Optional later improvements: expiry-register CSV/print and expiry-by-month summary.

### Workspace (Notes & Sheets)
- **Done (Phases 2–4, merged 19 Nov 2026):** database core and Notes backend (`1100`, `1101`), Notes editor, sharing, history/restore, home with search and folders; registered at `/workspace`.
- **Done 22 Nov 2026 (merged, PR #66):** Phase 5 increment 2, the JS reference model with a parity test against the database.
- **Done 22 Nov 2026 (merged 23 Nov as PR #70):** Phase 5 increment 3, the data layer `data/workbooks.js` (no screens).
- **Done 23 Nov 2026 (merged as PR #77):** Phase 5 increment 4, the read-only grid screen and New workbook.
- **Now:** Notes acceptance was reported by the owner on 21 Nov 2026. Cell editing (Phase 5 increment 5) is built; next is Sheets Phase 5 increment 6 (sheet management), then row and column structure operations and formats. Run real-browser CSP and phone grid-performance checks as the UI takes shape.
- **Next (Phase 5):** workbooks and the spreadsheet grid. `1102` (sheets, cells with stable row/column ids, styles, operation log, snapshots) is on `main` and applied live (21 Nov 2026); the Sheets UI is not built; next are the JS domain model with a parity fixture, then the grid.
- **Then:** formula engine (6), formatting/sort/filter/CSV (7), IndexedDB offline queue with sign-out hook (8), synchronisation and conflict merge screens (9), attachments (10), integration and acceptance (11). Details and acceptance gates: `docs/modules/workspace.design.md`.

### Closing / Manager / STR
- Treat the core implementations as built; prioritize acceptance and documented integration gaps rather than rebuilding their existing screens.
- Registry reconciled (22 Nov 2026). Get `0015_core_trigger_search_path.sql` onto `main`; the 12 Nov registry backup is dropped; the 21 and 22 Nov backups can go after review.
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

- Whether/when to split staging and production Supabase projects.
- Whether the Closing Inventory Audit gate should be re-enabled.
- Emergency Billing: grant the `ebill.*` rights and complete the real-device and printer checklist (`docs/modules/ebill-phase6.md`).
- Audit Barcode is built; confirm owner acceptance of scanner/offline workflows and complete Foundation OD-6 shared outbox/sign-out hardening.
- Senior vs Junior permission differences.
- Whether to port Bar Race, briefing email and other Sales extras.
- Whether Attendance/geofencing returns in the Android phase.

Do not mark a roadmap item complete because a design, route or migration file exists. Require integrated code, reproducible tests, live verification where applicable and owner acceptance.

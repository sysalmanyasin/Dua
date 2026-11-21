# Roadmap — remaining work

**Status snapshot:** 21 November 2026. This file lists unfinished work only; it is not a list of all implemented features. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the concise snapshot and [MODULE_PROGRESS_REGISTER.md](MODULE_PROGRESS_REGISTER.md) for module-by-module evidence and branch status.

## P0 — Deployment, migration and security confidence

1. **Migration registry parity:** 89 repository migration files and 89 live registry rows exist, but 12 migrations are registered under timestamp versions instead of their four-digit file versions: `0014`, `0215`, `0216`, `0217`, `0309`, `0409`, `0410`, `0411`, and `1000`–`1003`. The live registry has corresponding timestamp-name rows. Do not edit applied migrations or blindly insert duplicate rows; this was reconciled on 21 Nov 2026 (13 rows incl. `0218`; see `docs/ops/f7-registry-reconciliation.md`). Check before each batch with `node tools/check-registry.mjs registry.json`. The wider redesign plan is `docs/OPERATIONS_REDESIGN_PLAN.md`. Migration `0214_closing_staff_see_all` is present in both repository and live registry; the old missing-file warning was incorrect.
2. **Security advisor review:** review the 219 authenticated-callable SECURITY DEFINER functions for explicit permission checks and least-privilege grants; decide whether to pin `search_path` on the two flagged trigger functions; enable leaked-password protection if compatible with the staff-login model. Do not blanket-revoke RPCs without mapping required clients.
3. **Real backup restore drill:** restore an actual encrypted Drive backup into a separate empty Supabase project. The local 39/39 round-trip and upload checksum do not prove the real restore path.
4. **Separate production project:** plan a controlled production/staging split, secrets/Vault/cron recreation and data/config validation before broader launch.
5. **Performance hygiene:** prioritize 124 unindexed foreign keys and five RLS initplan warnings; review 28 unused indexes only after representative workload observation. The advisor also reports one duplicate permissive policy on `payment_methods`.
6. **CI baseline:** current `main` commit `9669497` has a green CI run (#401: app, database and functions) and Pages deployment (#226). Continue checking the exact commit after every merge.

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
- C2 Barcode is implemented and integrated on `main`; migrations 0411 are present in the live registry under a timestamp version. Remaining work is real-device scanner/offline acceptance and hardening, not initial implementation.
- After C2, complete D hardening: offline end-to-end, accessibility, low-end-phone behaviour, data-use review and formal acceptance.
- Optional later improvements: expiry-register CSV/print and expiry-by-month summary.

### Workspace (Notes & Sheets)
- **Done (Phases 2–4, merged 19 Nov 2026):** database core and Notes backend (`1100`, `1101`), Notes editor, sharing, history/restore, home with search and folders; registered at `/workspace`.
- **Now:** Notes acceptance was reported by the owner on 21 Nov 2026. Build Sheets Phase 5 increment 2: JS domain model with parity fixtures, data layer, grid and New workbook. Run real-browser CSP and phone grid-performance checks as the UI takes shape.
- **Next (Phase 5):** workbooks and the spreadsheet grid. `1102` (sheets, cells with stable row/column ids, styles, operation log, snapshots) is on `main` and applied live (21 Nov 2026); the Sheets UI is not built; next are the JS domain model with a parity fixture, then the grid.
- **Then:** formula engine (6), formatting/sort/filter/CSV (7), IndexedDB offline queue with sign-out hook (8), synchronisation and conflict merge screens (9), attachments (10), integration and acceptance (11). Details and acceptance gates: `docs/modules/workspace.design.md`.

### Closing / Manager / STR
- Treat the core implementations as built; prioritize acceptance and documented integration gaps rather than rebuilding their existing screens.
- Reconcile the 12 timestamp-versioned migration registry rows before adding more database migrations; 0214 is present in both repo and live registry.
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

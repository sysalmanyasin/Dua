# Invoice Desk — progress and handoff

Branch: `module/invoice-desk-phase0`

Last updated: 16 Nov 2026

## Current status

<badge>Phase 0 — registration and specification</badge>

- [x] Repository and module conventions inspected.
- [x] Connected Supabase project identified; read-only schema/permission inspection completed.
- [x] Confirmed no Invoice Desk tables or permissions currently exist.
- [x] Migration range 1000–1099 checked against repository migration files and connected live migration history; no collision found at the time of inspection.
- [x] Workbook inspected and approved worksheets recorded:
  - B.S Mart: `BS Mart (4)`
  - Safari Book Land: `Safari Book Land`
  - Best Choice Store: `Best Choice Store (3)` (four-column layout)
- [x] Phase 0 registry scope approved: documentation register plus live application registry/status page.
- [ ] Owner review of the committed Phase 0 brief and registration.
- [ ] Separate owner authorization before any functional implementation or database changes.

## Current repository changes in this Phase 0 branch

- `docs/modules/invoice-desk.md` — module brief.
- `docs/modules/invoice-desk.progress.md` — this handoff/status file.
- `docs/MODULES.md` — Invoice Desk row and migration allocation.
- `js/modules/index.js` — live module ID registration.
- `js/modules/invoice-desk/manifest.js` — owner-only registration manifest.
- `js/modules/invoice-desk/ui/status.js` — read-only Phase 0 status page.

No migration, database table, SQL function, permission seed, product catalogue, invoice form, history screen, or print renderer has been created. No Supabase write operation has been performed.

## Baseline quality status

The previously inspected GitHub Actions baseline was not fully green:
- npm install, ESLint and Prettier passed.
- Unit suite: 70/71 test files and 971/972 individual tests passed.
- The failure was `tests/unit/service-worker.test.js`, due to the precache list not matching current files.
- Database tests and Edge Function type checks passed.
- Secret/vendor checks were skipped after the unit-test failure.
- Six npm dependency advisories were reported (3 moderate, 1 high, 2 critical); not investigated in this Phase 0 task.

This is a pre-existing baseline finding, not caused by Invoice Desk. Do not fix unrelated failures without owner approval.

## Known design constraints

- Existing repository consistency tests require every registered module to have at least one route. The Phase 0 registration therefore includes one owner-only, read-only status route gated by existing `tools.view`. It has no invoice actions or data access.
- The live manifest gate is temporary. Replace it with approved `invoice_desk.*` permissions only when the first database/permission slice is separately approved and its migration has been applied.
- The module row is marked Briefed because the owner approved the implementation plan and registration scope. Functional implementation remains unauthorized.
- The shared repository contract requires immutable revisions and a correction reason. The brief records the correction-reason requirement as a point to confirm before implementation.

## Next steps

1. Owner reviews the Phase 0 branch/PR and approves or requests changes to the brief.
2. Owner separately authorizes the first implementation slice.
3. Only then prepare migration 1000+ and permission seeds; do not apply them until explicitly approved.
4. Implement and test one small slice at a time, following `docs/MODULES.md`.

## Handoff for another session

Read `docs/MODULES.md`, `docs/modules/invoice-desk.md`, and this file first. Invoice Desk is registered as an in-progress module, but only its status page exists. Do not assume that any invoice functionality or database schema exists. Do not modify migrations, Supabase, Sales, Emergency Billing, or shared Foundation code without explicit approval.

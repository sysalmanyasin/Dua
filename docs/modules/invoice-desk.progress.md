# Invoice Desk — Progress

Updated: 2026-11-22

> **Current status:** source and three routes are integrated on `main`; CI run #444 and Pages deployment #244 passed on main commit `18283f176`. Migrations 1000–1003 are live and recorded under their four-digit repository versions. Remaining: explicit E2E save/product/history/RLS coverage, source-workbook print comparison/logo verification, Android/Windows browser and physical 80mm printer acceptance.

## Completed
- [x] Owner-approved scope and isolated `feature/invoice-desk` branch.
- [x] Supabase DuaPharmaPlus project connected; live database migration registry inspected.
- [x] Existing `public.has_perm('invoice_desk.manage')` authorization used by RLS and write RPCs.
- [x] Original workbook inspected; exact worksheets confirmed: `BS Mart (6)`, `Safari Book Land (2)`, `Best Choice Store`.
- [x] Module brief, module registration and three routes added.
- [x] Namespaced invoice, line, product and idempotency tables created with RLS.
- [x] Transactional invoice and product RPCs created; direct client table writes revoked.
- [x] Live migrations 1000–1003 applied to DuaPharmaPlus.
- [x] PKR amount-in-words generated in JS and independently checked by a database trigger.
- [x] Product suggestions are business-scoped; invoice lines retain item descriptions and prices as snapshots.
- [x] Domain calculations, validation and template mapping implemented.
- [x] Three separate versioned renderers, invoice creation, product management, history search and print preview implemented.
- [x] History uses 100-record offset pages.
- [x] Responsive layout and dedicated browser 80mm print CSS added.
- [x] Initial domain and SQL amount-words tests added.
- [x] Live schema, RLS policies, migration registry and amount-word boundary examples inspected.

## Current Git and integration state

- The module ID `invoice-desk` is present in `js/modules/index.js` on `main`; its implementation directory and migrations 1000–1003 are also present on `main`.
- The earlier branch note below saying `feature/invoice-desk` was not merged is historical and superseded. The branch is not present in the current branch list; continue new work from current `main`.
- The progress record documents migrations 1000–1003 as applied live to DuaPharmaPlus. Verify the live registry before any further migration.

## In progress / not yet accepted

- [ ] Add end-to-end coverage for invoice save, product save, history and RLS denial/authorization.
- [ ] Compare rendered invoices side-by-side with all three source workbooks; verify the Safari Book Land embedded logo is included or explicitly record the approved omission.
- [ ] Test Android and Windows browser rendering, page sizing and print dialogs.
- [ ] Complete physical Windows 80 mm printer acceptance.
- [ ] Confirm `invoice_desk.manage` is assigned only to the intended owner account through the permission workflow.

## Known limitations
- Integrated-main verification is confirmed by CI run #401 (app, database and functions jobs) on commit `9669497`; this does not replace Invoice Desk-specific E2E or printer acceptance.
- The Safari Book Land workbook contains an embedded image; logo inclusion still needs explicit side-by-side verification.
- Physical printer output and browser-specific page sizing remain unverified.
- The `invoice_desk.manage` permission exists, but it must be explicitly assigned to the intended owner account through the existing permission workflow. No staff role preset is granted access.
- Existing Supabase advisor warnings include the intentionally policy-less idempotency tables (direct access is revoked) and the expected authenticated SECURITY DEFINER write RPCs (each checks `has_perm`). Pre-existing unrelated advisor findings were left untouched.

## Git history
- Original implementation branch: `feature/invoice-desk`.
- Current source and registry are on `main`; do not treat the historical branch note as current state.

## Supabase
- Project: DuaPharmaPlus (`sdsynzsflubdxnelgthh`).
- Applied migrations: `1000_invoice_desk_core`, `1001_invoice_desk_integrity`, `1002_invoice_desk_amount_words_fix`, `1003_invoice_desk_product_scope`.

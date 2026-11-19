# Invoice Desk — Progress

Updated: 2026-11-17

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

## In progress / not yet accepted
- [ ] Run `npm ci && npm run verify` on this feature branch and fix every reported lint, format or test issue.
- [ ] Run full `supabase/tests/run.sh` against a clean local Postgres database.
- [ ] Add end-to-end coverage for invoice save, product save, history and RLS denial/authorization.
- [ ] Compare rendered receipts side-by-side with the workbook at 80mm and adjust layout details.
- [ ] Confirm the Safari Book Land embedded logo is included in the final renderer.
- [ ] Android and Windows browser acceptance testing.
- [ ] Physical Windows 80mm printer acceptance.

## Known limitations
- The app code is committed but has not yet passed a full branch verification run.
- The Safari Book Land workbook contains an embedded image; current renderer is text-based and does not yet embed that logo.
- Physical printer output and browser-specific page sizing remain unverified.
- The `invoice_desk.manage` permission exists, but it must be explicitly assigned to the intended owner account through the existing permission workflow. No staff role preset is granted access.
- Existing Supabase advisor warnings include the intentionally policy-less idempotency tables (direct access is revoked) and the expected authenticated SECURITY DEFINER write RPCs (each checks `has_perm`). Pre-existing unrelated advisor findings were left untouched.

## Git
- Branch: `feature/invoice-desk`.
- Not merged to `main`; no merge was authorized.

## Supabase
- Project: DuaPharmaPlus (`sdsynzsflubdxnelgthh`).
- Applied migrations: `1000_invoice_desk_core`, `1001_invoice_desk_integrity`, `1002_invoice_desk_amount_words_fix`, `1003_invoice_desk_product_scope`.

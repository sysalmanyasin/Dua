# Invoice Desk — module brief

Status: Briefed
Owner approval: implementation plan approved; Phase 0 registration approved (16 Nov 2026)
Branch: module/invoice-desk-phase0
Migration range: 1000–1099
Table/function prefix: invoice_desk_
Permission prefix: invoice_desk.*
Route prefix: /invoice-desk
Current phase: Phase 0 — specification and registration only

## 1. Scope

Invoice Desk creates and manages printable invoices/receipts for three businesses: B.S Mart, Safari Book Land, and Best Choice Store.

Included:
- Create an invoice by selecting a business template.
- Enter invoice number manually as text; enforce uniqueness within that business, without losing leading zeroes.
- Set the invoice date and the business-specific header fields required by its template.
- Add, edit, and remove multiple line items manually.
- Offer product-name and price suggestions from the module's own product catalogue. Selecting a suggestion copies the name and price into the invoice; it does not create a live dependency from a historical invoice to the catalogue.
- Calculate line amounts and invoice totals using integer paisa in JavaScript and numeric(14,2) in PostgreSQL.
- Save invoices and search history by business, invoice number and date.
- Reopen, correct and reprint a saved invoice.
- Keep a logical invoice in history when corrected; preserve prior versions internally as immutable snapshots.
- Windows browser printing using the browser print dialog and an 80 mm receipt layout. Android is for invoice management; Android printing is not part of this scope.

Excluded:
- Accounting, customer/vendor management, expenses, payment tracking, OCR, AI, scanning, stock/inventory management, and integration with the existing Sales or Emergency Billing workflows.
- Direct ESC/POS printing, QZ Tray, a local helper application, or a browser extension.

## 2. Workbook source and approved template selection

Source: owner-provided `INVOICE.xlsx`. The workbook is a design reference and is not copied into this public repository. Preserve the selected worksheet's visual structure, labels, field placement, typography, borders, spacing, merged-cell relationships, and footer content. Do not put real phone numbers, customer data, or sample transaction amounts from the workbook into public source or tests.

Approved sheets:

### B.S Mart — `BS Mart (4)`
- Five-column worksheet layout with the item description, rate, quantity and amount fields.
- Header includes business identity/contact area and date/time, cashier and shift information.
- Receipt/invoice identifier is displayed in the header area.
- Includes item count, subtotal, grand total, cash/payment and change, amount-in-words line, and business-specific footer/complaint text including Urdu.
- Workbook styling is primarily bold Cambria with varied sizes and compact receipt spacing.
- No embedded worksheet image.

### Safari Book Land — `Safari Book Land`
- Header has the original-slip label, business identity/contact area, receipt number, date, cashier and time.
- Item table fields: Product, Qty, U/Price and Total.
- Includes item count, total, cash payment and change, and business-specific footer text.
- Contains one embedded PNG logo/image in the lower portion of the worksheet; preserve its placement and aspect ratio in the final receipt.
- Workbook typography is primarily bold Cambria with compact receipt spacing.

### Best Choice Store — `Best Choice Store (3)`
- This is the approved four-column worksheet, not the first Best Choice Store worksheet.
- Exact item headings: `ITEM | QTY | PRICE | AMOUNT`.
- Header includes original label, date, invoice number, time and shift.
- Totals include Total, Discount and Net Payable.
- Footer includes walk-in customer / welcome / availability / delivery messaging and the business contact area.
- Workbook uses Courier New and Comic Sans MS in different parts of the layout.

Do not substitute another worksheet for these approved selections. The Best Choice Store four-column layout is specifically `Best Choice Store (3)`.

## 3. Rules

- INV-1 — KEEP: Invoice number is entered manually by the user, stored as text, and unique per business. Never generate or silently renumber it.
- INV-2 — KEEP: Each business has its own receipt layout and business-specific labels/footers.
- INV-3 — KEEP: Product catalogue suggestions supply only product name and price. Manual item entry remains available.
- INV-4 — KEEP: A saved invoice stores a snapshot of its item descriptions, quantities, prices, calculations, business header and template identity. Later catalogue edits must not change old invoices.
- INV-5 — KEEP: User may reopen and correct an invoice. The current version is what normal history/reprint opens; earlier versions remain retained internally as immutable revisions.
- INV-6 — ASK before implementation: Dua's shared contract requires a correction reason for revisions. The UI should request a short reason when saving a correction unless the owner explicitly changes this requirement.
- INV-7 — KEEP: Browser print dialog is the supported Windows print path. The receipt renderer targets an 80 mm thermal roll and the installed Windows printer driver.
- INV-8 — KEEP: Android is for invoice creation, history and editing. No Android print flow is required.
- INV-9 — KEEP: Business day uses Asia/Karachi date semantics in line with the shared application rules.

## 4. Proposed structure

All names below are proposals only; no database objects have been created.

1. `invoice_desk_products`: module-owned product suggestions; name, suggested price, active flag and audit timestamps.
2. `invoice_desk_invoices`: one logical invoice per business + manually entered invoice number; current revision pointer and timestamps.
3. `invoice_desk_invoice_versions`: immutable saved snapshots; business/template identifier, header snapshot, invoice date, totals, revision number, editor, timestamp and correction reason.
4. `invoice_desk_invoice_items`: ordered item rows belonging to one invoice version; description, quantity, unit price and line amount.

Use `numeric(14,2)` for persisted money and integer paisa for JavaScript calculations. Use database constraints for per-business invoice-number uniqueness. All tables must have RLS enabled. Reads are permission-scoped; writes must use security-definer RPCs with permission checks, idempotency keys and activity logging. Do not add direct browser table writes.

No customer/vendor table is proposed. Do not connect product suggestions to the live Inventory module; the catalogue is module-owned and deliberately limited to name and price.

## 5. Permissions

Proposed keys, to be seeded only in the first approved Invoice Desk migration:
- `invoice_desk.view` — open Invoice Desk and view invoices/history.
- `invoice_desk.create` — create and save new invoices.
- `invoice_desk.edit` — correct an existing invoice and create a revision.
- `invoice_desk.history` — search and open invoice history.
- `invoice_desk.products_view` — view product suggestions.
- `invoice_desk.products_manage` — add/edit/disable product suggestions.
- `invoice_desk.print` — print or reprint invoices.

Role presets are not assigned in this brief; owner approval is required before seeding role permissions.

Registration note: the initial manifest uses the existing owner-only `tools.view` permission solely to expose the Phase 0 status page without introducing an unseeded Invoice Desk permission. This is a temporary registration gate, not authorization for invoice data. Replace it with the approved Invoice Desk permission model in the first implementation slice.

## 6. Screens and print layout

Planned routes (not implemented):
- `/invoice-desk/create`: business selection, invoice header fields, item editor, totals and save.
- `/invoice-desk/history`: filters for business, invoice number and date; open/edit/reprint actions.
- `/invoice-desk/products`: module-owned product suggestions; name and price only.
- `/invoice-desk/status`: temporary registration/status page. This is the only route in the Phase 0 manifest.

Create screen should allow multiple manually entered lines, inline editing/removal, and clear calculated totals. Product suggestions must never prevent manual entry.

Print implementation:
- Separate receipt renderer/configuration per approved business template.
- `@media print` and `@page` rules for an 80 mm receipt; hide app navigation and controls.
- Allow long descriptions to wrap without clipping; keep totals visible; avoid blank extra pages.
- Use the installed Windows printer driver and browser print dialog. Physical output must be tested on the target 80 mm printer and calibrated for its printable width.
- Preserve the Safari Book Land logo placement and all three templates' footer/header structures.
- Do not copy the existing Sales print CSS unchanged; its current target width is 72 mm.

## 7. Interfaces and dependencies

- Uses Dua authentication, permission checks, shared shell/router, shared formatting and logging conventions.
- Owns its product suggestion catalogue and invoice data. No module-to-module imports or direct reads of another module's tables.
- Does not update Sales, Emergency Billing, Inventory or shared Foundation files beyond the explicitly approved one-line module registration.
- No new runtime libraries, external hosts, CSP changes or Edge Functions are currently proposed.

## 8. Decisions

- INV-1: Three business templates and workbook sheet choices — accepted 16 Nov 2026.
- INV-2: Manual invoice number, unique per business, stored as text — accepted.
- INV-3: Product suggestions contain name and price only; manual entry always available — accepted.
- INV-4: Correction updates the current invoice while retaining prior internal revisions — accepted as design direction; correction reason follows shared contract pending owner confirmation.
- INV-5: Windows browser print dialog with 80 mm receipt; Android management only — accepted.
- INV-6: Migration allocation 1000–1099 — owner assigned; collision check performed against repository migration files and connected live migration history.
- INV-7: Phase 0 live registry entry and owner-only status page — approved 16 Nov 2026.
- INV-8: Best Choice Store uses `Best Choice Store (3)`, the four-column `ITEM | QTY | PRICE | AMOUNT` layout — accepted 16 Nov 2026.

## 9. Slices (future implementation; not authorized yet)

1. Database and permissions: schema, RLS, RPCs, idempotency, activity logging and database security tests.
2. Domain calculations and validation: pure functions, integer-paisa arithmetic and unit tests.
3. Invoice creation: business templates, manual invoice numbers and item editing.
4. Product suggestions and history: product catalogue, save/search/open/correct/revision history.
5. Printing: three receipt renderers and 80 mm Windows print validation.
6. Responsive acceptance: Android and Windows checks, permissions and end-to-end regression.

Each slice requires a separate owner go-ahead before implementation. No migration, permission seed, table, RPC, or invoice functionality is included in this Phase 0 change.

## 10. Handoff

The next session must read `docs/MODULES.md`, this brief, and `docs/modules/invoice-desk.progress.md` before doing anything. Invoice Desk is registered but not implemented. Do not start database work or functional screens until the owner reviews Phase 0 and separately authorizes coding. The approved workbook sheets are `BS Mart (4)`, `Safari Book Land`, and `Best Choice Store (3)`. The temporary manifest gate is `tools.view`; do not add unseeded Invoice Desk permissions to the manifest. Migration numbers 1000–1099 are allocated to Invoice Desk.

# Emergency Billing (`ebill`)

Branch `feature/backup-emergency-pos`. Migration range **0600–0699** (already assigned to Emergency Billing in `docs/MODULES.md` §5.1; nothing in it exists on any branch). Table and function prefix `ebill_`, permission prefix `ebill.`, route `/ebill`.

Business boundary (owner): emergency invoices stay separate from normal Sales and Candela. No reconciliation and no automatic posting. The owner enters them in the real POS by hand from the exported history.

## Decisions (owner, 15 Nov 2026)

| # | Decision |
|---|---|
| EB-1 | Use only the product data that exists today: code, name, generic, manufacturer, supplier, stock, pack, price, three dates. **No batch, expiry, barcode or cost** until the Candela feed carries them. Margin, batch and expiry columns are left out rather than faked. |
| EB-2 | Add a service worker so the app opens offline (Phase 3). |
| EB-3 | The finalize PIN is set only by the owner in Settings and stored in Supabase as a hash (Phase 2). Never plaintext. |
| EB-4 | Stock is read from the Inventory module's local copy and always labelled "saved on this device, not live". |

## Planned schema (Phase 2 onward, all in 0600–0699)

`ebill_devices`, `ebill_invoices` (client-made `invoice_id` uuid is the primary key, so a retried upload cannot duplicate), `ebill_invoice_lines`, `ebill_invoice_events` (append-only audit), `ebill_held_bills`, `ebill_staff_limits`, `ebill_staff_pins` (hash only). RLS on every table, writes only through `security definer` functions that check `has_perm('ebill.*')`. Sub-ranges: 0601–09 schema, 0610–19 save/sync, 0620–29 devices, 0630–39 held/refund/correct, 0640–49 settings/reports.

## Phase 1 (built)

- `domain/calc.js`: line, bill, discount, tax, adjustment, payment and change maths (2-decimal rounding at each step).
- `domain/cart.js`: immutable bill helpers, stock warnings from the saved copy.
- `domain/productFilter.js`: global search plus a filter on **every** column, combined with AND, with sort, paging, chips and Clear all.
- `ui/pos.js`: desktop screen (header, 70% invoice grid, 30% totals and payment panel, bottom bar). Hold, return, print, receipt search and save are shown **switched off** until their phases.
- `ui/productHelp.js`: Product Help popup (F2 or the search button). Opens over the bill without changing it, keeps its filters when reopened, keyboard and double-click selection.
- Route permission is `inventory.search` for now; Phase 2 seeds `ebill.use` and switches to it.

Not in Phase 1, by design: batch picker and expiry warnings (no data, EB-1), barcode field (no data), saving, PIN, devices, offline invoices, held bills, history, settings, exports.

Open question for the owner: the product copy's `price` is treated as the price of one **unit** and `pack` as units per pack (the Pack option multiplies both). Confirm this against a real Candela product.

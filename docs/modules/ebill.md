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
| EB-5 | Pack price = unit price × conversion factor (owner, 15 Nov 2026). Matches the Pack option on the screen. |
| EB-6 | No role preset carries an ebill right, so Foundation's role tests stay true. The owner grants `ebill.use` person by person in Users & Access. |
| EB-7 | Work goes to `main` as well as the feature branch, so the owner can see live screens (owner, 15 Nov 2026; replaces the "never commit to the default branch" line of the first brief). Only code that passes `npm run verify` and the database suite is pushed. |

## Database (Phase 2, applied to DuaPharmaPlus on 15 Nov 2026)

Migrations, all inside 0600–0699, applied by hand per RUNBOOK §4 and registered under their repo numbers:

| File | What |
|---|---|
| `0601_ebill_schema` | 5 permissions, 3 settings, tables `ebill_devices`, `ebill_invoices`, `ebill_invoice_lines`, `ebill_pins`, `ebill_staff_limits`; RLS on all; SELECT-only grants; posted invoices and lines frozen by triggers |
| `0602_ebill_harden` | trigger helper not callable by clients |
| `0610_ebill_pin_limits` | owner-set 6-digit finalize PIN stored as bcrypt; 5 wrong PINs lock for 15 minutes; manager sets staff discount limits |
| `0611_ebill_save_invoice` | the only way an invoice is saved: server recomputes the totals, checks device, discount limit and PIN, is idempotent on `invoice_id`, records stock seen (never blocks on it) |
| `0620_ebill_devices` | register a device; manager deactivates it (a deactivated device is told so and cannot save) |
| `0621_ebill_staff_list` | staff list for the settings page (never returns a hash) |
| `0622_ebill_search_path` | fixed search path on helper functions |

Not yet built (later phases): offline queue and sync, held bills, history, refunds and corrections (`ebill_invoice_events`), reports and exports, receipt settings and printing.

Known open design point for Phase 3: a PIN cannot be verified offline against a server hash. Offline invoices will need the PIN checked on this device against a verifier downloaded while online, and the server will re-check discounts and device status when the invoice syncs.

## Phase 1 (built)

- `domain/calc.js`: line, bill, discount, tax, adjustment, payment and change maths (2-decimal rounding at each step).
- `domain/cart.js`: immutable bill helpers, stock warnings from the saved copy.
- `domain/productFilter.js`: global search plus a filter on **every** column, combined with AND, with sort, paging, chips and Clear all.
- `ui/pos.js`: desktop screen (header, 70% invoice grid, 30% totals and payment panel, bottom bar). Hold, return, print, receipt search and save are shown **switched off** until their phases.
- `ui/productHelp.js`: Product Help popup (F2 or the search button). Opens over the bill without changing it, keeps its filters when reopened, keyboard and double-click selection.

Not in Phase 1, by design: batch picker and expiry warnings (no data, EB-1), barcode field (no data), saving, PIN, devices, offline invoices, held bills, history, settings, exports.

Open question for the owner: the product copy's `price` is treated as the price of one **unit** and `pack` as units per pack (the Pack option multiplies both). Confirm this against a real Candela product.

## Phase 2 (built, app side)

- Save invoice: PIN prompt, one invoice id per bill reused on every retry, plain refusal messages, the bill stays open on any failure, and clears only after the server confirms.
- Device id kept in localStorage and registered quietly when online. A deactivated device cannot save.
- Settings page (`/ebill/settings`, owner and managers): staff PINs, per-person discount limits, shop defaults, devices and "switch off".
- Route permission is now `ebill.use`.

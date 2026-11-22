# Emergency Billing (`ebill`)

> **Current status (22 Nov 2026):** Emergency Billing is integrated on `main`, with POS, hold/resume, PIN save, offline queue/sync, history, corrections/refunds, reports and CSV/Excel/PDF export. Live registry includes schema/feature migrations `0601`–`0642`. Owner/device acceptance, staff permission grants, receipt settings and physical printer checks remain; see [ebill.progress.md](ebill.progress.md).

Branch `feature/backup-emergency-pos` (merged into `main`; kept for Phase 5). Migration range **0600–0699** (already assigned to Emergency Billing in `docs/MODULES.md` §5.1; the migration files are present in the repository). Table and function prefix `ebill_`, permission prefix `ebill.`, route `/ebill`.

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
| EB-8 | Offline start (owner asked for offline billing, 15 Nov 2026): a device that was signed in keeps a small saved context so Emergency Billing can open with no connection. It holds only who the person is and the `ebill.use` right (nothing else opens offline), expires after 30 days, is used only when the server cannot be reached, and is removed on sign-out. Saving still needs the PIN. |
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
| `0612_ebill_offline` | offline grants and proof of PIN; `ebill_my_limits` (Phase 3) |
| `0622_ebill_search_path` | fixed search path on helper functions |
| `0630_ebill_held_bills` | `ebill_held_bills` + `ebill_hold_bill` (idempotent, max 10 per person) and `ebill_release_held` |
| `0631_ebill_events` | append-only `ebill_invoice_events`; manager-only `ebill_refund_invoice` (one per invoice, enforced by an index) and `ebill_correct_invoice` (customer, payment mode, comments only); reason required; audited |
| `0632_ebill_history` | `ebill_history` (filters, paging, totals excluding refunded) and `ebill_invoice_detail`, with refunds and corrections applied on top of the saved record |

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

## Phase 3: offline billing and sync (built)

**What the server added (`0612`)**: a PIN cannot be checked offline against the server's hash without giving a device that hash. Instead, after a person types their PIN correctly online, the server gives that device a random secret (stored only as a SHA-256 hash). An invoice made offline carries it as `offline_proof`. At sync the server accepts it only if the secret matches this person's grant for this device, the person still has a PIN, and the PIN was not changed after the device last proved it (invoices made before a change are still honoured). Everything else (totals, discount limit, device status, duplicates) is re-checked as for an online save. Such invoices are marked `pin_check = 'device'`. `ebill_my_limits()` gives an offline device the person's limits and the PIN rule.

**On the device**
- `data/localDb.js`: IndexedDB `dua-ebill` (invoices, small settings). An invoice is committed in its own transaction before the screen says saved. If IndexedDB is unavailable the screen refuses to save offline.
- `data/localPin.js`, `data/offlineKit.js`: after an online save the device keeps the grant and a PBKDF2 check of the PIN (never the PIN). Five wrong PINs lock the device check for 15 minutes.
- `data/sync.js`: the single sync. Uploads oldest first; marks **synced** only on the server's confirmation (or "duplicate"); a refusal marks **failed** with the reason and keeps the invoice whole; a dropped connection leaves invoices **pending** and stops the run; only the signed-in person's invoices are uploaded. Runs when the connection returns, when the page is shown, every minute while something waits, and on Upload now / Retry failed. Synced copies are kept 30 days.
- `sw.js` + `tools/sw-precache.mjs` (`npm run build:sw`): service worker, network-first for same-origin files, other sites and non-GET untouched; precaches the app shell and Emergency Billing so it opens offline. A test fails if the list goes stale.
- `js/core/offlineContext.js`: the narrow offline start described in EB-8.

**On screen**: a sync strip (Online/Offline, Pending, Failed, last sync, ready-for-offline, Retry failed, Upload now, Prepare offline) and a list of the invoices held on this device with Pending / Synced / Failed and the reason. A connection that drops during an online save carries on locally with the same PIN and the same invoice id, so a lost reply cannot create a second invoice.

**Limits to know about**
- Offline billing works only after the person has proved their PIN online once on that device (the screen says what is missing, and "Prepare offline" does it).
- Stock offline is the device's saved copy, always labelled as such. Discount limit and PIN are checked on the device, then again by the server.
- Someone with the device and enough skill can clear browser data to reset the local PIN counter. The protection that matters is the server: it will not take an offline invoice without the grant, and the owner can switch the device off.
- The owner sees which invoices were PIN-checked on a device (`pin_check`) once history exists (Phase 4).

## Phase 4: held bills, history, refunds and corrections (built)

**Rule for all of it (owner, 16 Nov 2026): start online; if the internet drops mid-work, carry on offline.** The screen shows "Connection lost" and "Back online" messages and never clears the bill. Billing, Product Help, holding bills and viewing invoices on the device all work offline; only manager actions that need the server (refund, correct) wait for a connection.

- **Held bills** (`data/held.js`, `ui/heldBills.js`): the device keeps the hold first, the server copy follows through the same single sync, so a bill can also be picked up from another device. Six at most (the Candela `[0 / 6]`). Resuming puts the bill back exactly as it was (items, discounts, cash, payment mode); saving it releases the hold, cancelling it does not. A hold edited while its upload is in flight is not wrongly marked as uploaded.
- **History** (`ui/history.js`, tab "History"): filters (dates, search, status, payment, sync), paging, totals that exclude refunded money, and each invoice's state **Synced / Pending / Failed**. Invoices still only on this device are listed first and called out as **not included** in the server totals. Managers also see the device and where the PIN was checked. Offline, it shows what the device holds.
- **Refund** (manager only): the whole invoice, one per invoice, reason required. **Correct** (manager only): customer, payment mode and comments only; for an amount, refund and bill again. Neither edits the saved invoice: each adds an event (who, when, why, what changed), shown in the detail and written to the audit log. The history overlays events on the saved record.
- **Return / Reason** buttons on the billing screen stay off: refunds are a manager action in History.

## Phase 5 (built, 20 Nov 2026)

- **Partial refunds**: History detail > Refund opens a dialog (item, sold, already back, can refund, quantity, Refund all remaining, reason). The screen previews the amount; the database decides it (`ebill_refund_lines`, 0633). The last refund returns exactly what is left. A request id per dialog makes a retry safe. Statuses: Posted, Corrected, Part refunded, Refunded.
- **Receipts**: `domain/receipt.js` (pure description, four types), `ui/receiptPrint.js` (drawing, print via a hidden `#eb-print-root`, named `@page` sizes for 58/80 mm), `ui/receiptForm.js` (Settings > Receipt with live preview, test slip, logo), `ui/receiptSearch.js` (Search receipt: server plus this device). Settings are cached on the device (`data/receiptSettings.js`) so receipts print offline. The layout follows the owner's own slip (no FBR logo, QR or FBR number).
- **Reports and exports**: History > Reports & export (export right or manager). Daily totals on screen; CSV (daily, invoices), Excel (two sheets) and PDF. Invoices still on this device (waiting or failed) are not on the server: the window warns, offers Upload now, adds the warning to the PDF and Excel notes, and names the files `-INCOMPLETE`. A cut-short list (over 5,000 invoices) is also stated.
- Database: 0633, 0634, 0640, 0641, 0642, all live.

## Full screen (audited and fixed, 21 Nov 2026)

Full screen is the cashier's choice: it stays on until they press **Exit full screen** (or leave the billing page). Rules in `ui/pos.js`:
- **Escape never leaves full screen, and is never swallowed.** It reaches the popups, so Escape still closes Product Help (F5/F2), held bills, Search receipt and the PIN question. (Bug found: the POS key handler used to stop Escape before any popup saw it, so no popup could be closed with Escape in full screen.)
- **Chromium** (Chrome, Edge): Keyboard Lock keeps a short press of Esc and F11 inside the page. Holding Esc about two seconds still lets the browser exit; that cannot be blocked.
- **Firefox and Safari** cannot lock Esc. The browser ends real full screen, but the full layout stays (the menu remains hidden), an open popup is closed (the key never reached the page), and real full screen returns on the next click or key press. Browsers only allow entering full screen from a user action, so it cannot return on its own.
- The same recovery applies when anything else ends full screen (a print window, a long Esc press).
- Exit full screen turns it off for good: no later click brings it back.
- A removed screen never reacts to full-screen events. Tests: `describe('full screen')` in `tests/unit/ebill-page.test.js`; checked in real Firefox.

## Phase 6 (automated testing done, 21 Nov 2026)

Money fuzz (database test `0650`), preview-versus-database cross-check, large-data tests, real print-engine layout check at 58 and 80 mm, and screenshots at 1366 x 768. Results, known limits and the owner's real-device/printer checklist are in `docs/modules/ebill-phase6.md`.

Settings: the shop's receipt settings live on the server (`settings` key `ebill.receipt`, read with `ebill_get_receipt`, changed with `ebill_set_receipt` by managers with a reason) and are the same on every device; each device keeps a copy for offline printing. The unit letter on the slip is **L = loose unit, P = pack** (owner confirmed 21 Nov 2026).

## Status (21 Nov 2026)

Phases 1 to 5 are built and live; Phase 6 automated testing is done. What remains is the owner's: grant the `ebill.*` rights (none are granted live yet), fill in Settings > Receipt, and run the real-device and real-printer checklist. See `docs/modules/ebill-handover.md` for the exact state.

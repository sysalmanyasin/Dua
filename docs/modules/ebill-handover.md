# Emergency Billing: handover for the next session

Read this first, then `docs/modules/ebill.md` (decisions EB-1..EB-8 and what each phase built).
Original handover written 17 Nov 2026; status reconciled 19 Nov 2026. `feature/backup-emergency-pos` is now a stale branch ref (0 commits ahead, 16 behind main); the Phase 1–4 implementation is integrated on `main`. Continue new work from current `main`, not from the stale branch.

## 1. What the module is
A desktop-first pharmacy POS used when the normal POS (Candela) is down. Emergency invoices live ONLY in Dua (`ebill_*` tables) and are NEVER posted to Sales or Candela. The owner exports history and re-enters transactions by hand (no reconciliation). Route `/ebill` (tabs: Emergency POS, History, Emergency Billing Settings). Reserved migration range **0600-0699**.

## 2. State at hand-over

| Area | State |
|---|---|
| Billing screen, Product Help (3 filters, F5/F2, Record n of N), totals, hold/resume, sync strip, full-screen mode | built, tested, pushed |
| Save with owner-set PIN, discount limits, devices, audit | built, **live** |
| Offline billing, on-device queue, sync, service worker, offline start | built, **live** (0612) |
| Held bills, History (Synced/Pending/Failed), manager refund (whole invoice) and correct | built, **live** (0630-0632) |
| Partial refunds (by item and quantity): dialog in History detail, per-line refunded/remaining, Part refunded status | built, tested, **live** (0633, 0634) |
| Receipt settings form (with live preview, test print, logo), receipt printing (Primary, Gift, Summary, Secondary), live Print/Copies/Type controls, Search receipt, Print receipt in History detail | built, tested, **live** (0640, 0642) |
| Reports and CSV / Excel / PDF export, with a warning about pending or failed invoices | built, tested, **live** (0641) |
| Phase 6 (stabilise, wider testing) | **started**: see section 5 |

### Live database (project `sdsynzsflubdxnelgthh`, DuaPharmaPlus) vs repo
Applied and registered live: 0601, 0602, 0610, 0611, 0612, 0620, 0621, 0622, 0630, 0631, 0632, **0633, 0634, 0640, 0641 (applied 20 Nov 2026 with the owner's approval) and 0642 (20 Nov 2026, owner approved)**. The repo and the live database now match. Each was applied by hand with `execute_sql` and registered in `supabase_migrations.schema_migrations` (RUNBOOK §4) with a short note in `statements`. Read-only checks after applying: all registered, no `anon`/`public` execute on any `ebill_` function, internal helpers not callable by clients, RLS on every `ebill_` table. 0 invoices live at the time.

**Receipt slip (0642).** The receipt follows the owner's printed slip (photo supplied 20 Nov 2026): Duplicate, Purchase Slip, shop name, address and licence lines, STN/NTN and payment type, Receipt# and bill date, POS NO, Product/Qty/U-Price/Total, Total, Net Payable, item count, terms. **No FBR logo, QR code or FBR invoice number (owner's decision).** 0642 added `tax_no`, `pos_no`, `slip_title` and a 400-character footer. The shop name, address, STN/NTN, POS number and terms are typed by the owner in Settings > Receipt; they are NOT pre-filled (the live setting still holds the plain defaults).

## 3. Map of the code
```
supabase/migrations/06xx_ebill_*.sql      schema and functions (all writes go through security-definer functions; clients only SELECT through RLS)
supabase/tests/06xx_ebill_*_test.sql      database tests (run: bash supabase/tests/run.sh, needs local Postgres, see section 6)
js/modules/ebill/manifest.js              routes + permissions
js/modules/ebill/domain/                  pure logic: calc.js (money), cart.js, productFilter.js (3 filters), invoice.js (payload + refusal words), offline.js (rules)
js/modules/ebill/data/                    api.js (the ONLY file that talks to Supabase), localDb.js (IndexedDB), sync.js (the ONE sync), held.js,
                                          offlineKit.js + localPin.js (offline PIN proof), device.js, products.js (reads Inventory's local copy), offline.js (service worker)
js/modules/ebill/ui/                      pos.js (billing screen), productHelp.js, heldBills.js, history.js, settings.js, dialog.js (small question dialog)
js/core/offlineContext.js                 the narrow offline start (touches js/core/auth.js and app.js minimally)
sw.js + tools/sw-precache.mjs             service worker and its generated file list (`npm run build:sw`)
css/ebill.css                             all styling for the module
tests/unit/ebill-*.test.js, service-worker.test.js, offline-context.test.js
```
Permissions: `ebill.use` (bill), `ebill.history_all`, `ebill.manage` (manager: devices, limits, refunds, corrections, receipt settings), `ebill.discount_override`, `ebill.set_pin` (owner only), `ebill.export`. **No role preset carries any of them**: the owner grants `ebill.use` per person in Users & Access. Admin with MFA has everything.

## 4. How the main flows work (so you do not break them)
- **One invoice id per bill** (`bill.invoiceId`, made at first save attempt, reused on every retry). The server saves by that id, so retries never duplicate. Never regenerate it on retry.
- **Server is the judge.** `ebill_save_invoice` recomputes totals (same rules as `domain/calc.js`), checks device, discount limit, PIN; returns `{ok, code}` instead of raising so a wrong-PIN count persists.
- **Offline PIN**: after a PIN is typed correctly online the server issues the device a secret (`ebill_offline_grant`, stored only as a hash). Offline invoices carry it as `offline_proof`; the device checks the typed PIN against a local PBKDF2 verifier. Invoices are marked `pin_check = 'device'`. The PIN is never stored.
- **Write locally first.** An invoice or hold is committed to IndexedDB BEFORE the screen says saved, and is deleted only after the server confirms. `sync.js` is the single uploader (invoices, held bills, held releases); a refusal marks the item Failed and keeps it.
- **Held bills**: device copy first, server copy through the same sync; max 6 on screen (server cap 10); resuming keeps the hold until the bill is saved.
- **Refunds/corrections never edit an invoice.** They append events (`ebill_invoice_events`, append-only). History overlays events on the frozen invoice. Corrections allow only customer, payment mode, comments.
- **Partial refund money rule (0633)**: a refund of part of the lines returns that share of the invoice NET total; the final refund returns exactly what is left, so refunds always sum to net to the paisa. A request id makes retries safe; an advisory lock serialises refunds per invoice.
- **Product Help**: three filters ANDed (code box, search box, per-column row); `productFilter.js` is pure and tested on 6,000 rows. Stock is always the device's saved copy, labelled "not live". There is NO batch, expiry, barcode or cost data in the feed (EB-1): do not invent columns.
- **Screen fit**: `.eb-desk` takes `100dvh - --eb-top` (measured in JS), the grid scrolls inside; "Full screen" hides `.hdr`, tabs and status bar via `html.eb-full` and calls `requestFullscreen`. F5/F2 open Product Help and F5 never reloads the page.

## 5. Work still to do
Done 20 Nov 2026: partial refund dialog, receipts and settings form, Search receipt, reports and exports (see section 2). Remaining:
1. **Owner to fill in Settings > Receipt** (shop name, address and licence, STN/NTN, POS number, terms, paper width) and print a test slip on the real printer. Unit letters on the slip are L (loose unit) and P (pack): confirm with the owner. "Duplicate" prints on reprints, copies after the first, and the Secondary type.
2. Settings page "Device settings": show last successful sync (device `lastSyncAt`) and this device's pending/failed counts.
3. Decide with the owner whether counter "Return" bills are wanted (refunds are a manager action in History).
4. **Phase 6**: end-to-end tests (restart persistence, interrupted sync, duplicates, deactivation, large catalogues, migration safety, RLS), real-device checks (Android Chrome, a desktop, the real thermal printer at 58 and 80 mm) and a visual check at 1366x768. The receipt print stylesheet uses named `@page` sizes (`58mm auto`, `80mm auto`); confirm on the real printer driver.
5. Known cosmetic point: at a small window height (about 600 px visible) the totals panel scrolls internally; Full screen fixes it.
6. Reports reuse Inventory's CSV/Excel writers and Closing's PDF writer (pure helpers, as `ebill` already imports Inventory's product helpers). If these are promoted to `js/shared`, update `domain/reportFile.js`.

## 6. How to work (environment and gotchas)
- Repository: `https://github.com/sysalmanyasin/Dua`; GitHub Pages deployment is from `main`. Continue from current `main`; do not use the stale `feature/backup-emergency-pos` pointer. Never paste, store or reuse a GitHub token from an old session; if a credential was exposed, revoke it and use the approved GitHub connection.
- Main is the integration baseline. Create a fresh feature branch from current `main`, keep it synchronized, run all checks, then use the repository's approved merge workflow. If `sw.js` conflicts or its test fails: `node tools/sw-precache.mjs` (the file is generated).
- Checks: `npm run verify` (lint, prettier, vitest, secrets, vendor) and `bash supabase/tests/run.sh` (all migrations in filename order against a scratch Postgres with `supabase/tests/stub_auth.sql`). Both must pass before any push.
- Local Postgres: `apt-get update && apt-get install -y postgresql postgresql-contrib`, `pg_ctlcluster 16 main start`, `su postgres -c "createuser -s root"`, `export PGUSER=root`. The cluster stops between tool calls: restart it at the start of each DB run.
- Migrations: numbered by range; apply live by hand with the Supabase MCP `execute_sql` plus an insert into `supabase_migrations.schema_migrations (version, name, statements)` using the repo number (never `apply_migration`, which stamps a timestamp). `execute_sql` returns only the LAST statement's result. Never edit an applied migration: add a new one (0602, 0622 are examples). Migrations run in FILENAME order, so a fix to something created in 0610 cannot be numbered 0603.
- Project quirks: `render()` in `js/shared/html.js` accepts only `html` output (pass `html```, not `''`) and drops bare `<tr>/<td>` (render whole tables); CSP is strict (`style-src 'self'`, no inline styles, `img-src 'self' data:`, no frames). jsdom tests need `fake-indexeddb/auto` (dev dependency, pinned) and, for WebCrypto, `Object.defineProperty(globalThis, 'crypto', { value: webcrypto })`. Do not use the shell `pkill -f` pattern that matches the shell's own command line.
- Visual checks: a headless Firefox can be had without root via micromamba from github.com releases + conda-forge (`firefox geckodriver`); serve the repo with `python3 -m http.server`, use an import map to mock `data/api.js`, `data/products.js`, `data/offline.js`, and drive it with selenium in a venv. The server dies between tool calls: start it in the same command as the screenshot. A throwaway harness lived in `_harness/` and was deleted.
- Tests tell you what a screen does, not how it looks: screenshot after layout changes.

## 7. Owner's preferences and decisions (do not re-ask)
Keep current product data (no batch/expiry). Add a service worker (done). PIN set only by the owner, stored hashed. Pack price = unit price × conversion factor. Sync with `main` always. Start online, and if the internet drops mid-work carry on offline. Remove buttons that are not needed. Partial refunds are needed. Desktop must fill the screen like Candela; Product Help opens with F5 from the search box and has three filters (code, search, per-column). The owner is non-technical: explain outcomes in plain words, flag decisions clearly, and never apply anything to the live database without their go-ahead.

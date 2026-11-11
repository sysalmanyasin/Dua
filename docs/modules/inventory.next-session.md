# Inventory — plan for the next session

Written 11 Nov 2026, after re-reading `main` (`e635e23`) and the old BT-Sale-Data2 inventory code (stock ledger, excess, reorder, health, bridge, search app, Android widgets, briefing function, Emergency Billing and STR consumers).
Read `docs/SESSIONS.md`, `docs/MODULES.md` and `docs/modules/inventory.md` first. This file is the **work order**; the brief is the **specification**; `docs/modules/inventory-sync-design.md` (revision 2) is the **design for the feed and the reads** and is still *Proposed*.

---

## 1. Where things stand

| Item | State |
|---|---|
| Feed (Foundation F3) | **Live and working.** Dropbox → Edge Function `sync-inventory-from-dropbox` → tables; pg_cron runs it every hour; first run and many hourly runs succeeded. 5,858 products, 4 sales-summary days, 7 credit-by-customer rows, 157 STR headers, 1,847 STR lines (9 Nov 2026) |
| Repo | Migration `0009_inventory_feed.sql`, the function, `supabase/tests/0009_inventory_feed_test.sql`; the inventory brief records decisions INV-1 to INV-6. Merged to `main` through PR #1 |
| Published interfaces (MODULES.md §8.1) | **Only `inventory_latest_sync()` exists** (it returns the last successful log row). `inventory_balances`, `inventory_search`, `inventory_products_for_scope` do **not** exist yet |
| Screens | None. No `js/modules/inventory/` folder, no manifest, no CSS |
| Design | `inventory-sync-design.md` rev 2 (shared local copy + changed-rows-only feed + small server lookups). **Not approved yet** (INV-7 to INV-11 are Proposed) |
| Live-only state (not reproducible from Git) | Extensions `pg_cron` and `pg_net`, the cron job `inventory-hourly-sync`, the Vault secret `inventory_sync_secret`, and the deployed function file (inlined `_shared` code; repo copy imports it). See Foundation task F6 in `docs/SESSIONS.md` |
| Registry | `0009` is registered on the live project under a **timestamp** version (D-35). New migrations must be hand-applied and registered under their repo number (RUNBOOK §4) |

### What changed in my understanding after reading the old app (read before arguing with the design)

The old app kept the **whole product table on every device** and ran every report in the browser. That gave instant search and counter use, and it also caused the egress trouble: about 4.2 MB downloaded per refresh; a "version" that moved every hour even with no change; five separate copies (Bridge, Stock Ledger, Search app, Android widgets, STR lookups); a 5 MB `localStorage` cache; and a manual Pause/Resume switch as the only brake. Business rules were duplicated in several places (the old "815 vs 838 slow items" bug). The design keeps the proven maths and the counter speed and removes those flaws.

Measured on the live data (9 Nov): whole table as objects ≈ 4.2 MB; as compact arrays ≈ 1.4 MB (stock columns 0.96 MB + sales columns 0.46 MB); 84% of rows change their 30/60/90-day numbers once a day at the roll-over (sales columns only); about 10% of rows change stock columns in a normal hour. Reading all 5,858 rows through the current RLS policy costs about 75 ms; wrapping the permission check as `(select public.has_perm(...))` brings that to about 2 ms.

---

## 2. Before writing any feature code (housekeeping)

1. `git fetch && git switch -c module/inventory origin/main` (or merge `origin/main` if the branch exists). Then `npm ci && npm run verify` and `bash supabase/tests/run.sh`. Both must pass; if not, tell the owner and stop.
2. Session start protocol of MODULES.md §0.1 (10-line summary, wait for "go").
3. Check **which Supabase project your tools are connected to.** It must be `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`). Never run anything on `BTpharmacyAudit@2026` or `BT SALE DATA`.
4. Do **not** apply any migration to the live project unless the owner says so. When he does: RUNBOOK §4 step 3 (by hand, register under `0301`, `0302`, …). Never let a tool pick a timestamp version.
5. Ask whether the GitHub token pasted in an earlier chat was revoked. Never store a token in a file. This environment cannot push without one; list every changed file at the end (MODULES.md §0.2).
6. Ask whether Foundation task F6 (registry reconcile) is done. If not, you are hand-applying everything, which is fine.
7. Local test database: start Postgres, make sure a superuser role exists for the shell user, run `bash supabase/tests/run.sh`.

---

## 3. Questions for the owner (ask first, in one message; do not guess)

| ID | Question | Suggested default |
|---|---|---|
| INV-7 | **Local copy or server-only reports?** Reports run on a shared local copy of the products on each phone, kept current by a "changed rows only" feed (instant, works offline at the counter, the proven maths stays in tested JavaScript), versus every report computed on the server (always online, rules rewritten in SQL, risk of mismatched numbers). The brief's §6 says "heavy tables paginate or filter on the server"; this overrides it for the report screens only | Local copy |
| INV-8 | Sales columns (net quantities, sale values, tax) go only to people with the new `inventory.view`; stock columns (code, name, qty, price, company, generic, supplier, pack size, dates) go to everyone with `inventory.search`. Is that the right split? Which presets get `inventory.view`? | `inventory.view` for the owner only until he grants it; presets unchanged |
| INV-9 | A sync that would remove more than 20% of products is refused and logged (protects against a broken export) | 20% |
| INV-10 | Default window for Never Sold and Dead Stock: BUSINESS_RULES §8 says 60 days. The old Stock Ledger tab defaulted Never Sold to 90 (adjustable); the old Home card used 60 | 60, adjustable on the screen |
| INV-11 | No Pause/Resume switch and no timers. Data refreshes when an inventory screen opens, when the tab regains focus after 5 minutes, and on a manual refresh | Yes |
| INV-12 | **Who owns the feed from now on?** The Inventory session would own migrations `0301`+ that change the F3 tables, the function folder `sync-inventory-from-dropbox` and the cron job (today those are Foundation) | Inventory owns it; Foundation keeps only registry and notifications (F6, F4) |
| INV-13 | "Inventory related, all working": does that mean the **Inventory module only** (feed, interfaces, five screens), or also **STR screens** (the feed already lands STR tables, and Reorder wants in-transit quantities)? | Inventory module first; STR becomes its own session once the interfaces exist |
| INV-14 | Rule 9 (no sales totals on staff phones): is product-level sales quantity/value, shown only to `inventory.view` users, acceptable on those users' phones? | Yes, only for users who hold `inventory.view` |
| INV-3 | Old Health page kept a small per-device "reorder value over time" trend in the browser. Keep it per device, or drop it? | Drop |
| INV-15 | MODULES.md rule 9 says offline storage is wiped at sign-out. Apply that to the local copy? Then the next sign-in re-downloads about 1 to 1.4 MB | Yes |

If INV-7 is **No**, stop and tell me: sections 5 and 6 of the design document change, and slices I-B onward need a new plan.

---

## 4. Review of what exists (honest list; fix in this order)

| # | Severity | Gap | What to do |
|---|---|---|---|
| G1 | **High, blocks others** | The interfaces other modules need do not exist (`inventory_balances` blocks Closing Session E) | Slice A2 first, before any delta work |
| G2 | High | `inventory_apply_sync` deletes and re-inserts every row every hour. Result: no way for devices to ask "what changed", table bloat and write churn, and `inventory_latest_sync()` moves every hour even if no data changed | Design §5 (changed rows only, counters, tombstones) |
| G3 | High | The read policy runs `has_perm` once per row (about 75 ms for the table) | New policies use `(select public.has_perm('inventory.search'))`; replace the existing six policies in `0301` and test they still refuse the right people |
| G4 | Medium | `code` has no unique constraint (it is unique in the data today, 0 blanks) | `0302`: unique constraint, dedupe and blank-code handling inside the function |
| G5 | Medium | The deployed function is a hand-inlined copy of the repo file; the two can drift | Every function change: update the repo file **and** redeploy; record the deployed version in the progress file. Ask Foundation whether the GitHub integration can deploy functions |
| G6 | Medium | Live-only state (cron job, Vault secret, extensions) is not in Git | Add a guarded migration or RUNBOOK section (agree with Foundation F6); never put the secret in Git |
| G7 | Medium | The shared secret was visible in a screenshot in an earlier chat | Recommend rotation (SESSIONS.md A4). Rotate **both places together** or the hourly job gets refused: set the new value as the Edge secret `INVENTORY_SYNC_SECRET` (dashboard), then run `select vault.update_secret((select id from vault.secrets where name = 'inventory_sync_secret'), '<NEW_VALUE>');` in the SQL editor, then trigger one run and check `inventory_sync_log` |
| G8 | Low | Failure logs keep only the last error text; no alert on repeated failures | Needs F4 (`notify_owner`); until then show the last result on the Sync history screen |
| G9 | Low | The Candela landing tables `sales_payment_summary` and `sales_credit_by_customer` have un-prefixed names and are read by Sales (Payments page, later) | Leave as is; tell the Sales owner they exist |
| G10 | Info | The old report maths has **almost no tests** (only `inventory-metrics.test.js`). It is tied to the page code, so "port the old tests" gives only the not-sold metric | Hand-work golden fixtures from the old formulas (as Closing did) and ask the owner for 3 to 5 real printed reports (figures may be invented) as extra cases |

---

## 5. Slice plan

Each slice ends with: `npm run verify`, `bash supabase/tests/run.sh`, files listed, progress file updated. **PHONE** = the owner tries it on a real phone before the next slice.

### Session I-A (next): unblock others, then the changed-rows-only feed

| Step | Scope | Done when |
|---|---|---|
| A0 | Housekeeping (§2) and owner answers (§3) | merged, green, answers written into the brief |
| A1 | **Tests first** for the interfaces (security and behaviour): refused without `inventory.search`; `anon` reads nothing; `p_limit` clamped; at most 200 codes; unknown code returns "not found"; `%` and `_` in a search are treated as plain text | tests exist and fail for the right reason |
| A2 | **`0301_inventory_interfaces.sql`**: seed `inventory.view`; replace read policies with the wrapped form; `inventory_balances(p_codes text[])` (code, name, qty, found), `inventory_search(p_text, p_limit ≤ 50, p_offset)`; keep `inventory_latest_sync()` compatible | DB tests green; mutation check (remove the permission check, see the test fail). **Owner may now apply it, and Closing can build the audit card** |
| A3 | **Tests first** for the delta feed (design §8) then **`0302_inventory_delta_feed.sql`**: `active`, two row hashes, two counters, unique `code`, `inventory_sync_state`, `inventory_apply_sync` v2, `inventory_changes_stock`, `inventory_changes_sales`, extended `inventory_latest_sync()`, mass-removal guard, advisory lock, tombstones | DB tests green, including: identical second sync changes **zero** rows and leaves counters alone; one price change moves only that row; a missing product becomes a tombstone and vanishes for users |
| A4 | Edge Function: Dropbox `content_hash` check first, new RPC, new log fields. Redeploy (by hand), update the repo copy | type-check passes; a manual run on the live project returns `unchanged` when nothing changed |
| A5 | Watch **two days** of real hourly runs. Record in the progress file: how many hours were `unchanged`, rows changed per hour, rows changed at the daily roll-over, table size. Answers the open question "does Candela write a timestamp inside the file every hour?" | numbers recorded; design doc §5.1 caveat resolved |
| **STOP** | Owner applies `0301` and `0302` (hand, in order) and confirms the hourly job still works | |

### Session I-B: the local copy and the maths

| Step | Scope |
|---|---|
| B1 | `data/mirror.js` (IndexedDB: `stock`, `sales`, `meta`) with the tests of design §8 (equal counters = zero data calls; delta add/change/remove; interrupted page resumes; count mismatch triggers a reload; logout wipes; offline keeps serving; one request shared by simultaneous callers) |
| B2 | `domain/` ports with golden fixtures: `metrics.js` (one "not sold in N days" definition; port the old test), `ledger.js` (zero stock, Never Sold, Dead Stock, Pack issues, 100-day Excess, pack down-rounding), `search.js` (old `BTSearch` scoring) |
| B3 | Manifest (id `inventory`, nav order 40), `css/inventory.css` + one `<link>`, `status.js` ("data as of" pill), `/inventory` overview with local search and 100-row pages |
| **STOP** | **PHONE #1:** first install (progress and time), search at the counter, airplane-mode search, sign out and in |

### Session I-C: the reports

C1 `/inventory/ledger` (tabs, export; the old XLSX export wrote formulas, ask whether CSV is enough) · C2 `/inventory/excess` (**read `excess-working.js` completely first**) · C3 `/inventory/reorder` (windows 30/60/90, today folded in, cover days, top N, in-transit stub from STR) · C4 `/inventory/health` (charts load only on this page) · C5 owner-only "Sync now" (permission `inventory.sync`) and sync history · **PHONE #2**.

### Session I-D: finish

D1 `inventory_cover_summary()` (the four Home numbers computed in SQL) with a **parity test** against the JavaScript engine on the same fixture · D2 owner alert on repeated sync failure when F4 exists · D3 egress review (MODULES.md OD-7): real numbers from the Supabase usage page after one week · D4 definition of done (MODULES.md §11), brief and handoff updated, owner marks the module Accepted.

---

## 6. Facts the next session must not have to rediscover

### 6.1 The Dropbox file (what the function parses)
Top-level keys: `products`, `paymentSummaryLast4Days`, `creditByCustomerLast4Days`, `strLast7Days`, `strLineItemsLast7Days`. A product has `code, name, stock, unitPrice, company, generic, supplier, conversionFactor, creationDate, lastReceiveDate, lastSaleDate, netQtyToday, netQty30Days, netQty60Days, netQty90Days, saleValueInclTax{Today,30Days,60Days,90Days}, saleValueExclTax{…}, taxPercent, isTaxable`. Blank strings mean "no date". The function maps these to the snake_case columns of `0009`.

### 6.2 What the numbers mean (from the old code, confirmed)
- `netQty30/60/90Days` and the matching sale values **end yesterday 23:59:59**, so they are stable all day. `netQtyToday` and the "Today" values are separate (today 00:00 to now). Reorder **adds** them and divides by the window plus the fraction of today elapsed; Never Sold, Dead Stock and Excess use the stable windows only.
- `isTaxable = false` means the incl-tax and excl-tax values are the same; the reports pick `saleValueInclTax` when taxable, else `saleValueExclTax`.
- `price` is the retail price (INV-5). `conversionFactor` is the pack size; invalid or missing means "no pack" (fallback 1 for display, but the product is excluded from Never Sold and Dead Stock and listed under Pack issues).

### 6.3 Rules read so far (Stock Ledger `computeAll`, old `stockledger.js` lines 161–357, and `inventory-metrics.js`)
- Stock = 0 → "zero stock" reference list only. Stock < 0 counts in the negative-stock value on the Home card; it is never Never Sold or Dead Stock (the rounded quantity is not > 0), and with an invalid pack size it appears under Pack issues.
- **Never Sold:** valid pack, **no** last-sale date, received more than N days ago, rounded-down quantity > 0. **Dead Stock:** valid pack, **has** a last-sale date, not sold in N days, received more than N days ago, rounded-down quantity > 0. The two are mutually exclusive. Value = rounded quantity × unit price.
- **Excess (100-day):** `net90 > 0`, `stock ≥ 4`, `excessQty = stock − net90/90×100 > 0`; then the default recalculation keeps rows at least 90 days old (a missing creation date counts as old enough) with at least 200 days of stock cover (`stockDays = stock ÷ (net90/90)`).
- The metrics module defines "not sold in N days" separately for the briefing and the dashboard card: stock > 0 and (last sale older than N days, or no last sale **and** no net sales in the 90-day window). **Do not keep two definitions**; reconcile them in `domain/metrics.js` and record which one wins in the brief (a business decision: ask).
- **Not yet read by anyone in this project:** `excess-working.js` (731 lines: Retained / Loose / Excess and the misc buffer), `reorder-report.js` and `reorder-table.js` bodies, `inventory-health-dashboard.js` scoring, `inventory-native.js` grouping and sorting, `cover-inventory.js`. Read them in full before writing the matching domain file; write each rule into the brief tagged KEEP / IMPROVE / DROP / ASK.

### 6.4 Old consumers (what each needs, so the interfaces are right)
| Old consumer | Needs | New home |
|---|---|---|
| Overview, Stock Ledger, Excess, Reorder, Health | the whole product set | local copy (this module) |
| Emergency Billing | stock check at the counter; the old design trusted the browser's stock figure | local copy to browse; `inventory_balances` at invoice time (module `ebill`, later) |
| STR report | `code → supplier, conversion_factor` map | `inventory_search` / a small lookup (module `str`, later) |
| Closing audit card | 31 fixed codes' current stock | `inventory_balances` (Closing Session E) |
| Daily briefing, notifications | totals and buckets | `inventory_cover_summary()` inside the database (D1), no egress |
| Android widgets, AI tools | small limited lookups | later; same interfaces |

### 6.5 Rules of thumb for this module
No `select *` on inventory tables from the app; every list call has a limit (200 rows per delta page, 50 per search page, 200 codes per balance lookup, enforced inside SQL); only `js/modules/inventory/data/` talks to inventory tables; no `setInterval` in inventory code. Text ≥ 0.8 rem, targets ≥ 44 px, `₨ 12,345` via `shared/format.js`, no `innerHTML`.

---

## 7. Definition of done for the module
MODULES.md §11, plus: egress numbers measured, not estimated; every screen shows "data as of"; a device that has not opened the app for 40 days recovers by itself; airplane-mode search works; the daily roll-over is observed once on a real device; golden fixtures for every report; the owner has tried each STOP on a phone; the brief's Handoff is current.

---

## 8. Paste this at the start of the next session

```text
You are continuing the "inventory" module of the Dua pharmacy app (branch module/inventory).
Read docs/SESSIONS.md, docs/MODULES.md completely, then docs/modules/inventory.md,
docs/modules/inventory.next-session.md (this is your work order) and docs/modules/inventory-sync-design.md.
Then read docs/ARCHITECTURE.md, docs/SECURITY_MODEL.md, docs/DATABASE_DESIGN.md, docs/DECISIONS.md,
docs/BUSINESS_RULES.md and docs/RUNBOOK.md §4, and study js/modules/sales as the finished example.
Step 0: merge origin/main, run `npm ci && npm run verify` and `bash supabase/tests/run.sh`; both must pass.
Then tell me in about 10 lines what you will do in Session I-A, which questions in section 3 you need me to
answer, and what you will not touch. Wait for my "go".
Do not guess money or business rules; ask. Stay inside MODULES.md §3.1 and §3.2 and migrations 0300-0399
(you may also change the F3 feed files once I answer INV-12). Do not apply migrations to the live project
unless I say so, and never let a tool invent a migration version. No real names or business amounts in the repo.
Check which Supabase project you are connected to before any database work: it must be DuaPharmaPlus.
At the end follow MODULES.md §0.2 and list every file you changed.
The old apps are references only: sysalmanyasin/BT-Sale-Data2 (main), sysalmanyasin/Random, sysalmanyasin/Closing.
```

# Inventory sync and reads: change-only design (egress-safe)

Status: **Proposed (revision 2), awaiting owner approval. Nothing here is built yet.**
Applies to: the Inventory module (migrations `0301`–`0399`; the feed itself was Foundation F3 in `0009`) and Inventory Part B (screens). Work order: `docs/modules/inventory.next-session.md`.
Revision 2 replaces revision 1 after reading the old BT-Sale-Data2 inventory code, the Android widgets, the briefing function and the reports.

## 1. What the old app taught us

Every Inventory screen, report and widget in BT-Sale-Data2 works from the **whole product table on the device**, and all the report maths runs in the browser. That is fast and works at the counter, but it caused the egress trouble:

| # | Old flaw (found in the code) | Where |
|---|---|---|
| F1 | Whole table downloaded with `select('*')` in 6 pages (about 4.2 MB) whenever the version changed | `inventory-bridge.js`, `stockledger.js`, `inventory-search/app.js` |
| F2 | The "version" was `inventory_sync_log.synced_at`, which moves **every hourly sync even if nothing changed**, so every active device re-downloaded about once an hour | same files |
| F3 | Five separate copies of the same data (Bridge, Stock Ledger, Search app, Android widgets, STR lookups), each downloading on its own | see list |
| F4 | The cache lived in `localStorage` (about 5 MB limit; failures were silently ignored) | `inventory-bridge.js` |
| F5 | The only egress control was a **manual Pause/Resume switch**; every launch started paused | `hub-gate.js` |
| F6 | Business rules re-implemented in several places (browser, Android Kotlin, the briefing function), which produced mismatches such as 815 vs 838 slow items | `inventory-metrics.js` header |
| F7 | Inventory table readable by the anonymous role | stock ledger header notes |

What the old app got right, and we keep: the engine is proven JavaScript with a tested single "not sold in N days" definition; windows end yesterday and "today" is separate (so 30/60/90 values are stable all day); Emergency Billing works from a local copy; widgets use small limited lookups.

## 2. Measured numbers (live Dua data, 9 Nov 2026)

| Fact | Value |
|---|---|
| Products | 5,858 (all codes unique, none blank) |
| Old style: objects, all columns | about 4.2 MB |
| Compact arrays, all columns | about 1.4 MB (stock columns 0.96 MB, sales columns 0.46 MB) |
| Rows whose 30/60/90-day numbers can change at the daily roll-over | up to 4,923 (84%), **sales columns only** |
| Rows whose stock columns change on a normal hour | about 10% (589 had a sale or receipt date of today) |

## 3. Decision: one shared local copy, changed rows only, plus small server lookups

This is a hybrid, chosen because it keeps the old app's proven maths and counter speed while removing every flaw above.

| Who reads | How | Why |
|---|---|---|
| Overview, Stock Ledger, Excess Working, Reorder, Health, Emergency Billing | **One shared local copy** (IndexedDB) kept current by a **delta feed**; the existing rules run locally in `domain/` | Instant and works offline; the maths stays in tested JavaScript (no second copy in SQL, so no F6) |
| STR, Audit, Closing, other modules | Small server lookups with hard limits: `inventory_search`, `inventory_balances`, `inventory_products_for_scope` | Never load a 1.4 MB copy to look up three codes |
| Emergency Billing at invoice time | Server `inventory_balances(codes)` verifies stock | Replaces the old "client says what the stock was" trust gap |
| Daily briefing, notifications, AI tools | Run inside the database or Edge Function (service role) | Inside Supabase, not billed as egress |

Rejected: server-side reports only (revision 1). It would duplicate every rule in SQL and let numbers drift between screens, which is the exact trouble the old app had.

## 4. Rules

1. **One local copy per device**, owned by one module (`inventory/data/mirror.js`). No screen and no other module downloads inventory on its own. A repo test fails the build if one does.
2. **Version = what really changed.** Two counters, `seq_stock` and `seq_sales`, increase only when row content changes. A sync that finds nothing new changes nothing, so devices do nothing.
3. **Delta only.** A device asks for rows changed after its last seen counter. First install loads everything once; after that, only changes.
4. **Two column groups, fetched separately.** Stock columns (code, name, qty, price, company, generic, supplier, pack size, three dates) go to everyone with `inventory.search`. Sales columns (net quantities, sale values, tax) go only to users with `inventory.view` (INV-8). The daily roll-over then costs a device about 0.4 MB, not a re-send of names.
5. **No timers, no Pause switch.** The version check runs when an inventory screen opens, when the tab regains focus after 5 minutes or more, and on manual refresh. No `setInterval`, no Realtime.
6. **Never `select *`; every list call has a limit** (cap 2,000 rows per delta page, 50 per search page, 200 codes per balance lookup, enforced inside SQL).
7. **Self-healing.** If anything looks inconsistent, the device wipes its copy and reloads. Correctness always beats saving bytes.
8. **The copy is wiped on logout** and when permission is lost (MODULES rule 9).

## 5. Server design

### 5.1 Sync (Edge Function and database)
**Layer 1, file unchanged:** ask Dropbox for the file's `content_hash` (about 1 KB). Same as stored: record "checked", stop. No download, no writes.
**Layer 2, row delta:** `inventory_apply_sync` stages the payload, computes two row hashes in SQL (stock columns, sales columns), and upserts by `code` **only where a hash differs**. Changed rows get the new counter value for their group. Products missing from the payload become `active = false` (a "tombstone") with counters bumped. All in one transaction; failure keeps old data (as today).
**Layer 3, counters** live in a one-row `inventory_sync_state`: `seq_stock`, `seq_sales`, `active_count`, `content_hash`, `last_checked_at`, `last_changed_at`, `schema_version`, and the oldest counter still covered by tombstones.

Caveat to verify with real runs: if Candela writes a timestamp inside the JSON every hour, layer 1 never skips. Layers 2 and 3 still prevent churn. After two days the log shows which case it is.

### 5.2 Data model (migration `0302_inventory_delta_feed.sql`; the small interfaces come first in `0301_inventory_interfaces.sql`)
- Read policies use the wrapped form `(select public.has_perm('inventory.search'))`. Measured on 5,858 rows (local Postgres 16, junior user): bare form about 75 ms per full read, wrapped form about 2 ms.
- `inventory_products`: add `active`, `row_hash_stock`, `row_hash_sales`, `seq_stock`, `seq_sales`; unique constraint on `code` (the plain index goes). RLS: `active` and `inventory.search`.
- `inventory_sync_state` (new, no direct client access).
- `inventory_sync_log`: add counts (added, changed, removed, unchanged) and result `changed` / `unchanged` / `failed`. No-change checks are not logged row by row. Last 200 rows kept (daily prune).
- Daily cron: delete tombstones older than 30 days and record the new "oldest covered" counter. A device older than that gets `reset` and reloads fully.
- Small tables (sales summary, credit, STR) keep replace-in-one-transaction, only when the file hash changed. Sales summary and credit are **never** put in the device copy (MODULES rule 9).

### 5.3 Functions (all clamp limits inside SQL)
| Function | Who | Returns |
|---|---|---|
| `inventory_latest_sync()` | `inventory.search` | `synced_at`, both counters, `active_count`, `schema_version`, reset flags (about 0.2 KB) |
| `inventory_changes_stock(p_since, p_limit ≤ 2000)` | `inventory.search` | compact rows, removed codes, next counter, done flag |
| `inventory_changes_sales(p_since, p_limit ≤ 2000)` | `inventory.view` | compact rows (code + sales columns), next counter, done flag |
| `inventory_search(text, limit ≤ 50, offset)` | `inventory.search` | slim rows |
| `inventory_balances(codes[] ≤ 200)` | `inventory.search` | code, qty |
| `inventory_products_for_scope(scope)` | Audit | product list, capped |
| `inventory_cover_summary()` (later) | `inventory.view` | the four Home numbers, with a parity test against the JavaScript engine |

### 5.4 Safety guards (each has a test)
Mass-removal guard (refuse if a sync would deactivate more than 20% of active products); advisory lock so two syncs cannot overlap; duplicate and blank codes deduplicated and counted; counters instead of timestamps so phone clocks cannot cause missed rows.

## 6. Client design

`js/modules/inventory/data/` holds the only code that talks to inventory tables.

- **Store:** IndexedDB, three stores: `stock` (key `code`), `sales` (key `code`), `meta` (counters, `synced_at`, `schema_version`). No `localStorage` (fixes F4). No new library needed; a small wrapper is enough.
- **`ensureFresh(reason)`:** deduplicated (one request in flight, shared by all callers) and remembered for 60 s. Steps: 1) `inventory_latest_sync()`; 2) counters equal to ours: stop (cost 0.2 KB); 3) otherwise page through `inventory_changes_*` from our counter, applying each page and saving the counter **only after that page is stored** (a crash or lost connection resumes cleanly); 4) when finished, check our row count equals `active_count`; mismatch means wipe and reload; 5) `reset`, a different `schema_version` or any error in step 4 means wipe and reload.
- **Offline or error:** keep using the local copy and show "as of 14:00" (from `meta.synced_at`). Never blank the screen.
- **Domain maths** in `domain/` as pure functions, ported from `stockledger.js`, `excess-working.js`, `reorder-data.js`, `inventory-health-dashboard.js`, `inventory-metrics.js`, with the old unit tests brought across plus new golden tests with invented rows. One definition of each metric, used by every screen.
- **Rules to carry over exactly** (from the old code, checked against BUSINESS_RULES): pack down-rounding with fallback 1; Never Sold and Dead Stock mutually exclusive, both needing a valid pack size; Excess = stock − net90 ÷ 90 × 100 when net90 > 0 and stock ≥ 4, then age and stock-days filters; Reorder windows 30/60/90 that add today's live sales and divide by the window plus the fraction of today elapsed; STR in-transit stub.

## 7. Egress budget (Free plan: 5 GB a month)

| Event | Size (compact, uncompressed, worst case) |
|---|---|
| Version check | about 0.2 KB |
| First install, everyone | stock 0.96 MB |
| First install, reports users | plus sales 0.46 MB |
| Normal hour, a device that opened the app | about 0.1 MB |
| Daily roll-over, reports users | about 0.4 MB |
| Search, balance or scope lookup | under 10 KB |

Per device per month: about 15 MB for a reports user, about 3 MB for a counter user. Twenty devices: roughly **0.3 GB, about 6% of the limit** (old app: up to 4.2 MB per hour per active device). Compression, if applied, only lowers this.

## 8. Tests (written first)

- **Database:** first sync loads all; identical second sync changes zero rows and leaves counters alone; one changed price moves only that row's stock counter; a sales-only change moves only the sales counter; a missing product becomes a tombstone and disappears from users' views; it returns when it reappears; mass-removal guard keeps data; duplicate and blank codes; second concurrent sync gets `busy`; limit clamps; user without `inventory.search` gets nothing; user without `inventory.view` gets no sales rows; failed sync leaves counters untouched; tombstone purge triggers `reset`.
- **Client mirror:** equal counters mean zero data calls; delta applies correctly (add, change, remove); interrupted page resumes; count mismatch triggers a reload; reset and schema change trigger a reload; logout wipes; offline keeps serving the local copy; two simultaneous callers share one request.
- **Repo guards:** no inventory table access outside `inventory/data/`; no `select('*')`; no `setInterval` in inventory code; every inventory RPC call carries a limit.
- **Domain:** the old tests ported, plus golden fixtures for each report.

## 9. Build order

0. **S0** Migration `0301`: `inventory_balances`, `inventory_search`, wrapped read policies, `inventory.view`. Tests first. This unblocks Closing's audit card and needs none of the delta machinery.
1. **S1** Migration `0302` and its database tests.
2. **S2** Edge Function (hash check, delta RPC, new log fields); redeploy; watch two days of real hourly runs and record the changed/unchanged numbers here.
3. **S3** Read functions (section 5.3) with limits and tests.
4. **S4** Client mirror with its tests.
5. **S5** Domain maths ported with tests; then screens in the brief's order (overview, ledger, excess, reorder, health).
6. **S6** `inventory_cover_summary()` with parity tests, for the Home cards and notifications.

## 10. Decisions

| ID | Decision | Status |
|---|---|---|
| INV-7 | Hybrid: shared local copy with delta feed for the screens, server lookups for other modules (this document) | **Proposed** |
| INV-8 | Sales columns (net quantities, sale values, tax) only for `inventory.view`; stock columns for `inventory.search` | **Proposed** |
| INV-9 | Mass-removal guard at 20% | **Proposed** |
| INV-10 | Default window for Never Sold and Dead Stock: 60 days (BUSINESS_RULES §8). The old Stock Ledger tab defaulted Never Sold to 90 (adjustable); the old Home card used 60 | **Ask owner** |
| INV-11 | No Pause/Resume switch; no timers; refresh on open, focus (5 min) and manual | **Proposed** |
| INV-12 | The Inventory session owns the feed from now on (migrations `0301`+, the function folder, the cron job) | **Ask owner** |
| INV-13 | Scope of "inventory related": Inventory module first; STR as its own session after the interfaces exist | **Ask owner** |
| INV-14 | Product-level sales quantities and values may sit on the phones of users who hold `inventory.view` | **Ask owner** |
| INV-15 | The local copy is wiped at sign-out | **Proposed** |

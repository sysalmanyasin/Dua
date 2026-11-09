# Inventory sync and reads: change-only design (egress-safe)

Status: **Proposed, awaiting owner approval. Nothing here is built yet.**
Applies to: Foundation F3 follow-up (migration `0010`) and Inventory Part B (screens).
Why: the old app downloaded and re-synced everything every time. On the Supabase **Free plan** (about 5 GB egress a month, 500 MB database) that does not survive real use.

## 1. The numbers that drive the design

Measured on the live Dua project (9 Nov 2026):

| Fact | Value |
|---|---|
| Products | 5,858 (all codes unique, none blank) |
| Whole product table as JSON, all columns | about 4.2 MB |
| Slim row (code, name, qty, price, company) | about 120 bytes; a 50-row page is about 6 KB |
| Rows that moved in the last 30 days | 3,755 (64%). Rolling windows shift every day |
| Sold today (at mid-afternoon) | 504 (9%) |

If every screen open downloaded the product table: 4.2 MB × 10 users × 20 opens a day × 30 days is about **25 GB a month, five times the Free limit.** That is the flaw to design out.

## 2. Where egress really happens

| Hop | Billed as egress? | Plan |
|---|---|---|
| Dropbox → Edge Function | No (data coming in) | Still skip it when the file is unchanged (saves time and Dropbox calls) |
| Edge Function → database | No (inside Supabase) | Still write only what changed (less bloat, less WAL) |
| pg_cron → Edge Function | Tiny | Unchanged |
| **Database → phones and browsers** | **Yes, the only one that matters** | Server-side search, server-side report maths, version-stamp caching (section 5) |

So "sync only changes" helps the database and Dropbox side, but **the egress saving comes from how the app reads.** Both are designed below.

## 3. Rules

1. **No screen reads the whole product table.** Every list is paginated or limited on the server. Hard cap 200 rows per call, enforced inside the SQL function, not trusted to the client.
2. **No `select *` on inventory tables from the app.** Named columns only.
3. **A tiny version check decides whether to refetch.** `inventory_latest_sync()` returns a `data_version` (a number, about 100 bytes). If it has not changed, the app reuses what it already has in memory.
4. **Reports are computed in the database** and return only the rows on screen (top N, a page, or one small summary object).
5. **No Realtime, no `setInterval` polling.** Version check runs on screen open, and on tab focus at most once every 5 minutes.
6. **Sales-value columns never go to staff phones as a bulk copy** (MODULES rule 9). `sale_value_*` is served only by report functions that need it, to users who may see sales data.
7. **A sync that changes nothing writes nothing** (beyond one "last checked" timestamp).

## 4. Server side: change detection in three layers

### Layer 1: skip the whole sync if the Dropbox file has not changed
Before downloading, the function asks Dropbox for the file's metadata (`/files/get_metadata`, about 1 KB) and reads its `content_hash`. If it equals the stored hash: update `last_checked_at`, return `{unchanged: true}`, stop. No download, no parsing, no database writes.
Caveat to verify in practice: if Candela writes a fresh timestamp inside the JSON every hour, the hash changes every hour and layer 1 never skips. Layer 2 still protects the database. After 3 days the log will show which case we are in.

### Layer 2: row-level delta (only changed rows are written)
`inventory_apply_sync` stops doing "delete everything, insert everything". It becomes:

1. Stage the payload (deduplicate by `code`, keep the last; skip blank codes and count them).
2. Compute a `row_hash` for each staged row in SQL (md5 of all business columns), so the hash is defined in one place.
3. `INSERT ... ON CONFLICT (code) DO UPDATE ... WHERE inventory_products.row_hash IS DISTINCT FROM excluded.row_hash`. Unchanged rows are not touched at all.
4. Products absent from the payload are **soft-removed**: `active = false`, `changed_seq` bumped. A product that comes back is reactivated.
5. Everything is in one transaction. Failure keeps the old data (same guarantee as today).
6. Returns counts: added, changed, removed, unchanged.

### Layer 3: data version
A single-row table `inventory_sync_state` holds `data_version` (bigint, increased only when a sync really changed something), `content_hash`, `last_checked_at`, `last_changed_at`. This is what the app polls.

### Data model (migration `0010_inventory_delta.sql`)
- `inventory_products`: add `active boolean not null default true`, `row_hash text`, `changed_seq bigint`. Replace the plain `code` index with a **unique** constraint on `code`. Backfill hashes. RLS policy gains `and active`.
- New `inventory_sync_state` (one row, no client write access, readable only through `inventory_latest_sync()`).
- `inventory_sync_log`: add `added`, `changed`, `removed`, `unchanged` counts and a `result` of `changed` / `unchanged` / `failed`. Successful no-change checks are **not** logged row by row. The log keeps the last 200 rows (daily prune).
- Daily cron: delete products inactive for more than 30 days.
- Small tables (sales summary, credit, STR) keep replace-in-one-transaction, but only run when the file hash changed. They are small (4, 7, 157 and 1,847 rows).

### Safety guards (each one has a test)
- **Mass-removal guard:** if a payload would deactivate more than 20% of active products (a truncated or empty export), refuse, keep the old data, log the failure. Manual override flag for real catalogue clean-ups.
- **No concurrent syncs:** an advisory lock; a second run returns `busy`.
- **Empty or tiny products array is refused** (already so today).
- **Duplicate or blank codes** are handled and counted, never crash the sync.
- Client deltas use `changed_seq`, not timestamps, so phone clocks cannot cause missed changes.

## 5. Client side: how the app reads

| Screen | How it reads | Typical size per use |
|---|---|---|
| Overview and search | `inventory_search(text, limit ≤ 50, offset)` returning slim columns | about 6 KB a page |
| Product lookups from other modules | `inventory_balances(codes[])`, `inventory_search` | under 5 KB |
| Stock Ledger, Excess, Reorder | one SQL function per report; returns the visible page or top N | 15 to 60 KB |
| Health dashboard | one function returning a small summary object (counts and sums), no rows | under 3 KB |
| "Last synced" pill | `inventory_latest_sync()` | about 0.1 KB |

Caching: results are cached **in memory** keyed by `(report, parameters, data_version)`. Switching tabs, going back, or reopening a report costs nothing until `data_version` changes. Nothing is stored on the device that the security model forbids.

Estimated usage: 10 users × 20 opens a day × about 20 KB is roughly **120 MB a month**, about 2% of the Free limit, leaving room for the Sales, Closing and Audit modules.

### Guard against regressions (the old app's flaw)
- A repo test fails the build if app code calls `.from('inventory_*')` with `select('*')`, or calls an inventory function without a limit.
- Every list function clamps `p_limit` to 200 inside SQL.
- The app logs response sizes to the console in development; any response over 100 KB is flagged.
- After launch: check the Supabase Usage page weekly for the first month; alert threshold 60% of the egress limit.

## 6. Considered and not chosen

- **Full on-device copy with delta updates (IndexedDB):** works offline, but the daily rolling-window shift changes about two thirds of rows, so each phone pulls roughly 2.5 MB a day, and caching sales-value columns conflicts with MODULES rule 9. Revisit only if offline stock lookup is required.
- **Supabase Realtime for stock changes:** adds message volume and egress for no benefit at hourly refresh.
- **Per-row `updated_at` instead of `changed_seq`:** vulnerable to clock skew and ties; a counter is simpler and exact.

## 7. Tests (written before the code)

Database (`supabase/tests/0010_*`): first sync loads all rows; identical second sync changes zero rows and does not bump `data_version`; one changed product changes exactly one row; a product missing from the payload becomes inactive and disappears for users; it returns when it reappears; mass-removal guard refuses and keeps data; duplicate and blank codes handled; two concurrent syncs, the second gets `busy`; limit clamp at 200; user without `inventory.search` sees nothing; failed sync leaves `data_version` untouched.
Function: unchanged Dropbox hash returns early with no download; changed hash runs the full path; Dropbox errors are logged.
App (later): no `select('*')` on inventory tables; every inventory call carries a limit.

## 8. Build order

1. **S1** Migration `0010` and tests (delta RPC, state table, guards).
2. **S2** Edge Function: hash check, new RPC call, new log fields; redeploy; watch two days of real hourly runs and record the unchanged/changed numbers here.
3. **S3** Read interfaces from the inventory brief section 7 (`inventory_latest_sync` with `data_version`, `inventory_search`, `inventory_balances`, `inventory_products_for_scope`) with limits and tests.
4. **S4** Screens (Part B) using only those functions, plus the egress regression test.

## 9. Open decisions

| ID | Question | Recommendation |
|---|---|---|
| INV-7 | Reports computed on the server (as above) or a full cached copy on each phone? | Server side. Revisit only if offline stock lookup is needed |
| INV-8 | Keep `sale_value_*` off the bulk path, served only through report functions to users allowed to see sales data? | Yes |
| INV-9 | Mass-removal guard at 20%? | Yes |

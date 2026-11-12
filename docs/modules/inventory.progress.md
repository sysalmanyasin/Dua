# Inventory — progress

Branch `module/inventory`. Live project: `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`). Nothing from this session has been applied to the live project.

## Session I-A (12 Nov 2026)

| Step | What | State | Tested |
|---|---|---|---|
| A0 | Branch from `origin/main` (`d81df5e`), `npm ci`, `verify`, DB tests green; owner answers recorded in the brief §8 | done | 242 unit tests; all DB checks |
| A1 | Interface tests written first, failed for the right reason (`inventory.view` missing) | done | — |
| A2 | `0301_inventory_interfaces.sql`: `inventory.view`, wrapped read policies, `inventory_balances`, `inventory_search` | done, **ready to apply** | 63 checks; 3 mutations caught (permission check removed, 200-code cap raised, one policy unwrapped) |
| A3 | `0302_inventory_delta_feed.sql` (tests first): hashes, two counters, unique `code`, tombstones, `inventory_sync_state`, `inventory_apply_sync` v2, `inventory_changes_stock/_sales`, extended `inventory_latest_sync`, 20% guard, advisory lock, prune, column privileges | done, **ready to apply** | 122 checks; 7 mutations caught (guard, hash, column grant, tombstone policy, page cap, sales permission, tombstone counters) |
| A4 | Edge Function: Dropbox `content_hash` shortcut, busy (409) and refused (422) answers, `confirmRemoval`, `recheck` | done in repo, **not deployed** | `deno check` passes (same command as CI) |
| A5 | Two days of real hourly runs | **not started**: needs 0302 and the function live | — |

### Measured on the local test database (invented data, 6,000 products)

- `inventory_search` 7–14 ms; `inventory_balances` for 200 codes 1.6 ms; full table read 0.8 ms (wrapped policy).
- Upgrade path: load 6,000 rows with the old `0009` function, apply `0302`: all rows get hashes and counter 1; the next identical sync reports 6,000 unchanged and writes nothing; a 1% price change writes exactly 60 rows and moves only the stock counter (1 → 61).
- Whole sync call about 0.2–0.25 s at 6,000 rows (includes building the test payload).
- Two real sessions: the second `inventory_apply_sync` while the first holds the lock returns `{"ok": false, "busy": true}` and writes nothing; it runs normally afterwards.

### Ready to apply (owner, by hand, in this order — RUNBOOK §4 step 3)

1. `0301_inventory_interfaces.sql` — safe to apply alone. Unblocks Closing Session E (audit card).
2. `0302_inventory_delta_feed.sql` — the live registry still holds the two timestamp rows (`inventory_feed`, `enable_cron_and_net`), so F6 is **not** done: register by hand under `0301` / `0302`, never let a tool choose a version.
   - Before applying, the owner may want a backup of `inventory_products` (it is rebuilt hourly, so loss is harmless).
   - The migration deletes rows with a blank code and keeps one row per duplicate code. The live table has none today; the next hourly sync would restore anything removed.
   - Existing rows get counter 1 in both groups; no phone has a copy yet, so nothing needs a reset.
   - The currently deployed Edge Function keeps working after 0302 (same first three arguments, same answer keys). Redeploy the repo copy afterwards to get the `content_hash` shortcut.
3. Redeploy `sync-inventory-from-dropbox` from the repo copy (by hand). The deployed copy inlines `_shared/clients.ts` and `_shared/http.ts` into one file; do the same.
4. Run it once by hand: a second run straight after should answer `{"result":"unchanged","skipped":true}`.

## Deviations from the work order (please confirm)

- **Delta page cap is 1,000 entries, not 200** (work order §6.5) **and not 2,000** (design §8). A page is one compact JSON document (about 165 KB at 1,000 stock rows), so PostgREST's 1,000-row limit does not apply, and a first install is 6 requests instead of 30. It is a single constant in each function; say the word and I change it. Proposed as **INV-16**.
- `inventory_changes_*` return one `jsonb` document (`reset`, `cols`, `rows`, `removed`, `next`, `done`, `seq`, `activeCount`), not a set of rows. A set-returning function repeats every key per row (about 4.2 MB for the whole table instead of 1.4 MB).
- Direct `select` on `inventory_products` now works only for stock columns (column-level grant), so nobody can read sales figures except through the feed (INV-8). The app must never `select *` (it would be refused).
- `inventory_latest_sync().synced_at` now means "last checked" (`last_checked_at`): a check that found nothing new still counts as fresh. Old three columns kept in the same order.

## Findings for later slices

**STR screens (owner decision INV-13: STR screens are in scope).** Read from the old app `BT-Sale-Data2/js/str` (1,558 lines). Rules, tagged:

- KEEP **Stage** (3-stage lifecycle): `received` if `receive_status = 'Received'`; else `dispatched` if `dispatch_status = 'Dispatched'`; else `awaited`. `str_status` itself is only Open/Close.
- KEEP **Direction**: `out` = Bahria Town is the dispatching branch ("Dispatched from BT"), `in` = Bahria Town receives ("Received at BT").
- KEEP **Pack quantity**: line quantities are loose units; pack qty = `floor(loose / conversion_factor)`; a code with a missing, zero or non-finite factor uses 1. Factor and supplier come from the product (join by code); a code no longer in the product table shows "Unassigned Supplier" and factor 1.
- KEEP **Difference** = dispatch pack qty − receive pack qty (blank when either is missing); red when negative, green when positive.
- KEEP **List**: search over STR number, ref no, comments, issued/dispatched/received by, both branch names; filters stage, branch chip (dispatched / received), date range; newest first (date, then id). Tap a row for the detail view with prev/next that walks the filtered list.
- KEEP **Detail** (reproduces the source system's "Stock Transfer Report"): header fields, items grouped by supplier, each group sorted by product code (numeric-aware), sub-totals per supplier and grand total of STR and dispatch pack qty, comments, print without a signature block.
- KEEP **Report** sub-tab: all matching STRs at once, grouped Dispatch Branch → STR (with comments) → Supplier → lines; column picker (R. Price, STR Qty, Dispatch Qty, Receive Qty, Difference) remembered per device; "Hide 0-Dispatch" toggle remembered per device; print.
- KEEP **Zero Dispatch** sub-tab: lines with pack STR qty > 0 and pack dispatch qty = 0 (per line, so partly dispatched STRs still show theirs); STRs and supplier groups left empty disappear; a checkbox per STR (unchecked by default, not remembered), Select all / none, print only the ticked ones.
- KEEP **Window**: the source gives only the last 7 days; the screen says so ("rolling 7-day window").
- DROP the old anonymous read client (the old app read these tables as `anon`); IMPROVE: the Dua tables are readable only with a permission.
- **Reorder needs STR too** (old `buildInTransitMap`): in-transit pack qty per code = sum of `floor(dispatch_qty / factor)` over lines of STRs with `direction = 'in'`, `dispatch_status = 'Dispatched'`, `receive_status <> 'Received'`.

Consequences to decide (question **STR-Q1**, not blocking I-B):
1. The contract lists `str` as its own module (`str_`, `/str`, `str.`, range 0500–0599). Recommendation: build it as module `str` in this same line of sessions after the Inventory core (supplier and pack factor are already in the local product copy, so no extra download). The alternative is routes under `/inventory/str` and migrations in 0300–0399.
2. The current read policy on the STR tables requires `str.approve` (a *different* meaning: approving requests). Viewing the report needs its own permission, proposed `str.view` (seeded in an 0500-range migration or in 0303, depending on 1).
3. Reorder's in-transit figure needs STR lines for people who hold `inventory.view` but not `str.view`. Proposed: a small database function `inventory_in_transit()` (security definer, `inventory.view`) returning code and packs only.

## Still to do (next sessions)

I-B (local copy, maths, golden fixtures) → I-C (reports) → I-D (Home numbers in SQL, egress review, done). STR slice after the Inventory core.

## Handoff
See the brief, §10.

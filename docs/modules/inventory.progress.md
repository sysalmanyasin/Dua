# Inventory — progress

Branch `module/inventory`. Live project: `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`). **Migrations 0301–0304 and the Edge Function (v14) are applied and verified live** (12 Nov 2026, owner instruction: "apply by yourself").

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

### Applied live (12 Nov 2026, by hand, registered under the repo numbers)

| Version | What | Verified |
|---|---|---|
| `0301` | permission, wrapped policies, `inventory_balances`, `inventory_search` | source and policy hashes equal the repo; no grant to `anon` or `public` |
| `0302` | the changed-rows-only feed | all 12 function hashes equal the repo (the live `inventory_apply_sync` first lacked 8 comment lines; restored, hash now identical) |
| `0303` | heartbeat log row (see "Found while applying") | hash equal; 3 mutations caught |
| `0304` | renumber counters 1..N and unique counter indexes (see "Found while applying") | 5,883 distinct counters, indexes present |
| Edge Function `sync-inventory-from-dropbox` v14 | hash shortcut, busy/refused answers | `verify_jwt` stays `false`; ran from the same call as the hourly job |

Live registry now: `0001`–`0012`, `0301`–`0304`. Foundation completed F6 (`0009`, `0011`, `0012`) between my first and second apply; those files live on `origin/foundation/operations-hardening` and are not on `main` yet. They do not conflict with mine (different numbers and files).

**Live evidence after the deploy** (hourly runs 08:00–12:00 UTC, plus manual runs through the same call the cron job makes):
- 5 hourly syncs, all `ok`; each changed only 41–68 rows of 5,883 (before 0302 every sync rewrote all 5,883). No failures, no watchdog alerts.
- Counters consistent: highest row counter equals the state counter; 5,883 distinct values.
- A full first install through the feed, as a signed-in senior: 6 pages, 5,883 distinct products, 977 KB (stock) + 540 KB (sales, owner only) ≈ 1.5 MB, about 100 ms of server time.
- Hash shortcut proven live: second call with the same file answered `{"result":"unchanged","skipped":true}`, moved only the "checked at" time, wrote no log row.
- Refusals proven live inside a rolled-back test: a senior cannot read the sales feed, a sales column directly, `select *`, the state table, or call `inventory_apply_sync`; an owner without MFA gets nothing.
- The file changes every hour with real row changes (about 1% of rows), so it does not carry an hourly timestamp; the hash shortcut will mostly fire at night and on quiet days.

### Found while applying (both fixed, both with tests)

1. **Watchdog false alarm (found by reading Foundation's `0012`).** `ops_check_inventory_feed` alerts when the log has no `ok` row for 3 hours. An unchanged file now skips the sync without a log row, which would have looked like a dead feed. `0303`: a scheduled unchanged check writes one `ok/unchanged` heartbeat row when the newest successful row is older than 2 hours (at most 12 a day). Caught before the new function was deployed, so no alert was ever raised.
2. **Backfill bug in my own `0302`.** Existing rows all got counter 1, and the feed pages by counter, so a first install would have received only the first 1,000 of 5,883 products. My upgrade test compared change counts but never paged from 0 on backfilled data. Found by the live smoke test; no phone had a copy. `0304` renumbers every row 1..N, sets the state counters, and adds partial unique indexes so duplicates cannot exist again. `0304`'s test reproduces the broken state, shows it losing rows, repairs it, and pages a full install.
3. Process slip, recorded for honesty: I re-checked the clock before 0301 but not before 0302 (hours had passed between my messages). It was safe (a transaction that holds the sync lock cannot collide with the hourly run) but the rule is now: check `now()` immediately before every apply.

## Session I-B (13 Nov 2026): the local copy, the maths, the first screen

Merged `origin/main` into `module/inventory` first (Closing and Manager are on main now). One conflict, `docs/modules/inventory.progress.md` (main carried an older mirror of this file with an integration note); kept this current version. No migration number collisions (others use 0013, 0101–0103, 0201–0205; Inventory uses 0301–0304). All database checks pass on the merged tree (829).

| Step | What | State | Tested |
|---|---|---|---|
| B1 | `data/feed.js` (the only file that calls Supabase), `data/mirror.js` (sync algorithm), `data/idbStore.js` + `data/memoryStore.js` (stores), `data/local.js` (shared copy, sign-out wipe, refresh on return) | done | 18 mirror tests (first install, no-change = one small call, delta, crash mid-install resumes from the last saved counter, reset, other person, schema change, count mismatch, offline, permission withdrawn, concurrent syncs); 6 mutations caught (one needed a stronger test, see below); the IndexedDB store checked against `fake-indexeddb` outside the project, including that a failed batch leaves rows and counter untouched |
| B2 | `domain/ledger.js`, `metrics.js`, `search.js`, `stockMath.js`, `join.js`: pure functions ported from the old app | done | 43 tests, 401 invented products; the generator `tests/fixtures/inventory-golden/make-golden.mjs` contains the old code verbatim (cites the old commit) and writes the numbers the new code must reproduce exactly: 5 window settings, "not sold" at 4 settings, 16 search queries; 10 mutations caught |
| B3 | `manifest.js`, `status.js` (Stock pill, arms the sign-out wipe), `ui/overview.js` (local search, 100 rows at a time, Refresh, offline and revoked-access notes), `css/inventory.css`, one line each in `js/modules/index.js` and `index.html` | done | 11 screen tests (real mirror, mocked network), 5 status/sign-out/refresh-on-return tests, 10 structural guards; 3 screen mutations caught |

Whole repo after I-B: 497 unit tests, lint, format, secret and vendor scans green.

**A weak test found by mutation.** Removing "apply removals" from the mirror did not fail any test, because the mirror's self-healing (count mismatch, wipe, reload) quietly produced the right result. The delta test now also asserts that nothing was reloaded from zero.

**Not verified: a real phone or browser.** This environment has no browser. The screen is tested in jsdom with the real mirror and a mocked network, and the IndexedDB store against a spec-compliant fake. The first run on a real device is the STOP check below.

### Owner decisions needed

1. **INV-17: which "not sold" number is the Home headline?** The old app has two on purpose, both ported and tested side by side:
   - *Headline* (old briefing): stock above zero and the last sale older than N days (or no sale date and no sales in 90 days); every unit counts, value is quantity × price.
   - *Stock Ledger lists*: Never Sold and Dead Stock also look at the received date, count whole packs only, and exclude unreliable pack sizes.
   Recommendation: Home keeps the headline definition (as the old briefing did), the Ledger screens use the list definitions, and each screen says in one line which it is. Default window 60 days (INV-10).
2. **INV-18: the "Pack issues" list cannot be reproduced.** The Edge Function and `0302` turn a missing or zero pack size into 1, so the signal the old report used is gone. On the live data 2,725 of 5,308 in-stock products (Rs 14.6M of Rs 24.4M) have pack size 1, a mix of real single-unit packs and possibly missing sizes. The port treats pack 1 as valid, so those products can appear in Never Sold and Dead Stock (rounding does nothing). Options: (a) accept, the Pack issues card is dropped; (b) keep the raw factor (one more column in the feed, a migration and an Edge Function change, about 30 KB more on a first install) so unusable sizes are flagged again. Recommendation: (b), as it protects the Dead Stock numbers you act on.

### Requests for Foundation (I may not edit these files)

- **Sign-out hook for modules.** `js/core/auth.js` has no way for a module to clear its own storage at sign-out (MODULES.md rule 9). Inventory listens to the auth `SIGNED_OUT` event from `status.js` and also discards a copy that belongs to someone else, which works but depends on `status.js` having loaded in that tab. A real hook (for example `registerSignOutCleanup(fn)` called by `signOut()`) would be cleaner.
- **A box icon** in `js/shared/icons.js` (Inventory uses `shield` until then, like Closing).

### STOP: first check on a phone (needs this branch live, for example merged to main or a preview)

1. Sign in, open **Inventory**. First time only: "Opening the product list…", then about 5,900 products (about 1 MB; about 1.5 MB if you hold `inventory.view`). Header shows the count and "as of" time.
2. Type "para": results appear instantly, best match first, no spinner. Turn on airplane mode, type again: still works.
3. Tap **Refresh** online: seconds, no big download (look at data use if you can). With airplane mode on: "Offline. Showing the copy from …".
4. Close the tab, reopen Inventory: opens immediately from the phone's copy.
5. Sign out, sign in as a different person (for example the senior), open Inventory: the first person's list must not appear.
6. As the owner you should see "Sold: x in 30 days" lines and "stock worth Rs …"; as the senior you must not.
7. Look at the Stock pill in the status bar (time of the last check).

## Deviations from the work order (confirmed)

- **Delta page cap is 1,000 entries, not 200** (work order §6.5) **and not 2,000** (design §8). A page is one compact JSON document (about 165 KB at 1,000 stock rows), so PostgREST's 1,000-row limit does not apply, and a first install is 6 requests instead of 30. Accepted by the owner as **INV-16** (12 Nov 2026).
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

Decisions (owner, 12 Nov 2026) on **STR-Q1** and its consequences:
1. **A separate `str` module** (`str_` prefix, route `/str`, migrations 0500–0599), reusing what Inventory already provides: supplier and pack factor from the local product copy, no extra download. Foundation owns the `MODULES.md` registry entry; this note is the request to move `str` from Planned to Active.
2. **`str.view` is the permission for every STR viewing screen** (list, detail, Report, Zero Dispatch). The current read policy on the STR tables requires `str.approve` (a different meaning: approving requests); the STR module's first migration seeds `str.view`, moves the two read policies to it (wrapped form), and adds the permission to no role template until the owner decides.
3. **Approved:** a small database function `inventory_in_transit()` (security definer, `inventory.view`) returning code and packs only, so Reorder works for people who hold `inventory.view` but not `str.view`. It belongs to the Reorder slice (I-C) and goes in the 0300 range.

## Still to do (next sessions)

I-B is built (above), waiting for the phone check and decisions INV-17/INV-18. Then I-C (the reports: Stock Ledger, Reorder with `inventory_in_transit()`, Excess; the reorder maths still has to be ported with golden fixtures) → I-D (Home numbers in SQL, egress review, done). The `str` module is a separate line of work.

## Handoff
See the brief, §10.

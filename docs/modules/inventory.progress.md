# Inventory — progress

> **Current status (21 Nov 2026):** Inventory is integrated on `main`; all six screens, Home stock summary and Excel/PDF/CSV exports are present. Live registry includes `0301`–`0309` (0309 `inventory_company_summary` is timestamp-registered); `sync-inventory-from-dropbox` is active at Edge Function v24. The older v23/0307 statement below is historical. Remaining: real-phone PDF acceptance, monitor sync health, confirm when Candela publishes the Dropbox file, and remove the legacy RPC fallback only after stable operation.

Branch `module/inventory` was merged into `main`. Live project: `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`).

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
| `0305` (14 Nov) | `pack_valid` flag (INV-18) | all 12 function hashes equal the repo; 5,911 of 5,911 stored hashes consistent; upgrade path rehearsed on 6,000 products (identical sync unchanged in both payload shapes, flagging 100 products writes exactly 100 rows and moves only the stock counter); 5 mutations caught |
| Edge Function `sync-inventory-from-dropbox` (v14 on 12 Nov; v20 on 14 Nov adds `pack_valid`; v21 on 14 Nov adds one retry on a statement timeout; v22 and v23 on 17 Nov add the whole-body call `inventory_apply_sync_body` from migration 0307, with a fallback to the old call if it is missing) | hash shortcut, busy/refused answers, pack flag | `verify_jwt` stays `false`; ran from the same call as the hourly job; v20 differs from v14 by exactly two lines. Versions 15–19 were deployed by someone else in between; the function file on `main` never changed after F3 except through this branch, so no repository change was overwritten |

Live registry: Foundation `0001`–`0013`, Closing `02xx`, Inventory `0301`–`0306`, STR `0500`–`0504`, e-bill `06xx`, Candela history `0900`. Foundation completed F6 (`0009`, `0011`, `0012`) between my first and second apply; those files live on `origin/foundation/operations-hardening` and are not on `main` yet. They do not conflict with mine (different numbers and files).

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

## Sessions I-C and I-D (15–16 Nov 2026): every screen, shared state, the Home numbers

Merged `origin/main` three more times (Closing, then STR, e-bill, Candela history: 51 commits, no conflicts). All gates green on the combined tree: **907 unit tests in 67 files, 1,183 database checks**, every Edge Function type-checks, lint, format, secret and vendor scans.

| Screen / piece | What it does | Tested |
|---|---|---|
| **Stock Ledger** `/inventory/ledger` | Tabs: Never sold, Dead stock, Excess (standard 90 days old / 200 days cover, or everything above target), Zero stock, Pack issues; window 30–365 days (default 60, INV-10); search, sort, totals, Excel, PDF and CSV of exactly what is shown | golden comparison with the old app (5 window settings, 400 products), 10 mutations, screen tests |
| **Reorder** `/inventory/reorder` | Window 30/60/90, cover days, include today (Karachi clock), Top sellers vs All low cover, group by supplier, search, sort, units already on the way, per-row other windows, Excel / PDF / CSV | every number of every product compared with the old engine for 5 settings; threshold, tax and supplier-fallback cases; 10 mutations |
| **Excess Working** `/inventory/excess` | Whole-pack corrected excess, Retained / Loose / Excess status, misc and head-office value, retain list shared across devices, filters, Excel / PDF / CSV | 3 scenarios compared with the old engine; retain failure puts the screen back |
| **Health** `/inventory/health` | The four Home numbers, class doughnut, stock by supplier, best sellers (Chart.js loaded only here), filterable product list | KPIs equal the Home four; classes use the ledger lists (INV-17); charts destroyed on redraw |
| **Sync** `/inventory/sync` (inventory.sync) | Last check, "Sync now", "Re-read the whole file", last 40 runs, explicit confirmation when a sync is refused for removing over 20% | refused → confirm flow, busy, errors |
| **Overview** | now has a menu to the screens each person may open | |
| `0306` (live 16 Nov) | `inventory_in_transit()`, shared retain list and settings tables with RLS, `inventory_cover_summary()` | 38 checks incl. **SQL parity with the old app on 409 products** (all 7 figures, counts exact, money to the cent); 10 mutations (one equivalent) |

**Decisions made while building (please confirm any you disagree with):**
1. **Export is Excel, PDF and CSV** (17 Nov 2026, owner request). Excel is written by `domain/xlsx.js`, a small writer with no library, so it works offline: values only, no formulas, text always stays text (a product name starting with `=`, `+`, `-` or `@` cannot run as a formula) and codes keep their leading zeros; the header is bold, frozen and filterable, and an About sheet records the settings and the stock data time. PDF uses the browser's print dialog (Save as PDF), landscape, with the first 1,500 rows and a note that the Excel file has the full list; it follows the same print pattern as STR and Sales. CSV stays. All three come from `ui/export.js`, so the three screens (Ledger, Reorder, Excess Working) export exactly what is on screen.
2. **"In transit" comes from the STR module.** STR (decision STR-10) publishes `str_in_transit_lines()`; `inventory_in_transit()` is a thin wrapper that only applies Inventory's pack size, so Inventory never reads STR tables and the definition lives in one place. Consequence: in transit follows STR's rule (live feed only, closed transfers excluded) and packs are `floor(sum of loose units / pack size)` per product, where the old app floored per line. My first version read the STR tables directly; changed after finding STR's interface.
3. **Excess retain list, misc and head-office value are shared** (migration `0306`, readable and changeable only with `inventory.view`), not per device as in the old app.
4. **Reorder settings are per person** (window, cover days, include today, tab, top N, grouping, sort), stored in the database preferences like other personal settings.
5. **Health classes use the ledger lists** for Never sold and Dead stock (INV-17: one definition); the dashboard's own looser tests are dropped, and its trend over time stays dropped (INV-3).
6. **The "reorder" Home figure leaves today out** so it is steady all day; the Reorder screen includes today by default, so the two can differ slightly on purpose.

**Live numbers on 16 Nov 02:39 UTC (rolled-back smoke test):** stock Rs 23.7M; to reorder 1,682 products, Rs 4.0M to buy; not sold in whole packs 694 products, Rs 2.2M; excess 256 products, Rs 0.86M; 253 products (851 packs) on the way. The cover summary takes about 120 ms on the live database. The reorder list is long on purpose: that is why the screen opens on "Top sellers".

**Egress review (the work order's I-D check).** Per person, per day, on the Free plan's 5 GB/month:
- First install: about 1 MB of products (about 1.5 MB with sales); once, and again only after a sign-out, a reset or a schema change.
- Each visit: one small call (about 0.5 KB); the hourly changes are about 40–700 rows, 7–115 KB, fetched only when something changed and the person opens a screen.
- Reorder adds the in-transit list (about 250 products, under 10 KB) per visit; Excess adds the shared state (a few KB); Health, Ledger and Overview add nothing: they compute on the phone.
- The Home numbers come from `inventory_cover_summary()`: one call, a few hundred bytes, no product rows.
- A heavy day (20 screen visits, 5 hourly deltas) is well under 1 MB per person. Ten people stay far inside the monthly allowance. The old app pulled the whole table on every visit.

**Not done / needs someone else:**
- **Home shows the four stock numbers** (17 Nov 2026): people with `inventory.view` see a Stock row on the Cover (stock value, to reorder, not selling, excess), each opening the page that explains it. It makes one extra call, `inventory_cover_summary()`, in parallel with the sales call; if it fails or the person lacks the permission, the row is simply left out and the rest of the Cover is unchanged. The Home change is small (data `api.js`, `domain/cover.js`, `ui/page.js`) and is in the same pull request, for Foundation's review.
- **Nothing was verified on a real phone or browser** (no browser here). Screens are tested with the real code against a fake server; the first look on a phone is yours.
- **Retained names are matched by product name** (as in the old app); two products with the same name share a status.

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

### Found after go-live (14 Nov 2026): occasional database statement timeouts

Six hourly syncs have ever failed with "canceling statement due to statement timeout": three on 11 Nov (before any Inventory migration, under the old rewrite-everything sync) and three since (12 Nov 15:00 and 23:00, 13 Nov 13:00 UTC); about 3 in 55 runs since `0302`. Every one kept the previous data, and the next hour succeeded, so nothing was lost and the 3-hour watchdog never fired.
- The role that calls the function (`authenticator`) has an 8-second statement limit. Measured on the live database at a quiet moment (a replay of a realistic payload built from the live tables, 5,932 products, 2,243 STR lines, inside a block that always rolls back): the whole sync takes **450–750 ms**, the product comparison alone about 380 ms. So the work is not slow; a busy moment on the server occasionally multiplies it past 8 s. The 13 Nov failure coincides with the daily backup starting at 13:00 UTC, the same minute as the hourly sync; the other two have no known cause.
- Mitigation shipped (Edge Function v21): when the database reports a statement timeout, wait 5 seconds and retry once; only a second failure is logged as a failed sync. Safe because the apply is atomic and repeatable (`inventory_apply_sync` takes a lock and either completes or changes nothing).
- Left to the owner: moving the hourly job a few minutes past the hour (for example `:05`) would also avoid the backup minute and the `:00` watchdog. I did not change the schedule because Candela's export time is not known to me.
- Check later: if timeouts continue after v21 (look for failed rows in `inventory_sync_log`), the next step is to look at the server's own logs for what runs at those minutes.

### Update 17 Nov 2026: the timeouts: diagnosis, the fix (`0307`) and the cron history

**Solved by `0307` and function v23 (see "Fix for the timeouts" below).** The first part of this section is the diagnosis as it stood before the cause was found, kept as the record; its "root cause not found" and its options (1)–(3) are superseded.

Nine hourly syncs have now failed with "statement timeout" since 12 Nov (about 7% of runs); every one kept the previous data and the next hour succeeded; no alert was raised.
- **The retry (v21, 14 Nov 12:30) runs but does not help.** Before it, failures were logged 27–42 s after the hour; after it, 43–56 s: the first attempt times out at 8 s, the function waits 5 s, the second attempt times out too (the Postgres log shows two timeout errors 26 s apart at 16 Nov 02:00). So when the database is slow it stays slow for more than 13 s; it is not a momentary blip.
- **All nine failed runs were the scheduled run at the top of the hour; the manual runs I made at :13 and :30 never failed.** They are spread over the day (hours 02, 10, 13, 15, 18, 20, 21, 23 UTC), so the daily backup (13:00 UTC) explains only one of them.
- **Not the size of the work:** a replay of a realistic payload on the live database took 450–750 ms. Not other jobs: at 16 Nov 02:00 the other scheduled jobs each took 0.1 s or less. The server log shows only the two timeout errors, nothing about locks or slow statements.
- **Root cause not found.** What I cannot see from here: the project's CPU and disk activity at those minutes (Supabase dashboard, Reports → Database; a Free-plan project can be throttled), and whatever else the platform runs at :00.
- **Options, cheapest first:** (1) check the dashboard's database CPU and disk graphs at 16 Nov 02:00 and 15 Nov 15:00 UTC; (2) move the hourly job a few minutes past the hour (for example `:07`, `select cron.alter_job(1, schedule := '7 * * * *')`, reversible, but it changes the "as of" times people see and I do not know when Candela writes the file); (3) split the sync into two calls (products, then the small STR/payment tables) so each has its own 8-second budget; (4) a larger compute size. I changed none of these; (2) is the one I would try first.
- **Impact today:** a failed run means stock data that is up to an hour older than usual (the Stock pill shows the time of the last check); the feed watchdog only alerts after 3 hours without a success.

**Cron history, 17 Nov 2026.** At 07:32 UTC the hourly sync was moved from minute 0 to minute 7 (`cron.alter_job(1, schedule := '7 * * * *')`) as a precaution while the real cause was still being found. Five scheduled runs at :07 (08:07 to 12:07) all succeeded, but that was after the fix below was already live, so it does not show that :07 itself helps. At 12:19 UTC, on the owner's instruction, it was moved back to minute 0 (`cron.alter_job(1, schedule := '0 * * * *')`). Live-only cron state, not a migration. Candela's export time is still unknown.

**Fix for the timeouts, same day (migration `0307`, Edge Function v23).** Measured in `pg_stat_statements` (114 calls): the API call that carried the 6.7 MB file spent a mean 4.8 s (1.9–7.9 s) parsing the request body before `inventory_apply_sync` even started, most of the 8-second limit (the function itself needs about 0.8 s). `0307` adds `inventory_apply_sync_body(jsonb)`, a single unnamed `jsonb` parameter, so PostgREST passes the body whole; options travel in `meta`; it calls the existing `inventory_apply_sync` unchanged; service role only. Edge Function v23 calls it, with a fallback to the old call if the function is missing (remove the fallback later). Applied live and registered as `0307` on 17 Nov 2026; the live function body hash equals the file. First figures (6 calls, 17 Nov): mean 2.4 s, slowest 3.6 s, against a mean of 4.8 s and a slowest of 7.9 s before; five scheduled syncs in a row succeeded. Still to check after a few days at :00: failed rows in `inventory_sync_log`, and that the slowest call stays well under the 8-second limit.

**Process note (17 Nov):** while pushing the all-screens work to `main`, a merge of `main` (e-bill Phase 3, which added an offline service worker with a precache list of app files) landed in my tree between my last check and the push, and I pushed without running the gates on that merged tree. `main` was red for about ten hours (a unit test requires the precache list to be current; my new files were missing). Fixed by regenerating the list (`node tools/sw-precache.mjs`) and pushing again; CI is green. Rule from now on: run the full gates after the last merge and immediately before every push to `main`, and re-run `node tools/sw-precache.mjs` whenever files are added to the app.

### Owner decisions (14 Nov 2026) and what came of them

1. **INV-17, "not sold" headline: whole packs only.** One definition everywhere: the headline equals the Stock Ledger's Never Sold list plus its Dead Stock list for the same window (pack size usable, received date, whole packs only, value = whole packs × price). The old app's looser headline is retired (`domain/metrics.js`); a test proves the headline always equals what the two lists add up to, for every window. Default window 60 days (INV-10).
2. **INV-18, keep the raw pack signal (option b): built.** `0305` adds `pack_valid` (stock group, in the row hash, last column `packValid` of the stock feed). The Edge Function sends it (true when the file's pack size is a real number above zero); `conversion_factor` is unchanged (1 when missing), so existing readers keep working. The ledger treats `packValid: false` as a pack issue; the screen says "pack size unknown" instead of inventing a pack breakdown.
   **Finding on the live data:** after the first full pass only **one** active product has an unusable pack size in the Candela file (stock worth Rs 69,300). The 2,706 in-stock products with pack size 1 (Rs 14.0M) really are single-unit packs, so the Dead Stock and Never Sold numbers were sounder than the earlier worry suggested. The flag now guards every future sync.
3. **Go live:** merged to `main` on 14 Nov 2026 by the Inventory session on the owner's instruction, after every gate passed on the merged tree.

### Owner decisions (17 Nov 2026)

1. **INV-19, exports: Excel, PDF and CSV on Stock Ledger, Reorder and Excess Working.** Excel has values only, no formulas (the old app's formulas are not carried over); PDF goes through the browser's print dialog, landscape, first 1,500 rows with a note pointing to the Excel file; CSV is unchanged. Built (`domain/xlsx.js`, `ui/export.js`, `ui/print.js`).
2. **INV-20, Home shows a Stock row:** stock value, to reorder, not selling, excess, each opening the page that explains it, for people with `inventory.view`. If the call fails the row is left out and the rest of Home is unchanged. Built (three small Foundation files, changed with the owner's approval: `home/data/api.js`, `home/domain/cover.js`, `home/ui/page.js`).
3. **INV-21, hourly sync stays at minute 0.** Minute 7 was tried for a few hours on 17 Nov and reversed on the owner's instruction (see "Cron history" above).

### Requests for Foundation (I may not edit these files)

- **Sign-out hook for modules.** `js/core/auth.js` has no way for a module to clear its own storage at sign-out (MODULES.md rule 9). Inventory listens to the auth `SIGNED_OUT` event from `status.js` and also discards a copy that belongs to someone else, which works but depends on `status.js` having loaded in that tab. A real hook (for example `registerSignOutCleanup(fn)` called by `signOut()`) would be cleaner.
- **A box icon** in `js/shared/icons.js` (Inventory uses `shield` until then, like Closing).

### First check on a phone (live from the merge to `main`; Pages publishes about a minute after CI passes)

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
1. **A separate `str` module** (`str_` prefix, route `/str`, migrations 0500–0599), reusing what Inventory already provides: supplier and pack factor from the local product copy, no extra download. STR has since been added to `js/modules/index.js` and the module registry; its current state and remaining acceptance work are summarized in `docs/MODULE_PROGRESS_REGISTER.md`.
2. **`str.view` is the permission for every STR viewing screen** (list, detail, Report, Zero Dispatch). The current read policy on the STR tables requires `str.approve` (a different meaning: approving requests); the STR module's first migration seeds `str.view`, moves the two read policies to it (wrapped form), and adds the permission to no role template until the owner decides.
3. **Approved:** a small database function `inventory_in_transit()` (security definer, `inventory.view`) returning code and packs only, so Reorder works for people who hold `inventory.view` but not `str.view`. It belongs to the Reorder slice (I-C) and goes in the 0300 range.

## Still to do (next sessions)

Inventory is complete (I-A to I-D): the feed, six screens, the Home stock numbers and the Excel / PDF / CSV exports are live on `main`. The owner reported on 17 Nov 2026 that everything was checked and works. Because the Home and export code had first been merged into the wrong branch (see the RUNBOOK incident log) and was then re-merged to `main`, it is worth one more look on the live site that the Home Stock row and the Excel / PDF / CSV buttons are present.

Small items that remain:
1. After a few clean days at minute 0, remove the old-call fallback in `supabase/functions/sync-inventory-from-dropbox/index.ts` (a small edit, then redeploy and update the version here).
2. Check `inventory_sync_log` for failed rows a few days after 17 Nov, and that the slowest `inventory_apply_sync_body` call stays well under the 8-second limit.
3. Find out when Candela writes the Dropbox file; it is still unknown.
4. Consider an owner alert after repeated failed syncs (today the feed watchdog alerts after 3 hours without a success).
5. Historical branch note (superseded 21 Nov 2026): the current GitHub list contains `main` plus the documentation audit branch and the already-merged PR #55 branch ref. No unmerged Inventory work was identified; see `docs/MODULE_PROGRESS_REGISTER.md`.

## Handoff
See the brief, §10.

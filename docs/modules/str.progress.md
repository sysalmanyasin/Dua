# STR — progress

Branch `module/str`. Live project: `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`). **Nothing is applied live.**

## Session S-0 / S-A / S-B (14 Nov 2026)

| Step | What | State | Tested |
|---|---|---|---|
| S-0 | Branch from `origin/main` (`c86e1c0`), `npm ci`, `npm run verify`, full database suite | done | 436 unit tests; all database checks |
| S-A | `js/modules/str/domain/`: `pack.js`, `group.js`, `filter.js`, `zero.js`, `report.js` (pure, no DOM, no network) | done | 51 unit tests in 3 files; 2 mutations caught (zero-dispatch comparison flipped, `floor` changed to `round`) |
| S-B | Migrations `0500`–`0504` with a test file each | done, **ready to apply, not applied** | 0500: 19 checks, 0501: 30, 0502: 41, 0503: 18, 0504: 17; 2 mutations caught (overdue threshold, search permission check); full suite `ALL DATABASE TESTS PASSED` |
| — | Manifest, data layer, screens, `css/str.css`, `MODULE_IDS` entry | **not started** (next slice) | — |

Totals after merging `main` at `72890ff` (Closing Session D): 538 unit tests (`npm run verify` green), full database suite green.

## Ready to apply (owner says when; by hand, in this order, registered under the repo number: RUNBOOK §4)

1. `0500_str_view_access`
2. `0501_str_archive` (also runs one archive copy at the end)
3. `0502_str_views_search`
4. `0503_str_overdue`
5. `0504_str_interfaces`

Before applying: check the connected project is `DuaPharmaPlus`; check `now()` immediately before each apply; never let a tool invent a timestamp version. After applying: RLS on `str_archive_headers` and `str_archive_lines`, no grants to `anon`, `select cost_price` refused for a signed-in user, the two guarded cron jobs exist (`str-archive-hourly`, `str-overdue-check`) if `pg_cron` is present.

**Order against Inventory:** `0500` is safe with or without Inventory's `0301` (it drops and recreates the same two policies). Inventory's `0301`–`0304` are live but their source is still on `module/inventory`; do not re-apply them.

## Decisions and behaviour worth knowing

- Zero Dispatch: dispatched or received STRs; loose units; null dispatch = 0; Hide 0-Dispatch uses the same rule (STR-5).
- Retention is **1 month** (setting `str.history_months`, whole months, clamped 1–24).
- Overdue alert: both directions; from the end of the day after the STR date; 09:00, 13:00, 17:00, 21:00 Pakistan; one summary alert per slot, stops when Received or Closed. Live feed only.
- In transit: incoming, dispatched, not received, not closed, loose dispatch qty above 0, summed by code; live feed only.
- Cost: never selectable directly; `str_line_costs()` needs `str.view` + `inventory.view_cost`; `str_cost_by_code()` needs `inventory.view_cost`.
- `str.create` and `str.approve` are unused. `str.create` is still in the junior and senior presets (Foundation's `0001`), harmless but untouched.

## Requests to others (nothing blocks the next slice)

| To | Request |
|---|---|
| Inventory | **D1** `inventory_product_meta(p_codes text[])`: `code, supplier, conversion_factor, found`, max 500 codes, `inventory.search`, active products only. Reorder's in-transit can call `str_in_transit_lines()` (loose qty by code) instead of reading STR tables. Cost: fill Inventory's own cost data from `str_cost_by_code()` |
| Foundation | Wording for notification kind `str.overdue` (`supabase/functions/_shared/ntfy.ts`, `js/shared/alerts.js`); `str` in `MODULE_IDS`; one `<link>` for `css/str.css`; registry row to Building |

## Files changed

`docs/modules/str.md`, `docs/modules/str.progress.md`, `js/modules/str/domain/{pack,group,filter,zero,report}.js`, `supabase/migrations/0500`–`0504_*.sql`, `supabase/tests/0500`–`0504_*_test.sql`, `tests/unit/str-{domain,filter,zero-report}.test.js`, `tests/fixtures/str-cases.json`.

## Next

S-C: manifest, `data/` (reads through `str_v_*`, `str_search_headers`, D1 stand-in inside the module's own tests), `/str` list and `/str/detail`, print; then owner phone try-out #1. Then S-D: Report and Zero Dispatch with per-person column choices (`user_prefs`).

## Handoff

Merge `origin/main` first, run `npm ci && npm run verify` and `bash supabase/tests/run.sh`. Do not apply migrations without the owner's word. A token pasted in chat counts as exposed; never store it, and revoke it at the end.

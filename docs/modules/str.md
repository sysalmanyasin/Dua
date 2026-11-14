# STR (Stock Transfer Requests) — brief

Status: **Building** — domain maths and database written, nothing applied live · Owner approval: go given 14 Nov 2026 (answers of 13/14 Nov recorded below)
Branch: `module/str` · Migration range: `0500`–`0599` · Prefix: `str_` · Permissions: `str.*` · Route: `/str` · Nav order: 60
Depends on: core, Inventory published interfaces.

> Read `docs/MODULES.md` first. Domain maths and migrations `0500`–`0504` are written and tested; **none has been applied to the live project**. Screens are not built yet. Progress: `docs/modules/str.progress.md`.

## 1. Scope

STR is a **read-only** module over Candela's stock transfer records. It browses transfers (Awaited → Dispatched → Received), shows detail and reports, lists zero-dispatch lines, prints, keeps a 6-month history, and raises overdue-receipt alerts.

It does **not** create, edit or approve transfers (STR-1). Products, supplier and pack factor belong to Inventory. Notifications are delivered by Foundation's `notify_owner`.

## 2. Old-app source

`sysalmanyasin/BT-Sale-Data2` `js/str/` (`str-shared.js`, `str-bridge.js`, `str-native.js`, `str-report-native.js`, `str-zero-dispatch.js`). Data arrives through the Inventory feed into `str_headers` and `str_line_items` (`0009`), a rolling 7-day window that is deleted and reinserted every sync.

## 3. Rules

| # | Rule | Tag |
|---|---|---|
| R1 | Stage: `received` if `receive_status='Received'`; else `dispatched` if `dispatch_status='Dispatched'`; else `awaited`. `str_status` (Open/Close) is not used. Defined once in SQL (`str_stage`) | KEEP |
| R2 | Direction `out` = Bahria Town (BT) dispatches; `in` = BT receives | KEEP |
| R3 | Pack qty = `floor(loose / factor)`; factor missing, ≤ 0 or non-finite → 1; null stays null | KEEP |
| R4 | Supplier group from the product; unknown code → "Unassigned Supplier", factor 1; groups by name, rows by code (numeric-aware) | KEEP |
| R5 | Difference = dispatch pack − receive pack; blank if either is null; red negative, green positive | KEEP |
| R6 | List filters: stage, branch chip (dispatched from BT / received at BT), date range on `str_date`; newest first (date, then id) | KEEP |
| R7 | **Search by product code, product name and STR number** (STR-8). The old search over ref no., comments, issued/dispatched/received by and branch names is kept | IMPROVE |
| R8 | Detail: old header fields only (STR-4); supplier groups with subtotals and grand total of STR and dispatch pack qty; comments; prev/next; print without a signature block. **No receive total** (STR-8) | KEEP |
| R9 | Report: Dispatch Branch → STR → Supplier → lines; column picker; **Hide 0-Dispatch uses the R10 rule** (so an Awaited STR's lines are no longer hidden, and a line with STR qty 0 is no longer hidden); print | KEEP / CHANGED |
| R10 | **Zero Dispatch (STR-5, final 14 Nov):** an STR in stage *dispatched* **or** *received* (not awaited). A line counts when its STR qty is above 0 and its dispatch qty is 0, in **loose** units; a null dispatch counts as 0. A partial dispatch (above 0, below the STR qty, even below one pack) is **not** zero dispatch. Per line; empty STRs and supplier groups disappear; per-STR checkbox, unchecked by default, print ticked only | CHANGED by owner |
| R11 | Column and Hide-0-Dispatch choices kept per person in `user_prefs` (not per device) | IMPROVE |
| R12 | "Data as of" comes from `inventory_latest_sync()` | IMPROVE |
| R13 | Browser `select *`, anonymous reads, localStorage cache of the whole data set | DROP |
| R14 | No audit log of views or prints (STR-6) | DECIDED |
| R15 | In Transit = dispatched to BT (`direction='in'`) and not received; counts as In Transit stock for Inventory/Reorder | KEEP |

## 4. Structure (as written)

STR is a reader of the feed tables. It never writes to `str_headers` or `str_line_items`. No foreign key points at them (the feed rewrites them hourly).

| Migration | Content |
|---|---|
| `0500_str_view_access` | Seeds `str.view` (no role preset). Moves the two feed read policies from `str.approve` to `str.view` (wrapped form). Revokes plain `select` on `str_line_items.cost_price` (column-level grants for the rest) |
| `0501_str_archive` | `str_stage()` (the one lifecycle definition); `str_archive_headers`, `str_archive_lines` (own tables, RLS on, no direct writes, no `cost_price` for plain reads); setting `str.history_months` = 1; `str_archive_sync()` (newest version wins, lines replaced per STR, a header with no lines never wipes kept lines); `str_archive_prune()`; guarded hourly cron `str-archive-hourly` at :20 |
| `0502_str_views_search` | `str_v_headers`, `str_v_lines` (`security_invoker`; feed rows plus archived STRs that left the feed); `str_search_headers()` (server search and paging, 50 rows max; words found in header fields or in product code/name); `str_line_costs()` (needs `str.view` and `inventory.view_cost`) |
| `0503_str_overdue` | `str_overdue_check()` and guarded cron `str-overdue-check` at 04, 08, 12, 16 UTC (= 09, 13, 17, 21 Pakistan) |
| `0504_str_interfaces` | `str_in_transit_lines()` and `str_cost_by_code()` for Inventory |

History: kept for one month by default (STR-3, owner 14 Nov); the owner can change `str.history_months` through `settings_set`. It starts accruing at the first archive run; nothing older than the feed holds can be recovered, and nothing is imported from old apps. Owner note: Candela's export carries only a few days (the feed file names say 7, the owner says 4) — the code does not depend on the exact number.

## 5. Permissions

| Key | Meaning | Presets |
|---|---|---|
| `str.view` (new) | Open every STR screen, search, print | **None.** The owner has everything and grants it to individual staff by choice (STR-2) |
| `inventory.search` | Needed to resolve supplier and pack factor | existing |
| `inventory.view_cost` | See cost columns | existing, owner only |
| `str.create`, `str.approve` | **Unused** (STR-1). `str.create` is already in the junior and senior presets; the STR module never checks it | untouched |

## 6. Screens

All phone first; tokens and shared components only; no `innerHTML`.

| Route | Content |
|---|---|
| `/str` | List: status line ("N STRs · data as of hh:mm"), search, stage buttons, two branch chips, date range, rows (STR no., master, date, From → To, stage badge, comments, item count). Default view is the live window; older history is fetched on search or a wider date range |
| `/str/detail?id=` | Detail with prev/next and print |
| `/str/report` | Report with column picker, Hide 0-Dispatch, print |
| `/str/zero-dispatch` | Zero Dispatch with checkboxes, select all/none, print selected |

Print uses a print layout and the browser's Save as PDF, with a small local print helper (Sales' cannot be imported).

## 7. Interfaces

**Consumed from Inventory**
- `inventory_latest_sync()`: exists.
- **D1 `inventory_product_meta(p_codes text[])`: MISSING.** Returns `code, supplier, conversion_factor, found` (max 500 codes, `inventory.search`, inactive products ignored). `inventory_search` is text-based and capped at 50 rows; `inventory_balances` has no supplier or factor.

**Published by STR (`0504`)**
- `str_stage()`: the single lifecycle definition.
- `str_in_transit_lines()`: code and loose dispatch qty for incoming dispatched-not-received STRs, from the live feed only. Inventory applies its own factor, so Inventory never reads STR tables itself.
- `str_cost_by_code(p_since)`: latest known cost per product code, so **Inventory can fill its own cost column over time** (STR-7). STR never writes into Inventory tables.

**Foundation requests**
- Wording for the notification kind `str.overdue` in `supabase/functions/_shared/ntfy.ts` and `js/shared/alerts.js` (generic text until then).
- `str` in `MODULE_IDS`, one `<link>` for `css/str.css`, registry status change.

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| STR-1 | Read-only module. No STR creation or approval. `str.create` and `str.approve` stay unused | Accepted (owner, 13 Nov 2026) |
| STR-2 | The owner has full permissions and may grant `str.view` to staff by choice; no preset | Accepted |
| STR-3 | Keep history in Dua, fetched only when needed or searched. **Retention: 1 month** (owner 14 Nov; first said 6 months, then "up to 1 month"; changeable by setting) | Accepted |
| STR-4 | Keep the old header; no extra fields (driver, vehicle, consignment, weight, carton) | Accepted |
| STR-5 | Zero Dispatch rule R10 (dispatched or received STRs; loose units; null dispatch = 0; Hide 0-Dispatch uses the same rule) | Accepted (owner, 14 Nov) |
| STR-6 | No audit log for STR | Accepted |
| STR-7 | Keep `cost_price`, visible only with `inventory.view_cost`; Inventory fills its own cost data over time from STR's `str_cost_by_code` | Accepted (owner, 14 Nov) |
| STR-8 | Search by product code, product name and STR number; no receive total | Accepted |
| STR-9 | Overdue alert: **both directions**; overdue from the end of the day after the STR date (1 Nov → overdue at the start of 3 Nov); alerts **only at 09:00, 13:00, 17:00 and 21:00 Pakistan time**, one summary alert per slot; continues until the STR is Received or Closed. Ids, count and a date only | Accepted (owner, 14 Nov) |
| STR-10 | Dispatched-not-received incoming STRs count as In Transit stock. STR **publishes** `str_in_transit_lines()` (loose qty by code); Inventory applies its own pack factor | Accepted (owner, 14 Nov) |

## 9. Assumptions and limits to confirm on a phone

- **Overdue and in-transit read the live feed only.** An STR that has left Candela's export has no known status, so it stops alerting and stops counting as In Transit, even if it was never received. (The archive would show it frozen at its last known status.) Say if you want a "left the feed unreceived" list instead.
- Alerts can lag a real receipt by up to one sync hour.
- A cost is "the newest nonzero cost by STR date"; a zero cost means unknown.
- `Closed` is recognised as `str_status` starting with "close" (any capitalisation).
- Notification wording for kind `str.overdue` is generic until Foundation adds it (`supabase/functions/_shared/ntfy.ts`, `js/shared/alerts.js`).
- Pack maths floors in JS; the shared fixture uses whole-number factors only (SQL numeric is exact, JS floats are not).
- `inventory_product_meta(p_codes)` (D1) is still a request to Inventory. Screens will be built against a stand-in inside the module's own tests.

## 10. Slices (nothing started)

1. S-0 housekeeping: **done** (`main` at `c86e1c0`).
2. S-A `domain/` ports with golden fixtures: **done** (51 tests).
3. S-B database `0500`–`0504` with tests and mutation checks: **done, not applied live**.
4. S-C data layer, manifest, `/str` and `/str/detail`; phone try-out #1.
5. S-D Report and Zero Dispatch, preferences, print; phone try-out #2.
6. S-E wire the archive/search screens, Foundation wording for the alert, owner applies the migrations.
7. Definition of done (MODULES §11), then only the owner marks Accepted.

## 11. Handoff

The first session must: merge `origin/main`, run `npm ci && npm run verify` and `bash supabase/tests/run.sh`, check the connected project is `DuaPharmaPlus`, never apply a migration without the owner's word (RUNBOOK §4, hand-apply under the repo number), and never store or commit a token. A token pasted in chat counts as exposed: revoke it at the end of the session.

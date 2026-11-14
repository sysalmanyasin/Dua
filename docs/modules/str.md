# STR (Stock Transfer Requests) — brief

Status: **Briefed** (awaiting owner "go" for implementation) · Owner approval: partial (answers of 13 Nov 2026 recorded below)
Branch: `module/str` · Migration range: `0500`–`0599` · Prefix: `str_` · Permissions: `str.*` · Route: `/str` · Nav order: 60
Depends on: core, Inventory published interfaces.

> Read `docs/MODULES.md` first. Nothing in this brief is implemented yet. No migration has been written, none applied to the live project.

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
| R9 | Report: Dispatch Branch → STR → Supplier → lines; column picker; Hide 0-Dispatch; print | KEEP |
| R10 | **Zero Dispatch (STR-5):** only STRs in stage *dispatched*. A line counts as zero dispatch only when its dispatch qty is 0 while STR qty > 0. A partial dispatch (dispatch > 0 but below STR qty) is **not** zero dispatch. Per line; empty STRs and supplier groups disappear; per-STR checkbox, unchecked by default, print ticked only | CHANGED by owner |
| R11 | Column and Hide-0-Dispatch choices kept per person in `user_prefs` (not per device) | IMPROVE |
| R12 | "Data as of" comes from `inventory_latest_sync()` | IMPROVE |
| R13 | Browser `select *`, anonymous reads, localStorage cache of the whole data set | DROP |
| R14 | No audit log of views or prints (STR-6) | DECIDED |
| R15 | In Transit = dispatched to BT (`direction='in'`) and not received; counts as In Transit stock for Inventory/Reorder | KEEP |

## 4. Structure (revised after owner answers)

STR is a reader of the feed tables. It never writes to `str_headers` or `str_line_items`. Its own tables and functions:

| Migration | Content |
|---|---|
| `0500_str_view_access` | Seed `str.view` (no role preset). Replace the two feed read policies (today `str.approve`) with `(select public.has_perm('str.view'))`. Keep `cost_price`, gated (see C3) |
| `0501_str_stage_views` | `str_stage(dispatch_status, receive_status)`; `str_v_headers` and `str_v_lines` (`security_invoker`) = live window ∪ archive rows not in the window |
| `0502_str_archive` | `str_archive_headers`, `str_archive_lines` (own tables, RLS on, no FK to the feed, no direct writes); `str_archive_sync()` upserts from the feed (latest version wins); `str_archive_prune()` keeps 6 months by `str_date`; guarded hourly pg_cron job (skips where `pg_cron` is absent, no secret in Git) |
| `0503_str_search` | `str_search_headers(...)`: server-side search and paging (limit 50) by STR number, product code and product name, with stage/branch/date filters. Older STRs are fetched only when asked for or searched |
| `0504_str_overdue` | `str_overdue_check()` plus guarded cron; raises `notify_owner('str.overdue', …)` (see STR-9) |
| `0505_str_interfaces` | `str_in_transit_lines()` and `str_cost_by_code(p_since)` for Inventory (see section 7) |

History starts accruing at the first archive run. Nothing older than the 7-day window can be recovered, and nothing is imported from old apps. Expected size: about 4,000 headers and 48,000 lines for six months (roughly 8–10 MB).

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

**Published by STR**
- `str_stage()`: the single lifecycle definition.
- `str_in_transit_lines()`: code and loose dispatch qty for incoming dispatched-not-received STRs, from window ∪ archive. Inventory applies its own factor (proposed replacement for Inventory reading STR tables itself, see C4).
- `str_cost_by_code(p_since)`: latest known cost per product code, so **Inventory can fill its own cost column over time** (STR-7). STR never writes into Inventory tables.

**Foundation requests**
- Wording for the notification kind `str.overdue` in `supabase/functions/_shared/ntfy.ts` and `js/shared/alerts.js` (generic text until then).
- `str` in `MODULE_IDS`, one `<link>` for `css/str.css`, registry status change.

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| STR-1 | Read-only module. No STR creation or approval. `str.create` and `str.approve` stay unused | Accepted (owner, 13 Nov 2026) |
| STR-2 | The owner has full permissions and may grant `str.view` to staff by choice; no preset | Accepted |
| STR-3 | Keep 6 months of history; staff screens fetch history only when needed or searched | Accepted |
| STR-4 | Keep the old header; no extra fields (driver, vehicle, consignment, weight, carton) | Accepted |
| STR-5 | Zero Dispatch rule R10 | Accepted (details in C1) |
| STR-6 | No audit log for STR | Accepted |
| STR-7 | Keep `cost_price`; Inventory fills its own cost data over time from STR's `str_cost_by_code` | Accepted (details in C3) |
| STR-8 | Search by product code, product name and STR number; no receive total | Accepted |
| STR-9 | Overdue alert: first alert at 09:00 on the first morning the STR is overdue, then every 4 hours while still not received (owner example: created 1 Nov, still not received at the start of 3 Nov → alert at 09:00 on 3 Nov). Each 4-hour slot is its own notification (`dedupe_key` includes the slot), payload ids and dates only | Accepted in principle (details in C2) |
| STR-10 | Dispatched-not-received incoming STRs count as In Transit stock | Accepted; STR builds against a stub of D1 first (C4) |

## 9. Clarifications still needed (asked in chat, 14 Nov 2026)

- **C1 (STR-5):** Does "dispatched" mean stage *dispatched* only (excluding *received* STRs whose line still shows dispatch 0)? Is the test on loose units (my default: dispatch loose = 0, STR loose > 0) rather than pack-rounded values? Is a null dispatch qty inside a dispatched STR treated as 0? Should the Report's Hide 0-Dispatch use the same definition?
- **C2 (STR-9):** Which STRs: incoming only (BT is waiting), or outgoing too? "Not received after 24 hours": my reading is overdue from the end of the day after `str_date`, so the first alert is 09:00 the morning after that. Should alerts run through the night or only in set hours (my default: 09:00, 13:00, 17:00, 21:00 PKT)? Stop after some days (the feed and archive mean STRs vanish from the window)? Note alerts can lag a real receipt by up to one sync hour.
- **C3 (STR-7):** Cost stays visible only to `inventory.view_cost` holders (owner by default)? The cost-fill into Inventory's table is Inventory's work, built on `str_cost_by_code`; STR cannot write it.
- **C4 (STR-10):** Build against a stub of D1 first (my recommendation), and let STR publish `str_in_transit_lines()` instead of Inventory reading STR tables?
- **C5 (STR-3):** Archive keeps the last seen version of each STR; an STR that vanishes from Candela stays in the archive until it is 6 months old. Acceptable?

## 10. Slices (nothing started)

1. S-0 housekeeping (done: `main` at `c86e1c0`, 436 unit tests and the full database suite pass).
2. S-A `domain/` ports with golden fixtures (invented data), including the new R10.
3. S-B `0500`–`0501` plus DB tests and mutation checks.
4. S-C data layer, `/str` and `/str/detail`; phone try-out #1.
5. S-D Report and Zero Dispatch, preferences, print; phone try-out #2.
6. S-E `0502`–`0505`, archive, search, overdue alert, interfaces.
7. Definition of done (MODULES §11), then only the owner marks Accepted.

## 11. Handoff

The first session must: merge `origin/main`, run `npm ci && npm run verify` and `bash supabase/tests/run.sh`, check the connected project is `DuaPharmaPlus`, never apply a migration without the owner's word (RUNBOOK §4, hand-apply under the repo number), and never store or commit a token. A token pasted in chat counts as exposed: revoke it at the end of the session.

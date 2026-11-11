# Inventory — brief (includes Foundation task F3, the inventory feed)

Status: **Briefed** (awaiting owner approval) · Owner approval: no
Branch: `foundation/inventory-feed` for F3, then `module/inventory` · Migration ranges: feed in `0001–0099` (Foundation), screens in `0300–0399` · Prefix: `inventory_` · Permissions: `inventory.*` · Route prefix: `/inventory` · Nav order: 40

> Read `docs/MODULES.md` first, especially §8.4 (inventory is **latest-only**).

## 1. Scope

**Part A — the feed (F3, built first, no screens).** Candela stays the source of truth (D-07). Data flows:

```
Candela PC export script  →  Dropbox  →  Edge Function (one Dropbox token)  →  inventory tables in the Dua project
```

Dua keeps **only the latest stock**. Each sync replaces the product rows; there is no history and no dated snapshot.

**Part B — the screens** (after Part A), from the old BT app:

- Inventory overview (search and list)
- Stock Ledger (includes the "100-Day Excess" view)
- Excess Working (pack-corrected excess)
- Reorder Report (30 / 60 / 90 day windows, cover-days threshold, top-N)
- Inventory Health dashboard
- Product search for other modules (published interface)

Out of scope: STR (its own module), the standalone Inventory Search PWA with AI chat (later, with the AI module), Android widgets, the Audit Hub counting workflow (Audit module).

## 2. Old-app source

- BT-Sale-Data2 `js/inventory/` (`stockledger.js`, `excess-working.js`, `reorder-data.js`, `reorder-report.js`, `reorder-table.js`, `reorder-export.js`, `inventory-health-dashboard.js`, `inventory-native.js`, `inventory-bridge.js`), `js/shared/inventory-metrics.js`, `js/shared/planning-metrics.js`, `js/shared/summary-calc.js`.
- Random repo `supabase/schema.sql` (section "SHARED INVENTORY") and `supabase/barcode-schema.sql`.
- BT-Sale-Data2 `inventory-search/` (reference only for now).
- **Not in any repo (F3 step 1 must get them):** the deployed Edge Function `sync-inventory-from-dropbox` (download its source from the Supabase dashboard of the project it runs in), the **live** `inventory_products` table definition, and the Candela-side export script (`sync.ps1`).

## 3. Rules

| # | Rule | Tag |
|---|---|---|
| I1 | **Latest only.** A sync replaces the product rows in one transaction, so readers never see a half-finished sync. One row in `inventory_sync_log` records when and how many | KEEP (owner, 9 Nov 2026) |
| I2 | Candela's export already carries, per product: code, name, stock qty, unit price, company, generic, supplier, conversion factor (pack size), creation date, last receive date, last sale date, net quantity for the last 30 / 60 / 90 days and today, sale value including and excluding tax for the same windows, tax percent, taxable flag. Stock Ledger, Excess, Reorder and Health all compute from these | KEEP (confirm against the live table) |
| I3 | **Never Sold:** has stock, no sale record, received more than 60 days ago. **Dead Stock:** has a sale record, none in 60 days, received more than 60 days ago | KEEP (BUSINESS_RULES §8) |
| I4 | **Excess** = stock − (net 90-day quantity ÷ 90 × 100), only when net 90 > 0 and stock ≥ 4; default view is 90+ days cover | KEEP |
| I5 | **Pack correction:** quantities round down by the conversion factor; missing or invalid factor falls back to 1. Excess Working then classifies Retained / Loose / Excess and applies a misc buffer | KEEP (read `excess-working.js`) |
| I6 | **Reorder:** windows 30 / 60 / 90 days; "less than N days stock" threshold (default 15); top-N list; inbound STR lines in the Dispatched stage count as In Transit | KEEP (STR input arrives later; use a stub) |
| I7 | "Not sold in N days" must have **one shared definition** (old `inventory-metrics.js`); do not duplicate it per screen | KEEP |
| I8 | Cost/price visibility is gated by `inventory.view_cost` | KEEP |
| I9 | The old Health page kept a small per-device "reorder value over time" trend in the browser. With latest-only data it has no server history | **ASK:** drop it, or keep per device |
| I10 | Sync runs every hour, scheduled | Decided (INV-4) |
| I11 | `price` is the retail price | Decided (INV-5) |

## 4. Structure

Proposed (the session confirms from the live table before writing the migration):

- `inventory_products` — latest rows, columns as in I2. No dated copies. RLS: readable with `inventory.search`; cost columns only through a function/view that checks `inventory.view_cost`. Index on `code`.
- `inventory_sync_log` — one row per sync: time, row count, source, result.
- Function `inventory_apply_sync(p_rows jsonb, ...)` — service-role only (called by the Edge Function); replaces rows atomically and writes the log row. A **failed sync must leave the old data in place** and record the error.
- Edge Function `sync-inventory-from-dropbox` — rebuilt in this repo. **The Dropbox token and any shared secret live only in Edge Function secrets, never in Git.** Add the folder to the CI type-check loop (MODULES.md §3.2).
- Free-tier note (MODULES.md OD-7): row count × columns is the only size driver now. Record the row count and table size in the progress file after the first real sync.

## 5. Permissions

Existing, reserved: `inventory.search`, `inventory.view_cost`. New (suggested, with owner approval): `inventory.view` (reports and ledgers), `inventory.sync` (trigger a sync by hand). Presets already give junior/senior `inventory.search`.

## 6. Screens (layout)

Old layout is the guide; phone first. Routes under `/inventory`:

1. `/inventory` — overview: search box (code, name, generic, company, supplier), grouped list, "last synced" pill (also a status-bar pill via `status.js`).
2. `/inventory/ledger` — Stock Ledger with its tabs (including 100-Day Excess); export.
3. `/inventory/excess` — Excess Working.
4. `/inventory/reorder` — Reorder Report (window, cover days, top-N, search, hide columns, export).
5. `/inventory/health` — Health dashboard (charts load only on this page; reuse the vendored Chart.js).
6. Owner-only: "Sync now" and sync history (last runs and results).

Heavy tables paginate or filter on the server (MODULES.md §6.6); the old app loaded everything on the phone, which the Free plan will not afford.

## 7. Interfaces (provided; names are proposals the session confirms)

| Function | Used by | Notes |
|---|---|---|
| `inventory_latest_sync()` | all | When data was last refreshed |
| `inventory_balances(p_codes text[])` | Closing | Current stock for given codes. Read-only |
| `inventory_search(p_text text, p_limit int)` | Audit, STR, Emergency Billing | Needs `inventory.search` |
| `inventory_products_for_scope(p_scope jsonb)` | Audit | Product list for an audit scope. Audit freezes its own copy at round lock, so it does not depend on history |

- **Consumes:** STR "in transit" quantities for the Reorder Report later (stub until the STR module exists).
- **Foundation requests:** none yet.

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| INV-1 | Inventory is latest-only; no dated snapshots | Accepted (owner, 9 Nov 2026) |
| INV-2 | Candela → Dropbox → Edge Function pipeline stays the same, moved into the Dua project | Accepted (owner, 9 Nov 2026) |
| INV-3 | Reorder-value trend (I9) | **Open** |
| INV-4 | Sync trigger and schedule (I10): scheduled every hour (pg_cron → Edge Function with the shared secret); manual "Sync now" needs `inventory.sync` | Accepted (owner, 9 Nov 2026) |
| INV-5 | Meaning of `price` (I11): it is the **retail** price, so it is not gated by `inventory.view_cost` | Accepted (owner, 9 Nov 2026) |
| INV-6 | The feed also lands Candela sales summaries and STR headers/lines (`0009_inventory_feed.sql`); screens for them belong to the Sales and STR modules | Accepted (owner, 9 Nov 2026) |

## 9. Slices

**Part A — Foundation F3**

1. **I1** Owner supplies the deployed function source, the live table definition and the Candela export script (without secrets). The session records the real column list here.
2. **I2** Migration: tables, RLS, `inventory_apply_sync`, security tests (a user without `inventory.search` reads nothing; a failed sync keeps old rows; two syncs in a row replace, not duplicate).
3. **I3** Edge Function in this repo, secrets in the dashboard, first real sync on staging; record row count and size.
4. **I4** Publish the interfaces of §7, with tests.

**Part B — screens**

5. **I5** Overview + search + "last synced" pill.
6. **I6** Stock Ledger (pure maths in `domain/`, tested with invented rows).
7. **I7** Excess Working.
8. **I8** Reorder Report (STR stub).
9. **I9** Health dashboard.

## 10. Handoff

**Part A (feed) is live in the Dua project** (9 Nov 2026).
- Migration `0009_inventory_feed.sql` applied; `sync-inventory-from-dropbox` deployed; hourly pg_cron job `inventory-hourly-sync` calls it with the shared secret kept in Supabase Vault (the SQL holds the secret, so it is not in Git).
- First real sync: 5,857 products (about 2 MB), 4 sales-summary days, 7 credit rows, 157 STR headers, 1,847 STR lines. Same counts as the old project.
- Secrets live only in Edge Function secrets: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, INVENTORY_SYNC_SECRET, ALLOWED_ORIGIN. The refresh token must be the `refresh_token` field, not the `access_token`.
- The deployed copy inlines `_shared/clients.ts` and `_shared/http.ts` into one file; the repo copy imports them.
- Next: slices I4 (interfaces `inventory_balances`, `inventory_search`, `inventory_products_for_scope`) and the Part B screens. Not yet built: the "Sync now" button (needs `inventory.sync`).

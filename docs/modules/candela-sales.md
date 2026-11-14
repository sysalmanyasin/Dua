# Candela Sales — brief

Status: Built, not yet accepted (owner phone try-out pending)        Owner approval: yes (13–14 Nov 2026)
Branch: module/candela-sales        Migration range: 0900–0999 (assigned by the owner, 14 Nov 2026)        Prefix: candela_        Permissions: candela.*

## 1. Scope

A separate Candela Sales module. It keeps every daily payment summary and every customer-wise credit summary that Candela sends, permanently, and shows them to the owner. Staff may see one number: today's total, in the status bar.

It does not create invoices, receipts, customer balances or an outstanding-credit ledger. Candela sends daily aggregates and customer/day aggregates only. The manual Sales module is not touched.

## 2. Source

Candela -> Dropbox `inventory.json` -> Edge Function `sync-inventory-from-dropbox` -> `inventory_apply_sync` -> landing tables `sales_payment_summary` and `sales_credit_by_customer`. The feed carries only the last 4 days and the apply function replaces the landing tables on every run. Those tables are therefore a rolling window, not history.

## 3. How history is kept (migration 0900)

- Statement-level triggers on the two landing tables copy every incoming batch into `candela_daily_payments` and `candela_credit_daily` in the same transaction as the sync. `inventory_apply_sync` and the Edge Function are not edited. A failed sync rolls the copy back with everything else.
- Only the days in a batch are touched. Older days are never deleted.
- A repeat of the same figures changes nothing. A changed figure updates the row, raises its `revision`, and keeps the old values in `candela_changes` (append-only).
- Customer rows: Candela sends only a name. The same name, ignoring case and extra spaces, is one customer (owner decision CS-5). Rows of one customer on one day are added together.
- The migration copies the landing tables' current rows into history the first time it runs.
- Nothing can write to the history tables except the triggers (no write grants, no write policies).

What cannot be derived: outstanding balances, invoice-level history, later repayments, or any day Candela never sent. Days before the first capture exist only in older backups; importing them would be a separate one-time job.

## 4. Permissions

- `candela.view`: owner. Reads all history, payment breakdowns, customer credit, corrections. No role preset carries it.
- `candela.today_total`: one number through `candela_today_total()`. The owner may grant it to a person. No role preset carries it. It gives no read access to any table.
- Admins hold both only with MFA, like every permission.
- `credit.view` and `sales.view_history` are not reused for Candela history tables.

## 5. Screens (all need `candela.view`)

- `/candela-sales` Overview: today, month so far, change against yesterday, last update from Candela.
- `/candela-sales/history` Daily History: date filter, cash/card/credit/total per day, "Corrected" marker.
- `/candela-sales/credit` Credit by Customer: date filter, name search, per-customer totals, tap for days.
- `/candela-sales/reports` Reports: monthly summaries, print / Save as PDF, corrections Candela made.
- Status bar pill "Candela today" for `candela.today_total` or `candela.view`.

## 6. Shared-core changes (owner-approved, 14 Nov 2026)

- `js/core/statusbar.js`: pills with `refreshMs` reload on a timer and when the app becomes visible; no overlapping requests; a failed refresh removes the pill; timers are cleared at sign-out. Pills without `refreshMs` behave as before.
- `js/core/shell.js`: status pills are offered from every usable module, so staff who hold only `candela.today_total` get the pill without a Candela tab.
- `docs/MODULES.md`: registry row and range 0900–0999.
- `index.html`: `css/candela.css` link. `js/modules/index.js`: module id.

## 7. Decisions

- CS-1 Preserve all payment summaries and customer credit summaries.
- CS-2 Keep history permanently; no automatic deletion.
- CS-3 Separate from the manual Sales module.
- CS-4 Staff may see only today's total.
- CS-5 (14 Nov 2026) Same customer name = one customer; rows merged.
- CS-6 (14 Nov 2026) Range 0900–0999 assigned to candela-sales. History is captured by triggers, so the Inventory-owned apply function is not edited.

## 8. Open

- Whether Candela's export has a customer ID. The deployed mapper sends only `customerName`; if an ID appears, the key could use it.
- Owner phone try-out.
- Optional: one-time import of days before the first capture, if a source exists.

## 9. Handoff

Migration 0900 must be applied by hand (RUNBOOK §4) and registered as `0900 candela_history`, never with a tool that invents a timestamp version. After applying: check RLS on the three tables, that `anon` has no grants, and that the next hourly sync adds days to `candela_daily_payments`.

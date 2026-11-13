# Candela Sales — brief

Status: Briefed        Owner approval: pending
Branch: module/candela-sales        Migration range: pending Foundation assignment        Prefix: candela_        Permissions: candela.*

## 1. Scope

Build a separate, owner-only Candela Sales reporting module using the existing imported daily payment summary and customer-wise credit summary.

The module will provide:
- Owner overview: today's total and cash/card/credit breakdown, month-to-date totals, previous-day comparison, trend, and latest successful feed sync.
- Daily Sales History: date filtering, daily and monthly totals, payment-method comparisons, and print/export.
- Credit Sales by Customer: customer search, date filtering, customer totals, receipt counts, and daily/monthly breakdown.
- Reports: daily/monthly summaries and payment-method/customer-credit analysis.

Preserve both daily payment summaries and customer credit summaries permanently. A sync may refresh only dates present in the incoming feed; dates outside the incoming payload must remain untouched. Repeated syncs must update existing keys rather than create duplicates. The entire feed apply remains atomic.

This module does not create invoices, receipt-level transactions, customer account balances, or an outstanding-credit ledger. The current Candela feed supplies daily aggregates and customer/date aggregates only. Outstanding balances and manual credit filing remain separate workflows.

The existing manual Sales module and its tables/screens remain unchanged.

## 2. Old-app / feed source

- Candela to Dropbox inventory.json to sync-inventory-from-dropbox Edge Function.
- Existing landing tables: public.sales_payment_summary and public.sales_credit_by_customer.
- Existing migration: supabase/migrations/0009_inventory_feed.sql.
- Existing feed payload window is currently short (four days); the module must not assume that payload itself is permanent history.

## 3. Rules

- KEEP: daily cash, card, credit and total sales summary.
- KEEP: daily customer-wise credit amount and receipt count.
- KEEP: all dates indefinitely in Dua after each successful sync.
- IMPROVE: sync updates only the dates supplied in the payload; it must not delete historical dates outside that window.
- IMPROVE: stable unique key for customer/day rows; use a Candela customer identifier if the feed exposes one, otherwise agree a normalized-name key before migration.
- KEEP: all-or-nothing sync transaction.
- KEEP: Asia/Karachi business-day interpretation.
- DROP: no individual invoice/receipt or line-item screens unless the source feed later provides those records.
- DROP: no representation of customer credit sales as outstanding customer balances.

## 4. Structure

Existing landing tables remain the source:
- sales_payment_summary: one row per sale_day, cash_sale, card_sale, credit_sale, total_sale, synced_at.
- sales_credit_by_customer: sale_day, customer_name, credit_amount, receipt_count, synced_at.

The module must use read-only database interfaces under RLS. No browser writes to feed tables. Historical retention is implemented in the inventory feed apply function, which is Foundation-owned; request a Foundation change rather than editing migration 0009 or the deployed Edge Function from this module branch.

## 5. Permissions

Proposed:
- candela.view: owner-only access to all Candela history, payment breakdowns and customer credit summaries.
- candela.today_total: staff-safe access to a single scalar for today's aggregate total only.

No staff role receives candela.view. Staff do not receive direct SELECT access to either detailed summary table. The staff status value must be returned by a narrow, permission-checked database function that exposes only today's total.

The existing credit.view permission is not reused for Candela customer summaries because it is shared with the separate credit-ledger workflow.

## 6. Screens

- /candela-sales: Owner overview.
- /candela-sales/history: Daily/monthly payment history.
- /candela-sales/credit: Customer-wise credit sales summary.
- /candela-sales/reports: Reporting and print/export.

All routes require candela.view. Staff receive no Candela Sales navigation or detail routes. Staff status-bar visibility is a separate, scalar-only capability.

## 7. Cross-module / Foundation requests

1. Assign an approved migration range and add the module row to the shared registry in docs/MODULES.md. The current table reserves 0900–0999 and does not yet define a Candela module range/prefix.
2. Update the Foundation-owned feed apply function so payment and customer summary rows are upserted for incoming dates, while dates outside the payload are preserved. Reconcile this with the enhanced live Inventory feed source before changing any deployed Edge Function or live migration.
3. Provide a staff-safe candela_today_total() interface with a dedicated permission check and no direct table access.
4. Provide a status-bar integration path that can refresh the scalar total on a timer and app focus. js/core/statusbar.js is Foundation-owned and currently refreshes only the clock; module status pills currently load once.
5. Confirm whether the feed includes a stable customer ID/code. If it does not, approve the exact customer-name normalization and uniqueness rule.

## 8. Decisions

- CS-1 (13 Nov 2026): Preserve all payment summaries and all customer credit summaries.
- CS-2 (13 Nov 2026): Keep history permanently; no automatic retention deletion.
- CS-3 (13 Nov 2026): Separate Candela Sales from the existing manual Sales module.
- CS-4 (13 Nov 2026): Staff may see only today's total in the status bar; all Candela history and customer details are owner-only.

## 9. Build order

1. Reconcile live Inventory feed v14 / migrations 0301–0304 with repository source; do not reapply already-live migrations.
2. Obtain Foundation approval for module registry entry, migration range, sync retention change and staff-safe status interface.
3. Implement schema/security and database tests.
4. Implement pure domain helpers and unit tests.
5. Implement read-only data layer and owner screens.
6. Implement staff scalar status pill through the approved Foundation interface.
7. Run npm run verify and npm run test:db; inspect CI; owner tests on a real phone.

## 10. Handoff

Do not modify the live sync Edge Function or apply database changes until the live Inventory v14 source has been reconciled with the repository. The owner has approved permanent retention of both summary datasets and the separation of Candela Sales from manual Sales. Foundation-owned files and migration ranges require explicit Foundation coordination.

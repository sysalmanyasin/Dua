# Database Design (Phase 1) — PostgreSQL, schema `public` unless noted

Conventions: `id uuid` PK · money `numeric(14,2)` · `created_at/updated_at timestamptz` UTC · `business_date date` (Asia/Karachi) wherever the day matters · soft-delete via `deleted_at` · every table RLS on · `created_by` references `staff`. Posted rows are never overwritten: corrections are new revision/reversal rows.

## core
- `staff` (id, full_name, phone, joined_on, active, notes) — persists forever.
- `profiles` (user_id → auth.users, staff_id, username, role_template admin|senior|junior, disabled_at, expires_at).
- `permissions` (key, description); `role_permissions` (role, key); `user_permissions` (user_id, key, effect grant|deny).
- `access_requests` (id, full_name, username, status pending|approved|rejected, requested_at, decided_by, decided_at); `setup_codes` (user, code_hash, expires_at, used_at).
- `settings` (key, value, version) + `settings_history` (restorable). Includes `till_float` (Rs 45,000 extra cash in hand), `per_customer_charge` (Rs 1), alert thresholds, retention.
- `activity_log` (id, at, user_id, action, entity, entity_id, old, new, reason, device) — append-only.
- `notifications` (id, to_user, kind, payload, read_at).

## sales
- `payment_methods` (id, code, label, section Cash|Banks|Credit Clients|Summary, sign add|sub|none, sort, active) — seeded with the 24 add + 7 subtract fields from BUSINESS_RULES §2; admin can add more.
- `daily_sales` (business_date PK, comp_sale, customers, fdpp_pos, fdpp_consumer, amount_received, load_sale, cash_to_deposit, low_sale_reason, **total**, **diff**, status, revision). `total`/`diff` written only by function `sales_save_day()`.
- `daily_sale_lines` (business_date, method_id, amount).
- `sales_targets` (month, target); view `monthly_sales` (sum of dailies).
- `cash_deposits` (business_date, amount, bank, slip_ref).
- `daily_checklist_items`, `daily_checklist_ticks`.
- Function `sales_last_closed_day()` → one row for staff (D-09).

## closing
- `closing_slots` (business_date, kind night|morning|evening|handover, seq, UNIQUE(business_date, kind, seq)).
- `closings` (id, slot_id, mode shift|final, status draft|submitted|superseded, revision, supersedes_id, responsible_staff_id, entered_by, idempotency_key UNIQUE, submitted_at, correction_reason).
  Inputs as real columns: `sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1..3, ret_system, book_bill_1, book_bill_2, extra_cash, credit_adj, prev_mediq, final_sys_returns` plus override flags for shift_sale, customers, curr_cc, prev_cash.
  Opening (carried) values stored with their source closing: `prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id`.
- Child tables (each with `deleted_at` for struck rows): `closing_hs_rows`, `closing_strip_lines` (strip_id, qty, price), `closing_cash_counts` (area till|vault, denomination, qty), `closing_credit_lines` (kind named|tier|free, account_id, label, amount), `closing_deposits`, `closing_mediq_orders` (bill_no, collected, pharmacy_bill; extra generated = collected − pharmacy_bill), `closing_misc_rows` (charge_id stable, label, amount), `closing_inventory_audit` (item_code, qty, verified).
- `closing_results` (closing_id PK, customers_charge, hs_total, strips_a, total_returns, mediq_extra, shift_sale, customers, net_sale, cc_curr, cc_total, till_c, vault_d, debt_e, deposits_f, misc_g, grand, liquid, net_cash, shift_variance, final_net_sale, final_net_cash, final_variance) — computed by `closing_compute()` at submit; formulas per BUSINESS_RULES §4–6.
- Lookup/config: `strips` (groups, price), `credit_accounts` (named accounts, tiers), `inventory_audit_items` (the 31 codes).
- Ledgers as views: `credit_ledger` (from closing_credit_lines per submitted closing), `misc_ledger` (by charge_id, with aging), `closing_book`, `register_book`, `cc_history`, `mediq_history`.
- RPCs: `closing_save_draft`, `closing_submit(key)` (checks audit verified, responsible staff, locks), `closing_correct(id, reason, changes)`.

## management
`salary_structures`, `payslips`, `petty_cash` (entry, kind, amount, business_date), `expenses`, `staff_credit`, `incentives`. Visible only with `mgmt.*`.

## audit (module Phase 7)
`audit_templates`, `engagements`, `rounds` (state draft|locked|counting|compiled|final), `assignments` (round, item/company, staff), `submissions` (assignment, counted_qty, method manual|barcode, idempotency_key), `variances`, `recounts`, `final_snapshots`, plus `racks`, `rack_assignments`, `expiry_entries`, `barcodes`. Counts immutable once submitted; recount = new row.

## inventory / str / pos — Candela is source of truth (D-07, confirmed)
 `inventory_snapshots` (as_of, product_code, name, qty, price, conversion_factor, last_receive_date, last_sale_date, net_qty_90d), `str_snapshots` (as_of, str_no, from/to, qty, dispatch_qty, status), import logs. V2 adds only: `stock_adjustments` (audit-driven, with reason), `emergency_bills` (+ items, payments, refunds with over-refund guard, idempotency key), held bills, and V2-originated STR requests with lifecycle events.

## documents / reports
`notes`, `sheets`, `files` (Storage), saved report definitions.

## History import (D-11)
Not part of the app. A separate `tools/import/` script loads old daily sales into `daily_sales` and `daily_sale_lines` through the same `sales_save_day()` function, tagged `source='import'`, idempotent by business_date.

## Indexes and growth
Index by `business_date`, `(slot_id)`, foreign keys, `(user_id)`. Seven years of daily sales ≈ 2,600 days × ~35 lines ≈ 90k rows — small. Closing child tables are the largest; partition not needed. Monitor against Free-tier storage.

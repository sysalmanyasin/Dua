# Candela Sales — progress

Last checked: 13 Nov 2026
Branch: module/candela-sales
Owner approval: yes (13 Nov 2026)
Status: Building — foundation dependencies identified; no live changes.

## Completed

- Created the Candela Sales brief and recorded the owner's approval.
- Confirmed permanent retention for both daily payment summaries and customer-wise credit summaries.
- Confirmed the separate-module boundary: the existing manual Sales module is not modified.
- Confirmed the live Supabase project is DuaPharmaPlus (sdsynzsflubdxnelgthh).
- Inspected live migration registry: versions through 0304, including the Inventory delta-feed migrations.
- Inspected deployed sync-inventory-from-dropbox: live function version 19, current source is enhanced Inventory v14.
- Confirmed the deployed inventory_apply_sync still deletes and replaces all rows in both Candela summary tables.
- Confirmed the two live summary tables have RLS and their current policies are owner/admin-gated: payment summary uses sales.view_history; customer summary uses credit.view.
- Confirmed current live policy names and role-permission schema. New Candela-specific permissions are still required.

## Parallel-session / safety observations

- Current main head is c86e1c0 (13 Nov, Closing Session C).
- No open GitHub pull requests were returned at the time of inspection.
- Other existing work branches: module/inventory, module/closing, module/manager, foundation/inventory-feed, foundation/operations-hardening, and docs/session-plans.
- Those branches are behind or diverged from current main. Do not merge/rebase/reset them without their session owners.
- The shared contract says docs/MODULES.md, js/core/**, index.html, and shared CI are Foundation-owned. The Candela branch must not modify those.
- Migration range 0900–0999 is marked Reserved. No Candela range may be assumed.

## Blocking Foundation decisions

1. Assign a migration range and add the Candela row to the shared module registry.
2. Approve the feed-retention change in the Foundation/Inventory-owned inventory_apply_sync, preserving the transaction and upserting only dates present in each payload.
3. Confirm whether the source has a stable customer ID/code. The deployed Edge Function currently maps customerName only.
4. Approve a scalar-only candela_today_total() interface gated by candela.today_total; no staff SELECT grants on either detail table.
5. Add a safe refresh lifecycle for status pills in the Foundation-owned status bar. Existing status pills load once; the clock alone refreshes every 30 seconds.

## Live feed behavior and schema notes

- sales_payment_summary: one row per sale_day (unique); amounts and synced_at.
- sales_credit_by_customer: currently no unique key; fields include sale_day, customer_name, credit_amount, receipt_count, synced_at.
- Dropbox payload exposes paymentSummaryLast4Days and creditByCustomerLast4Days.
- Customer rows cannot be safely deduplicated by a guessed ID. If no stable source identifier exists, agree the normalization and collision rule before a unique index is added.
- Existing credit.view is not reused for Candela because it is part of the separate Manager/Closing credit workflow.

## Not done (intentionally)

- No database migration created or applied.
- No SQL executed that changes production.
- No Edge Function modified or deployed.
- No shared Foundation files edited.
- No changes to manual Sales.
- No merge to main and no changes to other active branches.

## Next

After Foundation assigns the range and confirms the feed/customer identity contracts:
1. Write the migration and database tests first.
2. Test RLS for staff, owner without MFA, owner with MFA, and anon.
3. Test rolling-window upserts, preserving out-of-window dates, repeat sync idempotency, duplicate customer rows, and transaction rollback.
4. Build domain helpers, read-only API and owner screens.
5. Integrate the staff scalar status pill using the approved Foundation interface.
6. Run npm run verify and npm run test:db; check CI and complete owner phone testing.

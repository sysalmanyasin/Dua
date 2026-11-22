# Stage 2b — apply and rollback (0220, 0702, 0109)

Status: **written and tested locally; NOT applied to the live database.** Apply only after the owner says so.
Additive only: three new read functions and one new permission key. No existing function, table or policy is changed.

| Order | File | Adds |
|---|---|---|
| 1 | `0220_closing_ops_period.sql` | `closing_ops_period(date, date)`: counts of submitted closings, days with a closing and open drafts (internal only) |
| 2 | `0702_ops_bi_summary.sql` | `ops_bi_summary(integer)`: Owner Business Intelligence for 7, 30 or 90 days |
| 3 | `0109_mgmt_my_payslips.sql` | permission `payroll.view_own`; `mgmt_my_payslips(integer)`: the caller's OWN closed payslips |

## Decision the owner is making by applying this
`payroll.view_own` is carried by **no role template**. After applying, nobody sees a payslip on Home until the owner grants the permission to that person (Users page, person-level permission). To give every Senior or Junior their own payslip, grant it per person or ask for a template change as a separate decision.

## Before / apply / verify
Follow `docs/ops/f8-stage2-apply-and-rollback.md` (registry in step, backup first, apply by hand in the order above, register `0220`, `0702`, `0109`, then hash check every new function against the locally tested copy). Extra checks for this batch:
- As the Owner (second factor on): `ops_bi_summary(30)` returns figures; `ops_bi_summary(14)` is refused.
- As a person with `payroll.view_own`: `mgmt_my_payslips()` returns only that person's own closed months; as a person without it, null.
- `0199_mgmt_exposure_test` (Manager exposure guard) lists `mgmt_my_payslips` as the one new browser-callable Manager function.

## Rollback
```sql
begin;
drop function if exists public.mgmt_my_payslips(integer), public.ops_bi_summary(integer), public.closing_ops_period(date, date);
delete from public.user_permissions where perm_key = 'payroll.view_own';
delete from public.role_permissions where perm_key = 'payroll.view_own';
delete from public.permissions where key = 'payroll.view_own';
delete from supabase_migrations.schema_migrations where version in ('0220', '0702', '0109');
commit;
```
If the front-end is already deployed, Business Intelligence shows "could not be loaded" and the staff payroll section shows its error note; everything else on Home keeps working. Revert the merge to remove them.

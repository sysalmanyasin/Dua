# Stage 2b — apply and rollback (0220, 0702, 0109)

Status: **applied to the live database on 23 Nov 2026 (owner-approved) and registered as `0220`, `0702`, `0109`.** Backup first: `supabase_migrations.schema_migrations_backup_20261123_prestage2b` (96 rows). Verified: the three function-body hashes equal the locally tested copy (D-47); as the Owner (second factor) `ops_bi_summary` returns 7, 30 and 90 day figures (28 days with sales, 6 days with a closing in the last 30); as a non-owner `ops_bi_summary` and `mgmt_my_payslips` return null; nobody holds `payroll.view_own` (0 individual grants, 0 role grants). No salary sheet exists yet in the live app, so a granted person would currently see an empty list; the payslip logic is proven by the local test with closed months. A new security guard, `0749_ops_exposure_test.sql`, fails if a ops or closing_ops function becomes browser-callable without being listed, if a table loses RLS or gains a policy or grant, or if a role template carries `ops.view`, `ops.manage_rules` or `payroll.view_own`.
Additive only: three new read functions and one new permission key. No existing function, table or policy is changed.

| Order | File | Adds |
|---|---|---|
| 1 | `0220_closing_ops_period.sql` | `closing_ops_period(date, date)`: counts of submitted closings, days with a closing and open drafts (internal only) |
| 2 | `0702_ops_bi_summary.sql` | `ops_bi_summary(integer)`: Owner Business Intelligence for 7, 30 or 90 days |
| 3 | `0109_mgmt_my_payslips.sql` | permission `payroll.view_own`; `mgmt_my_payslips(integer)`: the caller's OWN closed payslips |

## Decision the owner is making by applying this
**Owner decision (23 Nov 2026): `payroll.view_own` is granted person by person only.** It is carried by no role template, and the security guard enforces that. Nobody sees a payslip on Home until the owner grants the permission to that person.

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

# Stage 2a — apply and rollback (0219, 0700, 0701)

Status: **written and tested locally; NOT applied to the live database.** Apply only after the owner says so.
These three migrations are additive: new tables and new functions, plus two new permission keys. Nothing existing is changed.

| Order | File | Adds |
|---|---|---|
| 1 | `0219_closing_ops_feed.sql` | three internal read functions owned by Closing (`closing_ops_feed`, `closing_ops_open_drafts`, `closing_ops_deposits`) |
| 2 | `0700_ops_rules.sql` | permissions `ops.view`, `ops.manage_rules`; tables `ops_rules`, `ops_activity_categories` (seeded); `ops_params_ok`, `ops_rules_list`, `ops_rule_set`, `ops_activity_category_set` |
| 3 | `0701_ops_action_items.sql` | `ops_action_items()`, `ops_recent_activity(integer)` |

## Before
1. Registry in step: `node tools/check-registry.mjs registry.json` exits 0.
2. Fresh backup: the nightly dump is recent (Tools tab) and `create table supabase_migrations.schema_migrations_backup_<yyyymmdd> as select * from supabase_migrations.schema_migrations;`
3. Quiet hours. Nobody else applying migrations.

## Apply (by hand, never `apply_migration`)
Run each file's SQL in its own transaction, in the order above, then register it:
```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
select '0219', 'closing_ops_feed', array['applied by hand from supabase/migrations/0219_closing_ops_feed.sql']
where not exists (select 1 from supabase_migrations.schema_migrations where version = '0219');
```
(`0700` name `ops_rules`, `0701` name `ops_action_items`.)

## Verify (D-47)
- Compare a hash of every new function body with the locally tested copy:
  `select p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'ops\_%' or p.proname like 'closing\_ops\_%') order by 1;`
  Run it on the local test database and on live; the lists must be identical.
- As the Owner (second factor on): the Home page shows Action Centre and Recent Activity. As a Senior and a Junior: neither appears.
- `select count(*) from public.ops_rules;` is 5 and `select count(*) from public.ops_activity_categories;` is 2 (run in the SQL editor).
- The existing suites that touch Home, Closing and notifications still pass.

## Rollback (removes only what these migrations created)
```sql
begin;
drop function if exists public.ops_action_items(), public.ops_recent_activity(integer), public.ops_activity_category_set(text, boolean),
  public.ops_rule_set(text, boolean, text, jsonb, text), public.ops_rules_list(), public.ops_params_ok(text, jsonb),
  public.closing_ops_deposits(date), public.closing_ops_open_drafts(integer), public.closing_ops_feed(integer);
drop table if exists public.ops_activity_categories, public.ops_rules;
delete from public.user_permissions where perm_key in ('ops.view', 'ops.manage_rules');
delete from public.role_permissions where perm_key in ('ops.view', 'ops.manage_rules');
delete from public.permissions where key in ('ops.view', 'ops.manage_rules');
delete from supabase_migrations.schema_migrations where version in ('0219', '0700', '0701');
commit;
```
Audit-log rows named `ops.*` stay (the log is append-only by design). If Home has already been deployed, the Owner's Action Centre shows "could not be loaded" and everything else on Home keeps working; roll the front-end back by reverting the merge.

## Known behaviour to expect after applying
- The **deposit rule is off**. On live data (17 Nov to 20 Nov 2026) the Closing deposit rows do not equal the day's cash sale (for example 250,000 deposited against 312,421 cash on 20 Nov), so switching it on today would raise a false alert almost every day. The owner decides what counts as a match (tolerance, or a different Sales figure such as `cash_to_deposit`) before enabling it.
- The **sales-missing** issue will list any of the last three days with no sales entered (the same window Home already uses), so it appears immediately if a day is missing.
- The **stock** issue is informational and will show while any product is under 30 days of cover.

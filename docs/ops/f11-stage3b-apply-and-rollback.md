# Stage 3b — apply and rollback (0703)

Status: **not applied.** Written 24 Nov 2026 on branch `ops-redesign-stage3b`. Do not apply until the owner says "apply".

3b needs exactly one database change: `supabase/migrations/0703_ops_task_rules.sql` (range 0700–0749). The Tasks screens use the Task Master functions that are already live (1200–1203).

## What 0703 does
1. Replaces the `category` check on `ops_rules` so `tasks` is allowed.
2. Adds two rules: `task_overdue` (warning) and `task_verification_waiting` (information). Both on, no settings (`ops_params_ok` refuses any setting for them).
3. `create or replace function public.ops_action_items()` with the 0701 body plus two task checks. Grants and `search_path` are unchanged. It reads tasks only through `task_team_overview` and `task_list_all`.

Effects after applying: with no tasks, nothing new appears. An overdue task or work waiting for a verifier appears in the Owner's Action Centre. The deposit rule stays off.

## Apply (follow `docs/ops/f8-stage2-apply-and-rollback.md`)
1. `node tools/check-registry.mjs registry.json` against the live registry (expect 113 rows before, no drift).
2. Backup: `create table supabase_migrations.schema_migrations_backup_<date>_pretask_rules as table supabase_migrations.schema_migrations;` and check the row count (113).
3. Apply the file by hand with `execute_sql` in one transaction, pasting the file text exactly (comment lines inside a function body change its hash). Never `apply_migration`.
4. Register `insert into supabase_migrations.schema_migrations (version, name) values ('0703', 'ops_task_rules');`.
5. Hash check (D-47): replay all migrations locally and compare `md5(pg_get_functiondef(oid))` of `ops_action_items` local against live. Compare the `ops_rules_category_check` definition too.

## Verify live (each in a transaction that rolls back)
- As the Owner (admin, aal2): `ops_action_items()` returns without error and has no `Tasks could not be checked` item; `ops_rules_list()` shows 7 rules and `deposit_vs_cash` still off.
- As a Junior: `ops_action_items()` returns null.
- `has_function_privilege('anon', 'public.ops_action_items()', 'execute')` is false.
- Security advisor: no new warnings.
- Guards `0199`, `0749`, `1299` pass unchanged.

## Rollback
```sql
begin;
-- 1. put back the 0701 function: paste the `create or replace function public.ops_action_items()` block from 0701_ops_action_items.sql exactly
-- 2. remove the rules and restore the category check
delete from public.ops_rules where rule_key in ('task_overdue', 'task_verification_waiting');
alter table public.ops_rules drop constraint ops_rules_category_check;
alter table public.ops_rules add constraint ops_rules_category_check check (category in ('closing', 'sales', 'inventory', 'cash', 'system'));
delete from supabase_migrations.schema_migrations where version = '0703';
commit;
```
If any action item was ever written with category `tasks` the constraint restore would fail; items are computed, not stored, so this cannot happen. Rollback is safe at any time and loses no task data.

The screens need no rollback beyond reverting the merge; with 0703 absent they work, and the Action Centre simply has no task rules.

# Stage 4 — apply and rollback (1300, 1301, 1204)

Status: **not applied.** Written 25 Nov 2026 on branch `ops-redesign-stage4`. Do not apply until the owner says "apply".

## What the three migrations do
- `1300_ntf_core` (range 1300–1399): permission `ntf.view_own` (Junior and Senior), table `ntf_messages` (closed to the browser), `ntf_send` (server only, never raises), `ntf_prune`, and the job `ntf-prune-daily` (22:00 UTC).
- `1301_ntf_reads`: `ntf_list_mine`, `ntf_unread_count`, `ntf_mark_read`, `ntf_mark_all_read` (signed-in users, own rows only).
- `1204_task_notices` (range 1200–1299): trigger `task_events_notify` on `task_events` calling `task_notify_on_event`, `task_overdue_reminders`, and the job `task-overdue-reminders` (03:00 UTC = 08:00 Pakistan time). No existing function is changed.

**Order matters: 1300, then 1301, then 1204.** 1204 calls `ntf_send`; if the trigger existed before 1300 it would only log warnings (a message can never block a task action), but no message would be sent.

Effects after applying: Juniors and Seniors get an Inbox; task events start producing messages; at 08:00 each morning overdue tasks produce one reminder each. Nothing is sent to anyone's phone (D-58).

## Apply (follow `docs/ops/f8-stage2-apply-and-rollback.md`)
1. `node tools/check-registry.mjs registry.json` against the live registry (expect no drift; check the row count first, other sessions also register migrations).
2. Backup: `create table supabase_migrations.schema_migrations_backup_<date>_prentf as table supabase_migrations.schema_migrations;` and check the row count matches.
3. Apply each file by hand with `execute_sql`, one transaction each, pasting the file text exactly (comment lines inside a function body change its hash). Never `apply_migration`. Register `1300 ntf_core`, `1301 ntf_reads`, `1204 task_notices` (four-digit version, name without the number).
4. Hash check (D-47): replay locally and compare `md5(pg_get_functiondef(oid))` of every `ntf_*` function plus `task_notify_on_event` and `task_overdue_reminders`, live against local. For `ntf_messages` compare columns, constraints and indexes.

## Verify live (each in a transaction that rolls back)
- A Junior and a Senior: `ntf_unread_count()` is 0 and `ntf_list_mine()` is `[]`; `ntf_mark_all_read()` is 0.
- A person without the permission (remove it inside the transaction): all four answer null or 0.
- `anon` cannot execute any `ntf_*` function; `authenticated` cannot execute `ntf_send`, `ntf_prune`, `task_notify_on_event`, `task_overdue_reminders`.
- `cron.job` has `ntf-prune-daily` `0 22 * * *` and `task-overdue-reminders` `0 3 * * *`.
- Create, assign and cancel a throwaway task inside a rolled-back transaction as the Owner and check the assignee's `ntf_messages` row appears and the task action still succeeds.
- Security advisor: no new kinds of finding (a closed table with no policy is expected, like the task tables).
- Guards `0199`, `0749`, `1299` pass unchanged; the new `1399` passes.

## Rollback
```sql
begin;
drop trigger if exists task_events_notify on public.task_events;
drop function if exists public.task_notify_on_event();
drop function if exists public.task_overdue_reminders();
drop function if exists public.ntf_list_mine(integer), public.ntf_unread_count(), public.ntf_mark_read(uuid[]), public.ntf_mark_all_read();
drop function if exists public.ntf_send(uuid, text, text, text, text, text), public.ntf_prune();
drop table if exists public.ntf_messages;
delete from public.role_permissions where perm_key = 'ntf.view_own';
delete from public.user_permissions where perm_key = 'ntf.view_own';
delete from public.permissions where key = 'ntf.view_own';
do $$ begin if to_regclass('cron.job') is not null then
  perform cron.unschedule(jobid) from cron.job where jobname in ('ntf-prune-daily', 'task-overdue-reminders'); end if; end $$;
delete from supabase_migrations.schema_migrations where version in ('1300', '1301', '1204');
commit;
```
Rolling back deletes every inbox message (they are copies of events that remain in the task history). It does not touch tasks, the owner push, or any other table. Revert the merge as well, or the Inbox page will show "not set up for your login".

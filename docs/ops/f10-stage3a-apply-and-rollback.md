# Stage 3a — apply and rollback (1200, 1201, 1202, 1203)

Status: **written and tested locally; NOT applied to the live database.** Apply only after the owner says so.
Additive only: new tables, new functions, three new permission keys, two new role grants (`tasks.view_own` to Junior and Senior) and one cron job. No existing table, function or policy is changed.

| Order | File | Adds |
|---|---|---|
| 1 | `1200_task_core.sql` | permissions `tasks.view_own`, `tasks.manage`, `tasks.verify`; 7 closed tables; append-only triggers; internal helpers (`task_can_verify`, `task_can_see`, ...) |
| 2 | `1201_task_lifecycle.sql` | create, assign, set deadline, cancel, accept, start, submit, begin verification, verify, comment, request change, decide change |
| 3 | `1202_task_schedules.sql` | the schedule rule, the generator, Generate now, schedule create, pause and list; cron job `task-generate-daily` (00:05 Pakistan time) where pg_cron exists |
| 4 | `1203_task_reads.sql` | the staff list and snapshot, the Owner lists, the verification queue, task detail, pending requests, the team overview |

## Effects to expect after applying
- Every Junior and Senior gets `tasks.view_own` through their role. It shows nothing until a task is assigned to them, and there are no screens yet (Stage 3b), so no visible change.
- Nobody can verify tasks until the owner names a Senior (a personal grant of `tasks.verify` on that login). The Owner can verify always (with the second factor).
- The daily job makes tasks only for schedules the Owner has created, and there are none, so it makes nothing.
- `0001_core_test` now expects a Junior to hold 6 permissions.

## Before / apply / verify
Follow `docs/ops/f8-stage2-apply-and-rollback.md`: registry in step (`node tools/check-registry.mjs`), registry backup first, apply each file by hand in its own transaction in the order above, register `1200`, `1201`, `1202`, `1203` (names without the number prefix), then compare an md5 of every new function body against the locally tested copy (D-47). Extra checks:
- As the Owner: `task_list_all()` returns `[]`; `task_team_overview(30)` returns the staff list; `task_schedule_list()` returns `[]`.
- As a Junior: `task_snapshot_mine()` returns zeros; `task_list_all()` returns null.
- `select count(*) from cron.job where jobname = 'task-generate-daily';` returns 1.
- The security guard `1299_task_exposure_test.sql` passes locally and in CI.

## Rollback
```sql
begin;
select cron.unschedule('task-generate-daily') where exists (select 1 from cron.job where jobname = 'task-generate-daily');
drop function if exists public.task_team_overview(integer), public.task_change_requests_pending(), public.task_get(uuid), public.task_verification_queue(),
  public.task_list_all(text, uuid, integer), public.task_snapshot_mine(), public.task_list_mine(text), public.task_card(public.task_items),
  public.task_schedule_list(), public.task_schedule_set_active(uuid, boolean), public.task_schedule_create(text, text, text, text, uuid, text, integer[], integer, integer),
  public.task_generate_now(), public.task_generate_due(date), public.task_cycle(text, integer[], integer, integer, date),
  public.task_decide_change(uuid, boolean, text, uuid), public.task_request_change(uuid, text, text, date), public.task_comment_add(uuid, text),
  public.task_verify(uuid, boolean, text), public.task_begin_verification(uuid), public.task_submit(uuid, text, boolean), public.task_start(uuid),
  public.task_accept(uuid), public.task_cancel(uuid, text), public.task_set_deadline(uuid, date, text), public.task_assign(uuid, uuid),
  public.task_create(text, text, text, text, uuid, date), public.task_event(uuid, text, text, text, jsonb), public.task_can_see(uuid),
  public.task_staff_has_login(uuid), public.task_can_verify(), public.task_my_staff(), public.task_today();
drop table if exists public.task_change_requests, public.task_submissions, public.task_comments, public.task_events, public.task_items, public.task_schedules, public.task_defs;
drop function if exists public.task_submission_guard(), public.task_append_only();
delete from public.user_permissions where perm_key like 'tasks.%';
delete from public.role_permissions where perm_key like 'tasks.%';
delete from public.permissions where key like 'tasks.%';
delete from supabase_migrations.schema_migrations where version in ('1200', '1201', '1202', '1203');
commit;
```
If tasks already exist when you roll back, **their history is dropped with the tables**; export `task_items` and `task_events` first. Audit-log rows named `task.*` stay (the log is append-only).

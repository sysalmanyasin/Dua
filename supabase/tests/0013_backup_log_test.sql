\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare a uuid; n int; failed boolean; ov jsonb; sha text := repeat('a', 64); begin
  perform pg_temp.ok(exists (select 1 from public.permissions where key = 'tools.view'), 'the tools.view permission exists');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'tools.view'), 'no role preset carries tools.view');

  set local role service_role;
  -- before any successful backup there is no stale alert (setup period)
  perform public.ops_check_backups();
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'no stale alert before the first successful backup');

  a := public.backup_report('daily', 'ok', current_date, 1234567, sha, '{"table:x":{"rows":"1","md5":"abc"}}'::jsonb, null);
  perform pg_temp.ok(a is not null and (select count(*) from public.backup_log) = 1, 'a successful backup is recorded');
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'a success raises no alert');

  -- a recent success means no stale alert
  perform public.ops_check_backups();
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'a recent backup raises no stale alert');

  -- a failure is recorded and alerts once per day
  perform public.backup_report('daily', 'failed', current_date, null, null, null, 'pg_dump exited with 1');
  perform public.backup_report('daily', 'failed', current_date, null, null, null, 'pg_dump exited with 1');
  perform pg_temp.ok((select count(*) from public.backup_log where status = 'failed') = 2, 'both failures are recorded');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'backup.failed') = 1, 'a failed backup raises one alert per day');
  perform public.backup_report('restore_drill', 'failed', current_date, null, null, null, 'fingerprint mismatch');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'restore_drill.failed') = 1, 'a failed restore drill raises its own alert');

  -- bad input is refused
  failed := false; begin perform public.backup_report('weekly2', 'ok', current_date, 1, sha, null, null); exception when check_violation then failed := true; end;
  perform pg_temp.ok(failed, 'an unknown backup kind is refused');
  failed := false; begin perform public.backup_report('daily', 'ok', current_date, 1, 'not-a-hash', null, null); exception when check_violation then failed := true; end;
  perform pg_temp.ok(failed, 'a malformed hash is refused');

  -- staleness: 31 hours since the last success raises one alert per day
  delete from public.notifications;
  update public.backup_log set created_at = now() - interval '31 hours' where status = 'ok';
  perform public.ops_check_backups();
  perform public.ops_check_backups();
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'backup.stale') = 1, 'no verified backup for 30 hours raises one alert per day');

  -- access
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.backup_log) = 0, 'a junior cannot read the backup log');
  perform pg_temp.ok(public.tools_overview() is null, 'a junior gets no Tools overview');
  failed := false; begin perform public.backup_report('daily', 'ok', current_date, 1, sha, null, null); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a signed-in user cannot write backup results');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.tools_overview() is null, 'the owner without the second factor sees nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  ov := public.tools_overview();
  perform pg_temp.ok(ov -> 'backups' ->> 'last_ok_daily' is not null and jsonb_array_length(ov -> 'backups' -> 'recent') = 4, 'the owner sees backup status and recent runs');
  perform pg_temp.ok((ov -> 'notifications' ->> 'failed')::int >= 0 and ov -> 'feed' is not null, 'the owner sees notifications and feed status');
  reset role;
end $t$;
rollback;

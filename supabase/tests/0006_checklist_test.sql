\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000b2','j2@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior');

-- content carried over from the original app
select pg_temp.ok((select count(*) from public.checklist_sections) = 13 and (select count(*) from public.checklist_items) = 52, '13 sections and 52 items seeded');
select pg_temp.ok((select count(*) from public.checklist_items where dropdown_key is not null) = 4, 'four dropdown items');
select pg_temp.ok((select count(*) from public.checklist_dropdown_options where dropdown_key = 'rpos') = 4 and (select count(*) from public.checklist_dropdown_options where dropdown_key = 'mkt') >= 3, 'dropdown lists have at least 3 options');
select pg_temp.ok((select default_value from public.checklist_items where key = 's7_1') like 'Yes, FDPP%', 'defaults are carried over');

do $t$ declare r jsonb; d date := (now() at time zone 'Asia/Karachi')::date; n int; begin
  -- no checklist permission: nothing
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.checklist_items; perform pg_temp.ok(n = 0, 'junior cannot read checklist content');
  perform pg_temp.fails(format($q$select public.checklist_get_day(%L)$q$, d), 'junior cannot read a day', '42501');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{}', '[]', null)$q$, d), 'junior cannot save', '42501');
  perform pg_temp.fails($q$insert into public.checklist_days (report_date) values (current_date)$q$, 'no direct writes', '42501');
  reset role;

  -- the owner saves, reads back, updates
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.checklist_save_day(d, '{"branch":"Test Branch","prepared_by":"Tester","report_time":"20:08","s_cashsale":"250000","s_closing":"","lt7_zero":"3","lt7_days":"4","notes":"hello"}',
        '{"s2_1":"Yes","dd_rpos":"Pending review"}', '[["Shop A","1 Crore","300K","9 Million"],["Shop B","","",""]]', null);
  perform pg_temp.ok((r ->> 'version')::int = 1, 'new day saved as version 1');
  r := public.checklist_get_day(d);
  perform pg_temp.ok(r -> 'day' ->> 'branch' = 'Test Branch' and (r -> 'day' ->> 's_cashsale')::numeric = 250000 and r -> 'day' -> 's_closing' = 'null'::jsonb, 'day reads back, blank numbers stay empty');
  perform pg_temp.ok(r -> 'answers' ->> 'dd_rpos' = 'Pending review' and jsonb_array_length(r -> 'competitors') = 2, 'answers and competitors read back in order');
  perform pg_temp.ok(not (r -> 'day' ? 'created_by'), 'internal user ids are not exposed');
  r := public.checklist_save_day(d, '{"branch":"Test Branch","notes":"second"}', '{"s2_1":"No"}', '[]', 1);
  perform pg_temp.ok((r ->> 'version')::int = 2 and (select count(*) from public.checklist_answers where report_date = d) = 1 and (select count(*) from public.checklist_competitors where report_date = d) = 0, 'update replaces answers and competitors and bumps the version');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{}', '[]', 1)$q$, d), 'a stale version is a conflict', 'conflict');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{}', '[]', null)$q$, d), 'claiming a new day that exists is a conflict', 'conflict');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{}', '[]', 5)$q$, d - 4), 'claiming a saved day that does not exist is a conflict', 'conflict');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{"nope":"x"}', '[]', null)$q$, d - 3), 'unknown checklist item refused', 'unknown');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', jsonb_build_object('s2_1', repeat('x', 501)), '[]', null)$q$, d - 3), 'over-long answer refused', 'too long');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{}', (select jsonb_agg('["a","b","c","d"]'::jsonb) from generate_series(1, 31)), null)$q$, d - 3), 'too many competitor rows refused', 'too many');
  perform pg_temp.fails($q$select public.checklist_save_day(current_date + 30, '{}', '{}', '[]', null)$q$, 'a date far in the future is refused', 'too far');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{"s_cashsale":"abc"}', '{}', '[]', null)$q$, d - 3), 'a non-number in a number field is refused');
  select count(*) into n from public.activity_log where action = 'checklist.created'; perform pg_temp.ok(n = 1, 'only the first save is logged as creation (autosave is not)');
  perform public.checklist_log_send(d, 'gmail');
  perform pg_temp.fails(format($q$select public.checklist_log_send(%L, 'carrier-pigeon')$q$, d), 'unknown send channel refused', 'bad channel');
  perform public.checklist_reset_day(d);
  perform pg_temp.ok(public.checklist_get_day(d) is null and (select count(*) from public.checklist_answers) = 0, 'reset removes the day and its answers');
  reset role;
end $t$;

-- permissions are separate: view, fill, manage
do $t$ declare d date := (now() at time zone 'Asia/Karachi')::date - 1; r jsonb; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.checklist_save_day(d, '{"branch":"B"}', '{}', '[]', null);
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b1', 'checklist.view', 'grant', null);
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b2', 'checklist.fill', 'grant', null);
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.checklist_get_day(d) is not null, 'a viewer can read the checklist');
  select count(*) into n from public.checklist_items; perform pg_temp.ok(n = 52, 'a viewer can read the content');
  perform pg_temp.fails(format($q$select public.checklist_save_day(%L, '{}', '{}', '[]', 1)$q$, d), 'but cannot save', '42501');
  perform pg_temp.fails($q$select public.checklist_set_dropdown('rpor', array['a','b','c'])$q$, 'and cannot change dropdowns', '42501');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  r := public.checklist_save_day(d - 1, '{"branch":"B2"}', '{}', '[]', null);
  perform pg_temp.ok((r ->> 'version')::int = 1, 'a filler can save');
  perform pg_temp.fails($q$select public.checklist_set_dropdown('rpor', array['a','b','c'])$q$, 'a filler still cannot change dropdowns', '42501');
  reset role;

  -- dropdown lists: manage only, 3 to 30 unique options
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.checklist_set_dropdown('rpor', array['Yes', ' No ', 'yes', 'Partially', '', 'Maybe']);
  perform pg_temp.ok((select string_agg(option_text, ',' order by sort) from public.checklist_dropdown_options where dropdown_key = 'rpor') = 'Yes,No,Partially,Maybe', 'dropdown list is trimmed, de-duplicated ignoring case, and ordered');
  perform pg_temp.fails($q$select public.checklist_set_dropdown('rpor', array['only','two'])$q$, 'fewer than 3 options refused', 'at least 3');
  perform pg_temp.fails($q$select public.checklist_set_dropdown('nope', array['a','b','c'])$q$, 'unknown dropdown refused', 'unknown');
  select count(*) into n from public.activity_log where action = 'checklist.dropdown_set'; perform pg_temp.ok(n = 1, 'dropdown change is logged');
  reset role;
end $t$;
rollback;

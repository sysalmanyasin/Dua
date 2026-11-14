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

-- people (invented): owner, a viewer with str.view, a plain staff member, a viewer who may also see cost
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','v@t'),
  ('00000000-0000-0000-0000-0000000000b2','n@t'),('00000000-0000-0000-0000-0000000000b3','c@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Viewer'),('10000000-0000-0000-0000-000000000002','Plain'),('10000000-0000-0000-0000-000000000003','Coster');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','viewer','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','plain','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','coster','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b1','str.view','grant'),
 ('00000000-0000-0000-0000-0000000000b3','str.view','grant'),
 ('00000000-0000-0000-0000-0000000000b3','inventory.view_cost','grant');

-- a moment in Pakistan time: date + hour
create function pg_temp.pkt(d date, h int) returns timestamptz language sql as $$ select ((d::timestamp + make_interval(hours => h)) at time zone 'Asia/Karachi') $$;

do $t$ declare r jsonb; d date := (now() at time zone 'Asia/Karachi')::date; base date := date '2026-11-01'; n int; p jsonb; begin
  -- STR dated 1 Nov, not received
  insert into public.str_headers (str_id, str_number, dispatch_status, receive_status, str_status, str_date, direction)
    values (1, 'T-1', 'Dispatched', '', 'Open', base, 'in');

  r := public.str_overdue_check(pg_temp.pkt(base + 1, 23) + interval '59 minutes');
  perform pg_temp.ok((r ->> 'count')::int = 0 and (r ->> 'notified')::boolean = false, '1 Nov STR is not overdue at 23:59 on 2 Nov');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'str.overdue') = 0, 'and nothing was sent');

  r := public.str_overdue_check(pg_temp.pkt(base + 2, 9));
  perform pg_temp.ok((r ->> 'count')::int = 1 and (r ->> 'notified')::boolean, 'it is overdue and alerted at 09:00 on 3 Nov');
  select payload into p from public.notifications where kind = 'str.overdue';
  perform pg_temp.ok(p ->> 'dedupe_key' = 'str.overdue:2026-11-03T09' and (p ->> 'count')::int = 1 and p -> 'str_ids' = '[1]'::jsonb and p ->> 'oldest_date' = '2026-11-01', 'the alert carries ids, a count and a date, keyed by its slot');
  perform pg_temp.ok(not (p::text ilike '%T-1%') and not (p ? 'amount'), 'no names, numbers of the STR or amounts in the alert');

  r := public.str_overdue_check(pg_temp.pkt(base + 2, 9) + interval '30 minutes');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'str.overdue') = 1, 'a second call in the same slot sends nothing new');
  perform public.str_overdue_check(pg_temp.pkt(base + 2, 13));
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'str.overdue') = 2, 'the 13:00 slot is a new alert');
  perform public.str_overdue_check(pg_temp.pkt(base + 2, 17));
  perform public.str_overdue_check(pg_temp.pkt(base + 2, 21));
  perform public.str_overdue_check(pg_temp.pkt(base + 3, 9));
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'str.overdue') = 5, 'one alert per slot, and it carries on the next morning');

  -- it stops when the STR is received or closed
  update public.str_headers set receive_status = 'Received' where str_id = 1;
  r := public.str_overdue_check(pg_temp.pkt(base + 3, 13));
  perform pg_temp.ok((r ->> 'count')::int = 0, 'a received STR stops alerting');
  update public.str_headers set receive_status = '', str_status = 'Close' where str_id = 1;
  perform pg_temp.ok((public.str_overdue_check(pg_temp.pkt(base + 3, 13)) ->> 'count')::int = 0, 'a closed STR stops alerting');
  update public.str_headers set str_status = 'Closed' where str_id = 1;
  perform pg_temp.ok((public.str_overdue_check(pg_temp.pkt(base + 3, 13)) ->> 'count')::int = 0, 'so does "Closed"');
  update public.str_headers set str_status = 'Open' where str_id = 1;
  perform pg_temp.ok((public.str_overdue_check(pg_temp.pkt(base + 3, 13)) ->> 'count')::int = 1, 'and it alerts again if it is reopened');

  -- awaited and outgoing STRs count too; no date is ignored; the list is capped
  delete from public.notifications;
  insert into public.str_headers (str_id, str_number, dispatch_status, receive_status, str_status, str_date, direction) values
    (2, 'T-2', '', '', 'Open', base, 'out'), (3, 'T-3', '', '', 'Open', null, 'in'), (4, 'T-4', 'Dispatched', 'Received', 'Open', base, 'in');
  r := public.str_overdue_check(pg_temp.pkt(base + 2, 9));
  perform pg_temp.ok((r ->> 'count')::int = 2, 'awaited and outgoing STRs are included; a received STR and one with no date are not');
  delete from public.notifications; delete from public.str_headers;
  insert into public.str_headers (str_id, str_number, str_date) select g, 'B-' || g, base from generate_series(1, 30) g;
  perform public.str_overdue_check(pg_temp.pkt(base + 2, 9));
  select payload into p from public.notifications where kind = 'str.overdue';
  perform pg_temp.ok((p ->> 'count')::int = 30 and jsonb_array_length(p -> 'str_ids') = 20, 'the count is exact, the id list is capped at 20');

  -- nothing to report, nothing sent
  delete from public.notifications; delete from public.str_headers;
  perform pg_temp.ok((public.str_overdue_check(now()) ->> 'notified')::boolean = false and (select count(*) from public.notifications) = 0, 'no overdue STR, no alert');

  -- not callable from the app
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select public.str_overdue_check()$q$, 'a viewer cannot run the overdue check', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.fails($q$select public.str_overdue_check()$q$, 'even the owner cannot run it from the app', '42501');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select public.str_overdue_check()$q$, 'anon cannot run it', '42501');
  reset role;
end $t$;
rollback;

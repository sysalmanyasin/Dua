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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000b3','j3@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000003','J Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','junior3','junior');
-- junior3 has had the closing permission taken away
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b3', 'closing.enter_own', 'deny', 'test');
  reset role;
end $t$;

insert into public.closing_slots (id, business_date, kind, seq) values
 ('20000000-0000-0000-0000-000000000001', date '2030-02-01', 'evening', 9999),
 ('20000000-0000-0000-0000-000000000002', date '2030-02-02', 'evening', 9999),
 ('20000000-0000-0000-0000-000000000003', date '2030-02-03', 'night', 10),
 ('20000000-0000-0000-0000-000000000004', date '2030-02-04', 'evening', 9999);
insert into public.closings (id, slot_id, entered_by, idempotency_key, sys_cash, alfalah, keenu, status, submitted_at) values
 -- 1 Feb: a submitted evening closing (the 23 Nov 2026 figures)
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 207202, 46451, 116020, 'submitted', now()),
 -- 3 Feb: only a night closing, no evening one
 ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 5, 5, 5, 'submitted', now());
insert into public.closings (id, slot_id, entered_by, idempotency_key, sys_cash, alfalah, keenu, status) values
 -- 2 Feb: an evening closing still being typed
 ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 999, 999, 999, 'draft');
-- 4 Feb: a corrected closing: revision 1 superseded, revision 2 submitted
insert into public.closings (id, slot_id, entered_by, idempotency_key, sys_cash, alfalah, keenu, status, submitted_at, revision) values
 ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 100, 10, 20, 'superseded', now(), 1);
insert into public.closings (id, slot_id, entered_by, idempotency_key, sys_cash, alfalah, keenu, status, submitted_at, revision, supersedes_id, correction_reason) values
 ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 150, 15, 25, 'submitted', now(), 2, '30000000-0000-0000-0000-000000000004', 'typo');

do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_day_feed(date '2030-02-01');
  perform pg_temp.ok((r ->> 'sys_cash')::numeric = 207202 and (r ->> 'alfalah')::numeric = 46451 and (r ->> 'keenu')::numeric = 116020, 'a closing user gets the submitted evening closing figures');
  perform pg_temp.ok(r ->> 'closing_id' = '30000000-0000-0000-0000-000000000001', 'it names the closing it came from');
  perform pg_temp.ok(public.closing_day_feed(date '2030-02-02') is null, 'an evening closing still in draft is not returned');
  perform pg_temp.ok(public.closing_day_feed(date '2030-02-03') is null, 'a day with only a night closing has no evening figures');
  perform pg_temp.ok(public.closing_day_feed(date '2030-02-09') is null, 'a day with no closing at all gives null');
  perform pg_temp.ok(public.closing_day_feed(null) is null, 'a null date gives null');
  r := public.closing_day_feed(date '2030-02-04');
  perform pg_temp.ok((r ->> 'revision')::int = 2 and (r ->> 'sys_cash')::numeric = 150, 'after a correction the live revision is returned, not the superseded one');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.fails($q$select public.closing_day_feed(date '2030-02-01')$q$, 'a person without any closing permission is refused', 'not allowed');
  reset role;

  set local role anon;
  perform pg_temp.fails($q$select public.closing_day_feed(date '2030-02-01')$q$, 'a signed-out caller cannot call it', 'permission denied');
  reset role;
end $t$;
rollback;

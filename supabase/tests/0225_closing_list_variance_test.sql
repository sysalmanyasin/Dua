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
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

insert into public.closing_slots (id, business_date, kind, seq) values
 ('20000000-0000-0000-0000-000000000001', date '2030-03-01', 'night', 10),
 ('20000000-0000-0000-0000-000000000002', date '2030-03-01', 'morning', 20);
insert into public.closings (id, slot_id, entered_by, idempotency_key, responsible_staff_id, sys_cash, status, submitted_at) values
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '10000000-0000-0000-0000-000000000001', 500, 'submitted', now());
insert into public.closings (id, slot_id, entered_by, idempotency_key, responsible_staff_id, sys_cash, status) values
 ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '10000000-0000-0000-0000-000000000001', 9, 'draft');
select public.closing_write_result('30000000-0000-0000-0000-000000000001');

do $t$ declare r jsonb; e jsonb; stored numeric; begin
  select shift_variance into stored from public.closing_results where closing_id = '30000000-0000-0000-0000-000000000001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

  r := public.closing_saved_list(10);
  e := (select x from jsonb_array_elements(r) x where x ->> 'closing_id' = '30000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((e ->> 'shift_variance')::numeric = stored, 'the saved list carries the stored shift variance');
  perform pg_temp.ok(e ? 'final_variance' and e ->> 'staff' = 'J One', 'it carries final_variance and keeps the responsible person');
  perform pg_temp.ok(e ? 'mode' and e ? 'key' and e ? 'revision', 'every earlier key is still there');

  r := public.closing_my_recent(10);
  e := (select x from jsonb_array_elements(r) x where x ->> 'closing_id' = '30000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((e ->> 'shift_variance')::numeric = stored, 'my recent carries the stored variance of a submitted closing');
  e := (select x from jsonb_array_elements(r) x where x ->> 'closing_id' = '30000000-0000-0000-0000-000000000002');
  perform pg_temp.ok(e -> 'shift_variance' = 'null'::jsonb and e ->> 'status' = 'draft' and e ->> 'staff' = 'J One', 'a draft has no variance yet, and still shows who is responsible');
  perform pg_temp.ok(e ? 'mine', 'the shared-draft key is kept');
  reset role;
end $t$;
rollback;

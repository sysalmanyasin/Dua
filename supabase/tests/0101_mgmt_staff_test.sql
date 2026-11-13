-- Tests for 0101_mgmt_staff. All people and figures here are invented.
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

-- people: owner (a1), a junior holding every normal permission (b1), and single-key sharers
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t'),
 ('00000000-0000-0000-0000-0000000000e1','e@t'), ('00000000-0000-0000-0000-0000000000f1','f@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B'), ('10000000-0000-0000-0000-00000000000c','Test Viewer C'),
 ('10000000-0000-0000-0000-00000000000d','Test Editor D'), ('10000000-0000-0000-0000-00000000000e','Test Notes E'),
 ('10000000-0000-0000-0000-00000000000f','Test Editor F');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','viewer_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','editor_d','junior'),
 ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-00000000000e','notes_e','senior'),
 ('00000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000f','editor_f','junior');
-- the junior is granted EVERY permission that is not a Manager one (users.manage, settings.manage, activity.view, ...)
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions
  where key not like 'mgmt.%' and key not like 'credit.%';
-- single-key shares, as the owner would do by hand
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','mgmt.staff_view','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.staff_edit','grant'),
 ('00000000-0000-0000-0000-0000000000e1','mgmt.notes','grant'),
 ('00000000-0000-0000-0000-0000000000f1','mgmt.staff_edit','grant'),
 ('00000000-0000-0000-0000-0000000000f1','mgmt.staff_private','grant');

do $t$ declare tot int; tot_d int; r jsonb; r2 jsonb; pid uuid; pid2 uuid; nid uuid; k uuid; n int; code1 text; tbl text;
  a text := '00000000-0000-0000-0000-0000000000a1'; j text := '00000000-0000-0000-0000-0000000000b1';
begin
  -- 0. the permissions exist and no role preset holds any Manager key
  perform pg_temp.ok((select count(*) from public.permissions where key like 'mgmt.%' or key like 'credit.%') = 14, '14 Manager permissions are seeded (11 new + 3 reserved)');
  perform pg_temp.ok((select count(*) from public.role_permissions where perm_key like 'mgmt.%' or perm_key like 'credit.%') = 0, 'no role preset holds a Manager permission');

  -- 1. the owner (MFA) builds data
  perform pg_temp.as_user(a::uuid, 'aal2');
  r := public.mgmt_staff_save(null, 'Test Person A', '0300-0000001', date '2024-01-15', true, 'Salesman', null, 1,
         '{"father_name":"Test Father","address":"Test Street 1","blood_group":"O+"}'::jsonb, '20000000-0000-0000-0000-000000000001');
  pid := (r ->> 'staff_id')::uuid;
  perform pg_temp.ok(r ->> 'staff_code' ~ '^EMP-[0-9]{3}$', 'a new person gets an automatic staff code');
  code1 := r ->> 'staff_code';
  perform pg_temp.ok((select full_name from public.staff where id = pid) = 'Test Person A', 'the person is a core staff row (no second staff table)');
  perform pg_temp.ok((public.mgmt_staff_get(pid) -> 'private' ->> 'blood_group') = 'O+', 'the owner sees private details');

  -- 2. same idempotency key twice = one row; another user with the same key is refused
  r2 := public.mgmt_staff_save(null, 'Test Person A', '0300-0000001', date '2024-01-15', true, 'Salesman', null, 1, null, '20000000-0000-0000-0000-000000000001');
  perform pg_temp.ok(r2 = r and (select count(*) from public.staff where full_name = 'Test Person A') = 1, 'the same key twice creates one person');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person A', null, null, true, null, null, null, null, '20000000-0000-0000-0000-000000000001')$q$, 'another person cannot reuse the owner''s key', '42501');
  reset role;

  -- 3. validation
  perform pg_temp.as_user(a::uuid, 'aal2');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'X', null, null, true, null, null, null, null, gen_random_uuid())$q$, 'a one-letter name is refused', 'name must');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', 'abc', null, true, null, null, null, null, gen_random_uuid())$q$, 'a bad phone is refused', 'phone');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', null, current_date + 5, true, null, null, null, null, gen_random_uuid())$q$, 'a future joining date is refused', 'joining date');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', null, null, true, null, 'bad code!', null, null, gen_random_uuid())$q$, 'a bad staff code is refused', 'staff code');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', null, null, true, null, null, 1000, null, gen_random_uuid())$q$, 'order above 999 is refused', 'order');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', null, null, true, null, null, null, '{"blood_group":"Z+"}'::jsonb, gen_random_uuid())$q$, 'a bad blood group is refused', 'blood group');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', null, null, null, null, null, null, null, gen_random_uuid())$q$, 'missing active flag is refused', 'active');
  perform pg_temp.fails($q$select public.mgmt_staff_save(gen_random_uuid(), 'Test Person B', null, null, true, null, null, null, null, gen_random_uuid())$q$, 'an unknown person is refused', 'unknown staff');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person B', null, null, true, null, null, null, null, null)$q$, 'a missing key is refused', 'idempotency key');
  perform pg_temp.ok((select count(*) from public.staff where full_name = 'Test Person B') = 0, 'refused saves left nothing behind');

  -- 4. staff codes: a manual code is kept, duplicates are refused, automatic codes skip used ones
  r2 := public.mgmt_staff_save(null, 'Test Person B', null, null, true, 'Cashier', 'emp-002', 2, null, gen_random_uuid());
  perform pg_temp.ok(r2 ->> 'staff_code' = 'EMP-002', 'a typed code is kept (and upper-cased)');
  pid2 := (r2 ->> 'staff_id')::uuid;
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person C', null, null, true, null, 'EMP-002', null, null, gen_random_uuid())$q$, 'a duplicate code is refused', 'already used');
  perform pg_temp.ok((public.mgmt_staff_save(null, 'Test Person C', null, null, true, null, null, null, null, gen_random_uuid()) ->> 'staff_code') <> 'EMP-002', 'an automatic code never reuses a taken code');

  -- 5. edit: details change, deactivate (never delete), code unchanged when not typed, a person without details gets them
  perform public.mgmt_staff_save(pid, 'Test Person A', '0300-0000001', date '2024-01-15', false, 'Senior Salesman', null, 3, null, gen_random_uuid());
  perform pg_temp.ok((select not active from public.staff where id = pid) and (select designation from public.mgmt_staff_details where staff_id = pid) = 'Senior Salesman', 'a person can be deactivated and re-titled');
  perform pg_temp.ok((select staff_code from public.mgmt_staff_details where staff_id = pid) = code1, 'the code stays when it is not typed again');
  perform pg_temp.ok((select address from public.mgmt_staff_private where staff_id = pid) = 'Test Street 1', 'private details are unchanged when none are sent');
  r2 := public.mgmt_staff_save('10000000-0000-0000-0000-00000000000b', 'Test Junior B', null, null, true, 'Guard', null, 9, null, gen_random_uuid());
  perform pg_temp.ok((select count(*) from public.mgmt_staff_details where staff_id = '10000000-0000-0000-0000-00000000000b') = 1, 'an existing core person without details gets a details row');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_list()) = (select count(*) from public.staff), 'the list shows every core person, even without a login');
  perform pg_temp.ok((select full_name from public.mgmt_staff_list() limit 1) = 'Test Person B', 'the list follows the order number first');
  reset role;
  tot := (select count(*) from public.staff); tot_d := (select count(*) from public.mgmt_staff_details);
  perform pg_temp.fails($q$delete from public.staff where id = (select staff_id from public.mgmt_staff_details limit 1)$q$, 'a person with Manager records can never be deleted', 'violates foreign key');

  -- 6. private details and the log
  perform pg_temp.ok((select count(*) from public.activity_log where new_value::text like '%Test Street%' or old_value::text like '%Test Street%' or new_value::text like '%0300-0000001%') = 0, 'private values and phone numbers never reach the activity log');
  perform pg_temp.ok((select count(*) from public.activity_log where action in ('mgmt.staff_created','mgmt.staff_saved')) >= 5, 'saving a person is logged');

  -- 7. notes
  perform pg_temp.as_user(a::uuid, 'aal2');
  k := gen_random_uuid();
  r := public.mgmt_note_add(pid, 'Test note: spoke about timing', k);
  nid := (r ->> 'id')::uuid;
  perform pg_temp.ok(public.mgmt_note_add(pid, 'Test note: spoke about timing', k) = r and (select count(*) from public.mgmt_staff_notes where staff_id = pid) = 1, 'the same key twice adds one note');
  perform pg_temp.fails(format($q$select public.mgmt_note_add(%L, '   ', gen_random_uuid())$q$, pid), 'an empty note is refused', '1 to 2000');
  perform pg_temp.fails($q$select public.mgmt_note_add(gen_random_uuid(), 'x', gen_random_uuid())$q$, 'a note for an unknown person is refused', 'unknown staff');
  perform public.mgmt_note_remove(nid, 'added by mistake');
  perform public.mgmt_note_remove(nid, 'again');
  perform pg_temp.ok((select deleted_at is not null and delete_reason = 'added by mistake' and body = 'Test note: spoke about timing' from public.mgmt_staff_notes where id = nid), 'removing a note keeps its text and the first reason; a retry is harmless');
  reset role;
  perform pg_temp.fails(format($q$update public.mgmt_staff_notes set body = 'changed' where id = %L$q$, nid), 'a note''s text cannot be changed, even by the database owner', 'cannot be changed');
  perform pg_temp.fails(format($q$delete from public.mgmt_staff_notes where id = %L$q$, nid), 'a note cannot be deleted, even by the database owner', 'cannot be deleted');
  perform pg_temp.ok((select count(*) from public.activity_log where action like 'mgmt.note%' and (new_value::text like '%spoke about%')) = 0, 'note text never reaches the activity log');

  -- 8. a junior who holds every normal permission still sees and does nothing
  perform pg_temp.as_user(j::uuid);
  foreach tbl in array array['mgmt_staff_details','mgmt_staff_private','mgmt_staff_notes'] loop
    execute format('select count(*) from public.%I', tbl) into n;
    perform pg_temp.ok(n = 0, 'junior with every normal permission reads no rows of ' || tbl);
  end loop;
  perform pg_temp.fails($q$select * from public.mgmt_save_keys$q$, 'the key table is not readable', 'permission denied');
  perform pg_temp.fails($q$select * from public.mgmt_staff_list()$q$, 'junior cannot list staff', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_staff_get(%L)$q$, pid), 'junior cannot open a staff card', '42501');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person Z', null, null, true, null, null, null, null, gen_random_uuid())$q$, 'junior cannot add a person', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_note_add(%L, 'x', gen_random_uuid())$q$, pid), 'junior cannot add a note', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_note_remove(%L, 'x')$q$, nid), 'junior cannot remove a note', '42501');
  reset role;

  -- 9. the owner without MFA holds nothing
  perform pg_temp.as_user(a::uuid, 'aal1');
  perform pg_temp.fails($q$select * from public.mgmt_staff_list()$q$, 'an owner without MFA cannot list staff', '42501');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person Z', null, null, true, null, null, null, null, gen_random_uuid())$q$, 'an owner without MFA cannot add a person', '42501');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_details) = 0, 'an owner without MFA reads no rows');
  reset role;

  -- 10. anon has nothing
  set local role anon;
  perform pg_temp.fails($q$select * from public.mgmt_staff_details$q$, 'anon cannot read staff details', 'permission denied');
  perform pg_temp.fails($q$select * from public.mgmt_staff_private$q$, 'anon cannot read private details', 'permission denied');
  perform pg_temp.fails($q$select * from public.mgmt_staff_notes$q$, 'anon cannot read notes', 'permission denied');
  perform pg_temp.fails($q$select * from public.mgmt_staff_list()$q$, 'anon cannot call the list', 'permission denied');
  reset role;

  -- 11. direct writes are refused even for the owner at MFA level 2
  perform pg_temp.as_user(a::uuid, 'aal2');
  foreach tbl in array array['mgmt_staff_details','mgmt_staff_private','mgmt_staff_notes','mgmt_save_keys'] loop
    perform pg_temp.fails(format('delete from public.%I', tbl), 'direct delete refused on ' || tbl, 'permission denied');
  end loop;
  perform pg_temp.fails($q$update public.mgmt_staff_details set designation = 'x'$q$, 'direct update refused on details', 'permission denied');
  perform pg_temp.fails($q$update public.mgmt_staff_private set address = 'x'$q$, 'direct update refused on private', 'permission denied');
  perform pg_temp.fails($q$update public.mgmt_staff_notes set body = 'x'$q$, 'direct update refused on notes', 'permission denied');
  perform pg_temp.fails($q$insert into public.mgmt_staff_notes(staff_id, body) values (gen_random_uuid(), 'x')$q$, 'direct insert refused on notes', 'permission denied');
  perform pg_temp.fails($q$insert into public.mgmt_staff_details(staff_id, staff_code) values (gen_random_uuid(), 'EMP-900')$q$, 'direct insert refused on details', 'permission denied');
  perform pg_temp.fails($q$select public.mgmt_idem_put(gen_random_uuid(), 'x', '{}'::jsonb)$q$, 'the internal key helpers cannot be called from the app', 'permission denied');
  reset role;

  -- 12. sharing one key at a time
  -- viewer: staff_view only
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_list()) = tot, 'a viewer (staff_view) can list the staff');
  perform pg_temp.ok((public.mgmt_staff_get(pid) ->> 'private_visible') = 'false' and (public.mgmt_staff_get(pid) -> 'private') = 'null'::jsonb, 'a viewer never receives private details');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_private) = 0 and (select count(*) from public.mgmt_staff_notes) = 0, 'a viewer reads no private rows and no notes');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_details) = tot_d, 'a viewer reads the non-private details');
  perform pg_temp.fails($q$select public.mgmt_staff_save(null, 'Test Person Z', null, null, true, null, null, null, null, gen_random_uuid())$q$, 'a viewer cannot add a person', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_note_add(%L, 'x', gen_random_uuid())$q$, pid), 'a viewer cannot add a note', '42501');
  reset role;
  -- editor: staff_edit only (can edit, cannot touch private)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform public.mgmt_staff_save(pid, 'Test Person A', '0300-0000001', date '2024-01-15', true, 'Salesman', null, 1, null, gen_random_uuid());
  perform pg_temp.ok((public.mgmt_staff_get(pid) ->> 'active') = 'true' and (public.mgmt_staff_get(pid) ->> 'designation') = 'Salesman', 'an editor (staff_edit) can change a person');
  perform pg_temp.fails(format($q$select public.mgmt_staff_save(%L, 'Test Person A', null, null, true, null, null, 1, '{"address":"Hacked"}'::jsonb, gen_random_uuid())$q$, pid), 'an editor cannot write private details', '42501');
  perform pg_temp.ok((public.mgmt_staff_get(pid) -> 'private') = 'null'::jsonb, 'an editor cannot read private details either');
  reset role;
  perform pg_temp.ok((select address from public.mgmt_staff_private where staff_id = pid) = 'Test Street 1', 'private details survive an editor''s save');
  -- editor with private
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
  perform public.mgmt_staff_save(pid, 'Test Person A', '0300-0000001', date '2024-01-15', true, 'Salesman', null, 1, '{"address":"Test Street 2","blood_group":"A-"}'::jsonb, gen_random_uuid());
  perform pg_temp.ok((public.mgmt_staff_get(pid) -> 'private' ->> 'address') = 'Test Street 2', 'staff_edit + staff_private can edit private details');
  reset role;
  -- notes only
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  perform pg_temp.ok((public.mgmt_note_add(pid, 'Test note from a sharer', gen_random_uuid()) ->> 'id') is not null, 'a notes-only person can add a note');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_notes where deleted_at is null) = 1, 'and read notes');
  perform pg_temp.fails($q$select * from public.mgmt_staff_list()$q$, 'but cannot list the registry', '42501');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_details) = 0, 'and reads no staff details');
  reset role;

  -- 13. a Deny beats a grant
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000d1','mgmt.staff_view','deny');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.ok((select count(*) from public.mgmt_staff_details) = tot_d, 'an editor still reads details through staff_edit');
  reset role;
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000d1','mgmt.staff_edit','deny')
    on conflict (user_id, perm_key) do update set effect = 'deny';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.fails($q$select * from public.mgmt_staff_list()$q$, 'a Deny on both keys removes access', '42501');
  reset role;
end $t$;
rollback;

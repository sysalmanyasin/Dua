-- Security tests for 0001_core. Run by supabase/tests/run.sh; any failed assert aborts.
\set ON_ERROR_STOP on
begin;

create function pg_temp.as_user(uid uuid, lvl text default 'aal1', r text default 'authenticated') returns void
language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', r)::text, true);
  execute format('set local role %I', r);
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.denied(sql text, msg text) returns void language plpgsql as $$
declare n int; begin
  begin execute sql; get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL (not denied, % rows): %', n, msg; end if;
    raise notice 'pass (0 rows): %', msg;
  exception when insufficient_privilege or check_violation then raise notice 'pass (denied): %', msg;
  end; end $$;

-- fixtures (as superuser)
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@test'),
 ('00000000-0000-0000-0000-0000000000b1','junior@test'),
 ('00000000-0000-0000-0000-0000000000b2','senior@test'),
 ('00000000-0000-0000-0000-0000000000c1','outsider@test'),
 ('00000000-0000-0000-0000-0000000000d1','disabled@test'),
 ('00000000-0000-0000-0000-0000000000e1','expired@test');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior One'),
 ('10000000-0000-0000-0000-000000000004','Disabled One'),('10000000-0000-0000-0000-000000000005','Expired One');
insert into public.profiles(user_id, staff_id, username, role_template, disabled_at, expires_at) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior',null,null),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','senior1','senior',null,null),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-000000000004','disabled1','junior',now(),null),
 ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-000000000005','expired1','junior',null,now() - interval '1 day');

-- 1. bootstrap works only once, and not from the app
do $t$ begin
  begin perform public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000c1','x','X'); raise exception 'FAIL: second bootstrap accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'pass: a second bootstrap is refused'; end;
end $t$;
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000c1','hack','Hack');
    raise exception 'FAIL: authenticated called bootstrap';
  exception when insufficient_privilege then raise notice 'pass: authenticated cannot call bootstrap'; end;
  reset role;
end $t$;

-- 2. outsider (valid login, no profile) has nothing
do $t$ declare c jsonb; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(not public.has_perm('sales.view_last_day'), 'outsider has no permission');
  perform pg_temp.ok(public.my_context() is null, 'outsider gets no context');
  select count(*) into n from public.profiles; perform pg_temp.ok(n = 0, 'outsider sees no profiles');
  select count(*) into n from public.settings; perform pg_temp.ok(n = 2, 'outsider sees only staff-visible settings');
  select count(*) into n from public.staff; perform pg_temp.ok(n = 0, 'outsider sees no staff');
  reset role;
end $t$;

-- 3. anon has no access at all
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'aal1', 'anon');
  begin perform count(*) from public.profiles; raise exception 'FAIL: anon read profiles';
  exception when insufficient_privilege then raise notice 'pass: anon cannot read profiles'; end;
  begin perform public.has_perm('x.y'); raise exception 'FAIL: anon ran has_perm';
  exception when insufficient_privilege then raise notice 'pass: anon cannot run has_perm'; end;
  reset role;
end $t$;

-- 4. junior: preset permissions, nothing more
do $t$ declare n int; c jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.has_perm('closing.enter_own'), 'junior can enter own closing');
  perform pg_temp.ok(public.has_perm('sales.view_last_day'), 'junior can see last day sale');
  perform pg_temp.ok(not public.has_perm('sales.view_history'), 'junior cannot see sales history');
  perform pg_temp.ok(not public.has_perm('mgmt.salary'), 'junior cannot see salaries');
  perform pg_temp.ok(not public.has_perm('users.manage'), 'junior cannot manage users');
  select count(*) into n from public.profiles; perform pg_temp.ok(n = 1, 'junior sees only own profile');
  select count(*) into n from public.staff; perform pg_temp.ok(n = 1, 'junior sees only own staff record');
  select count(*) into n from public.settings where key = 'till_float'; perform pg_temp.ok(n = 0, 'junior cannot read till_float');
  c := public.my_context(); perform pg_temp.ok(c ->> 'role' = 'junior' and jsonb_array_length(c -> 'permissions') = 5, 'junior context lists exactly 5 permissions');
  perform pg_temp.denied($$update public.profiles set role_template = 'admin' where username = 'junior1'$$, 'junior cannot promote self');
  perform pg_temp.denied($$insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1','users.manage','grant')$$, 'junior cannot grant self permissions');
  perform pg_temp.denied($$update public.settings set value = '0'$$, 'junior cannot edit settings');
  perform pg_temp.denied($$select count(*) from public.setup_codes$$, 'junior cannot touch setup codes');
  perform pg_temp.denied($$select count(*) from public.login_attempts$$, 'junior cannot touch login attempts');
  begin perform public.log_activity('fake','x','1',null,null,'forged'); raise exception 'FAIL: forged log';
  exception when insufficient_privilege then raise notice 'pass: junior cannot forge activity log'; end;
  begin perform public.settings_set('till_float','1','because'); raise exception 'FAIL: junior set setting';
  exception when sqlstate '42501' then raise notice 'pass: junior cannot call settings_set'; end;
  reset role;
  select count(*) into n from public.profiles where username='junior1' and role_template='junior'; perform pg_temp.ok(n = 1, 'junior role is unchanged');
end $t$;

-- 5. admin without MFA is powerless; with MFA has everything
do $t$ declare c jsonb; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(not public.has_perm('users.manage'), 'admin at aal1 has no permission');
  c := public.my_context(); perform pg_temp.ok((c ->> 'mfa_ok')::boolean = false and jsonb_array_length(c -> 'permissions') = 0, 'admin at aal1 gets no permissions and mfa_ok=false');
  select count(*) into n from public.profiles; perform pg_temp.ok(n = 1, 'admin at aal1 sees only own profile');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(public.has_perm('users.manage') and public.has_perm('mgmt.salary'), 'admin at aal2 has permissions');
  select count(*) into n from public.profiles; perform pg_temp.ok(n = 5, 'admin at aal2 sees all profiles');
  c := public.my_context(); perform pg_temp.ok(jsonb_array_length(c -> 'permissions') = 25, 'admin context lists all 25 permissions');
  reset role;
end $t$;

-- 6. per-user grant / deny overrides the preset
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b1','sales.view_history','grant','test');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b1','closing.enter_own','deny','test');
  perform pg_temp.denied($q$insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','users.manage','grant')$q$, 'admin cannot write permissions directly (must use the logged function)');
  begin perform public.set_user_permission('00000000-0000-0000-0000-0000000000a1','users.manage','deny'); raise exception 'FAIL: admin target allowed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'pass: admin permissions cannot be altered'; end;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.has_perm('sales.view_history'), 'granted extra permission works');
  perform pg_temp.ok(not public.has_perm('closing.enter_own'), 'deny beats the role preset');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok(public.has_perm('closing.enter_own') and not public.has_perm('sales.view_history'), 'other users are unaffected');
  reset role;
end $t$;

-- 6b. role changes and permission changes are logged; non-admins cannot make them
do $t$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.set_user_permission('00000000-0000-0000-0000-0000000000b1','users.manage','grant'); raise exception 'FAIL: junior granted self';
  exception when sqlstate '42501' then raise notice 'pass: junior cannot call set_user_permission'; end;
  begin perform public.set_user_role('00000000-0000-0000-0000-0000000000b1','senior'); raise exception 'FAIL: junior changed role';
  exception when sqlstate '42501' then raise notice 'pass: junior cannot call set_user_role'; end;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_role('00000000-0000-0000-0000-0000000000b2','junior');
  select count(*) into n from public.activity_log where action in ('permission.set','role.set'); perform pg_temp.ok(n = 3, 'role and permission changes are in the activity log');
  perform public.set_user_role('00000000-0000-0000-0000-0000000000b2','senior');
  reset role;
end $t$;

-- 7. disabled and expired logins stop working
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.ok(not public.has_perm('closing.enter_own') and public.my_context() is null, 'disabled user has nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  perform pg_temp.ok(not public.has_perm('closing.enter_own') and public.my_context() is null, 'expired user has nothing');
  reset role;
end $t$;

-- 8. settings change is versioned, needs a reason, and is logged
do $t$ declare n int; v int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  begin perform public.settings_set('till_float','50000',''); raise exception 'FAIL: no reason accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'pass: reason is required'; end;
  perform public.settings_set('till_float','50000','test change');
  select version into v from public.settings where key='till_float'; perform pg_temp.ok(v = 2, 'setting version incremented');
  select count(*) into n from public.settings_history where key='till_float'; perform pg_temp.ok(n = 1, 'history row written');
  select count(*) into n from public.activity_log where action='settings.set'; perform pg_temp.ok(n = 1, 'activity logged');
  reset role;
end $t$;

-- 9. activity log is append-only, even for the superuser
do $t$ begin
  begin update public.activity_log set action = 'x'; raise exception 'FAIL: log was updated';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'pass: activity log cannot be updated'; end;
  begin delete from public.activity_log; raise exception 'FAIL: log was deleted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'pass: activity log cannot be deleted'; end;
end $t$;

rollback;

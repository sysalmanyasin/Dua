-- Tests for 1205_owner_only_permissions_guard: owner-only permissions cannot be granted to staff; other grants and all denies still work.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.raises(q text, state text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = state; end $$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000002','Senior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior2','senior');

do $t$
declare
  o uuid := '00000000-0000-0000-0000-0000000000a1'; s uuid := '00000000-0000-0000-0000-0000000000c1'; k text; has boolean;
begin
  perform pg_temp.as_user(o, 'aal2');
  foreach k in array array['tasks.manage', 'ops.view', 'notifications.view'] loop
    perform pg_temp.ok(pg_temp.raises(format('select public.set_user_permission(%L, %L, %L)', s, k, 'grant'), '42501'), format('the owner cannot grant %s to a staff member', k));
  end loop;
  reset role;
  perform pg_temp.ok(not exists (select 1 from public.user_permissions where user_id = s and perm_key in ('tasks.manage', 'ops.view', 'notifications.view') and effect = 'grant'), 'and nothing was stored');

  perform pg_temp.as_user(o, 'aal2');
  perform public.set_user_permission(s, 'tasks.verify', 'grant');
  perform public.set_user_permission(s, 'tasks.manage', 'deny');
  reset role;
  perform pg_temp.ok(exists (select 1 from public.user_permissions where user_id = s and perm_key = 'tasks.verify' and effect = 'grant'), 'a verifier grant still works');
  perform pg_temp.ok(exists (select 1 from public.user_permissions where user_id = s and perm_key = 'tasks.manage' and effect = 'deny'), 'an owner-only permission can still be denied');
  perform pg_temp.as_user(o, 'aal2');
  perform public.set_user_permission(s, 'tasks.manage', null);
  reset role;
  perform pg_temp.ok(not exists (select 1 from public.user_permissions where user_id = s and perm_key = 'tasks.manage'), 'and cleared');
  perform pg_temp.as_user(s);
  select public.has_perm('tasks.manage') into has;
  reset role;
  perform pg_temp.ok(has is false, 'a Senior never ends up with the owner controls');
end $t$;
rollback;

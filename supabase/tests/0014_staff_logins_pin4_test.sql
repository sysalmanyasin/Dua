-- Tests for 0014_staff_logins_pin4 (Audit 0, T4): one login per person, and the list of locked usernames the owner sees.
-- The 5-failures-in-60-minutes rule must match supabase/functions/_shared/validate.ts. Invented people.
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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','b@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Plain');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','plain','junior');
-- one login per person: a second profile for the same staff row is refused
do $t$ declare a uuid := '00000000-0000-0000-0000-0000000000a1'; b uuid := '00000000-0000-0000-0000-0000000000b1'; r text[]; begin
  perform pg_temp.fails('insert into public.profiles(user_id, staff_id, username, role_template) values (gen_random_uuid(), ''10000000-0000-0000-0000-000000000001'', ''twin'', ''junior'')', 'a second login for the same person is refused', 'profiles_one_per_staff');
  insert into public.login_attempts(username, ip_hash, success, at) values
    ('ali', 'h1', false, now() - interval '5 minutes'), ('ali', 'h1', false, now() - interval '10 minutes'), ('ali', 'h1', false, now() - interval '20 minutes'),
    ('ali', 'h1', false, now() - interval '30 minutes'), ('ali', 'h1', false, now() - interval '40 minutes'),
    ('bob', 'h2', false, now() - interval '5 minutes'), ('bob', 'h2', false, now() - interval '6 minutes'), ('bob', 'h2', false, now() - interval '7 minutes'), ('bob', 'h2', false, now() - interval '8 minutes'),
    ('cyd', 'h3', false, now() - interval '1 minute'), ('cyd', 'h3', false, now() - interval '2 minutes'), ('cyd', 'h3', false, now() - interval '3 minutes'),
    ('cyd', 'h3', false, now() - interval '4 minutes'), ('cyd', 'h3', true, now() - interval '3 minutes'), ('cyd', 'h3', false, now() - interval '61 minutes'),
    ('dee', 'h4', false, now() - interval '61 minutes'), ('dee', 'h4', false, now() - interval '62 minutes'), ('dee', 'h4', false, now() - interval '63 minutes'),
    ('dee', 'h4', false, now() - interval '64 minutes'), ('dee', 'h4', false, now() - interval '65 minutes'),
    ('eve', 'h5', true, now() - interval '1 minute'), ('eve', 'h5', true, now() - interval '2 minutes'), ('eve', 'h5', true, now() - interval '3 minutes'),
    ('eve', 'h5', true, now() - interval '4 minutes'), ('eve', 'h5', true, now() - interval '5 minutes'), ('eve', 'h5', true, now() - interval '6 minutes');
  perform pg_temp.as_user(a, 'aal2');
  r := public.access_locked_usernames();
  perform pg_temp.ok(r = array['ali'], 'exactly the username with 5 failures inside the hour is locked (4 failures, 5 old failures and 6 successes are not)');
  perform pg_temp.ok(not ('bob' = any (r)), 'four failures do not lock');
  perform pg_temp.ok(not ('dee' = any (r)), 'failures older than 60 minutes do not count');
  perform pg_temp.ok(not ('eve' = any (r)), 'successful sign-ins never count');
  perform pg_temp.ok(not ('cyd' = any (r)), 'four recent failures plus one old one is not locked');
  -- the window and the threshold match the Edge Function (LOCK_WINDOW_MIN = 60, MAX_FAILS_PER_USER = 5)
  reset role; insert into public.login_attempts(username, ip_hash, success, at) values ('bob', 'h2', false, now() - interval '59 minutes'); perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok('bob' = any (public.access_locked_usernames()), 'a fifth failure at 59 minutes locks');
  reset role; delete from public.login_attempts where username = 'ali' and success = false; perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok(not ('ali' = any (public.access_locked_usernames())), 'clearing the failures (unlock) removes the lock');
  perform pg_temp.ok(public.access_locked_usernames() is not null and cardinality(public.access_locked_usernames()) = 1, 'the answer is a plain list of usernames');
  reset role;
  perform pg_temp.as_user(b);
  perform pg_temp.fails('select public.access_locked_usernames()', 'a basic staff member cannot read who is locked', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal1');
  perform pg_temp.fails('select public.access_locked_usernames()', 'the owner without MFA cannot read it either', '42501');
  reset role;
  perform pg_temp.ok(not has_function_privilege('anon', 'public.access_locked_usernames()', 'execute'), 'the visitor role cannot call it');
end $t$;
rollback;

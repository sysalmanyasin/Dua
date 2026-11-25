-- Tests for 1300_ntf_core and 1301_ntf_reads: a person's own inbox.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.owner() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2') $$;
create function pg_temp.junior() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1') $$;
create function pg_temp.senior() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1') $$;
create function pg_temp.named() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1') $$;
create function pg_temp.msgs(uid uuid, k text default null) returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object(kind, kind, 'title', title, 'body', body, 'href', href) order by created_at, id), '[]'::jsonb) from public.ntf_messages where user_id = uid and (k is null or kind = k) $$;
create function pg_temp.raises(q text, state text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = state; end $$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t'),('00000000-0000-0000-0000-0000000000d1','n@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two'),('10000000-0000-0000-0000-000000000003','Senior Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior2','senior'),
  ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-000000000003','senior3','senior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000d1', 'tasks.verify', 'grant');

do $t$
declare j uuid := '00000000-0000-0000-0000-0000000000b1'; s uuid := '00000000-0000-0000-0000-0000000000c1'; o uuid := '00000000-0000-0000-0000-0000000000a1';
  a uuid; b uuid; c uuid; v jsonb; cj boolean := true;
begin
  -- ── permission and closed table ──
  perform pg_temp.ok(exists (select 1 from public.permissions where key = 'ntf.view_own'), 'the permission exists');
  perform pg_temp.ok((select count(*) from public.role_permissions where perm_key = 'ntf.view_own' and role in ('junior', 'senior')) = 2, 'Junior and Senior carry it');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'ntf.view_own' and role not in ('junior', 'senior')), 'no other role template carries it');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ntf_messages', 'select') and not has_table_privilege('anon', 'public.ntf_messages', 'select')
    and (select relrowsecurity from pg_class where oid = 'public.ntf_messages'::regclass), 'the table is closed to the browser (row level security on, no grant)');

  -- ── sending ──
  a := public.ntf_send(j, 'task.assigned', 'A task was given to you', 'Count the fridge', '/tasks', 'k1');
  perform pg_temp.ok(a is not null, 'a message is sent to a person with a login');
  perform pg_temp.ok(public.ntf_send(j, 'task.assigned', 'A task was given to you', 'again', '/tasks', 'k1') is null, 'the same dedupe key sends nothing the second time');
  perform pg_temp.ok(public.ntf_send(s, 'task.assigned', 'A task was given to you', 'x', '/tasks', 'k1') is not null, 'the same key for another person is a different message');
  perform pg_temp.ok(public.ntf_send(gen_random_uuid(), 'task.assigned', 'Hello there', '', null, null) is null, 'no login, no message (and no error)');
  perform pg_temp.ok(public.ntf_send(j, 'Bad Kind!', 'Hello there') is null and public.ntf_send(j, 'task.x', 'ab') is null and public.ntf_send(j, 'task.x', 'Hello', '', 'https://evil.example') is null, 'a bad kind, a too-short title or an outside link is refused quietly, never raised');
  perform pg_temp.ok(public.ntf_send(null, 'task.x', 'Hello there') is null, 'a null person is ignored');
  update public.profiles set disabled_at = now() where user_id = s;
  perform pg_temp.ok(public.ntf_send(s, 'task.x', 'Hello there') is null, 'a disabled login gets nothing');
  update public.profiles set disabled_at = null where user_id = s;
  c := public.ntf_send(j, 'task.x', 'Long one', repeat('x', 900));
  perform pg_temp.ok(length((select body from public.ntf_messages where id = c)) = 300, 'a long body is cut to 300 characters');
  delete from public.ntf_messages where id = c;
  insert into public.ntf_messages (user_id, kind, title) select o, 'bulk.x', 'Bulk message' from generate_series(1, 500);
  perform pg_temp.ok(public.ntf_send(o, 'task.x', 'One too many') is null, 'a full inbox (500) drops the new message instead of growing without limit');
  delete from public.ntf_messages where user_id = o;

  -- ── reading ──
  b := public.ntf_send(j, 'task.returned', 'Sent back for correction', 'Fridge: count again', '/tasks', 'k2');
  perform pg_temp.junior();
  v := public.ntf_list_mine();
  perform pg_temp.ok(jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 2 and v -> 0 ->> 'kind' = 'task.returned' and (v -> 0 ->> 'read')::boolean = false, 'the person sees their own messages, newest first, as unread');
  perform pg_temp.ok(public.ntf_unread_count() = 2, 'two unread');
  perform pg_temp.ok(jsonb_array_length(public.ntf_list_mine(1)) = 1 and jsonb_array_length(public.ntf_list_mine(0)) = 1 and jsonb_array_length(public.ntf_list_mine(100000)) = 2 and jsonb_array_length(public.ntf_list_mine(null)) = 2, 'the limit is clamped to 1..100 and null means the default');
  perform pg_temp.ok(not (v -> 0 ? 'user_id'), 'the list never shows the user id');
  perform pg_temp.ok(public.ntf_mark_read(array[b, gen_random_uuid()]) = 1 and public.ntf_mark_read(array[b]) = 0, 'marking read changes only unread rows, and is idempotent');
  perform pg_temp.ok(public.ntf_unread_count() = 1 and (select count(*) from jsonb_array_elements(public.ntf_list_mine()) x where (x ->> 'read')::boolean) = 1, 'it shows as read');
  perform pg_temp.ok(public.ntf_mark_read(null) = 0 and public.ntf_mark_read('{}') = 0, 'null or empty ids change nothing');
  reset role;

  -- nobody can touch someone else's messages
  perform pg_temp.senior();
  perform pg_temp.ok(public.ntf_unread_count() = 1 and jsonb_array_length(public.ntf_list_mine()) = 1, 'a Senior sees only their own');
  perform pg_temp.ok(public.ntf_mark_read(array[a, b]) = 0, 'and cannot mark another person''s messages');
  reset role;
  perform pg_temp.ok((select count(*) from public.ntf_messages where user_id = j and read_at is null) = 1, 'the other person''s messages stayed unread');
  perform pg_temp.junior();
  perform pg_temp.ok(public.ntf_mark_all_read() = 1, 'mark all read clears the person''s own');
  perform pg_temp.ok(public.ntf_unread_count() = 0, 'none are left unread');
  perform pg_temp.ok(public.ntf_mark_all_read() = 0, 'and repeating it is harmless');
  reset role;
  perform pg_temp.ok((select count(*) from public.ntf_messages where user_id = s and read_at is null) = 1, 'and left the Senior''s alone');

  -- ── who may use it ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.ok(public.ntf_unread_count() = 0, 'a named verifier is just another staff member here');
  reset role;
  delete from public.role_permissions where role = 'senior' and perm_key = 'ntf.view_own';
  perform pg_temp.senior();
  perform pg_temp.ok(public.ntf_list_mine() is null and public.ntf_unread_count() is null and public.ntf_mark_all_read() = 0, 'without the permission everything answers null or zero');
  reset role;
  insert into public.role_permissions (role, perm_key) values ('senior', 'ntf.view_own');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform pg_temp.ok(public.ntf_list_mine() is null and public.ntf_unread_count() is null, 'a call with no signed-in user gets null');
  reset role;
  perform pg_temp.owner();
  perform pg_temp.ok(jsonb_typeof(public.ntf_list_mine()) = 'array', 'the Owner (second factor passed) has an inbox too');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.ntf_list_mine() is null, 'the Owner without the second factor gets nothing');
  reset role;

  -- ── housekeeping ──
  insert into public.ntf_messages (user_id, kind, title, created_at, read_at) values
    (j, 'old.read', 'Old read one', now() - interval '70 days', now() - interval '61 days'),
    (j, 'old.unread', 'Old unread one', now() - interval '190 days', null),
    (j, 'recent.read', 'Recent read one', now() - interval '70 days', now() - interval '10 days'),
    (j, 'recent.unread', 'Recent unread', now() - interval '100 days', null);
  perform pg_temp.ok(public.ntf_prune() = 2, 'prune removes read messages older than 60 days and anything older than 180 days');
  perform pg_temp.ok(exists (select 1 from public.ntf_messages where kind = 'recent.read') and exists (select 1 from public.ntf_messages where kind = 'recent.unread'), 'and keeps the rest');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.ntf_prune()', 'execute') and not has_function_privilege('anon', 'public.ntf_prune()', 'execute'), 'prune is not callable from the browser');
  if to_regclass('cron.job') is not null then execute 'select exists (select 1 from cron.job where jobname = ''ntf-prune-daily'' and schedule = ''0 22 * * *'')' into cj; end if;
  perform pg_temp.ok(cj, 'the daily prune job exists where pg_cron does');
end $t$;
rollback;

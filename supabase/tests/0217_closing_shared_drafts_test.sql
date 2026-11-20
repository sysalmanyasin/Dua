-- Tests for 0217_closing_shared_drafts_live: shared drafts, owner override, field-level patch, Realtime publication.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.refused(sql text, code text, msg text) returns void language plpgsql as $$
declare h text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint;
    if h is distinct from code then raise exception 'FAIL (wrong code "%" / "%"): %', h, sqlerrm, msg; end if;
    raise notice 'pass (refused as %): %', code, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),
 ('00000000-0000-0000-0000-0000000000b2','j2@t'),('00000000-0000-0000-0000-0000000000b3','n@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two'),('10000000-0000-0000-0000-000000000003','No Access');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','nobody','junior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b3','closing.enter_own','deny');

-- opening, then junior 1 starts a night closing
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"till": [9,0,0,0,0,0,0,0]}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": 1000, "hs": [{"label":"h","amount":100}]}');
  reset role;
end $t$;

-- 1. another closing user sees and works on the shared draft
do $t$ declare r jsonb; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.closings where status = 'draft' and not is_opening;
  perform pg_temp.ok(n = 1, 'a second closing user can read the shared draft');
  select count(*) into n from public.closing_hs_rows; perform pg_temp.ok(n = 1, 'and its rows');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.closing_my_recent()) e where e ->> 'mine' = 'false' and e ->> 'status' = 'draft'),
    'it is on their list, marked as not their own');
  perform pg_temp.ok(public.closing_compute((select id from public.closings where not is_opening and status = 'draft')) is not null, 'they can compute it');
  r := public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"alfalah": 3000, "overrides": {"customers": 12}}');
  perform pg_temp.ok((r ->> 'version')::int = 1, 'a patch does not bump the draft version');
  reset role;
  perform pg_temp.ok((select alfalah from public.closings where not is_opening) = 3000 and (select ov_customers from public.closings where not is_opening) = 12
    and (select sys_cash from public.closings where not is_opening) = 1000, 'only the given fields changed');
  -- a second override later keeps the first (the four overrides are laid over what is saved)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"overrides": {"curr_cc": 500}}');
  reset role;
  perform pg_temp.ok((select ov_customers from public.closings where not is_opening) = 12 and (select ov_curr_cc from public.closings where not is_opening) = 500,
    'patching one override leaves the others');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"overrides": {"customers": ""}}');
  reset role;
  perform pg_temp.ok((select ov_customers from public.closings where not is_opening) is null, 'an empty override clears just that one');
end $t$;

-- 2. what a patch refuses, and who is still shut out
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.refused($q$select public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"hs": []}')$q$, 'patch_simple_only', 'row sections are not patchable');
  perform pg_temp.refused($q$select public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"till": [1,0,0,0,0,0,0,0]}')$q$, 'patch_simple_only', 'nor cash counts');
  perform pg_temp.refused($q$select public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"opening": {"cc": 1}}')$q$, 'patch_simple_only', 'nor opening figures');
  perform pg_temp.refused($q$select public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"sys_cash": "abc"}')$q$, 'invalid_amount', 'a bad amount is refused');
  perform pg_temp.refused($q$select public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"overrides": {"nonsense": 1}}')$q$, 'invalid_payload', 'an unknown override is refused');
  perform pg_temp.refused($q$select public.closing_patch_draft(gen_random_uuid(), '{"sys_cash": 1}')$q$, 'not_allowed', 'an unknown key is refused');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.ok((select count(*) from public.closings) = 0, 'someone without closing.enter_own sees no draft');
  perform pg_temp.refused($q$select public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"sys_cash": 1}')$q$, 'not_allowed', 'and cannot patch it');
  reset role;
  set local role anon;
  begin
    perform public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"sys_cash": 1}');
    raise exception 'FAIL: anon patched a draft';
  exception when insufficient_privilege then raise notice 'pass: anon cannot patch';
  end;
  reset role;
end $t$;

-- 3. the owner can always save, author or not
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_patch_draft('a0000000-0000-0000-0000-000000000001', '{"keenu": 700}');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"hs": [{"label":"h","amount":150}]}', null, 1);
  reset role;
  perform pg_temp.ok((select keenu from public.closings where not is_opening) = 700, 'the owner patched a draft they did not start');
  perform pg_temp.ok((select amount from public.closing_hs_rows) = 150, 'and saved its rows');
end $t$;

-- 4. live sync
do $t$ begin
  perform pg_temp.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'closings'),
    'closings is in the Realtime publication');
end $t$;
rollback;

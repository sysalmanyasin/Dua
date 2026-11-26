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
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare nid uuid; ov jsonb; r jsonb; failed boolean; begin
  set local role service_role;
  nid := public.notify_owner('closing.corrected', '{}'::jsonb);
  perform pg_temp.ok(nid is not null, 'an alert is queued');
  perform pg_temp.ok((select title is null and body is null from public.notifications where id = nid), 'a new alert has no saved text until it is sent');

  perform public.notifications_record_text(nid, 'Closing Corrected - Evening 2026-11-25', E'Revision 2\nNet cash: Rs. 100');
  perform pg_temp.ok((select title = 'Closing Corrected - Evening 2026-11-25' and body like 'Revision 2%Net cash: Rs. 100' from public.notifications where id = nid), 'the sender saves the exact title and message');

  perform public.notifications_record_text(nid, repeat('t', 500), repeat('b', 9000));
  perform pg_temp.ok((select char_length(title) = 200 and char_length(body) = 4000 from public.notifications where id = nid), 'over-long text is cut to the limits, never raising');
  perform public.notifications_record_text('00000000-0000-0000-0000-00000000dead', 'x', 'y');
  perform pg_temp.ok(true, 'saving text for an alert that does not exist does nothing');
  reset role;

  -- who can save text
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  failed := false; begin perform public.notifications_record_text(nid, 'x', 'y'); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a signed-in user, even the owner, cannot save alert text');
  reset role;

  -- who can read it
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.tools_overview() is null, 'a junior gets no Tools overview');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.tools_overview() is null, 'the owner without the second factor sees nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  ov := public.tools_overview();
  r := ov -> 'notifications' -> 'recent' -> 0;
  perform pg_temp.ok(r ->> 'kind' = 'closing.corrected' and char_length(r ->> 'title') = 200 and char_length(r ->> 'body') = 4000, 'the owner sees the saved title and message in the Tools overview');
  perform pg_temp.ok(ov -> 'backups' is not null and ov -> 'feed' is not null, 'the rest of the overview is unchanged');
  reset role;
end $t$;
rollback;

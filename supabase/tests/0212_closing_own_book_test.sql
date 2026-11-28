-- Tests for 0212 / 0214 / 0216 Closing book functions (Audit 0): closing_book_own, closing_page_json (through the book), closing_prev_page,
-- closing_can_read, closing_saved_list. Fixture: the real opening/submit/draft functions, as in 0208. Invented people.
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
declare h text; m text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    if h is distinct from code then raise exception 'FAIL (wrong code "%" for "%", wanted "%"): %', h, m, code, msg; end if;
    raise notice 'pass (refused as %): %', code, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.denied(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlstate <> '42501' then raise exception 'FAIL (wrong error % "%"): %', sqlstate, sqlerrm, msg; end if;
    raise notice 'pass (database refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create temp table memo (k text primary key, v text);
grant all on memo to public;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t'), ('00000000-0000-0000-0000-0000000000b3','v@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000003','J Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','viewer','junior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b3','closing.view_all','grant');

do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"till": [9,0,0,0,0,0,0,0], "last_bill_no": 500}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 10000, "last_bill_no": 520, "till": [10,0,0,0,0,0,0,0], "vault": [0,1,0,0,0,0,0,0],
      "hs": [{"label": "HS A", "amount": 100}, {"label": "HS struck", "amount": 5, "deleted": true}],
      "deposits": [{"label": "Bank", "amount": 2000}],
      "mediq": [{"bill_no": "B1", "collected": 300, "pharmacy_bill": 250}],
      "credit": {"free": [{"label": "Ali", "amount": 400}]}, "misc": [{"label": "Courier", "amount": 500}]}');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000003', current_date - 5, 'morning', 'shift', '{"hs": [{"label": "Draft only", "amount": 9}]}');
  reset role;
end $t$;

do $t$ declare
  o uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1'; v uuid := '00000000-0000-0000-0000-0000000000b3';
  nid uuid := 'a0000000-0000-0000-0000-000000000001'; did uuid := 'a0000000-0000-0000-0000-000000000003'; oid uuid := 'e0000000-0000-0000-0000-000000000001';
  night uuid; draft uuid; opening uuid; book jsonb; pg jsonb; prev jsonb; src uuid;
begin
  select id into night from public.closings where idempotency_key = nid; select id into draft from public.closings where idempotency_key = did;
  select id into opening from public.closings where idempotency_key = oid;
  perform pg_temp.ok(night is not null and draft is not null and opening is not null, 'fixture: an opening, a submitted shift and a draft exist');

  -- a person who enters closings sees the whole submitted book (migration 0214), newest first, never a draft
  perform pg_temp.as_user(j);
  book := public.closing_book_own();
  perform pg_temp.ok(jsonb_array_length(book) = 2, 'the book holds the 2 submitted closings and not the draft');
  perform pg_temp.ok((book -> 0 ->> 'closing_id')::uuid = night and (book -> 1 ->> 'closing_id')::uuid = opening, 'newest business day first');
  perform pg_temp.ok(jsonb_array_length(public.closing_book_own(null, null, 60, draft)) = 0, 'asking for a draft by id returns nothing');
  perform pg_temp.ok(jsonb_array_length(public.closing_book_own(null, null, 60, night)) = 1, 'asking for one closing by id returns exactly that page');
  perform pg_temp.ok(jsonb_array_length(public.closing_book_own(current_date - 5, null)) = 1 and jsonb_array_length(public.closing_book_own(null, current_date - 6)) = 1, 'the from and to dates filter the book');
  perform pg_temp.ok(jsonb_array_length(public.closing_book_own(null, null, 0)) = 1 and jsonb_array_length(public.closing_book_own(null, null, -3)) = 1, 'a limit below 1 is raised to 1');
  perform pg_temp.ok(jsonb_array_length(public.closing_book_own(null, null, null)) = 2, 'a null limit uses the default');

  pg := book -> 0;
  perform pg_temp.ok(pg ->> 'staff' = 'J One' and pg ->> 'kind' = 'night' and pg ->> 'mode' = 'shift' and (pg ->> 'is_opening')::boolean = false, 'the page names the responsible person, the slot and the mode');
  perform pg_temp.ok(not (pg -> 'inputs' ? 'idempotency_key') and not (pg -> 'inputs' ? 'entered_by') and not (pg -> 'inputs' ? 'id'), 'the page leaves out internal ids and keys');
  perform pg_temp.ok(jsonb_array_length(pg -> 'hs') = 1 and pg -> 'hs' -> 0 ->> 'label' = 'HS A', 'a struck-out HS row is not shown');
  perform pg_temp.ok((pg -> 'deposits' -> 0 ->> 'amount')::numeric = 2000 and pg -> 'mediq' -> 0 ->> 'bill_no' = 'B1' and (pg -> 'misc' -> 0 ->> 'amount')::numeric = 500, 'deposits, MediQ and misc rows are included');
  perform pg_temp.ok(pg -> 'credit' -> 0 ->> 'label' = 'Ali' and (pg -> 'credit' -> 0 ->> 'amount')::numeric = 400, 'the credit line shows its label and amount');
  perform pg_temp.ok(pg ? 'results' and pg ? 'final_part' and pg ? 'shop' and (pg ->> 'day_no')::int >= 1, 'the page carries results, the final part, the shop header and a day number');

  -- the previous page
  select source_closing_id into src from public.closings where id = night;
  prev := public.closing_prev_page(night);
  perform pg_temp.ok(src is not null and (prev ->> 'closing_id')::uuid = src, 'the previous page of a shift is the closing it carried forward from');
  perform pg_temp.ok(public.closing_prev_page(opening) is null, 'the opening has no previous page');
  perform pg_temp.fails(format('select public.closing_prev_page(%L)', gen_random_uuid()), 'an unknown closing is refused, not answered with null', '42501');
  perform public.closing_prev_page(draft);
  perform pg_temp.ok(true, 'asking for a draft''s previous page is allowed and does not raise');
  reset role;

  -- the saved list
  perform pg_temp.as_user(j);
  perform pg_temp.ok(jsonb_array_length(public.closing_saved_list()) = 2 and not exists (select 1 from jsonb_array_elements(public.closing_saved_list()) e where e ->> 'status' <> 'submitted'), 'the saved list shows only submitted closings');
  perform pg_temp.ok(jsonb_array_length(public.closing_saved_list(0)) = 1, 'its limit is raised to 1');
  reset role;

  -- other roles
  perform pg_temp.as_user(v);
  perform pg_temp.ok(jsonb_array_length(public.closing_book_own()) = 2, 'a closing.view_all holder reads the book too');
  reset role;
  insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b9','x@t');
  insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000009','No Closing');
  insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b9','10000000-0000-0000-0000-000000000009','noclose','junior');
  insert into public.user_permissions(user_id, perm_key, effect) select '00000000-0000-0000-0000-0000000000b9', k, 'deny' from unnest(array['closing.enter_own','closing.view_all','closing.review','closing.correct','closing.settings']) k;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  perform pg_temp.refused('select public.closing_book_own()', 'not_allowed', 'a person with no closing right cannot read the book');
  perform pg_temp.refused('select public.closing_saved_list()', 'not_allowed', 'nor the saved list');
  perform pg_temp.fails(format('select public.closing_prev_page(%L)', night), 'nor a previous page', '42501');
  reset role;

  -- grants
  perform pg_temp.ok(not has_function_privilege('anon', 'public.closing_book_own(date,date,integer,uuid)', 'execute') and not has_function_privilege('anon', 'public.closing_prev_page(uuid)', 'execute') and not has_function_privilege('anon', 'public.closing_saved_list(integer)', 'execute'), 'the visitor role cannot call the book functions');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.closing_page_json(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.closing_can_read(uuid)', 'execute'), 'the raw page and permission helpers are not callable from the app, only through the checked functions');
end $t$;
rollback;

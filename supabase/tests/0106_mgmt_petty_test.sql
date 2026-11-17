-- Tests for 0106_mgmt_petty. All people, titles and figures here are invented.
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

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t'),
 ('00000000-0000-0000-0000-0000000000e1','e@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B'), ('10000000-0000-0000-0000-00000000000c','Test Petty C'),
 ('10000000-0000-0000-0000-00000000000d','Test Salary D'), ('10000000-0000-0000-0000-00000000000e','Test Closer E');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','petty_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','salary_d','junior'),
 ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-00000000000e','closer_e','junior');
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions where key not like 'mgmt.%' and key not like 'credit.%';
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','mgmt.petty_cash','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary_view','grant'),
 ('00000000-0000-0000-0000-0000000000e1','mgmt.close_month','grant');

do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date; m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi')::date)::date;
  m1 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '1 month')::date;
  m2 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '2 month')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1';
  g1 uuid := '30000000-0000-0000-0000-000000000001'; g2 uuid := '30000000-0000-0000-0000-000000000002'; g3 uuid := '30000000-0000-0000-0000-000000000003';
  r jsonb; k uuid; got record; n int; tbl text; sqls text[]; one jsonb; two jsonb;
begin
  one := jsonb_build_object('group_key', g1, 'title', 'Test voucher 1-10', 'lines', jsonb_build_array(
           jsonb_build_object('description', 'Test tea', 'amount', 450.5), jsonb_build_object('description', 'Test soap', 'amount', 1200)));
  two := jsonb_build_object('group_key', g2, 'title', 'Test voucher 11-20', 'lines', jsonb_build_array(jsonb_build_object('description', 'Test fuel', 'amount', 3000)));
  perform pg_temp.as_user(a, 'aal2');

  -- 1. save and read
  select count(*) into n from public.mgmt_petty_month(m1);
  perform pg_temp.ok(n = 0, 'an untouched month has no groups');
  k := gen_random_uuid();
  r := public.mgmt_petty_save(m1, jsonb_build_array(one, two), null, k);
  perform pg_temp.ok((r ->> 'changed')::int = 2 and public.mgmt_petty_save(m1, jsonb_build_array(one, two), null, k) = r, 'two groups saved; the same key twice saves once');
  select * into got from public.mgmt_petty_month(m1) order by title limit 1;
  perform pg_temp.ok(got.total = 1651 and got.revision = 0 and jsonb_array_length(got.lines) = 2 and (got.lines -> 0 ->> 'amount')::numeric = 451, 'a voucher total: 450.5 rounds to 451, plus 1,200 = 1,651');
  perform pg_temp.ok((select array_agg(title order by ord) from (select title, row_number() over () as ord from public.mgmt_petty_month(m1)) x) = array['Test voucher 1-10','Test voucher 11-20'], 'groups keep the order they were created in');
  r := public.mgmt_petty_save(m1, jsonb_build_array(one, two), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0 and (r ->> 'unchanged')::int = 2, 'saving the same vouchers adds nothing');

  -- 1b. a refund is a negative line and lowers the total
  perform public.mgmt_petty_save((m0 - interval '3 month')::date, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'Test refund voucher',
    'lines', jsonb_build_array(jsonb_build_object('description', 'Test purchase', 'amount', 1000), jsonb_build_object('description', 'Test refund', 'amount', -200)))), null, gen_random_uuid());
  perform pg_temp.ok((select total from public.mgmt_petty_month((m0 - interval '3 month')::date)) = 800, 'a refund line lowers the total (1,000 - 200 = 800)');

  -- 2. a change is a new revision; the old one stays
  one := jsonb_set(one, '{lines,0,amount}', '500');
  r := public.mgmt_petty_save(m1, jsonb_build_array(one, two), null, gen_random_uuid());
  select * into got from public.mgmt_petty_month(m1) where group_key = g1;
  perform pg_temp.ok((r ->> 'changed')::int = 1 and got.revision = 1 and got.total = 1700, 'a changed line is a new revision (total 1,700)');
  perform pg_temp.ok((select count(*) from public.mgmt_petty_groups g join public.mgmt_sheets s on s.id = g.sheet_id where s.month = m1 and g.group_key = g1) = 2, 'and the old revision is kept');

  -- 3. removing is a revision too, and a removed group can come back
  r := public.mgmt_petty_save(m1, jsonb_build_array(jsonb_build_object('group_key', g2, 'removed', true)), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 1 and (select count(*) from public.mgmt_petty_month(m1)) = 1, 'a removed group disappears from the month');
  perform pg_temp.ok((select count(*) from public.mgmt_petty_groups g join public.mgmt_sheets s on s.id = g.sheet_id where s.month = m1 and g.group_key = g2) = 2, 'but is never erased');
  r := public.mgmt_petty_save(m1, jsonb_build_array(jsonb_build_object('group_key', g2, 'removed', true)), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0, 'removing it again does nothing');
  r := public.mgmt_petty_save(m1, jsonb_build_array(two), null, gen_random_uuid());
  perform pg_temp.ok((select count(*) from public.mgmt_petty_month(m1)) = 2 and (select revision from public.mgmt_petty_month(m1) where group_key = g2) = 2, 'saving it again brings it back as a new revision');
  r := public.mgmt_petty_save(m1, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'removed', true)), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0, 'removing a group that never existed does nothing');

  -- 4. validation
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, '{"a":1}'::jsonb, null, gen_random_uuid())$q$, m1), 'groups must be a list', 'list');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, '[{"group_key":"nope","title":"x","lines":[]}]'::jsonb, null, gen_random_uuid())$q$, m1), 'a bad group id is refused', 'valid id');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', '  ', 'lines', jsonb_build_array(jsonb_build_object('description','x','amount',1)))), null, gen_random_uuid())$q$, m1), 'a group needs a title', 'title');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'x', 'lines', '[]'::jsonb)), null, gen_random_uuid())$q$, m1), 'a group needs a line', 'at least one line');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'x', 'lines', jsonb_build_array(jsonb_build_object('description','x','amount',0)))), null, gen_random_uuid())$q$, m1), 'a zero line is refused', 'cannot be zero');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'x', 'lines', jsonb_build_array(jsonb_build_object('description','x','amount','abc')))), null, gen_random_uuid())$q$, m1), 'a non-number is refused', 'numbers');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'x', 'lines', jsonb_build_array(jsonb_build_object('description','','amount',5)))), null, gen_random_uuid())$q$, m1), 'a line needs a description', 'description');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'x', 'lines', jsonb_build_array(jsonb_build_object('description',repeat('d',121),'amount',5)))), null, gen_random_uuid())$q$, m1), 'a 121-character description is refused', 'description');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, jsonb_build_array(jsonb_build_object('group_key', gen_random_uuid(), 'title', 'x', 'lines', jsonb_build_array(jsonb_build_object('description','x','amount',2000000000)))), null, gen_random_uuid())$q$, m1), 'a huge amount is refused', 'out of range');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, '[]'::jsonb, null, gen_random_uuid())$q$, (m0 + interval '1 month')::date), 'a future month is refused', 'has begun');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, '[]'::jsonb, null, gen_random_uuid())$q$, m1 + 3), 'a month not on the 1st is refused', 'first of the month');
  perform pg_temp.fails(format($q$select * from public.mgmt_petty_month(%L)$q$, m1 + 3), 'reading a month not on the 1st is refused', 'first day');
  perform pg_temp.ok((select count(*) from public.mgmt_petty_month(m1)) = 2, 'refused saves left nothing behind');

  -- 5. copy to next month (the old behaviour): clones the current groups, with their amounts, into a month with none
  r := public.mgmt_petty_save(m1, jsonb_build_array(jsonb_build_object('group_key', g2, 'removed', true)), null, gen_random_uuid());
  k := gen_random_uuid();
  r := public.mgmt_petty_copy(m1, m0, k);
  perform pg_temp.ok((r ->> 'groups')::int = 1 and public.mgmt_petty_copy(m1, m0, k) = r, 'copy clones the one current group; the same key twice copies once');
  select * into got from public.mgmt_petty_month(m0);
  perform pg_temp.ok(got.title = 'Test voucher 1-10' and got.total = 1700 and got.revision = 0 and got.group_key <> g1, 'the copy keeps title, lines and amounts under a new id');
  perform pg_temp.ok((select reason from public.mgmt_petty_groups g join public.mgmt_sheets s on s.id = g.sheet_id where s.month = m0 limit 1) like 'copied from%', 'and says where it came from');
  perform pg_temp.fails(format($q$select public.mgmt_petty_copy(%L, %L, gen_random_uuid())$q$, m1, m0), 'copying into a month that already has groups is refused', 'already has');
  perform pg_temp.fails(format($q$select public.mgmt_petty_copy(%L, %L, gen_random_uuid())$q$, m2, m1), 'copying from a month with nothing is refused', 'nothing to copy');
  perform pg_temp.fails(format($q$select public.mgmt_petty_copy(%L, %L, gen_random_uuid())$q$, m1, m1), 'the same month twice is refused', 'two different');
  perform pg_temp.fails(format($q$select public.mgmt_petty_copy(%L, %L, gen_random_uuid())$q$, m1, (m0 + interval '1 month')::date), 'a future target is refused', 'must have begun');
  perform pg_temp.fails(format($q$select public.mgmt_petty_copy(%L, %L, gen_random_uuid())$q$, m1, m2 + 3), 'a month not on the 1st is refused', 'first day');
  reset role;

  -- 6. Close month and revisions
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');                       -- petty only
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'petty', gen_random_uuid())$q$, m1), 'editing petty cash does not allow closing the month', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');                       -- close only
  r := public.mgmt_sheet_close(m1, 'petty', gen_random_uuid());
  perform pg_temp.ok((r ->> 'sheet_id') is not null, 'the close key closes the petty month');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'petty', gen_random_uuid())$q$, m1), 'it cannot be closed twice', 'already closed');
  perform pg_temp.fails(format($q$select * from public.mgmt_petty_month(%L)$q$, m1), 'closing alone gives no right to read', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok((select closed from public.mgmt_petty_month(m1) limit 1), 'a closed month says so');
  perform pg_temp.fails(format($q$select public.mgmt_petty_save(%L, %L::jsonb, null, gen_random_uuid())$q$, m1, jsonb_build_array(jsonb_set(one, '{lines,1,amount}', '1300'))::text), 'a closed month needs a reason to be revised', 'reason is required');
  perform public.mgmt_petty_save(m1, jsonb_build_array(jsonb_set(one, '{lines,1,amount}', '1300')), 'soap price corrected', gen_random_uuid());
  select * into got from public.mgmt_petty_month(m1) where group_key = g1;
  perform pg_temp.ok(got.revision = 2 and got.total = 1800 and got.closed, 'a closed month is revised, never overwritten (revision 2, total 1,800)');
  perform pg_temp.ok((select reason from public.mgmt_petty_groups g join public.mgmt_sheets s on s.id = g.sheet_id where s.month = m1 and g.group_key = g1 and g.revision = 2) = 'soap price corrected', 'the revision keeps its reason');
  perform pg_temp.fails(format($q$select public.mgmt_petty_copy(%L, %L, gen_random_uuid())$q$, m0, m1), 'copying into a closed month is refused', 'already has');
  perform pg_temp.ok((select count(*) from public.activity_log where action like 'mgmt.petty%' and (new_value::text like '%Test fuel%' or new_value::text like '%voucher%' or new_value::text like '%1800%')) = 0, 'titles, descriptions and amounts never reach the activity log');
  reset role;

  -- 7. append-only
  perform pg_temp.fails($q$update public.mgmt_petty_groups set title = 'x'$q$, 'a voucher revision cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_petty_groups$q$, 'a voucher revision cannot be deleted', 'append-only');

  -- 8. permissions
  sqls := array[format('select * from public.mgmt_petty_month(%L)', m1), format('select public.mgmt_petty_save(%L, ''[]''::jsonb, null, gen_random_uuid())', m1),
                format('select public.mgmt_petty_copy(%L, %L, gen_random_uuid())', m1, m2)];
  perform pg_temp.as_user(j);
  perform pg_temp.ok((select count(*) from public.mgmt_petty_groups) = 0, 'a junior with every normal permission reads no petty rows');
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'junior is refused: ' || left(tbl, 50), '42501'); end loop;
  reset role;
  perform pg_temp.as_user(a, 'aal1');
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'owner without MFA is refused: ' || left(tbl, 50), '42501'); end loop;
  perform pg_temp.ok((select count(*) from public.mgmt_petty_groups) = 0, 'an owner without MFA reads no rows');
  reset role;
  set local role anon;
  perform pg_temp.fails('select * from public.mgmt_petty_groups', 'anon cannot read the table', 'permission denied');
  perform pg_temp.fails(sqls[1], 'anon cannot call the month', 'permission denied');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails('delete from public.mgmt_petty_groups', 'direct delete refused for the owner too', 'permission denied');
  perform pg_temp.fails('update public.mgmt_petty_groups set title = ''x''', 'direct update refused for the owner too', 'permission denied');
  perform pg_temp.fails($q$insert into public.mgmt_petty_groups(sheet_id, group_key, revision, title, total) values (gen_random_uuid(), gen_random_uuid(), 0, 'x', 1)$q$, 'direct insert refused for the owner too', 'permission denied');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                       -- salary edit + view, no petty
  perform pg_temp.ok((select count(*) from public.mgmt_petty_groups) = 0, 'salary editors cannot read petty cash');
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'salary rights do not open petty cash: ' || left(tbl, 50), '42501'); end loop;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');                       -- the petty key alone
  perform pg_temp.ok((select count(*) from public.mgmt_petty_month(m0)) = 1 and (select count(*) from public.mgmt_petty_groups) >= 1, 'the petty key alone can read');
  k := gen_random_uuid();
  perform pg_temp.ok(((public.mgmt_petty_save(m0, jsonb_build_array(jsonb_build_object('group_key', g3, 'title', 'Test shared voucher', 'lines', jsonb_build_array(jsonb_build_object('description', 'Test item', 'amount', 100)))), null, k)) ->> 'changed')::int = 1, 'and edit');
  perform pg_temp.fails(format('select * from public.mgmt_salary_month(%L)', m1), 'but cannot read salaries', '42501');
  perform pg_temp.fails(format('select * from public.mgmt_incentive_month(%L)', m1), 'or the incentive', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_petty_save(%L, ''[]''::jsonb, null, %L)', m0, k), 'another person cannot reuse a key', '42501');
  reset role;
end $t$;
rollback;

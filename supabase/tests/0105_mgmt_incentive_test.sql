-- Tests for 0105_mgmt_incentive. Maths cases are shared with the browser tests (tests/fixtures/manager-incentive-cases.json).
-- All figures here are invented.
\set ON_ERROR_STOP on
\set icases `cat ../../tests/fixtures/manager-incentive-cases.json`
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
create temp table case_data as select :'icases'::jsonb as j;
grant select on case_data to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t'),
 ('00000000-0000-0000-0000-0000000000e1','e@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B'), ('10000000-0000-0000-0000-00000000000c','Test Incentive C'),
 ('10000000-0000-0000-0000-00000000000d','Test Salary D'), ('10000000-0000-0000-0000-00000000000e','Test Closer E');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','incentive_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','salary_d','junior'),
 ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-00000000000e','closer_e','junior');
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions where key not like 'mgmt.%' and key not like 'credit.%';
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','mgmt.incentive','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary_view','grant'),
 ('00000000-0000-0000-0000-0000000000e1','mgmt.close_month','grant');

-- 1. the maths: every shared fixture case through the real functions (rates set first, each case in its own month)
do $t$ declare c jsonb; i int := 0; mth date; got record; e jsonb;
begin
  perform pg_temp.ok((select count(*) from public.mgmt_rates where rate_key in ('sale_commission','generic_pool','owner_share')) = 3, 'the three starting rates are seeded');
  for c in select * from jsonb_array_elements((select j from case_data)) loop
    i := i + 1; mth := (date '2018-01-01' + (i || ' month')::interval)::date; e := c -> 'expect';
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
    perform public.mgmt_rate_set('sale_commission', (c -> 'rates' ->> 'sale_commission')::numeric, 'fixture ' || i, gen_random_uuid());
    perform public.mgmt_rate_set('generic_pool', (c -> 'rates' ->> 'generic_pool')::numeric, 'fixture ' || i, gen_random_uuid());
    perform public.mgmt_rate_set('owner_share', (c -> 'rates' ->> 'owner_share')::numeric, 'fixture ' || i, gen_random_uuid());
    perform public.mgmt_incentive_save(mth, c -> 'inputs', null, gen_random_uuid());
    select * into got from public.mgmt_incentive_month(mth);
    perform pg_temp.ok(got.sale_comm = (e ->> 'sale_comm')::numeric and got.gen_inc = (e ->> 'gen_inc')::numeric and got.total_comm = (e ->> 'total_comm')::numeric
      and got.total_gen = (e ->> 'total_gen')::numeric and got.grand_total = (e ->> 'grand_total')::numeric and got.pre_panel = (e ->> 'pre_panel')::numeric
      and got.net_inc = (e ->> 'net_inc')::numeric and got.owner_net = (e ->> 'owner_net')::numeric,
      'incentive fixture: ' || (c ->> 'name') || ' (owner ' || got.owner_net || ')');
    reset role;
  end loop;
end $t$;

-- 2. behaviour
do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date; m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi')::date)::date;
  m1 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '1 month')::date;
  m2 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '2 month')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; got record; r jsonb; k uuid;
  base jsonb := '{"sale":1000000,"generic_sale":200000,"pilferage":500,"till_short":200,"cash_target":3000,"excess_fine":100,"plus_fine":50,"paper_fine":25,"panel_fine":1000,"tax":700}';
begin
  perform pg_temp.as_user(a, 'aal2');
  -- back to the starting rates for the behaviour tests
  perform public.mgmt_rate_set('sale_commission', 0.005, 'back to the starting value', gen_random_uuid());
  perform public.mgmt_rate_set('generic_pool', 0.045, 'back to the starting value', gen_random_uuid());
  perform public.mgmt_rate_set('owner_share', 0.5, 'back to the starting value', gen_random_uuid());
  perform pg_temp.fails($q$select public.mgmt_rate_set('nonsense', 0.1, 'unknown rate key', gen_random_uuid())$q$, 'an unknown rate is still refused', 'unknown rate');

  -- empty month: zeros, nothing stored
  select * into got from public.mgmt_incentive_month(m1);
  perform pg_temp.ok(not got.has_row and got.owner_net = 0 and got.rate_sale_commission = 0.005 and got.rate_owner_share = 0.5, 'an untouched month shows zeros at the current rates');
  r := public.mgmt_incentive_save(m1, '{}'::jsonb, null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0 and not (select has_row from public.mgmt_incentive_month(m1)), 'saving an empty month stores nothing');

  -- the hand-worked month
  k := gen_random_uuid();
  r := public.mgmt_incentive_save(m1, base, null, k);
  select * into got from public.mgmt_incentive_month(m1);
  perform pg_temp.ok(got.has_row and got.revision = 0 and got.net_inc = 15125 and got.owner_net = 6863 and got.grand_total = 16200, 'hand-worked month: net incentive 15,125, owner''s net 6,863');
  perform pg_temp.ok(public.mgmt_incentive_save(m1, base, null, k) = r and (select count(*) from public.mgmt_incentive_rows) >= 1, 'the same key twice saves once');
  r := public.mgmt_incentive_save(m1, base, null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0 and (r ->> 'unchanged')::int = 1, 'the same figures add no revision');
  r := public.mgmt_incentive_save(m1, base || '{"tax":800}', null, gen_random_uuid());
  select * into got from public.mgmt_incentive_month(m1);
  perform pg_temp.ok(got.revision = 1 and got.owner_net = 6763, 'a changed figure is a new revision (tax 800 gives 6,763)');
  perform pg_temp.ok((select count(*) from public.mgmt_incentive_rows r join public.mgmt_sheets s on s.id = r.sheet_id where s.month = m1) = 2, 'and the old revision is kept');
  -- the month keeps the rates it started with
  perform public.mgmt_rate_set('sale_commission', 0.01, 'a later change', gen_random_uuid());
  perform public.mgmt_incentive_save(m1, base || '{"tax":900}', null, gen_random_uuid());
  select * into got from public.mgmt_incentive_month(m1);
  perform pg_temp.ok(got.rate_sale_commission = 0.005 and got.sale_comm = 5000 and got.revision = 2, 'a rate change does not touch a month that already started');
  perform public.mgmt_incentive_save(m2, base, null, gen_random_uuid());
  perform pg_temp.ok((select rate_sale_commission from public.mgmt_incentive_month(m2)) = 0.01 and (select sale_comm from public.mgmt_incentive_month(m2)) = 10000, 'a new month takes the new rate');
  perform public.mgmt_rate_set('sale_commission', 0.005, 'back again', gen_random_uuid());

  -- validation
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, '{"sale":"abc"}'::jsonb, null, gen_random_uuid())$q$, m0), 'a non-number is refused', 'numbers');
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, '{"sale":2000000000}'::jsonb, null, gen_random_uuid())$q$, m0), 'a huge figure is refused', 'out of range');
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, '{"salary":5}'::jsonb, null, gen_random_uuid())$q$, m0), 'an unknown figure is refused', 'unknown figure');
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, '[]'::jsonb, null, gen_random_uuid())$q$, m0), 'figures must be an object', 'object');
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, '{}'::jsonb, null, gen_random_uuid())$q$, (m0 + interval '1 month')::date), 'a future month is refused', 'has begun');
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, '{}'::jsonb, null, gen_random_uuid())$q$, m0 + 3), 'a month not on the 1st is refused', 'first of the month');
  perform pg_temp.fails(format($q$select * from public.mgmt_incentive_month(%L)$q$, m0 + 3), 'reading a month not on the 1st is refused', 'first day');

  -- close month
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                       -- salary + salary_view
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'incentive', gen_random_uuid())$q$, m1), 'a salary editor cannot close the incentive month', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');                       -- close key only
  r := public.mgmt_sheet_close(m1, 'incentive', gen_random_uuid());
  perform pg_temp.ok((r ->> 'sheet_id') is not null, 'the close key can close the incentive month');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'incentive', gen_random_uuid())$q$, m1), 'it cannot be closed twice', 'already closed');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'petty', gen_random_uuid())$q$, m1), 'a sheet kind with nothing saved cannot be closed', 'nothing saved');
  perform pg_temp.fails(format($q$select * from public.mgmt_incentive_month(%L)$q$, m1), 'the close key alone cannot read the incentive', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format($q$select public.mgmt_incentive_save(%L, %L::jsonb, null, gen_random_uuid())$q$, m1, (base || '{"tax":1}')::text), 'a closed month needs a reason to be revised', 'reason is required');
  perform public.mgmt_incentive_save(m1, base || '{"tax":1}', 'tax corrected after the accountant''s check', gen_random_uuid());
  select * into got from public.mgmt_incentive_month(m1);
  perform pg_temp.ok(got.closed and got.revision = 3 and got.rate_sale_commission = 0.005, 'a closed month is revised, never overwritten (revision 3, same rates)');
  perform pg_temp.ok((select reason from public.mgmt_incentive_rows r join public.mgmt_sheets s on s.id = r.sheet_id where s.month = m1 and r.revision = 3) like 'tax corrected%', 'the revision keeps its reason');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'mgmt.incentive_saved' and (new_value::text like '%6863%' or new_value::text like '%tax%')) = 0, 'the figures never reach the activity log');
  reset role;

  -- append-only
  perform pg_temp.fails($q$update public.mgmt_incentive_rows set tax = 0$q$, 'an incentive row cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_incentive_rows$q$, 'an incentive row cannot be deleted', 'append-only');
end $t$;

-- 3. permissions: this sheet holds the owner's own share, so even salary editors cannot read it
do $t$ declare
  m1 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '1 month')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1'; n int; k uuid := gen_random_uuid(); sqls text[];
begin
  sqls := array[format('select * from public.mgmt_incentive_month(%L)', m1),
                format('select public.mgmt_incentive_save(%L, ''{}''::jsonb, null, gen_random_uuid())', m1)];
  perform pg_temp.as_user(j);
  perform pg_temp.ok((select count(*) from public.mgmt_incentive_rows) = 0, 'a junior with every normal permission reads no incentive rows');
  for n in 1..2 loop perform pg_temp.fails(sqls[n], 'junior is refused: ' || left(sqls[n], 50), '42501'); end loop;
  reset role;
  perform pg_temp.as_user(a, 'aal1');
  for n in 1..2 loop perform pg_temp.fails(sqls[n], 'owner without MFA is refused: ' || left(sqls[n], 50), '42501'); end loop;
  perform pg_temp.ok((select count(*) from public.mgmt_incentive_rows) = 0, 'an owner without MFA reads no rows');
  reset role;
  set local role anon;
  perform pg_temp.fails('select * from public.mgmt_incentive_rows', 'anon cannot read the table', 'permission denied');
  perform pg_temp.fails(sqls[1], 'anon cannot call the month', 'permission denied');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails('delete from public.mgmt_incentive_rows', 'direct delete refused for the owner too', 'permission denied');
  perform pg_temp.fails('update public.mgmt_incentive_rows set tax = 1', 'direct update refused for the owner too', 'permission denied');
  perform pg_temp.fails($q$insert into public.mgmt_incentive_rows(sheet_id, revision) values (gen_random_uuid(), 0)$q$, 'direct insert refused for the owner too', 'permission denied');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                       -- salary edit + view: NOT incentive
  perform pg_temp.ok((select count(*) from public.mgmt_incentive_rows) = 0, 'salary editors cannot read the incentive rows');
  for n in 1..2 loop perform pg_temp.fails(sqls[n], 'salary rights do not open the incentive: ' || left(sqls[n], 50), '42501'); end loop;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');                       -- the incentive key alone
  perform pg_temp.ok((select owner_net from public.mgmt_incentive_month(m1)) is not null and (select count(*) from public.mgmt_incentive_rows) >= 1, 'the incentive key alone can read');
  perform pg_temp.ok((public.mgmt_incentive_save(m1, '{"tax":1}'::jsonb, 'allowed to the incentive key', k) ->> 'changed')::int = 1, 'and edit (a closed month, with a reason)');
  perform pg_temp.fails(format('select public.mgmt_rate_set(''owner_share'', 0.4, ''try it'', gen_random_uuid())'), 'but cannot change a rate', '42501');
  perform pg_temp.fails(format('select public.mgmt_sheet_close(%L, ''incentive'', gen_random_uuid())', m1), 'and cannot close a month', '42501');
  perform pg_temp.fails(format('select * from public.mgmt_salary_month(%L)', m1), 'and cannot read salaries', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_incentive_save(%L, ''{"tax":2}''::jsonb, ''x reason'', %L)', m1, k), 'another person cannot reuse a key', '42501');
  reset role;
end $t$;
rollback;

\set ON_ERROR_STOP on
-- 0621: staff list for the Emergency Billing settings page. All data below is invented.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.denied(q text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'pass (refused): %', msg; return; end;
  raise exception 'FAIL: % was allowed', msg;
end $$;
create function pg_temp.inv(p_id uuid, p_dev uuid, p_net numeric, p_lines jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('invoice_id', p_id, 'device_id', p_dev, 'client_created_at', now(), 'customer', 'Test', 'payment_mode', 'Cash',
    'totals', jsonb_build_object('net_total', p_net), 'lines', p_lines) || p_extra $$;
create function pg_temp.line(p_code text, p_qty numeric, p_rate numeric, p_dmode text default 'pct', p_dval numeric default 0, p_unit text default 'unit') returns jsonb language sql as $$
  select jsonb_build_object('code', p_code, 'name', 'Item ' || p_code, 'unit', p_unit, 'pack', 10, 'qty', p_qty, 'rate', p_rate,
    'discount', jsonb_build_object('mode', p_dmode, 'value', p_dval)) $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j1@t'),
  ('00000000-0000-0000-0000-0000000000b2','j2@t'), ('00000000-0000-0000-0000-0000000000c1','s1@t'), ('00000000-0000-0000-0000-0000000000d1','x@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
  ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000002','J Two'), ('10000000-0000-0000-0000-000000000003','S One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000003','senior1','senior');
-- senior1 is made a manager the documented way: a per-person grant
insert into public.user_permissions(user_id, perm_key, effect) values
  ('00000000-0000-0000-0000-0000000000c1','ebill.manage','grant'), ('00000000-0000-0000-0000-0000000000c1','ebill.use','grant'),
  ('00000000-0000-0000-0000-0000000000b1','ebill.use','grant'), ('00000000-0000-0000-0000-0000000000b2','ebill.use','grant');

do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$select public.ebill_staff_list()$q$, 'ordinary staff cannot list staff PIN status');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.ebill_staff_list();
  perform pg_temp.ok(jsonb_array_length(r) = 4, 'a manager sees every login');
  perform pg_temp.ok((select bool_and(not (e ? 'pin_hash')) from jsonb_array_elements(r) e), 'no PIN hash is ever returned');
  perform pg_temp.ok((select (e ->> 'can_bill')::boolean from jsonb_array_elements(r) e where e ->> 'username' = 'junior1'), 'junior1 may bill (per-person grant)');
  perform pg_temp.ok((select not (e ->> 'has_pin')::boolean from jsonb_array_elements(r) e where e ->> 'username' = 'junior1'), 'and has no PIN yet');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1', '482913');
  r := public.ebill_staff_list();
  perform pg_temp.ok((select (e ->> 'has_pin')::boolean from jsonb_array_elements(r) e where e ->> 'username' = 'junior1'), 'after the owner sets a PIN, has_pin is true');
  perform pg_temp.ok((select (e ->> 'can_bill')::boolean from jsonb_array_elements(r) e where e ->> 'username' = 'owner'), 'the owner may bill');
  perform pg_temp.back();
end $t$;

rollback;

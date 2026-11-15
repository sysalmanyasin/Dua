\set ON_ERROR_STOP on
-- 0306: units in transit (Reorder), the shared Excess settings and retain list, and the four Home numbers computed in SQL.
-- The parity test loads the same 410 invented products the JavaScript tests use and requires the SQL to reproduce the
-- numbers the OLD app computed for them (tests/fixtures/inventory-golden/make-golden-engines.mjs).
\set fx `cat ../../tests/fixtures/inventory-golden/inventory-cover-fixture.json`
select set_config('fx.json', :'fx', false) \gset
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@t'), ('00000000-0000-0000-0000-0000000000b1', 'j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'owner', 'Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001', 'J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'junior1', 'junior');

do $t$ declare
  fx jsonb := current_setting('fx.json')::jsonb; f jsonb; v jsonb; n numeric; ok_pack boolean; j jsonb; c jsonb; e jsonb; k text; cnt int; r record;
  owner_id constant uuid := '00000000-0000-0000-0000-0000000000a1'; junior_id constant uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  -- ══ A. units in transit ══
  insert into public.inventory_products (code, name, qty, price, conversion_factor) values ('T1', 'Tablet', 5, 10, 10), ('T2', 'Syrup', 5, 10, 1), ('T3', 'Cream', 5, 10, 6);
  insert into public.str_headers (str_id, str_number, direction, dispatch_status, receive_status) values
    (1, 'S1', 'in', 'Dispatched', ''), (2, 'S2', 'out', 'Dispatched', ''), (3, 'S3', 'in', 'Dispatched', 'Received'),
    (4, 'S4', 'in', '', ''), (5, 'S5', 'in', 'Dispatched', 'Pending');
  insert into public.str_line_items (str_id, str_item_id, product_code, dispatch_qty, str_qty) values
    (1, 1, 'T1', 25, 25), (1, 2, 'T1', 14, 14), (1, 3, 'T2', 7, 7), (1, 4, 'NOPE', 9, 9), (1, 5, 'T3', null, 6), (1, 6, 'T3', 5, 5),
    (2, 1, 'T1', 100, 100), (3, 1, 'T1', 100, 100), (4, 1, 'T1', 100, 100), (5, 1, 'T2', 3, 3);

  perform pg_temp.as_user(junior_id);
  begin perform * from public.inventory_in_transit(); perform pg_temp.ok(false, 'junior in transit');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'a person with inventory.search only cannot read units in transit (pass: refused)'); end;
  reset role;
  set local role anon;
  begin perform * from public.inventory_in_transit(); perform pg_temp.ok(false, 'anon in transit');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read units in transit (pass: refused)'); end;
  reset role;

  perform pg_temp.as_user(owner_id, 'aal2');
  perform pg_temp.ok((select string_agg(code || '=' || packs, ',' order by code) from public.inventory_in_transit()) = 'NOPE=9,T1=3,T2=10',
                     'in transit: only incoming, dispatched, not-received transfers; whole packs per line; unknown code counts as pack 1; a line with no dispatch quantity adds nothing; 5 units of a pack of 6 is 0 packs and is not listed');
  perform pg_temp.ok((select count(*) from public.inventory_in_transit(1)) = 1, 'the limit is honoured');
  perform pg_temp.ok((select count(*) from public.inventory_in_transit(0)) = 1 and (select count(*) from public.inventory_in_transit(-9)) = 1, 'a limit below 1 is raised to 1');
  perform pg_temp.ok((select count(*) from public.inventory_in_transit(100000)) = 3, 'a huge limit is capped, not refused');
  reset role;
  delete from public.str_line_items; delete from public.str_headers; delete from public.inventory_products;

  -- ══ B. shared Excess settings and retain list ══
  perform pg_temp.as_user(junior_id);
  begin perform public.inventory_excess_retain_set('Panadol', true); perform pg_temp.ok(false, 'junior retain');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'a person without inventory.view cannot change the retain list (pass: refused)'); end;
  begin perform public.inventory_excess_settings_set(100, null); perform pg_temp.ok(false, 'junior settings');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'a person without inventory.view cannot change the settings (pass: refused)'); end;
  begin insert into public.inventory_excess_retained (name_key, name) values ('x', 'x'); perform pg_temp.ok(false, 'direct insert');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'the retain table cannot be written directly (pass: refused)'); end;
  reset role;

  perform pg_temp.as_user(owner_id, 'aal2');
  perform public.inventory_excess_retain_set('  Panadol Extra  ', true);
  perform public.inventory_excess_retain_set('PANADOL EXTRA', true);
  perform public.inventory_excess_retain_set('Brufen', true);
  perform pg_temp.ok((select count(*) from public.inventory_excess_retained) = 2, 'retained names are kept once, whatever the capital letters or spaces');
  perform pg_temp.ok((select name_key from public.inventory_excess_retained where name_key like 'panadol%') = 'panadol extra', 'the key is lower-case and trimmed');
  perform pg_temp.ok((select name from public.inventory_excess_retained where name_key = 'panadol extra') = 'Panadol Extra', 'the name is stored trimmed, as first entered');
  perform public.inventory_excess_retain_set('panadol EXTRA', false);
  perform pg_temp.ok((select count(*) from public.inventory_excess_retained) = 1, 'a retained name can be removed (any capital letters)');
  begin perform public.inventory_excess_retain_set('   ', true); perform pg_temp.ok(false, 'blank');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a blank name is refused (pass: refused)'); end;
  begin perform public.inventory_excess_retain_set(repeat('x', 201), true); perform pg_temp.ok(false, 'long');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a name over 200 characters is refused (pass: refused)'); end;
  perform public.inventory_excess_settings_set(5000, 12000000);
  perform pg_temp.ok((select misc from public.inventory_excess_settings) = 5000 and (select ho_value from public.inventory_excess_settings) = 12000000, 'misc and head-office value are saved');
  perform public.inventory_excess_settings_set(0, null);
  perform pg_temp.ok((select ho_value from public.inventory_excess_settings) is null, 'the head-office value can be cleared');
  begin perform public.inventory_excess_settings_set(-1, null); perform pg_temp.ok(false, 'negative misc');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a negative misc amount is refused (pass: refused)'); end;
  begin perform public.inventory_excess_settings_set(1e13, null); perform pg_temp.ok(false, 'huge misc');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'an absurd misc amount is refused (pass: refused)'); end;
  perform pg_temp.ok((select count(*) from public.inventory_excess_settings) = 1, 'there is exactly one settings row');
  reset role;
  perform pg_temp.ok((select updated_by from public.inventory_excess_settings) = owner_id, 'who changed the settings last is recorded');

  perform pg_temp.as_user(junior_id);
  perform pg_temp.ok((select count(*) from public.inventory_excess_retained) = 0 and (select count(*) from public.inventory_excess_settings) = 0, 'a person without inventory.view reads neither the retain list nor the settings');
  reset role;
  set local role anon;
  begin perform count(*) from public.inventory_excess_retained; perform pg_temp.ok(false, 'anon retained');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read the retain list (pass: refused)'); end;
  reset role;

  -- ══ C. the four Home numbers: parity with the old app on 410 products ══
  for f in select * from jsonb_array_elements(fx->'rows') loop
    v := f->'pack'; n := null;
    if jsonb_typeof(v) = 'number' then n := (v #>> '{}')::numeric;
    elsif jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then n := btrim(v #>> '{}')::numeric; end if;
    ok_pack := n is not null and n > 0;  -- what the feed's pack_valid means (the old isPackValid)
    insert into public.inventory_products (code, name, qty, price, company, generic, supplier, conversion_factor, pack_valid, creation_date, last_receive_date, last_sale_date,
      net_qty_today, net_qty_30_days, net_qty_60_days, net_qty_90_days, sale_value_incl_tax_today, sale_value_incl_tax_30_days, sale_value_incl_tax_60_days, sale_value_incl_tax_90_days,
      sale_value_excl_tax_today, sale_value_excl_tax_30_days, sale_value_excl_tax_60_days, sale_value_excl_tax_90_days, tax_percent, is_taxable)
    values (f->>'code', f->>'name', (f->>'qty')::numeric, (f->>'price')::numeric, coalesce(f->>'company', ''), coalesce(f->>'generic', ''), coalesce(f->>'supplier', ''),
      case when ok_pack then n else 1 end, ok_pack, nullif(f->>'created', '')::date, nullif(f->>'received', '')::date, nullif(f->>'sold', '')::date,
      (f->>'n0')::numeric, (f->>'n30')::numeric, (f->>'n60')::numeric, (f->>'n90')::numeric, (f->>'vi0')::numeric, (f->>'vi30')::numeric, (f->>'vi60')::numeric, (f->>'vi90')::numeric,
      (f->>'ve0')::numeric, (f->>'ve30')::numeric, (f->>'ve60')::numeric, (f->>'ve90')::numeric, (f->>'tax')::numeric, (f->>'taxable')::boolean);
  end loop;
  perform pg_temp.ok((select count(*) from public.inventory_products) = jsonb_array_length(fx->'rows'), 'the 410 products are loaded');

  perform pg_temp.as_user(junior_id);
  begin perform public.inventory_cover_summary(); perform pg_temp.ok(false, 'junior cover');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'a person without inventory.view cannot read the Home numbers (pass: refused)'); end;
  reset role;
  set local role anon;
  begin perform public.inventory_cover_summary(); perform pg_temp.ok(false, 'anon cover');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read the Home numbers (pass: refused)'); end;
  reset role;

  perform pg_temp.as_user(owner_id, 'aal2');
  j := public.inventory_cover_summary((fx->>'now')::timestamptz);
  reset role;
  c := fx->'cover';
  perform pg_temp.ok(abs((j->>'stockValue')::numeric - (c->>'stockValue')::numeric) < 0.01, format('stock value: SQL %s, old app %s', j->>'stockValue', c->>'stockValue'));
  for k in select unnest(array['reorder', 'notSold', 'excess']) loop
    perform pg_temp.ok((j->k->>'count')::int = (c->k->>'count')::int, format('%s count: SQL %s, old app %s', k, j->k->>'count', c->k->>'count'));
    perform pg_temp.ok(abs((j->k->>'value')::numeric - (c->k->>'value')::numeric) < 0.01, format('%s value: SQL %s, old app %s', k, j->k->>'value', c->k->>'value'));
  end loop;
  perform pg_temp.ok(c->'reorder'->>'count' <> '0' and c->'notSold'->>'count' <> '0' and c->'excess'->>'count' <> '0', 'the fixture really exercises all three lists');

  -- the answer carries the definitions it used, so a screen can say which numbers these are
  perform pg_temp.ok(j->'window' = '{"reorderDays": 60, "coverDays": 30, "notSoldDays": 60}'::jsonb, 'the answer states the windows it used');

  -- changing one product moves the numbers it should: make a whole-pack product never sold
  update public.inventory_products set qty = 100, price = 2, conversion_factor = 10, pack_valid = true, last_sale_date = null, last_receive_date = '2026-01-01', creation_date = '2026-01-01',
    net_qty_60_days = 0, net_qty_90_days = 0, net_qty_30_days = 0, net_qty_today = 0 where code = 'RO-NOSALES';
  perform pg_temp.as_user(owner_id, 'aal2');
  e := public.inventory_cover_summary((fx->>'now')::timestamptz);
  reset role;
  perform pg_temp.ok((e->'notSold'->>'count')::int >= (c->'notSold'->>'count')::int, 'a never-sold product is counted in notSold');
  -- an unusable pack size takes it out
  update public.inventory_products set pack_valid = false where code = 'RO-NOSALES';
  perform pg_temp.as_user(owner_id, 'aal2');
  perform pg_temp.ok((public.inventory_cover_summary((fx->>'now')::timestamptz)->'notSold'->>'count')::int = (e->'notSold'->>'count')::int - 1, 'an unusable pack size takes a product out of notSold');
  reset role;
  -- removed products are ignored
  update public.inventory_products set active = false where code = 'RO-NOSALES';
  perform pg_temp.as_user(owner_id, 'aal2');
  perform pg_temp.ok((public.inventory_cover_summary((fx->>'now')::timestamptz)->>'stockValue')::numeric < (c->>'stockValue')::numeric, 'removed products do not count');
  reset role;
end $t$;
rollback;

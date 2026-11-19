\set ON_ERROR_STOP on
-- 0640: receipt settings and the export right. All data below is invented.
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

do $t$ declare r jsonb; v0 int; begin
  perform pg_temp.ok((select count(*) = 1 from public.permissions where key = 'ebill.export'), 'the export right exists');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'ebill.export'), 'no role preset carries it');
  perform pg_temp.ok((select value ->> 'width_mm' = '80' and value ->> 'receipt_type' = 'Primary Receipt' from public.settings where key = 'ebill.receipt'), 'sensible defaults are seeded');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.denied($q$select public.ebill_get_receipt()$q$, 'no billing right, no receipt settings');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_get_receipt();
  perform pg_temp.ok((r ->> 'width_mm')::int = 80 and (r ->> 'copies')::int = 1 and (r ->> 'footer') = 'Thank you for your visit', 'staff can read the receipt settings');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"footer":"x"}', 'because')$q$, 'but cannot change them');
  perform pg_temp.denied($q$select public.ebill_rows(null, null, null, null, null)$q$, 'the shared row query is not callable by clients');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"footer":"x"}', '')$q$, 'a reason is required');
  perform pg_temp.denied($q$select public.ebill_set_receipt('[]', 'because')$q$, 'it must be an object');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"width_mm":70}', 'because')$q$, 'only 58 or 80 mm');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"copies":0}', 'because')$q$, 'copies below 1');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"copies":6}', 'because')$q$, 'copies above 5');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"copies":1.5}', 'because')$q$, 'a fraction of a copy');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"receipt_type":"Fancy"}', 'because')$q$, 'unknown receipt type');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"auto_print":"yes"}', 'because')$q$, 'on/off must be true or false');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"mystery":1}', 'because')$q$, 'unknown setting');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"shop_name":5}', 'because')$q$, 'text must be text');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('shop_name', repeat('x', 81))), 'shop name too long');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('footer', repeat('x', 201))), 'footer too long');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"logo":"https://evil.example/x.png"}', 'because')$q$, 'a logo must be an embedded image, not a link');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"logo":"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="}', 'because')$q$, 'SVG images can carry scripts and are refused');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"logo":"data:image/png;base64,AAA<script>"}', 'because')$q$, 'a logo with stray characters is refused');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('logo', 'data:image/png;base64,' || repeat('A', 150000))), 'a huge logo is refused');

  r := public.ebill_set_receipt('{"shop_name":"  Fazal Din''s Pharma Plus ","phone":"0300 1234567","width_mm":58,"copies":2,"receipt_type":"Gift Receipt","logo":"data:image/png;base64,iVBORw0KGgo="}', 'initial setup');
  perform pg_temp.ok((r ->> 'shop_name') = 'Fazal Din''s Pharma Plus' and (r ->> 'width_mm')::int = 58 and (r ->> 'copies')::int = 2, 'a manager sets the receipt, text is trimmed');
  r := public.ebill_set_receipt('{"footer":"See you soon"}', 'new footer');
  perform pg_temp.ok((r ->> 'footer') = 'See you soon' and (r ->> 'shop_name') = 'Fazal Din''s Pharma Plus' and (r ->> 'width_mm')::int = 58, 'a partial update keeps everything else');
  perform pg_temp.back();
  perform pg_temp.ok((select version = 3 from public.settings where key = 'ebill.receipt'), 'each of the two successful changes is a new version (so none of the refusals changed anything)');
  perform pg_temp.ok((select count(*) = 2 from public.settings_history where key = 'ebill.receipt'), 'with its history and reason');
  perform pg_temp.ok((select count(*) = 2 from public.activity_log where action = 'ebill.receipt_set'), 'and an audit entry');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where action = 'ebill.receipt_set' and (new_value ? 'logo' or old_value ? 'logo')), 'the audit log does not carry the logo image');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((public.ebill_get_receipt() ->> 'receipt_type') = 'Gift Receipt', 'staff then read the new settings');
  perform pg_temp.back();
end $t$;

rollback;

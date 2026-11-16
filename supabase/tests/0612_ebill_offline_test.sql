\set ON_ERROR_STOP on
-- 0612: offline grants, proof of PIN, and limits for offline devices. All data below is invented.
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

insert into public.inventory_products(code, name, qty, price) values ('A1','Test Tablet', 10, 5);
insert into public.ebill_devices(device_id, registered_by) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1');
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1', '482913');
  perform pg_temp.back();
end $t$;

-- the grant: needs the right PIN, online, on an active device
do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.denied(format($q$select public.ebill_offline_grant(%L, '482913')$q$, d), 'no billing right, no grant');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_offline_grant(d, '000001') ->> 'code') = 'bad_pin', 'a wrong PIN gets no grant');
  perform pg_temp.ok((public.ebill_offline_grant(d, '') ->> 'code') = 'pin_required', 'no PIN gets no grant');
  perform pg_temp.ok((public.ebill_offline_grant(gen_random_uuid(), '482913') ->> 'code') = 'device_unknown', 'an unknown device gets no grant');
  r := public.ebill_offline_grant(d, '482913');
  perform pg_temp.ok((r ->> 'ok')::boolean and length(r ->> 'secret') = 48, 'the right PIN returns a 48-character secret');
  perform pg_temp.denied($q$select * from public.ebill_offline_grants$q$, 'grants are not readable by clients');
  perform pg_temp.back();
  perform pg_temp.ok((select secret_hash <> (r ->> 'secret') and length(secret_hash) = 64 from public.ebill_offline_grants), 'only a SHA-256 hash of the secret is stored');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where coalesce(new_value::text,'') like '%' || (r ->> 'secret') || '%'), 'the secret is not in the audit log');
  perform set_config('t.secret', r ->> 'secret', false);
  perform set_config('t.set', r ->> 'pin_set_at', false);
end $t$;

-- saving with the proof instead of a PIN
do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; s text := current_setting('t.secret'); i uuid := gen_random_uuid(); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), null) ->> 'code') = 'pin_required', 'no PIN and no proof: pin_required');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), '{"offline_proof":"forged"}'), null) ->> 'code') = 'bad_proof', 'a forged proof is refused');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), '20000000-0000-0000-0000-000000000002', 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', s)), null) ->> 'code') = 'bad_proof', 'the proof only works on the device that earned it');
  r := public.ebill_save_invoice(pg_temp.inv(i, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', s)), null);
  perform pg_temp.ok((r ->> 'code') = 'saved', 'a valid proof saves the invoice');
  perform pg_temp.back();
  perform pg_temp.ok((select pin_check = 'device' from public.ebill_invoices where invoice_id = i), 'and it is marked as checked on the device');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(i, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', s)), null) ->> 'code') = 'duplicate', 'a retry of that offline invoice is a duplicate, not a second invoice');
  -- an online save with the PIN is still marked server
  perform public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '482913');
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) from public.ebill_invoices where pin_check = 'server') = 1 and (select count(*) from public.ebill_invoices) = 2, 'online invoices stay marked server');
  -- the proof does not skip the other checks: a deactivated device still fails
  update public.ebill_devices set status = 'deactivated' where device_id = d;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', s)), null) ->> 'code') = 'device_inactive', 'a proof does not revive a deactivated device');
  perform pg_temp.ok((public.ebill_offline_grant(d, '482913') ->> 'code') = 'device_inactive', 'nor can a deactivated device get a new grant');
  perform pg_temp.back();
  update public.ebill_devices set status = 'active' where device_id = d;
  -- nor the discount limit
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 8, jsonb_build_array(pg_temp.line('A1', 2, 5, 'pct', 20)), jsonb_build_object('offline_proof', s)), null) ->> 'code') = 'discount_limit', 'the discount limit is still enforced for offline invoices');
  perform pg_temp.back();
end $t$;

-- the owner changes or removes the PIN
do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; s text := current_setting('t.secret'); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1', '739150');
  perform pg_temp.back();
  -- inside one test transaction now() never advances, so say the change happened 10 minutes ago
  update public.ebill_pins set set_at = now() - interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000b1';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  -- made after the change with the old proof: refused for the owner to review
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', s)), null);
  perform pg_temp.ok((r ->> 'code') = 'pin_changed', 'an offline invoice made after the PIN was changed is refused');
  -- made before the change: still honoured
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', s, 'client_created_at', now() - interval '1 hour')), null);
  perform pg_temp.ok((r ->> 'code') = 'saved', 'one made before the change is still honoured');
  -- a fresh grant after the change works for new invoices
  r := public.ebill_offline_grant(d, '739150');
  perform pg_temp.ok((r ->> 'ok')::boolean, 'a new grant needs the new PIN');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', r ->> 'secret')), null) ->> 'code') = 'saved', 'and then offline invoices save again');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_remove_pin('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('offline_proof', r ->> 'secret')), null) ->> 'code') = 'no_pin', 'with the PIN removed, no proof is accepted');
  perform pg_temp.back();
end $t$;

-- what an offline device learns about its user
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.denied($q$select public.ebill_my_limits()$q$, 'no billing right, no limits');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_my_limits();
  perform pg_temp.ok((r ->> 'max_pct')::numeric = 10 and (r ->> 'max_amount')::numeric = 1000 and (r ->> 'pin_required')::boolean and not (r ->> 'has_pin')::boolean and not (r ->> 'override')::boolean, 'shop defaults, PIN required, no PIN now (removed above)');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', 25, null, 'trusted');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_my_limits();
  perform pg_temp.ok((r ->> 'max_pct')::numeric = 25 and (r ->> 'max_amount')::numeric = 1000, 'a personal percentage with the default amount');
  perform pg_temp.back();
end $t$;

rollback;

\set ON_ERROR_STOP on
-- 0610: finalize PINs and staff discount limits. All data below is invented.
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

do $t$ declare h text; begin
  perform pg_temp.ok(public.ebill_pin_valid('482913'), 'a normal PIN is valid');
  perform pg_temp.ok(not public.ebill_pin_valid('123456') and not public.ebill_pin_valid('654321') and not public.ebill_pin_valid('111111')
    and not public.ebill_pin_valid('12345') and not public.ebill_pin_valid('1234567') and not public.ebill_pin_valid('abcdef') and not public.ebill_pin_valid('012345') and not public.ebill_pin_valid('567890'),
    'runs, repeats, wrong length and letters are refused');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$select public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1','482913')$q$, 'staff cannot set their own PIN');
  perform pg_temp.denied($q$select public.ebill_check_pin('00000000-0000-0000-0000-0000000000b1','482913')$q$, 'the PIN checker is not callable by staff');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied($q$select public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1','482913')$q$, 'a manager without ebill.set_pin cannot set a PIN');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.denied($q$select public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1','482913')$q$, 'the owner without MFA cannot set a PIN');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.denied($q$select public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1','123456')$q$, 'a run is refused');
  perform pg_temp.denied($q$select public.ebill_set_pin('00000000-0000-0000-0000-0000000000f9','482913')$q$, 'an unknown user is refused');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1','482913');
  perform pg_temp.back();
  select pin_hash into h from public.ebill_pins where user_id = '00000000-0000-0000-0000-0000000000b1';
  perform pg_temp.ok(h is not null and h <> '482913' and h like '$2%', 'the PIN is stored as a bcrypt hash, never plaintext');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where coalesce(new_value::text,'') || coalesce(old_value::text,'') || coalesce(reason,'') like '%482913%'), 'the PIN is not in the audit log');
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'ebill.pin_set' and entity_id = '00000000-0000-0000-0000-0000000000b1'), 'setting a PIN is audited');
  perform pg_temp.ok(public.ebill_check_pin('00000000-0000-0000-0000-0000000000b1','482913') = 'ok', 'the right PIN passes');
  perform pg_temp.ok(public.ebill_check_pin('00000000-0000-0000-0000-0000000000b2','482913') = 'no_pin', 'someone with no PIN gets no_pin');
end $t$;

-- lockout: 5 wrong PINs lock for 15 minutes
do $t$ declare i int; begin
  for i in 1..5 loop
    perform pg_temp.ok(public.ebill_check_pin('00000000-0000-0000-0000-0000000000b1','000001') = 'bad_pin', 'wrong PIN ' || i);
  end loop;
  perform pg_temp.ok((select locked_until > now() + interval '14 minutes' from public.ebill_pins where user_id = '00000000-0000-0000-0000-0000000000b1'), 'the 5th wrong PIN locks for about 15 minutes');
  perform pg_temp.ok(public.ebill_check_pin('00000000-0000-0000-0000-0000000000b1','482913') = 'locked', 'the right PIN is refused while locked');
  update public.ebill_pins set locked_until = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-0000000000b1';
  perform pg_temp.ok(public.ebill_check_pin('00000000-0000-0000-0000-0000000000b1','482913') = 'ok', 'after the lock ends the right PIN works');
  perform pg_temp.ok((select failed_count = 0 and locked_until is null from public.ebill_pins where user_id = '00000000-0000-0000-0000-0000000000b1'), 'and clears the count');
end $t$;

-- removing a PIN, and limits
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_remove_pin('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.back();
  perform pg_temp.ok(public.ebill_check_pin('00000000-0000-0000-0000-0000000000b1','482913') = 'no_pin', 'a removed PIN no longer works');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$select public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', 50, 5000, 'because')$q$, 'staff cannot raise their own limits');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied($q$select public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', 50, 5000, '')$q$, 'a reason is required');
  perform pg_temp.denied($q$select public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', 101, 5000, 'too high')$q$, 'a percentage above 100 is refused');
  perform pg_temp.denied($q$select public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', 5, -1, 'negative')$q$, 'a negative amount is refused');
  perform public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', 20, 2500, 'trusted cashier');
  perform pg_temp.ok((select max_discount_pct = 20 and max_discount_amount = 2500 from public.ebill_staff_limits where user_id = '00000000-0000-0000-0000-0000000000b1'), 'a manager sets limits');
  perform pg_temp.back();
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'ebill.limits_set' and reason = 'trusted cashier'), 'limit changes are audited with the reason');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.ebill_staff_limits) = 1, 'staff can see their own limit');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((select count(*) from public.ebill_staff_limits) = 0, 'but not anyone else''s');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.ebill_set_limits('00000000-0000-0000-0000-0000000000b1', null, null, 'back to default');
  perform pg_temp.back();
  perform pg_temp.ok(not exists (select 1 from public.ebill_staff_limits), 'clearing both returns the person to the shop default');
end $t$;

rollback;

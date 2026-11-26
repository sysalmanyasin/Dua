-- Tests for 1401_app_devices: push addresses, who receives which alert, and the home-screen widget secret.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'pass: % (%)', msg, sqlerrm; return; end;
  raise exception 'FAIL: % (it was allowed)', msg;
end $$;
create function pg_temp.hash(s text) returns text language sql as $$ select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');
-- Candela today figure (invented): cash 1000, card 500, credit 250, total 1750
insert into public.candela_daily_payments(sale_day, cash_sale, card_sale, credit_sale, total_sale)
  values ((now() at time zone 'Asia/Karachi')::date, 1000, 500, 250, 1750);

do $t$ declare v jsonb; secret text; secret2 text; n int; tok1 text := repeat('a', 40); tok2 text := repeat('b', 40);
  d1 uuid := '20000000-0000-0000-0000-000000000001'; d2 uuid := '20000000-0000-0000-0000-000000000002';
begin
  -- ───── registration ─────
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.app_device_register(d1, tok1, '1.0.0', false);
  perform pg_temp.ok(v ->> 'widget_secret' is null, 'registering for push alone creates no widget secret');
  perform pg_temp.fails($f$select public.app_device_register('20000000-0000-0000-0000-000000000009', repeat('c', 40), '1', true)$f$, 'a person without a Candela permission cannot get a widget secret');
  perform pg_temp.fails($f$select * from public.app_devices$f$, 'nobody reads the devices table directly');
  perform pg_temp.fails($f$select public.app_widget_today('20000000-0000-0000-0000-000000000001', repeat('0', 64))$f$, 'a phone cannot call the widget reader');
  perform pg_temp.fails($f$select public.app_push_tokens_for('closing.submitted')$f$, 'a phone cannot list push addresses');
  perform pg_temp.fails($f$select public.app_push_rules_list()$f$, 'staff cannot read the push rules');
  perform pg_temp.fails($f$select public.app_push_rule_set('closing.%', 'closing.review', true, 'sneaky')$f$, 'staff cannot change the push rules');
  reset role;
  set local role anon;
  perform pg_temp.fails($f$select public.app_device_register('20000000-0000-0000-0000-000000000001', repeat('a', 40), '1', false)$f$, 'anon cannot register a device');
  reset role;

  -- ───── who receives what ─────
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 0, 'a junior without notifications.view receives nothing by default');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.app_device_register(d2, tok2, '1.0.0', false);
  reset role;
  perform pg_temp.ok((select array_agg(fcm_token) from public.app_push_tokens_for('closing.submitted')) = array[tok2], 'the owner (admin) receives owner alerts');

  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'notifications.view', 'grant');
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 2, 'a person the owner allows notifications.view receives them too');
  update public.user_permissions set effect = 'deny' where user_id = '00000000-0000-0000-0000-0000000000b1';
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 1, 'Deny stops it');
  delete from public.user_permissions where user_id = '00000000-0000-0000-0000-0000000000b1';

  -- a rule for one kind, by permission; the underscore in a kind is not a wildcard
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.app_push_rule_set('inventory.sync_stale', 'closing.review', true, 'test rule');
  perform pg_temp.fails($f$select public.app_push_rule_set('x', 'no.such_key', true, 'bad key')$f$, 'a rule needs a real permission');
  perform pg_temp.fails($f$select public.app_push_rule_set('x', 'closing.review', true, '')$f$, 'a rule needs a reason');
  perform pg_temp.ok(jsonb_array_length(public.app_push_rules_list()) = 2, 'the owner lists the rules');
  reset role;
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'closing.review', 'grant');
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('inventory.sync_stale')) = 2, 'a rule sends that kind to people holding the permission');
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('inventoryXsync_stale')) = 1, 'an underscore in a rule matches only an underscore');
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 1, 'other kinds still go to the owner only');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'app.push_rule_set') = 1, 'the rule change was logged');

  -- a switched-off address and a disabled person get nothing
  perform public.app_push_disable(d2, 'gone');
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 0, 'a dead push address is skipped');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.app_device_register(d2, repeat('d', 40), '1.0.1', false);
  reset role;
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 1, 'registering a fresh address switches the device back on');
  update public.profiles set disabled_at = now() where user_id = '00000000-0000-0000-0000-0000000000a1';
  perform pg_temp.ok((select count(*) from public.app_push_tokens_for('closing.submitted')) = 0, 'a disabled person receives nothing');
  update public.profiles set disabled_at = null where user_id = '00000000-0000-0000-0000-0000000000a1';

  -- a token that moves to a new install leaves the old row
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.app_device_register('20000000-0000-0000-0000-000000000003', tok1, '1.0.2', false);
  reset role;
  perform pg_temp.ok((select count(*) from public.app_devices where fcm_token = tok1) = 1, 'a push address belongs to exactly one install');
  perform pg_temp.ok(not exists (select 1 from public.app_devices where id = d1), 'the old install row was dropped');

  -- ───── the widget ─────
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000c1', 'candela.today_total', 'grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  v := public.app_device_register('20000000-0000-0000-0000-000000000004', null, '1.0.0', true);
  secret := v ->> 'widget_secret';
  perform pg_temp.ok(secret ~ '^[0-9a-f]{64}$', 'a staff member with candela.today_total gets a 64-character widget secret');
  reset role;
  perform pg_temp.ok((select widget_secret_hash from public.app_devices where id = '20000000-0000-0000-0000-000000000004') = pg_temp.hash(secret), 'only the hash is stored');
  perform pg_temp.ok(not exists (select 1 from public.app_devices where widget_secret_hash = secret), 'the secret itself is never stored');

  v := public.app_widget_today('20000000-0000-0000-0000-000000000004', pg_temp.hash(secret));
  perform pg_temp.ok((v ->> 'total')::numeric = 1750, 'the widget reads today''s total');
  perform pg_temp.ok(v -> 'breakdown' is null or v ->> 'breakdown' is null, 'staff get one number only, no cash/card/credit split');
  perform pg_temp.ok(v ->> 'as_of' is not null, 'the widget gets the time of the last sync');
  perform pg_temp.ok(public.app_widget_today('20000000-0000-0000-0000-000000000004', pg_temp.hash('wrong')) is null, 'a wrong secret gets nothing');
  perform pg_temp.ok(public.app_widget_today('20000000-0000-0000-0000-0000000000ff', pg_temp.hash(secret)) is null, 'an unknown device gets nothing');

  -- revoking the permission stops it at once, with no new APK and no new secret
  update public.user_permissions set effect = 'deny' where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform pg_temp.ok(public.app_widget_today('20000000-0000-0000-0000-000000000004', pg_temp.hash(secret)) is null, 'a denied person''s widget stops working');
  delete from public.user_permissions where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform pg_temp.ok(public.app_widget_today('20000000-0000-0000-0000-000000000004', pg_temp.hash(secret)) is null, 'without the permission the widget gets nothing');
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000c1', 'candela.today_total', 'grant');
  update public.profiles set disabled_at = now() where user_id = '00000000-0000-0000-0000-0000000000c1';
  perform pg_temp.ok(public.app_widget_today('20000000-0000-0000-0000-000000000004', pg_temp.hash(secret)) is null, 'a disabled person''s widget stops working');
  update public.profiles set disabled_at = null where user_id = '00000000-0000-0000-0000-0000000000c1';

  -- the owner gets the split; their secret is separate
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.app_device_register(d2, null, '1.0.1', true);
  secret2 := v ->> 'widget_secret';
  reset role;
  v := public.app_widget_today(d2, pg_temp.hash(secret2));
  perform pg_temp.ok((v -> 'breakdown' ->> 'cash')::numeric = 1000 and (v -> 'breakdown' ->> 'card')::numeric = 500 and (v -> 'breakdown' ->> 'credit')::numeric = 250, 'the owner also sees cash, card and credit');
  perform pg_temp.ok(public.app_widget_today(d2, pg_temp.hash(secret)) is null, 'one device''s secret does not open another device');

  -- another person signing in on the same phone does not inherit the widget
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.app_device_register(d2, null, '1.0.1', false);
  reset role;
  perform pg_temp.ok(public.app_widget_today(d2, pg_temp.hash(secret2)) is null, 'a new person on the same phone does not inherit the previous widget');

  -- sign-out and clearing
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.app_widget_clear('20000000-0000-0000-0000-000000000004');
  reset role;
  perform pg_temp.ok(public.app_widget_today('20000000-0000-0000-0000-000000000004', pg_temp.hash(secret)) is null, 'clearing the widget stops it');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.app_device_unregister('20000000-0000-0000-0000-000000000004');   -- not b1's device: must do nothing
  reset role;
  perform pg_temp.ok(exists (select 1 from public.app_devices where id = '20000000-0000-0000-0000-000000000004'), 'a person cannot unregister someone else''s device');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.app_device_unregister('20000000-0000-0000-0000-000000000004');
  reset role;
  perform pg_temp.ok(not exists (select 1 from public.app_devices where id = '20000000-0000-0000-0000-000000000004'), 'signing out removes the device');
end $t$;
rollback;

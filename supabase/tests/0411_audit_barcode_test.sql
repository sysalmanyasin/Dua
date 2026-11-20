-- Tests for 0411_audit_barcode (Audit slice C2 (Barcode)). Invented people and products only.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.refused(sql text, want text, msg text) returns void language plpgsql as $$
declare h text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint;
    if h is distinct from want then raise exception 'FAIL (code "%", wanted "%", message "%"): %', h, want, sqlerrm, msg; end if;
    raise notice 'pass (refused with %): %', want, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'pass (refused): %', msg; return; end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'reg@t'),
 ('00000000-0000-0000-0000-0000000000b2', 'adm@t'), ('00000000-0000-0000-0000-0000000000b3', 'scan@t'),
 ('00000000-0000-0000-0000-0000000000b4', 'scan2@t'), ('00000000-0000-0000-0000-0000000000b5', 'none@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'owner', 'Test Owner');
insert into public.staff (id, full_name) values
 ('10000000-0000-0000-0000-0000000000b1', 'Reg One'), ('10000000-0000-0000-0000-0000000000b2', 'Adm One'),
 ('10000000-0000-0000-0000-0000000000b3', 'Scan One'), ('10000000-0000-0000-0000-0000000000b4', 'Scan Two'), ('10000000-0000-0000-0000-0000000000b5', 'No Perms');
insert into public.profiles (user_id, staff_id, username, role_template, disabled_at) values
 ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'reg1', 'senior', null),
 ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', 'adm1', 'senior', null),
 ('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-0000000000b3', 'scan1', 'junior', null),
 ('00000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-0000000000b4', 'scan2', 'junior', null),
 ('00000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-0000000000b5', 'none1', 'junior', null);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000b1', 'audit.barcode_register', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000b2', 'audit.barcode_admin', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000b3', 'audit.barcode_scan', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000b3', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000b3', 'audit.individual', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000b4', 'audit.barcode_scan', 'grant', 'test');
reset role;

insert into public.inventory_products (id, code, name, company, qty, price) values
 ('20000000-0000-0000-0000-000000000001', 'A1', 'Alpha one', 'Acme', 10, 100.5),
 ('20000000-0000-0000-0000-000000000002', 'A2', 'Alpha two', 'Acme', 5, 20),
 ('20000000-0000-0000-0000-000000000003', 'B1', 'Beta one', 'Beta', 8, 55),
 ('20000000-0000-0000-0000-000000000004', 'C1', 'Cura one', 'Cura', 40, 3),
 ('20000000-0000-0000-0000-000000000005', '', 'No code product', 'Cura', 1, 1);
create or replace function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select v.code, v.name, v.company, v.qty, v.price from (values ('A1', 'Alpha one', 'Acme', 10::numeric, 100.50::numeric), ('B1', 'Beta one', 'Beta', 8::numeric, 55::numeric))
  v (code, name, company, qty, price) where (p_scope -> 'codes') ? v.code $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;

-- ── who may do what ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select pg_temp.refused($$select * from public.audit_barcode_mirror()$$, 'not_allowed', 'a person with no barcode permission cannot read the list');
select pg_temp.refused($$select public.audit_scan_batch('[]'::jsonb)$$, 'not_allowed', 'nor save scans');
select pg_temp.refused($$select public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000001')$$, 'not_allowed', 'nor register');
select pg_temp.refused($$select * from public.audit_scan_history()$$, 'not_allowed', 'nor read scan history');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select pg_temp.refused($$select public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000001')$$, 'not_allowed', 'a scanner cannot register');
select pg_temp.refused($$select * from public.audit_barcode_list()$$, 'not_allowed', 'a scanner cannot open the Center list');
select pg_temp.refused($$select public.audit_barcode_overview()$$, 'not_allowed', 'nor its overview');
select pg_temp.refused($$select * from public.audit_barcode_products('alpha')$$, 'not_allowed', 'nor search products to register');
reset role;

-- ── register ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.refused($$select public.audit_barcode_register('12', '20000000-0000-0000-0000-000000000001')$$, 'barcode_invalid', 'too short a barcode is refused');
select pg_temp.refused($$select public.audit_barcode_register('59$01!34', '20000000-0000-0000-0000-000000000001')$$, 'barcode_invalid', 'odd characters are refused');
select pg_temp.refused($$select public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000001', 'pdf')$$, 'barcode_type_invalid', 'an unknown type is refused');
select pg_temp.refused($$select public.audit_barcode_register('5901234123457', gen_random_uuid())$$, 'product_not_found', 'an unknown product is refused');
select pg_temp.refused($$select public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000005')$$, 'product_no_code', 'a product without a code cannot be linked');
select pg_temp.ok((select count(*) from public.audit_barcode_products('alpha')) = 2, 'a registrar can search products');
insert into ids select 'b1', (public.audit_barcode_register(' 5901234 123457 ', '20000000-0000-0000-0000-000000000001', 'ean13', 'shelf photo') ->> 'id')::uuid;
select pg_temp.ok((public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000001') ->> 'outcome') = 'exists', 'registering the same link again changes nothing');
reset role;
select pg_temp.ok((select barcode from public.audit_barcodes) = '5901234123457' and (select status from public.audit_barcodes) = 'unverified', 'a registered barcode is cleaned and starts unverified');
select pg_temp.ok((select count(*) from public.audit_barcodes) = 1 and (select count(*) from public.audit_barcode_log) = 1, 'a repeat leaves one barcode and one log line');

-- ── verify ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select pg_temp.refused(format('select public.audit_barcode_verify(%L)', (select v from ids where k = 'b1')), 'not_allowed', 'a scanner cannot verify');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.refused($$select public.audit_barcode_verify(gen_random_uuid())$$, 'barcode_not_found', 'verifying an unknown barcode is refused');
select pg_temp.ok(public.audit_barcode_verify((select v from ids where k = 'b1')) = 'verified', 'a registrar verifies');
select pg_temp.ok(public.audit_barcode_verify((select v from ids where k = 'b1')) = 'verified', 'verifying again is harmless');
reset role;
select pg_temp.ok((select count(*) from public.audit_barcode_log where action = 'verified') = 1, 'one verify log line, not two');

-- ── conflict: never settled automatically ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000002', 'ean13', 'seen on the A2 box') ->> 'outcome') = 'conflict', 'the same barcode for another product is a conflict');
select pg_temp.ok((public.audit_barcode_register('5901234123457', '20000000-0000-0000-0000-000000000003') ->> 'outcome') = 'conflict', 'a second claim does not replace the first');
reset role;
select pg_temp.ok((select product_code from public.audit_barcodes) = 'A1' and (select status from public.audit_barcodes) = 'conflict', 'the existing link is kept and the barcode flagged');
select pg_temp.ok((select conflict_product_code from public.audit_barcodes) = 'A2', 'the first claim is the one recorded');
select pg_temp.ok((select count(*) from public.audit_barcode_log where action = 'conflict_flagged') = 1, 'one conflict log line');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.refused(format('select public.audit_barcode_verify(%L)', (select v from ids where k = 'b1')), 'barcode_state', 'a conflict cannot be verified');
select pg_temp.refused(format('select public.audit_barcode_conflict_resolve(%L, %L, %L)', (select v from ids where k = 'b1'), 'keep', 'looks right'), 'not_allowed', 'a registrar cannot settle it');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.refused(format('select public.audit_barcode_conflict_resolve(%L, %L, %L)', (select v from ids where k = 'b1'), 'maybe', 'looks right'), 'barcode_decision_invalid', 'the decision must be keep, reassign or disable');
select pg_temp.refused(format('select public.audit_barcode_conflict_resolve(%L, %L, %L)', (select v from ids where k = 'b1'), 'keep', ' x '), 'reason_required', 'a reason is required');
select pg_temp.ok(public.audit_barcode_conflict_resolve((select v from ids where k = 'b1'), 'reassign', 'The box says A2') = 'verified', 'an administrator gives it to the claimed product');
select pg_temp.refused(format('select public.audit_barcode_conflict_resolve(%L, %L, %L)', (select v from ids where k = 'b1'), 'keep', 'again'), 'conflict_resolved', 'a settled conflict cannot be settled twice');
reset role;
select pg_temp.ok((select product_code from public.audit_barcodes) = 'A2' and (select conflict_product_id from public.audit_barcodes) is null, 'the barcode now belongs to A2 and the claim is cleared');

-- keep, and disable, on two more barcodes
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'b2', (public.audit_barcode_register('1111111111116', '20000000-0000-0000-0000-000000000003') ->> 'id')::uuid;
insert into ids select 'b3', (public.audit_barcode_register('2222222222222', '20000000-0000-0000-0000-000000000004') ->> 'id')::uuid;
select public.audit_barcode_register('1111111111116', '20000000-0000-0000-0000-000000000004');
select public.audit_barcode_register('2222222222222', '20000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok(public.audit_barcode_conflict_resolve((select v from ids where k = 'b2'), 'keep', 'Original is right') = 'verified', 'keep leaves the first product and verifies');
select pg_temp.ok(public.audit_barcode_conflict_resolve((select v from ids where k = 'b3'), 'disable', 'Nobody knows which') = 'disabled', 'disable switches it off');
reset role;
select pg_temp.ok((select product_code from public.audit_barcodes where id = (select v from ids where k = 'b2')) = 'B1', 'keep: still B1');
select pg_temp.ok((select count(*) from public.audit_barcode_log where action in ('conflict_kept', 'conflict_reassigned', 'conflict_disabled')) = 3, 'each decision is logged with its reason');

-- ── change, disable, enable ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.refused(format('select public.audit_barcode_change(%L, %L, %L)', (select v from ids where k = 'b2'), '20000000-0000-0000-0000-000000000004', 'wrong label'), 'not_allowed', 'a registrar cannot change a link');
select pg_temp.refused(format('select public.audit_barcode_disable(%L, %L)', (select v from ids where k = 'b2'), 'bad'), 'not_allowed', 'nor disable');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.refused(format('select public.audit_barcode_change(%L, %L, %L)', (select v from ids where k = 'b2'), '20000000-0000-0000-0000-000000000004', ''), 'reason_required', 'a change needs a reason');
select pg_temp.refused(format('select public.audit_barcode_change(%L, %L, %L)', (select v from ids where k = 'b2'), '20000000-0000-0000-0000-000000000003', 'same'), 'same_product', 'changing to the same product is refused');
select public.audit_barcode_change((select v from ids where k = 'b2'), '20000000-0000-0000-0000-000000000004', 'Label was on the wrong box');
reset role;
select pg_temp.ok((select product_code from public.audit_barcodes where id = (select v from ids where k = 'b2')) = 'C1', 'an administrator moves a barcode to another product');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.audit_barcode_disable((select v from ids where k = 'b2'), 'Printed wrong');
select public.audit_barcode_disable((select v from ids where k = 'b2'), 'Printed wrong');
reset role;
select pg_temp.ok((select count(*) from public.audit_barcode_log where action = 'disabled' and barcode_id = (select v from ids where k = 'b2')) = 1, 'disabling twice logs once');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok(public.audit_barcode_enable((select v from ids where k = 'b2'), 'Reprinted') = 'verified', 'enabling a barcode that was verified returns it verified');
select pg_temp.ok(public.audit_barcode_enable((select v from ids where k = 'b3'), 'Checked the box') = 'unverified', 'a barcode that was never verified comes back unverified, even after a conflict');
reset role;
select pg_temp.ok((select status from public.audit_barcodes where id = (select v from ids where k = 'b3')) = 'unverified' and (select status from public.audit_barcodes where id = (select v from ids where k = 'b2')) = 'verified', 'after enabling: b3 unverified, b2 verified');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'b4', (public.audit_barcode_register('3333333333333', '20000000-0000-0000-0000-000000000001') ->> 'id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.audit_barcode_disable((select v from ids where k = 'b4'), 'Test only');
select pg_temp.ok(public.audit_barcode_enable((select v from ids where k = 'b4'), 'Test only') = 'unverified', 'a plain unverified barcode comes back unverified');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((public.audit_barcode_register('3333333333333', '20000000-0000-0000-0000-000000000001') ->> 'outcome') = 'exists', 'a registrar re-registering the same link after enable changes nothing');
select public.audit_barcode_register('4444444444444', '20000000-0000-0000-0000-000000000002');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
reset role;
insert into ids select 'b5', id from public.audit_barcodes where barcode = '4444444444444';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.audit_barcode_disable((select v from ids where k = 'b5'), 'Test only');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((public.audit_barcode_register('4444444444444', '20000000-0000-0000-0000-000000000001') ->> 'outcome') = 'disabled', 'a disabled barcode cannot be claimed or reopened by registering');
reset role;

-- ── the Center list and overview ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok((public.audit_barcode_overview() ->> 'total')::int = 5, 'overview counts every barcode');
select pg_temp.ok((select count(*) from public.audit_barcode_list('unverified')) = 2, 'the list filters by status');
select pg_temp.ok((select count(*) from public.audit_barcode_list(null, 'beta')) = 0 and (select count(*) from public.audit_barcode_list(null, 'alpha')) >= 1, 'the list searches product names');
select pg_temp.ok((select total from public.audit_barcode_list(null, null, 2, 0) limit 1) = 5, 'a page reports the full total');
select pg_temp.ok((select registered_by_name from public.audit_barcode_list(null, '5901234') limit 1) = 'Reg One', 'the list shows who registered');
select pg_temp.refused($$select * from public.audit_barcode_list('bogus')$$, 'status_invalid', 'an unknown status filter is refused');
reset role;

-- ── the phone's copy ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select pg_temp.ok((select count(*) from public.audit_barcode_mirror()) = 5, 'a scanner reads the whole list');
select pg_temp.ok((select count(*) from public.audit_barcode_mirror(null, null, 2)) = 2, 'a page is capped by the limit');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'audit_barcodes' and column_name in ('qty', 'price')), 'the barcode table holds no stock or prices (AUD-4)');
select pg_temp.ok((select count(*) from public.audit_barcode_mirror((select m.updated_at from public.audit_barcode_mirror() m order by m.updated_at desc, m.id desc limit 1),
  (select m.id from public.audit_barcode_mirror() m order by m.updated_at desc, m.id desc limit 1))) = 0, 'the list since the newest row is empty');
select pg_temp.ok((select count(*) from public.audit_barcode_mirror((select m.updated_at from public.audit_barcode_mirror() m order by m.updated_at, m.id limit 1),
  (select m.id from public.audit_barcode_mirror() m order by m.updated_at, m.id limit 1))) = 4, 'the list since the first row holds the other four');
reset role;

-- ── scans from a phone ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
insert into ids select 'asg', (public.audit_individual_start('80000000-0000-0000-0000-000000000001', array['A1', 'B1']) ->> 'assignment_id')::uuid;
select pg_temp.ok((select counting_method from public.audit_my_assignments() limit 1) = 'hybrid', 'an Individual Audit counts as hybrid on the counter''s assignment');
select pg_temp.refused($$select public.audit_scan_batch('{"a":1}'::jsonb)$$, 'invalid_events', 'events must be a list');
select pg_temp.ok((public.audit_scan_batch(jsonb_build_array(
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000001', 'type', 'lookup', 'barcode', ' 5901234 123457', 'result', 'matched', 'at', now()),
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000002', 'type', 'count', 'barcode', '5901234123457', 'result', 'matched', 'code', 'A2',
                     'assignment', (select v from ids where k = 'asg'), 'at', now() - interval '5 minutes')
  )) ->> 'saved')::int = 2, 'a scanner saves its scans');
select pg_temp.ok((public.audit_scan_batch(jsonb_build_array(
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000001', 'type', 'lookup', 'barcode', '5901234123457', 'result', 'matched', 'at', now())
  )) ->> 'duplicates')::int = 1, 'sending a scan again changes nothing');
select pg_temp.ok((public.audit_scan_batch(jsonb_build_array(
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000003', 'type', 'count', 'barcode', '5901234123457', 'result', 'matched', 'assignment', gen_random_uuid()),
  jsonb_build_object('id', 'not-a-uuid', 'type', 'lookup', 'barcode', '5901234123457', 'result', 'matched'),
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000004', 'type', 'lookup', 'barcode', '', 'result', 'matched'),
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000005', 'type', 'lookup', 'barcode', '5901234123457', 'result', 'wrong'),
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000006', 'type', 'lookup', 'barcode', '5901234123457', 'result', 'not_found', 'at', 'garbage'),
  jsonb_build_object('id', '90000000-0000-0000-0000-000000000007', 'type', 'lookup', 'barcode', '9999999999999', 'result', 'not_found', 'at', now() + interval '10 days')
  )) ->> 'rejected')::int = 5, 'someone else''s assignment and unreadable events are rejected one by one');
select pg_temp.ok((select count(*) from public.audit_scan_history()) = 3, 'the good events in that batch were still saved');
select pg_temp.refused(format('select public.audit_scan_batch(%L::jsonb)', (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'type', 'lookup', 'barcode', '5901234123457', 'result', 'matched'))::text from generate_series(1, 201))), 'batch_too_large', 'more than 200 events at once is refused');
reset role;
select pg_temp.ok((select scanned_at from public.audit_scan_events where client_event_id = '90000000-0000-0000-0000-000000000007') <= now() + interval '1 second', 'a scan time in the far future is replaced by the server time');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select public.audit_scan_batch(jsonb_build_array(jsonb_build_object('id', '90000000-0000-0000-0000-000000000009', 'type', 'lookup', 'barcode', '5901234123457', 'result', 'matched')));
select pg_temp.ok((select count(*) from public.audit_scan_history()) = 1, 'a scanner reads only their own scan history');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.ok((select count(*) from public.audit_scan_history()) = 4, 'an administrator reads everyone''s');
select pg_temp.ok((select count(*) from public.audit_barcode_history((select v from ids where k = 'b2'))) >= 4, 'an administrator reads one barcode''s history');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.refused(format('select * from public.audit_barcode_history(%L)', (select v from ids where k = 'b2')), 'not_allowed', 'a registrar cannot read the full history');
reset role;

-- ── history can never be edited; tables cannot be read or written directly ──
select pg_temp.fails($$update public.audit_scan_events set barcode = 'X1234'$$, 'scan events cannot be edited');
select pg_temp.fails($$delete from public.audit_barcode_log$$, 'the barcode log cannot be deleted');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'aal2');
select pg_temp.fails($$select * from public.audit_barcodes$$, 'even an administrator has no direct table access');
select pg_temp.fails($$insert into public.audit_barcodes (barcode, product_id, product_code, product_name, registered_by) values ('ZZZZ1234', gen_random_uuid(), 'A1', 'x', auth.uid())$$, 'no direct writes');
reset role;
set local role anon;
select pg_temp.fails($$select * from public.audit_barcode_mirror()$$, 'a signed-out visitor cannot call the functions');
reset role;

-- ── counting method of an audit ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('80000000-0000-0000-0000-0000000000e1', 'Method test', 'full');
select pg_temp.refused(format('select public.audit_engagement_set_method(%L, %L)', (select v from ids where k = 'eng'), 'scan-only'), 'invalid_method', 'only manual, barcode or hybrid');
select public.audit_engagement_set_method((select v from ids where k = 'eng'), 'hybrid');
select public.audit_engagement_set_method((select v from ids where k = 'eng'), 'hybrid');
reset role;
select pg_temp.ok((select counting_method from public.audit_engagements where id = (select v from ids where k = 'eng')) = 'hybrid', 'the owner sets the counting method');
select pg_temp.ok((select count(*) from public.activity_log where action = 'audit.method_changed') = 1, 'one change, one log line');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.refused(format('select public.audit_engagement_set_method(%L, %L)', (select v from ids where k = 'eng'), 'manual'), 'not_allowed', 'a registrar cannot change an audit''s method');
reset role;

-- ── the grants themselves, not just the symptoms ──
select pg_temp.ok(not exists (
  select 1 from (values ('anon'), ('authenticated')) r (role), (values ('audit_barcodes'), ('audit_barcode_log'), ('audit_scan_events')) t (tbl)
  where has_table_privilege(r.role, 'public.' || t.tbl, 'select') or has_table_privilege(r.role, 'public.' || t.tbl, 'insert')
     or has_table_privilege(r.role, 'public.' || t.tbl, 'update') or has_table_privilege(r.role, 'public.' || t.tbl, 'delete')),
  'neither anon nor signed-in users hold any privilege on the three barcode tables');
select pg_temp.ok((select bool_and(c.relrowsecurity) from pg_class c where c.relname in ('audit_barcodes', 'audit_barcode_log', 'audit_scan_events') and c.relnamespace = 'public'::regnamespace), 'row-level security is on for all three tables');
select pg_temp.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'audit\_barcode\_%' or p.proname in ('audit_scan_batch', 'audit_scan_history', 'audit_engagement_set_method'))
    and p.proname not in ('audit_barcode_clean', 'audit_barcode_note', 'audit_barcode_require') and has_function_privilege('anon', p.oid, 'execute')),
  'anon can execute none of the barcode functions');
select pg_temp.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('audit_barcode_clean', 'audit_barcode_note', 'audit_barcode_require')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'the helper functions are not callable by app users');
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'audit\_barcode\_%' and p.prosecdef) = 12 and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'audit\_barcode\_%') = 14, 'the 12 barcode functions that act are security definer (the 2 pure helpers are not)');

rollback;

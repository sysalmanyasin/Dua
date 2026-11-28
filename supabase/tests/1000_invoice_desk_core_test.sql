-- Tests for 1000_invoice_desk_core (Audit 0): the only way an invoice or product is written, its validation, idempotency and who can read.
-- Amount-in-words must match the total (migration 1001), so the tests build it with the same database function. Invented data.
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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','m@t'),('00000000-0000-0000-0000-0000000000b2','p@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Desk'),('10000000-0000-0000-0000-000000000002','Plain');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','desk','senior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','plain','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b1','invoice_desk.manage','grant'),
 ('00000000-0000-0000-0000-0000000000b2','invoice_desk.manage','deny');

do $t$ declare
  m uuid := '00000000-0000-0000-0000-0000000000b1'; p uuid := '00000000-0000-0000-0000-0000000000b2';
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();
  id1 uuid; id1b uuid; id2 uuid; pid uuid; inv record; lines jsonb; n int;
  l2 jsonb := '[{"description":"Test book A","quantity":2,"unit_price":150.50},{"description":"Test book B","quantity":1.5,"unit_price":10}]';
  hdrj text := '{"business_id":"bs-mart","template_id":"bs-mart-v1","template_version":1,"invoice_number":"T-001","invoice_date":"2026-11-20","amount_words":"%s"}';
begin
  perform pg_temp.as_user(m);
  id1 := public.invoice_desk_save_invoice(format(hdrj, public.invoice_desk_amount_words(316))::jsonb, l2, k1);
  select * into inv from public.invoice_desk_invoices where id = id1;
  perform pg_temp.ok(inv.subtotal = 316.00 and inv.discount = 0 and inv.grand_total = 316.00, 'the server computes the totals from the lines (2 x 150.50 + 1.5 x 10 = 316.00)');
  perform pg_temp.ok(inv.created_by = m and inv.business_id = 'bs-mart' and inv.invoice_number = 'T-001', 'the invoice records who saved it and its business and number');
  perform pg_temp.ok((select array_agg(display_order order by display_order) from public.invoice_desk_lines where invoice_id = id1) = array[1, 2], 'lines are numbered in the order sent');
  perform pg_temp.ok((select array_agg(line_total order by display_order) from public.invoice_desk_lines where invoice_id = id1) = array[301.00, 15.00], 'each line total is quantity x price rounded to paisa');

  id1b := public.invoice_desk_save_invoice(format(hdrj, public.invoice_desk_amount_words(316))::jsonb, l2, k1);
  perform pg_temp.ok(id1b = id1, 'saving again with the same key returns the same invoice (a retried save never duplicates)');
  reset role;
  perform pg_temp.ok((select count(*) from public.invoice_desk_invoices) = 1 and (select count(*) from public.invoice_desk_lines) = 2, 'the retry created no second invoice and no extra lines');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'invoice_desk.invoice_created') = 1, 'one activity-log entry per invoice');
  perform pg_temp.as_user(m);

  -- the best-choice template is the only one with a discount
  id2 := public.invoice_desk_save_invoice(jsonb_build_object('business_id','best-choice-store','template_id','best-choice-store-v1','template_version',1,'invoice_number','T-002','invoice_date','2026-11-20','discount',16,'amount_words',public.invoice_desk_amount_words(300)), l2, k2);
  select * into inv from public.invoice_desk_invoices where id = id2;
  perform pg_temp.ok(inv.subtotal = 316 and inv.discount = 16 and inv.grand_total = 300, 'a best-choice invoice takes its discount off the subtotal');

  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, public.invoice_desk_amount_words(316)) , '[]'), 'an invoice with no lines is refused', 'to 200 lines');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, null)', format(hdrj, public.invoice_desk_amount_words(316)), l2), 'a missing idempotency key is refused', 'idempotency key');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, public.invoice_desk_amount_words(316)), (select jsonb_agg('{"description":"x","quantity":1,"unit_price":1}'::jsonb) from generate_series(1, 201))), 'more than 200 lines is refused', 'to 200 lines');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', replace(format(hdrj, public.invoice_desk_amount_words(316)), 'bs-mart-v1', 'best-choice-store-v1'), l2), 'a template that does not belong to the business is refused', 'do not match');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', replace(format(hdrj, public.invoice_desk_amount_words(316)), 'T-001', ''), l2), 'an empty invoice number is refused', 'invoice number');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, ''), l2), 'empty amount in words is refused', 'amount in words');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, public.invoice_desk_amount_words(316)), '[{"description":"x","quantity":0,"unit_price":5}]'), 'a zero quantity is refused', 'invalid invoice line');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, public.invoice_desk_amount_words(316)), '[{"description":"x","quantity":1,"unit_price":-5}]'), 'a negative price is refused', 'invalid invoice line');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, public.invoice_desk_amount_words(316)), '[{"description":"   ","quantity":1,"unit_price":5}]'), 'a blank description is refused', 'invalid invoice line');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', replace(format(hdrj, public.invoice_desk_amount_words(300)), '"amount_words"', '"discount":16,"amount_words"'), l2), 'a discount on a template that has none is refused', 'discount is not supported');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', jsonb_build_object('business_id','best-choice-store','template_id','best-choice-store-v1','template_version',1,'invoice_number','T-003','invoice_date','2026-11-20','discount',400,'amount_words','x'), l2), 'a discount larger than the subtotal is refused', 'invalid discount');
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, 'Nine Hundred Pakistani Rupees Only'), l2), 'amount in words that does not match the total is refused (integrity trigger, migration 1001)');
  perform pg_temp.ok((select count(*) from public.invoice_desk_invoices) = 2, 'none of the refused saves left a partial invoice behind');

  perform pg_temp.fails('insert into public.invoice_desk_invoices(business_id, invoice_number, invoice_date, template_id, template_version, subtotal, grand_total, amount_words, created_by) values (''bs-mart'',''X'',''2026-11-20'',''bs-mart-v1'',1,1,1,''x'', auth.uid())', 'direct inserts into invoices are refused even for the manager', '42501');
  perform pg_temp.fails('update public.invoice_desk_invoices set grand_total = 1', 'invoices cannot be edited after saving', '42501');
  perform pg_temp.fails('delete from public.invoice_desk_lines', 'lines cannot be deleted', '42501');
  perform pg_temp.fails('select * from public.invoice_desk_idempotency', 'the idempotency table is not readable by the app', '42501');
  perform pg_temp.ok((select count(*) from public.invoice_desk_invoices) = 2 and (select count(*) from public.invoice_desk_lines) = 4, 'the manager can read the invoices and lines');

  -- products
  pid := public.invoice_desk_product_save('{"business_id":"bs-mart","name":"  Test Pen  ","suggested_price":25}'::jsonb, k3);
  perform pg_temp.ok((select name = 'Test Pen' and suggested_price = 25 and active from public.invoice_desk_products where id = pid), 'a product is saved trimmed, active by default');
  perform public.invoice_desk_product_save(jsonb_build_object('id', pid, 'business_id', 'bs-mart', 'name', 'Test Pen Gel', 'suggested_price', 30, 'active', false), gen_random_uuid());
  perform pg_temp.ok((select name = 'Test Pen Gel' and suggested_price = 30 and not active from public.invoice_desk_products where id = pid), 'saving with an id updates that product');
  perform pg_temp.fails(format('select public.invoice_desk_product_save(%L::jsonb, gen_random_uuid())', jsonb_build_object('id', pid, 'business_id', 'safari-book-land', 'name', 'x', 'suggested_price', 1)), 'a product cannot be updated through another business', 'product not found');
  perform pg_temp.fails('select public.invoice_desk_product_save(''{"business_id":"bs-mart","name":"x","suggested_price":1}''::jsonb, null)', 'a product save without a key is refused', 'idempotency key');
  perform pg_temp.fails('select public.invoice_desk_product_save(''{"business_id":"nope","name":"x","suggested_price":1}''::jsonb, gen_random_uuid())', 'an unknown business is refused', 'check');
  perform pg_temp.fails('select public.invoice_desk_product_save(''{"business_id":"bs-mart","name":"x","suggested_price":-1}''::jsonb, gen_random_uuid())', 'a negative suggested price is refused', 'check');
  reset role;

  -- no right, no access
  perform pg_temp.as_user(p);
  perform pg_temp.fails(format('select public.invoice_desk_save_invoice(%L::jsonb, %L::jsonb, gen_random_uuid())', format(hdrj, public.invoice_desk_amount_words(316)), l2), 'a person denied invoice_desk.manage cannot save', '42501');
  perform pg_temp.fails('select public.invoice_desk_product_save(''{"business_id":"bs-mart","name":"x","suggested_price":1}''::jsonb, gen_random_uuid())', 'a person denied invoice_desk.manage cannot save a product', '42501');
  perform pg_temp.ok((select count(*) from public.invoice_desk_invoices) = 0 and (select count(*) from public.invoice_desk_lines) = 0 and (select count(*) from public.invoice_desk_products) = 0, 'and sees no invoices, lines or products');
  reset role;
  perform pg_temp.ok(not has_function_privilege('anon', 'public.invoice_desk_save_invoice(jsonb,jsonb,uuid)', 'execute') and not has_function_privilege('anon', 'public.invoice_desk_product_save(jsonb,uuid)', 'execute'), 'the visitor role cannot call either save function');
end $t$;
rollback;

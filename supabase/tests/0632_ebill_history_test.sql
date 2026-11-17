\set ON_ERROR_STOP on
-- 0632: history list and invoice detail. All data below is invented.
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

insert into public.ebill_devices(device_id, label, registered_by) values ('20000000-0000-0000-0000-000000000001','Counter 1','00000000-0000-0000-0000-0000000000b1');
create function pg_temp.mk(p_id uuid, p_no text, p_user uuid, p_name text, p_cust text, p_mode text, p_net numeric, p_date date default current_date, p_disc numeric default 0) returns void language plpgsql as $$
begin
  insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, customer, payment_mode, gross_total, line_discounts, net_gross, net_total, client_created_at)
  values (p_id, p_no, p_date, '20000000-0000-0000-0000-000000000001', p_user, p_name, p_cust, p_mode, p_net + p_disc, p_disc, p_net, p_net, p_date::timestamptz + interval '10 hours');
  insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values (p_id, 1, 'A1', 'Item', 'unit', 1, p_net + p_disc, 'amt', p_net);
end $$;

select pg_temp.mk('30000000-0000-0000-0000-000000000001','EB-T-1','00000000-0000-0000-0000-0000000000b1','J One','Mr Ali','Cash',90, current_date, 10);
select pg_temp.mk('30000000-0000-0000-0000-000000000002','EB-T-2','00000000-0000-0000-0000-0000000000b2','J Two','100% Khan','Card',50, current_date);
select pg_temp.mk('30000000-0000-0000-0000-000000000003','EB-T-3','00000000-0000-0000-0000-0000000000b1','J One','Mr Ali','Credit',30, current_date - 5);
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','ebill.history_all','grant');
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.denied($q$select public.ebill_history()$q$, 'no billing right, no history');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_history();
  perform pg_temp.ok((r ->> 'total')::int = 2 and (r ->> 'sum_net')::numeric = 120, 'staff see only their own invoices, with a total');
  perform pg_temp.ok((select bool_and((e ->> 'staff_name') = 'J One') from jsonb_array_elements(r -> 'rows') e), 'all of them theirs');
  perform pg_temp.ok((r #>> '{rows,0,discounts}')::numeric = 10 or (r #>> '{rows,1,discounts}')::numeric = 10, 'discounts are the sum of every kind');
  perform pg_temp.ok((r #>> '{rows,0,items}')::int = 1, 'each row says how many items');
  perform pg_temp.ok((public.ebill_invoice_detail('30000000-0000-0000-0000-000000000002') ->> 'code') = 'not_found', 'staff cannot open someone else''s invoice');
  perform pg_temp.ok((public.ebill_invoice_detail('30000000-0000-0000-0000-000000000001') ->> 'ok')::boolean, 'but can open their own');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((public.ebill_history() ->> 'total')::int = 3, 'someone with ebill.history_all sees every invoice');
  perform pg_temp.denied($q$select public.ebill_refund_invoice('30000000-0000-0000-0000-000000000002', 'trying')$q$, 'but seeing is not refunding');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((public.ebill_history(current_date, current_date) ->> 'total')::int = 2, 'date range: today only');
  perform pg_temp.ok((public.ebill_history(null, current_date - 1) ->> 'total')::int = 1, 'date range: up to yesterday');
  perform pg_temp.ok((public.ebill_history(null, null, 'ALI') ->> 'total')::int = 2, 'text search ignores case and finds the customer');
  perform pg_temp.ok((public.ebill_history(null, null, 'eb-t-3') ->> 'total')::int = 1, 'and the invoice number');
  perform pg_temp.ok((public.ebill_history(null, null, 'j two') ->> 'total')::int = 1, 'and the staff name');
  perform pg_temp.ok((public.ebill_history(null, null, '%') ->> 'total')::int = 1, '"%" is an ordinary character, not a wildcard (only "100% Khan" has one)');
  perform pg_temp.ok((public.ebill_history(null, null, '_') ->> 'total')::int = 0, '"_" matches nothing');
  perform pg_temp.ok((public.ebill_history(null, null, null, null, 'Card') ->> 'total')::int = 1, 'payment mode filter');
  perform pg_temp.ok((public.ebill_history(null, null, null, null, null, 2, 0) -> 'rows') is not null and jsonb_array_length(public.ebill_history(null, null, null, null, null, 2, 0) -> 'rows') = 2, 'paging: limit');
  perform pg_temp.ok((public.ebill_history(null, null, null, null, null, 2, 2) -> 'rows' -> 0 ->> 'invoice_no') = 'EB-T-3', 'paging: offset gives the oldest last');
  perform pg_temp.ok((public.ebill_history(null, null, null, null, null, 2, 2) ->> 'total')::int = 3, 'and the total still counts everything');

  -- refunds and corrections show up
  perform public.ebill_refund_invoice('30000000-0000-0000-0000-000000000002', 'returned');
  perform public.ebill_correct_invoice('30000000-0000-0000-0000-000000000001', '{"customer":"Ali Khan","payment_mode":"Card"}', 'fix');
  r := public.ebill_history();
  perform pg_temp.ok((r ->> 'sum_net')::numeric = 120 and (r ->> 'sum_refunded')::numeric = 50, 'totals exclude refunded money and report it separately');
  perform pg_temp.ok((public.ebill_history(null, null, null, 'refunded') ->> 'total')::int = 1, 'status filter: refunded');
  perform pg_temp.ok((public.ebill_history(null, null, null, 'corrected') ->> 'total')::int = 1, 'status filter: corrected');
  perform pg_temp.ok((public.ebill_history(null, null, 'ali khan') ->> 'total')::int = 1, 'search finds the corrected name');
  perform pg_temp.ok((public.ebill_history(null, null, null, null, 'Card') ->> 'total')::int = 2, 'and the corrected payment mode');
  r := public.ebill_invoice_detail('30000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((r #>> '{invoice,status}') = 'corrected' and (r #>> '{invoice,customer}') = 'Ali Khan' and jsonb_array_length(r -> 'lines') = 1 and jsonb_array_length(r -> 'events') = 1, 'the detail shows the effective values, the lines and the events');
  perform pg_temp.ok((r #>> '{events,0,reason}') = 'fix' and (r #>> '{events,0,by}') = 'S One', 'each event shows its reason and who did it');
  perform pg_temp.ok(not (r -> 'invoice') ? 'staff_user' is false or true, 'detail is a plain record');
  perform pg_temp.back();
end $t$;

rollback;

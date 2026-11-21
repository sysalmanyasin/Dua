\set ON_ERROR_STOP on
-- 0633: refunds by item and quantity. All data below is invented.
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

-- Phase 6 money-integrity check: 300 invented invoices with random items, prices and totals are refunded in random pieces.
-- However the pieces fall, the refunds must add up to the invoice net total to the paisa, never exceed it, and never go negative.
do $t$ declare
  i int; n_lines int; l int; inv uuid; g numeric; rate numeric; qty numeric; net numeric; r jsonb; st jsonb; picks jsonb;
  rem numeric; take numeric; q1 uuid; sum_ref numeric; steps int; worst int := 0; total_steps int := 0; bad int := 0; amt numeric; lim int;
begin
  perform setseed(0.4242);
  for i in 1..300 loop
    inv := gen_random_uuid(); g := 0; n_lines := 1 + floor(random() * 6)::int;
    create temp table if not exists fz(line_no int, qty numeric, rate numeric, lt numeric) on commit drop;
    truncate fz;
    for l in 1..n_lines loop
      qty := case when random() < 0.25 then (1 + floor(random() * 15)) / 2.0 else 1 + floor(random() * 9) end;
      rate := round((0.5 + random() * 800)::numeric, 2);
      insert into fz values (l, qty, rate, round(qty * rate, 2));
      g := g + round(qty * rate, 2);
    end loop;
    -- the net has discount, tax and adjustment mixed in; the database forbids editing a posted invoice, so it is inserted once, complete
    net := greatest(round((g * (0.7 + random() * 0.5) + (random() * 20 - 10))::numeric, 2), 0.01);
    insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
      values (inv, 'EB-F' || i, current_date, '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'J One', 'Cash', g, g, net, now());
    insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total)
      select inv, f.line_no, 'F' || f.line_no, 'Fuzz ' || f.line_no, 'unit', f.qty, f.rate, 'amt', f.lt from fz f;

    steps := 0; lim := 40;
    loop
      st := public.ebill_refund_state(inv); -- internal helper: read as the database owner
      exit when public.ebill_remaining_qty(inv) = 0 or steps >= lim;
      -- pick a random non-empty subset of the lines that still have something left, and a random quantity of each
      picks := '[]'::jsonb;
      for l in select (x ->> 'line_no')::int from jsonb_array_elements(st -> 'lines') x where (x ->> 'remaining')::numeric > 0 loop
        if random() < 0.6 then
          rem := (select (x ->> 'remaining')::numeric from jsonb_array_elements(st -> 'lines') x where (x ->> 'line_no')::int = l);
          take := case when rem <= 1 or random() < 0.3 then rem else 1 + floor(random() * (floor(rem)))::numeric end;
          take := least(take, rem);
          picks := picks || jsonb_build_object('line_no', l, 'qty', take);
        end if;
      end loop;
      if jsonb_array_length(picks) = 0 then continue; end if;
      perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
      r := public.ebill_refund_lines(inv, picks, 'fuzz', gen_random_uuid());
      perform pg_temp.back();
      if (r ->> 'ok')::boolean is not true then bad := bad + 1; raise notice 'refused: %', r; exit; end if;
      amt := (r ->> 'amount')::numeric;
      if amt < 0 then bad := bad + 1; raise notice 'negative refund on %', i; end if;
      if (r ->> 'refunded_total')::numeric > net then bad := bad + 1; raise notice 'over-refund on %', i; end if;
      steps := steps + 1;
    end loop;

    select coalesce(sum(amount), 0) into sum_ref from public.ebill_invoice_events where invoice_id = inv and kind = 'refund';
    if sum_ref <> net or public.ebill_remaining_qty(inv) <> 0 then bad := bad + 1; raise notice 'invoice % : refunded % of net % (left qty %)', i, sum_ref, net, public.ebill_remaining_qty(inv); end if;
    total_steps := total_steps + steps; worst := greatest(worst, steps);
  end loop;
  perform pg_temp.ok(bad = 0, format('300 random invoices: every one refunded in pieces adds up to its net total to the paisa (%s refunds, at most %s per invoice)', total_steps, worst));

  -- the one-tap "refund everything left" finishes any partly refunded invoice at exactly the net total too
  for i in 1..60 loop
    inv := gen_random_uuid(); g := 0;
    create temp table if not exists fz(line_no int, qty numeric, rate numeric, lt numeric) on commit drop;
    truncate fz;
    for l in 1..3 loop
      qty := 1 + floor(random() * 5); rate := round((1 + random() * 300)::numeric, 2);
      insert into fz values (l, qty, rate, round(qty * rate, 2));
      g := g + round(qty * rate, 2);
    end loop;
    net := round(g * 0.93, 2);
    insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
      values (inv, 'EB-G' || i, current_date, '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'J One', 'Cash', g, g, net, now());
    insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total)
      select inv, f.line_no, 'G' || f.line_no, 'G' || f.line_no, 'unit', f.qty, f.rate, 'amt', f.lt from fz f;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
    perform public.ebill_refund_lines(inv, jsonb_build_array(jsonb_build_object('line_no', 1, 'qty', 1)), 'first piece', gen_random_uuid());
    r := public.ebill_refund_invoice(inv, 'the rest');
    perform pg_temp.back();
    select coalesce(sum(amount), 0) into sum_ref from public.ebill_invoice_events where invoice_id = inv and kind = 'refund';
    if sum_ref <> net then bad := bad + 1; raise notice 'one-tap rest on %: % vs %', i, sum_ref, net; end if;
  end loop;
  perform pg_temp.ok(bad = 0, '60 invoices: a first piece then "refund the rest" also adds up exactly to net');

  -- the same request id sent twice (a lost reply) refunds once
  inv := gen_random_uuid(); r := null;
  insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
    values (inv, 'EB-DUP', current_date, '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'J One', 'Cash', 90, 90, 90, now());
  insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values (inv, 1, 'D1', 'Dup', 'unit', 3, 30, 'amt', 90);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  q1 := gen_random_uuid();
  perform public.ebill_refund_lines(inv, '[{"line_no":1,"qty":1}]', 'lost reply', q1);
  r := public.ebill_refund_lines(inv, '[{"line_no":1,"qty":1}]', 'lost reply', q1);
  perform pg_temp.back();
  perform pg_temp.ok(r ->> 'code' = 'duplicate' and (select count(*) from public.ebill_invoice_events where invoice_id = inv and kind = 'refund') = 1, 'a retry with the same request id never refunds twice');
end $t$;
rollback;

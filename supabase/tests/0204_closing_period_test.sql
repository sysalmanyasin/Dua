-- Tests for 0204_closing_period (gap G1): the "since the last Final" roll-up, and the figures a shift closing STORES.
-- Fixtures are hand-worked (tests/fixtures/closing-period-cases.json) and also run by tests/unit/closing-period.test.js.
\set ON_ERROR_STOP on
\set pcases `cat ../../tests/fixtures/closing-period-cases.json`
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create temp table pc as select :'pcases'::jsonb as j;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000b2','j2@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');
-- a junior whose closing permissions are explicitly denied: someone with no right to any closing
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000002','J Two');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','nobody','junior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','closing.enter_own','deny');

-- builds one closing (and its stored result) straight into the tables, as the fixtures describe it
create function pg_temp.mk(p jsonb, base date) returns uuid language plpgsql as $$
declare v_slot uuid; v_id uuid; v_date date := base + (p ->> 'day')::int; v_seq int := (p ->> 'seq')::int; v_prev uuid; m jsonb := p -> 'ret_manual'; b jsonb := p -> 'book';
begin
  insert into public.closing_slots (business_date, kind, seq)
  values (v_date, case when v_seq = 10 then 'night' when v_seq = 20 then 'morning' when v_seq = 9999 then 'evening' else 'handover' end, v_seq)
  on conflict do nothing;
  select id into v_slot from public.closing_slots where business_date = v_date and seq = v_seq;
  if p ? 'old_revision' then -- an earlier revision that has since been superseded: must never be counted
    insert into public.closings (slot_id, mode, status, entered_by, idempotency_key, submitted_at)
    values (v_slot, p ->> 'mode', 'submitted', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), now()) returning id into v_prev;
    insert into public.closing_results (closing_id, till_float, per_customer_charge, customers_charge, hs_total, strips_a, total_returns, mediq_extra, shift_sale, customers,
      net_sale, cc_curr, cc_total, till_c, vault_d, debt_e, deposits_f, misc_g, grand, liquid, prev_cash, net_cash, shift_variance, final_net_sale, final_net_cash)
    values (v_prev, 45000, 1, 0, 0, 0, 0, 0, (p -> 'old_revision' ->> 'shift_sale')::numeric, (p -> 'old_revision' ->> 'customers')::int, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    update public.closings set status = 'superseded' where id = v_prev;
  end if;
  insert into public.closings (slot_id, mode, status, revision, supersedes_id, correction_reason, entered_by, idempotency_key, submitted_at,
    ret_system, ret_manual_1, ret_manual_2, ret_manual_3, book_bill_1, book_bill_2, extra_cash)
  values (v_slot, p ->> 'mode', p ->> 'status', case when v_prev is null then 1 else 2 end, v_prev, case when v_prev is null then null else 'fixture' end,
    '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), case when p ->> 'status' = 'submitted' then now() end,
    (p ->> 'ret_system')::numeric, (m ->> 0)::numeric, (m ->> 1)::numeric, (m ->> 2)::numeric, (b ->> 0)::numeric, (b ->> 1)::numeric, (p ->> 'extra_cash')::numeric)
  returning id into v_id;
  if p ->> 'status' = 'submitted' then
    insert into public.closing_results (closing_id, till_float, per_customer_charge, customers_charge, hs_total, strips_a, total_returns, mediq_extra, shift_sale, customers,
      net_sale, cc_curr, cc_total, till_c, vault_d, debt_e, deposits_f, misc_g, grand, liquid, prev_cash, net_cash, shift_variance, final_net_sale, final_net_cash)
    values (v_id, 45000, 1, 0, 0, 0, 0, (p ->> 'mediq_extra')::numeric, (p ->> 'shift_sale')::numeric, (p ->> 'customers')::int, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  end if;
  return v_id;
end $$;

-- 1. what a shift closing really STORES (this runs first: the opening closing must be the first closing in the database), worked through the whole flow by hand (settings: float 45000, Rs 1 per customer)
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"till": [9,0,0,0,0,0,0,0], "last_bill_no": 500}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  -- Night: shift sale 10000 (new day, so the whole POS figure), customers 520-500 = 20, net sale = 10000 + 100 books + 20 - 50 returns = 10070
  --        Liquid = till 50000 - float 45000 = 5000. Nothing earlier in the period, the opening Final has nothing: net final sale 10070, net final cash 5000 - 10070 = -5070
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 10000, "last_bill_no": 520, "book_bill_1": 100, "ret_manual_1": 50, "till": [10,0,0,0,0,0,0,0]}');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((r -> 'result' ->> 'net_sale')::numeric = 10070 and (r -> 'result' ->> 'liquid')::numeric = 5000, 'Night: net sale 10070, Liquid 5000');
  perform pg_temp.ok((r -> 'result' ->> 'final_net_sale')::numeric = 10070 and (r -> 'result' ->> 'final_net_cash')::numeric = -5070, 'Night: stored net final sale 10070 and net final cash -5070');

  -- Morning: shift sale 25000 - 10000 = 15000, customers 560-520 = 40, mediq extra 200-150 = 50, returns 30 + 10, books 40
  --          net sale = 15000 + 40 + 40 - 40 + 50 = 15090. Liquid = till 60000 - 45000 = 15000.
  --          Period = the Night (same day): sale 10000, customers 20, manual returns 50, books 100.
  --          Net final sale = 10000 + 15000 + books (100+40) + customers (20+40) + mediq 50 - manual (50+30) - system returns 10 = 25160
  --          Net final cash = 15000 - earlier-day total 0 - extra cash (0+20) - 25160 = -10180
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift',
    '{"sys_cash": 25000, "last_bill_no": 560, "book_bill_2": 40, "ret_manual_1": 30, "ret_system": 10, "extra_cash": 20,
      "mediq": [{"bill_no": "1", "collected": 200, "pharmacy_bill": 150}], "till": [12,0,0,0,0,0,0,0]}');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000011');
  perform pg_temp.ok((r -> 'result' ->> 'shift_sale')::numeric = 15000 and (r -> 'result' ->> 'customers')::numeric = 40 and (r -> 'result' ->> 'net_sale')::numeric = 15090
    and (r -> 'result' ->> 'liquid')::numeric = 15000, 'Morning: shift sale 15000, 40 customers, net sale 15090, Liquid 15000');
  perform pg_temp.ok((r -> 'result' ->> 'final_net_sale')::numeric = 25160, 'Morning: stored net final sale 25160 (it includes the Night)');
  perform pg_temp.ok((r -> 'result' ->> 'final_net_cash')::numeric = -10180, 'Morning: stored net final cash -10180');
  perform pg_temp.ok((r -> 'result' ->> 'shift_variance')::numeric = (r -> 'result' ->> 'net_cash')::numeric - (r -> 'result' ->> 'net_sale')::numeric, 'the shift keeps its OWN variance, not the period figure');
  -- the screen can read the same roll-up
  perform pg_temp.ok((public.closing_period((select id from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000011')) ->> 'same_date_shift_sale')::numeric = 10000, 'the screen can read the roll-up of its own closing');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok(not exists (select 1 from public.closings), 'someone with no closing permission sees nothing');
  reset role;
end $t$;

-- 2. the roll-up against every hand-worked case (each case lives 100 days after the previous one, so they never touch)
do $t$ declare cs jsonb; c jsonb; e jsonb; k text; base date; v_cur uuid; got jsonb; n int := 0; begin
  select j into cs from pc;
  for c in select * from jsonb_array_elements(cs) loop
    n := n + 1; base := date '2026-01-01' + n * 100;
    for e in select * from jsonb_array_elements(c -> 'timeline') loop perform pg_temp.mk(e, base); end loop;
    insert into public.closing_slots (business_date, kind, seq)
    values (base + (c -> 'current' ->> 'day')::int,
            case when (c -> 'current' ->> 'seq')::int = 10 then 'night' when (c -> 'current' ->> 'seq')::int = 20 then 'morning' when (c -> 'current' ->> 'seq')::int = 9999 then 'evening' else 'handover' end,
            (c -> 'current' ->> 'seq')::int) on conflict do nothing;
    insert into public.closings (slot_id, mode, entered_by, idempotency_key)
    values ((select id from public.closing_slots where business_date = base + (c -> 'current' ->> 'day')::int and seq = (c -> 'current' ->> 'seq')::int),
            'shift', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()) returning id into v_cur;
    got := public.closing_period_agg(v_cur);
    for k in select jsonb_object_keys(c -> 'expect') loop
      perform pg_temp.ok((got ->> k)::numeric = (c -> 'expect' ->> k)::numeric,
        format('%s: %s = %s (got %s)', left(c ->> 'name', 4), k, c -> 'expect' ->> k, got ->> k));
    end loop;
  end loop;
  perform pg_temp.ok(n = jsonb_array_length(cs), 'every fixture case ran');
end $t$;

-- 3. a Final uses only its own values: its roll-up is empty
do $t$ declare v_slot uuid; v_id uuid; begin
  insert into public.closing_slots (business_date, kind, seq) values (date '2027-06-01', 'night', 10) returning id into v_slot;
  insert into public.closings (slot_id, mode, entered_by, idempotency_key) values (v_slot, 'final', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()) returning id into v_id;
  perform pg_temp.ok(public.closing_period_agg(v_id) = '{}'::jsonb, 'a Final closing has no roll-up of earlier shifts');
end $t$;

-- 4. only the people allowed to see a closing can read its roll-up
do $t$ declare v_id uuid; denied boolean := false; begin
  select id into v_id from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000011';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  begin perform public.closing_period(v_id); exception when others then denied := sqlstate = '42501'; end;
  perform pg_temp.ok(denied, 'a person with no closing permission cannot read the roll-up');
  reset role;
  set local role anon;
  denied := false;
  begin perform public.closing_period(v_id); exception when others then denied := sqlstate = '42501'; end;
  perform pg_temp.ok(denied, 'anon cannot read the roll-up');
  denied := false;
  begin perform public.closing_period_agg(v_id); exception when others then denied := sqlstate = '42501'; end;
  perform pg_temp.ok(denied, 'the internal roll-up is not callable from outside');
  reset role;
end $t$;
rollback;

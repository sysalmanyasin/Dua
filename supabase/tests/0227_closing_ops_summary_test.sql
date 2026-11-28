-- Tests for 0227_closing_ops_summary (internal, Closing-owned) and 0704_ops_closing_summary (the Owner-only door Home uses).
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
-- a saved result with only the figures this summary reads
create function pg_temp.res(cid uuid, mediq numeric, cc_total numeric, cc_curr numeric, dep numeric) returns void language plpgsql as $$
begin
  insert into public.closing_results (closing_id, till_float, per_customer_charge, customers_charge, hs_total, strips_a, total_returns, mediq_extra,
    shift_sale, customers, net_sale, cc_curr, cc_total, till_c, vault_d, debt_e, deposits_f, misc_g, grand, liquid, prev_cash, net_cash,
    shift_variance, final_net_sale, final_net_cash)
  values (cid, 0, 0, 0, 0, 0, 0, mediq, 0, 0, 0, cc_curr, cc_total, 0, 0, 0, dep, 0, 0, 0, 0, 0, 0, 0, 0);
end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000c1','s@t'),('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000002','S Two'),('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior'),
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

-- nothing submitted yet
do $t$ begin
  perform pg_temp.ok(public.closing_ops_summary() = '{"has_closing": false}'::jsonb, 'with no submitted closing the summary says so');
end $t$;

insert into public.closing_slots (id, business_date, kind, seq) values
  ('20000000-0000-0000-0000-0000000000a1', date '2031-03-01', 'night', 10),
  ('20000000-0000-0000-0000-0000000000a2', date '2031-03-01', 'morning', 20),
  ('20000000-0000-0000-0000-0000000000a3', date '2031-03-02', 'night', 10),
  ('20000000-0000-0000-0000-0000000000a4', date '2031-03-02', 'morning', 20),
  ('20000000-0000-0000-0000-0000000000a5', date '2031-03-03', 'night', 10),
  ('20000000-0000-0000-0000-0000000000a0', date '2031-02-28', 'night', 10);

-- 28 Feb: an older Final (must not count: nothing before the LAST Final counts)
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, ret_manual_1, status, submitted_at) values
  ('30000000-0000-0000-0000-0000000000a0', '20000000-0000-0000-0000-0000000000a0', 'final', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 9000, 9000, 'submitted', now());
select pg_temp.res('30000000-0000-0000-0000-0000000000a0', 900, 100, 50, 9999);
-- 1 Mar night: the LAST Final: its own figures count
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, book_bill_2, ret_manual_1, status, submitted_at) values
  ('30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', 'final', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 100, 0, 10, 'submitted', now());
select pg_temp.res('30000000-0000-0000-0000-0000000000a1', 5, 800, 300, 1000);
-- 1 Mar morning: shift
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, book_bill_2, ret_manual_1, ret_manual_2, status, submitted_at) values
  ('30000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000a2', 'shift', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 200, 50, 20, 30, 'submitted', now());
select pg_temp.res('30000000-0000-0000-0000-0000000000a2', 7, 900, 400, 1500);
-- 2 Mar night: shift (the latest so far); also a superseded older revision that must not count
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, ret_manual_1, status, submitted_at) values
  ('30000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000a3', 'shift', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 77777, 77777, 'superseded', now());
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, ret_manual_1, ret_manual_2, ret_manual_3, status, submitted_at, revision, supersedes_id, correction_reason) values
  ('30000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-0000000000a3', 'shift', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 5, 1, 2, 3, 'submitted', now(), 2, '30000000-0000-0000-0000-0000000000b1', 'typo');
select pg_temp.res('30000000-0000-0000-0000-0000000000a3', 3, 1000, 300, 1800);
-- 3 Mar night: a draft, never counted
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, status) values
  ('30000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000a5', 'shift', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 555555, 'draft');

do $t$ declare v jsonb; begin
  v := public.closing_ops_summary();
  perform pg_temp.ok(v ->> 'closing_id' = '30000000-0000-0000-0000-0000000000a3' and (v ->> 'has_closing')::boolean, 'it reads the latest SUBMITTED closing, not the draft or the superseded revision');
  perform pg_temp.ok(v ->> 'business_date' = '2031-03-02' and v ->> 'kind' = 'night' and (v ->> 'day_no')::int = 1 and v ->> 'mode' = 'shift', 'it names the closing: date, slot, number in the day, mode');
  perform pg_temp.ok((v ->> 'book_bills')::numeric = 355, 'book bills = last Final own 100 + morning 250 + latest 5 (older Final and superseded revision left out)');
  perform pg_temp.ok((v ->> 'manual_returns')::numeric = 66, 'manual returns = 10 + (20+30) + (1+2+3)');
  perform pg_temp.ok((v ->> 'mediq_collected')::numeric = 15, 'MEDIQ collected = 5 + 7 + 3');
  perform pg_temp.ok((v ->> 'deposits')::numeric = 1800, 'deposits = the latest closing''s cumulative Total Cash Deposits');
  perform pg_temp.ok((v ->> 'carried_cc')::numeric = 700, 'carried CC = cc_total - cc_curr of the latest closing');
  perform pg_temp.ok(v ->> 'period_start' = '2031-03-01' and (v ->> 'period_closings')::int = 3, 'the period starts at the last Final and holds 3 closings');
  perform pg_temp.ok(not (v ->> 'is_opening')::boolean, 'it says whether the closing is the opening one');
end $t$;

-- the same period figures as the Final page of that closing
do $t$ declare v jsonb; fb jsonb; begin
  v := public.closing_ops_summary();
  fb := public.closing_final_breakdown('30000000-0000-0000-0000-0000000000a3');
  perform pg_temp.ok((fb -> 'part1' ->> 'book_bills')::numeric = (v ->> 'book_bills')::numeric and (fb -> 'part1' ->> 'manual_returns')::numeric = (v ->> 'manual_returns')::numeric and (fb -> 'part1' ->> 'mediq_extra')::numeric = (v ->> 'mediq_collected')::numeric,
    'book bills, manual returns and MEDIQ equal the Final page figures of the same closing');
end $t$;

-- a Final becomes the latest: it uses only its own values
insert into public.closings (id, slot_id, mode, entered_by, idempotency_key, book_bill_1, book_bill_2, ret_manual_3, status, submitted_at) values
  ('30000000-0000-0000-0000-0000000000a4', '20000000-0000-0000-0000-0000000000a4', 'final', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 40, 2, 9, 'submitted', now());
select pg_temp.res('30000000-0000-0000-0000-0000000000a4', 4, 650, 150, 300);
do $t$ declare v jsonb; begin
  v := public.closing_ops_summary();
  perform pg_temp.ok(v ->> 'closing_id' = '30000000-0000-0000-0000-0000000000a4' and v ->> 'mode' = 'final', 'a newer Final becomes the latest closing');
  perform pg_temp.ok((v ->> 'book_bills')::numeric = 42 and (v ->> 'manual_returns')::numeric = 9 and (v ->> 'mediq_collected')::numeric = 4, 'a Final starts the period again: only its own book bills, returns and MEDIQ');
  perform pg_temp.ok((v ->> 'deposits')::numeric = 300 and (v ->> 'carried_cc')::numeric = 500, 'deposits and carried CC come from the Final itself');
  perform pg_temp.ok(v ->> 'period_start' = '2031-03-02' and (v ->> 'period_closings')::int = 1, 'the period is just that Final');
end $t$;

-- the internal function is closed to browsers
do $t$ begin
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.closing_ops_summary()', 'execute'), 'a signed-in browser cannot call the Closing helper');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.closing_ops_summary()', 'execute'), 'the visitor role cannot call the Closing helper');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.ops_closing_summary()', 'execute'), 'the visitor role cannot call the Owner door');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.ops_closing_summary()', 'execute'), 'signed-in users reach the Owner door, which then checks the permission');
end $t$;

-- the Owner door
do $t$ declare v jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(public.ops_closing_summary() is null, 'a senior gets nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.ops_closing_summary() is null, 'a junior gets nothing');
  perform pg_temp.fails($q$select public.closing_ops_summary()$q$, 'a signed-in person cannot call the internal helper directly', 'permission denied');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.ops_closing_summary() is null, 'an owner session without the second factor gets nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.ops_closing_summary();
  perform pg_temp.ok(v ->> 'closing_id' = '30000000-0000-0000-0000-0000000000a4' and (v ->> 'book_bills')::numeric = 42, 'the Owner (second factor done) gets the summary');
  perform pg_temp.ok(v ->> 'carried_cc' = '500.00' or (v ->> 'carried_cc')::numeric = 500, 'the door passes Closing''s figures through unchanged (carried CC 500)');
  reset role;
end $t$;
rollback;

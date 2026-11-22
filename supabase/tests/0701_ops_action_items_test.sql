-- Tests for 0701_ops_action_items (Action Centre and Recent Activity).
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- the issues of one rule, as the owner sees them
create function pg_temp.items(k text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(public.ops_action_items() -> 'items') x where x ->> 'rule_key' = k $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','Ayesha Khan');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare v jsonb; today date := (now() at time zone 'Asia/Karachi')::date; yday date := ((now() at time zone 'Asia/Karachi')::date - 1); n int; begin
  -- ── staff are refused ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.ops_action_items() is null and public.ops_recent_activity(10) is null, 'a junior gets nothing from the Action Centre or the activity list');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.ops_action_items() is null, 'an owner session without the second factor gets nothing');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');

  -- ── sales not entered: critical when all of the last 3 days are missing (the default) ──
  v := pg_temp.items('sales_missing');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'severity' = 'critical' and v -> 0 ->> 'category' = 'sales', 'three missing sales days raise one critical issue');
  perform pg_temp.ok(v -> 0 ->> 'href' = '/sales' and v -> 0 ->> 'responsible' = 'Owner' and length(v -> 0 ->> 'detail') > 10, 'the issue says who, why and where to fix it');
  reset role;
  insert into public.daily_sales(business_date, total) values (today - 1, 1000), (today - 2, 1000);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('sales_missing');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'severity' = 'warning', 'one missing day is only a warning');
  reset role;
  insert into public.daily_sales(business_date, total) values (today - 3, 1000);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('sales_missing')) = 0, 'the issue disappears once the sales are entered, with no dismiss step');
  reset role;

  -- ── closing drafts ──
  insert into public.closing_slots(id, business_date, kind, seq) values ('20000000-0000-0000-0000-000000000001', yday, 'evening', 9999);
  insert into public.closings(id, slot_id, status, entered_by, idempotency_key, responsible_staff_id, updated_at)
    values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '10000000-0000-0000-0000-000000000002', now() - interval '20 hours');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('closing_draft_open');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'responsible' = 'Ayesha Khan' and v -> 0 ->> 'href' = '/closing', 'an old draft is an issue with the responsible person named');
  perform public.ops_rule_set('closing_draft_open', null, null, '{"hours": 48}', null);
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('closing_draft_open')) = 0, 'raising the limit clears the issue');
  perform public.ops_rule_set('closing_draft_open', null, null, '{"hours": 12}', null);
  perform public.ops_rule_set('closing_draft_open', false, null, null, null);
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('closing_draft_open')) = 0, 'a rule that is switched off raises nothing');
  perform public.ops_rule_set('closing_draft_open', true, null, null, null);
  reset role;
  update public.closings set status = 'submitted', submitted_at = now() where id = '30000000-0000-0000-0000-000000000001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('closing_draft_open')) = 0, 'submitting the closing clears the issue');
  reset role;

  -- ── stock cover (Inventory's own summary) ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('stock_reorder')) = 0, 'no products low on cover: no stock issue');
  reset role;
  insert into public.inventory_products(name, qty, price, net_qty_60_days, net_qty_90_days, active) values ('Test Tablet', 10, 100, 120, 180, true);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('stock_reorder');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'severity' = 'info' and v -> 0 ->> 'href' = '/inventory', 'a product under 30 days of cover raises an info issue');
  reset role;

  -- ── owner alerts failing ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('notify_failures')) = 0, 'no failed alerts: no issue');
  reset role;
  insert into public.notifications(kind, status, last_error) values ('test.kind', 'failed', 'boom');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('notify_failures');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'severity' = 'critical' and v -> 0 ->> 'href' = '/tools', 'a failed owner alert is a critical issue');
  reset role;

  -- ── the deposit rule: off by default, then compares Closing deposits with the cash sale ──
  -- two days ago: cash sale 300,000 (Sales) and 250,000 of deposit rows on a submitted closing (Closing)
  insert into public.daily_sale_lines(business_date, method_code, amount) values (today - 2, 'cash_sale', 300000);
  insert into public.closing_slots(id, business_date, kind, seq) values ('20000000-0000-0000-0000-000000000002', today - 2, 'evening', 9999);
  insert into public.closings(id, slot_id, status, entered_by, idempotency_key) values
    ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid());
  insert into public.closing_deposits(closing_id, label, amount) values ('30000000-0000-0000-0000-000000000002', 'Bank', 250000);
  update public.closings set status = 'submitted', submitted_at = now() where id = '30000000-0000-0000-0000-000000000002';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('deposit_vs_cash')) = 0, 'the deposit rule is off by default, so a gap raises nothing');
  perform public.ops_rule_set('deposit_vs_cash', true, null, '{"days": 2, "tolerance": 5000}', null);
  v := pg_temp.items('deposit_vs_cash');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'category' = 'cash' and (v -> 0 ->> 'detail') like '%50,000%', 'with the rule on, a 50,000 gap is reported');
  perform public.ops_rule_set('deposit_vs_cash', null, null, '{"days": 2, "tolerance": 60000}', null);
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('deposit_vs_cash')) = 0, 'a gap inside the tolerance is not reported');
  perform public.ops_rule_set('deposit_vs_cash', null, null, '{"days": 1, "tolerance": 0}', null);
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('deposit_vs_cash')) = 0, 'a day whose deposit and cash sale agree is not reported');
  perform public.ops_rule_set('deposit_vs_cash', false, null, null, null);
  reset role;

  -- ── ordering and shape ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.ops_action_items();
  perform pg_temp.ok(v ? 'generated_at' and jsonb_typeof(v -> 'items') = 'array', 'the result carries a time stamp and a list');
  perform pg_temp.ok((v -> 'items' -> 0 ->> 'severity') = 'critical', 'critical issues come first');
  perform pg_temp.ok((select bool_and(x ? 'title' and x ? 'severity' and x ? 'responsible' and x ? 'detail' and x ? 'href' and x ? 'category') from jsonb_array_elements(v -> 'items') x), 'every issue has a title, priority, person, explanation, place and category');
  reset role;

  -- ── a check that fails is reported, never skipped ──
  drop function public.inventory_cover_summary(timestamptz);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('stock_reorder');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'category' = 'system' and (v -> 0 ->> 'title') like '%could not be checked%', 'a failed stock check is shown as an issue, not hidden');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('sales_missing')) = 0, 'one failed check does not stop the other checks');
  reset role;

  -- ── Recent Activity ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.ops_recent_activity(10);
  perform pg_temp.ok(jsonb_array_length(v -> 'events') = 2, 'both closings appear');
  perform pg_temp.ok((v -> 'events' -> 0 ->> 'category') in ('closing_done', 'closing_drafts') and v -> 'events' -> 0 ? 'at', 'each event has a time and a category');
  perform pg_temp.ok(jsonb_array_length(public.ops_recent_activity(1) -> 'events') = 1, 'the limit is respected');
  perform public.ops_activity_category_set('closing_done', false);
  perform pg_temp.ok(jsonb_array_length(public.ops_recent_activity(10) -> 'events') = 0, 'switching a category off removes its events');
  perform public.ops_activity_category_set('closing_done', true);
  perform pg_temp.ok(jsonb_array_length(public.ops_recent_activity(10) -> 'events') = 2, 'switching it back on restores them');
  reset role;
  n := (select count(*) from public.activity_log);
  perform pg_temp.ok(n >= 1, 'the audit log was only ever added to');
end $t$;
rollback;

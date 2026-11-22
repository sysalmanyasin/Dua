-- 0701_ops_action_items: the Owner's Action Centre and Recent Activity (range 0700-0749).
-- ops_action_items() works out the issues LIVE from each module's own data and the rules in ops_rules. There is no dismiss
-- button and no stored alert state: an issue disappears only when the underlying condition is fixed in its own module.
-- Severity comes only from the rules (the Owner changes it there); AI never sets it. Modules stay the authority for their
-- figures: Closing, Inventory, Sales and Owner Notifications are asked through their own functions or views.
-- A check that cannot be completed is shown as an issue of its own, never silently skipped.

create or replace function public.ops_action_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  items jsonb := '[]'::jsonb;
  r public.ops_rules;
  d record; v jsonb; n integer; m integer; dep numeric; cash numeric; tol numeric; i integer; dt date; days_list text;
begin
  if not public.has_perm('ops.view') then return null; end if;

  -- Closing drafts left open
  select * into r from public.ops_rules where rule_key = 'closing_draft_open' and enabled;
  if found then
    begin
      for d in select * from public.closing_ops_open_drafts(coalesce((r.params ->> 'hours')::int, 12)) loop
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'closing', 'severity', r.severity,
          'title', 'Closing draft left open',
          'detail', format('%s %s closing was last saved %s hours ago and has not been submitted.',
                           to_char(d.business_date, 'DD Mon'), d.slot_kind, floor(extract(epoch from (now() - d.saved_at)) / 3600)::int),
          'responsible', coalesce(d.responsible, 'Not assigned'), 'deadline', null, 'href', '/closing', 'ref', d.closing_id::text);
      end loop;
    exception when others then
      items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'system', 'severity', 'warning',
        'title', 'Closing drafts could not be checked', 'detail', 'The check failed. Open Closing to look at open drafts.',
        'responsible', 'Owner', 'deadline', null, 'href', '/closing', 'ref', null);
    end;
  end if;

  -- Sales not entered for recent days (same window as the Home "days to review" list)
  select * into r from public.ops_rules where rule_key = 'sales_missing' and enabled;
  if found then
    n := coalesce((r.params ->> 'days')::int, 3);
    select count(*), string_agg(to_char(x::date, 'DD Mon'), ', ' order by x) into m, days_list
      from generate_series(today - n, today - 1, interval '1 day') x
     where not exists (select 1 from public.daily_sales s where s.business_date = x::date);
    if m > 0 then
      items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'sales',
        'severity', case when m >= coalesce((r.params ->> 'critical_days')::int, 3) then 'critical' else r.severity end,
        'title', 'Daily sales not entered', 'detail', format('No sales entered for: %s.', days_list),
        'responsible', 'Owner', 'deadline', null, 'href', '/sales', 'ref', null);
    end if;
  end if;

  -- Stock running low on cover (Inventory's own summary)
  select * into r from public.ops_rules where rule_key = 'stock_reorder' and enabled;
  if found then
    begin
      v := public.inventory_cover_summary();
      n := coalesce((v -> 'reorder' ->> 'count')::int, 0);
      if n >= coalesce((r.params ->> 'min_count')::int, 1) then
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'inventory', 'severity', r.severity,
          'title', 'Products are running low on cover',
          'detail', format('%s product%s under 30 days of cover. Open Inventory to reorder.', n, case when n = 1 then ' is' else 's are' end),
          'responsible', 'Owner', 'deadline', null, 'href', '/inventory', 'ref', null);
      end if;
    exception when others then
      items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'system', 'severity', 'warning',
        'title', 'Stock levels could not be checked', 'detail', 'The check failed. Open Inventory to look at stock.',
        'responsible', 'Owner', 'deadline', null, 'href', '/inventory', 'ref', null);
    end;
  end if;

  -- Owner alerts that failed or are stuck (Foundation notifications)
  select * into r from public.ops_rules where rule_key = 'notify_failures' and enabled;
  if found then
    begin
      v := public.notifications_attention();
      n := coalesce((v ->> 'failed')::int, 0) + coalesce((v ->> 'stuck')::int, 0);
      if n > 0 then
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'system', 'severity', r.severity,
          'title', 'Owner alerts are not being delivered',
          'detail', format('%s alert%s failed or %s waiting to send. Open Tools to review.', n, case when n = 1 then '' else 's' end, case when n = 1 then 'is' else 'are' end),
          'responsible', 'Owner', 'deadline', null, 'href', '/tools', 'ref', null);
      end if;
    exception when others then
      items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'system', 'severity', 'warning',
        'title', 'Owner alerts could not be checked', 'detail', 'The check failed. Open Tools.',
        'responsible', 'Owner', 'deadline', null, 'href', '/tools', 'ref', null);
    end;
  end if;

  -- Bank deposit against the day's cash sale (off by default; see 0700)
  select * into r from public.ops_rules where rule_key = 'deposit_vs_cash' and enabled;
  if found then
    tol := coalesce((r.params ->> 'tolerance')::numeric, 0);
    for i in 1 .. coalesce((r.params ->> 'days')::int, 1) loop
      dt := today - i;
      dep := public.closing_ops_deposits(dt);
      select f.cash into cash from public.v_daily_full f where f.business_date = dt;
      if dep is not null and cash is not null and abs(dep - cash) > tol then
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'cash', 'severity', r.severity,
          'title', 'Bank deposit does not match cash sale',
          'detail', format('%s: deposits recorded in Closing differ from the cash sale by Rs %s.', to_char(dt, 'DD Mon'), to_char(abs(dep - cash), 'FM999,999,999,990')),
          'responsible', 'Owner', 'deadline', null, 'href', '/closing', 'ref', dt::text);
      end if;
    end loop;
  end if;

  return jsonb_build_object('generated_at', now(), 'items', coalesce((
    select jsonb_agg(x order by case x ->> 'severity' when 'critical' then 0 when 'warning' then 1 else 2 end, x ->> 'title', x ->> 'ref')
      from jsonb_array_elements(items) x), '[]'::jsonb));
end $$;

-- The latest events from the categories the Owner has switched on. Reads Closing through its own feed function; it never
-- touches the audit log and cannot alter or delete anything there.
create or replace function public.ops_recent_activity(p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('ops.view') then return null; end if;
  return jsonb_build_object('generated_at', now(), 'events', coalesce((
    select jsonb_agg(e order by (e ->> 'at') desc, e ->> 'ref') from (
      select jsonb_build_object('at', f.at, 'category', cat.category_key,
               'title', case f.kind when 'submitted' then 'Closing submitted' else 'Closing draft saved' end,
               'detail', to_char(f.business_date, 'DD Mon') || ' · ' || initcap(f.slot_kind) || case when f.revision > 1 then ' · revision ' || f.revision else '' end
                         || coalesce(' · ' || f.responsible, ''),
               'href', '/closing', 'ref', f.closing_id::text) as e
        from public.closing_ops_feed(50) f
        join public.ops_activity_categories cat
          on cat.category_key = case f.kind when 'submitted' then 'closing_done' else 'closing_drafts' end and cat.enabled
       order by f.at desc, f.closing_id
       limit greatest(1, least(coalesce(p_limit, 10), 50))) s), '[]'::jsonb));
end $$;

revoke all on function public.ops_action_items(), public.ops_recent_activity(integer) from public, anon, authenticated;
grant execute on function public.ops_action_items(), public.ops_recent_activity(integer) to authenticated;

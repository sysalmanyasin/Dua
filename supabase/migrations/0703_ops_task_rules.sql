-- 0703_ops_task_rules: the Action Centre learns about Task Master (range 0700-0749, Stage 3b).
-- Two new rules, both on by default and editable by the Owner like the others:
--   task_overdue               warning  one issue per person with overdue tasks, and one for overdue tasks nobody holds
--   task_verification_waiting  info     tasks handed in and waiting for a verifier
-- Rules carry no settings, so a typo in a setting cannot switch them off (ops_params_ok refuses every setting for them).
-- ops_action_items() is replaced with the same body as 0701 plus the two task checks; its grants are unchanged. Task data is read
-- only through Task Master's own functions (task_team_overview, task_list_all), never its tables. A check that fails is shown
-- as an issue of its own ("Tasks could not be checked"), never skipped. The deposit rule stays OFF (D-60 and the owner's decision).

alter table public.ops_rules drop constraint ops_rules_category_check;
alter table public.ops_rules add constraint ops_rules_category_check check (category in ('closing', 'sales', 'inventory', 'cash', 'tasks', 'system'));

insert into public.ops_rules (rule_key, title, category, severity, enabled, params) values
  ('task_overdue', 'Tasks are overdue', 'tasks', 'warning', true, '{}'),
  ('task_verification_waiting', 'Tasks are waiting for verification', 'tasks', 'info', true, '{}')
on conflict (rule_key) do nothing;

create or replace function public.ops_action_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  items jsonb := '[]'::jsonb;
  r public.ops_rules;
  d record; v jsonb; n integer; m integer; dep numeric; cash numeric; tol numeric; i integer; dt date; days_list text;
  tv jsonb; trow jsonb;
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

  -- Task Master: overdue tasks. One issue per person with overdue work, plus one for overdue tasks that nobody holds.
  -- Task Master stays the authority: this asks its own team overview and list, and never reads its tables.
  select * into r from public.ops_rules where rule_key = 'task_overdue' and enabled;
  if found then
    begin
      tv := public.task_team_overview(7);
      if tv is null then raise exception 'tasks cannot be read'; end if;
      for trow in select x from jsonb_array_elements(tv -> 'staff') x where (x ->> 'overdue')::int > 0 loop
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'tasks', 'severity', r.severity,
          'title', 'Overdue tasks',
          'detail', format('%s has %s overdue task%s.', trow ->> 'name', trow ->> 'overdue', case when (trow ->> 'overdue')::int = 1 then '' else 's' end),
          'responsible', trow ->> 'name', 'deadline', null, 'href', '/tasks/manage', 'ref', trow ->> 'staff_id');
      end loop;
      select count(*) into n from jsonb_array_elements(coalesce(public.task_list_all('created', null, 500), '[]'::jsonb)) x where (x ->> 'overdue')::boolean;
      if n > 0 then
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'tasks', 'severity', r.severity,
          'title', 'Overdue tasks with no one assigned',
          'detail', format('%s task%s past the deadline and not given to anyone.', n, case when n = 1 then ' is' else 's are' end),
          'responsible', 'Owner', 'deadline', null, 'href', '/tasks/manage', 'ref', 'unassigned');
      end if;
    exception when others then
      items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'system', 'severity', 'warning',
        'title', 'Tasks could not be checked', 'detail', 'The check failed. Open Tasks to look at overdue work.',
        'responsible', 'Owner', 'deadline', null, 'href', '/tasks/manage', 'ref', null);
    end;
  end if;

  -- Task Master: work handed in and waiting for a verifier.
  select * into r from public.ops_rules where rule_key = 'task_verification_waiting' and enabled;
  if found then
    begin
      tv := public.task_team_overview(7);
      if tv is null then raise exception 'tasks cannot be read'; end if;
      select coalesce(sum((x ->> 'verification_pending')::int), 0) into n from jsonb_array_elements(tv -> 'staff') x;
      if n > 0 then
        items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'tasks', 'severity', r.severity,
          'title', 'Tasks waiting for verification',
          'detail', format('%s task%s waiting to be checked.', n, case when n = 1 then ' is' else 's are' end),
          'responsible', 'Owner or a named verifier', 'deadline', null, 'href', '/tasks/verify', 'ref', null);
      end if;
    exception when others then
      items := items || jsonb_build_object('rule_key', r.rule_key, 'category', 'system', 'severity', 'warning',
        'title', 'Tasks could not be checked', 'detail', 'The check failed. Open Tasks to look at work waiting for verification.',
        'responsible', 'Owner', 'deadline', null, 'href', '/tasks/verify', 'ref', null);
    end;
  end if;

  return jsonb_build_object('generated_at', now(), 'items', coalesce((
    select jsonb_agg(x order by case x ->> 'severity' when 'critical' then 0 when 'warning' then 1 else 2 end, x ->> 'title', x ->> 'ref')
      from jsonb_array_elements(items) x), '[]'::jsonb));
end $$;

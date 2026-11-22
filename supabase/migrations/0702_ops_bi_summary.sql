-- 0702_ops_bi_summary: Business Intelligence for the Owner's Home (range 0700-0749). Periods of 7, 30 or 90 complete days
-- ending yesterday (Pakistan time), compared with the period of the same length before it. Every figure comes from the
-- module that owns it: Sales (daily_sales as entered), Inventory (its own cover summary, a snapshot as of now, not a period
-- figure) and Closing (counts through its own function). Detailed financial analysis stays in the Sales and Reports modules.
create or replace function public.ops_bi_summary(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  t date; f date; pt date; pf date;
  cur record; prv record; cl record; series jsonb; inv jsonb := null; inv_failed boolean := false;
begin
  if not public.has_perm('ops.view') then return null; end if;
  if p_days is null or p_days not in (7, 30, 90) then raise exception 'period must be 7, 30 or 90 days' using errcode = '22023'; end if;
  t := today - 1; f := today - p_days; pt := f - 1; pf := f - p_days;

  select coalesce(sum(total), 0) as total, count(*)::int as days, coalesce(sum(customers), 0)::bigint as cust, count(customers)::int as cust_days
    into cur from public.daily_sales where business_date between f and t;
  select coalesce(sum(total), 0) as total, count(*)::int as days, coalesce(sum(customers), 0)::bigint as cust, count(customers)::int as cust_days
    into prv from public.daily_sales where business_date between pf and pt;
  select coalesce(jsonb_agg(jsonb_build_object('date', business_date, 'total', total) order by business_date), '[]'::jsonb)
    into series from public.daily_sales where business_date between f and t;

  begin
    inv := public.inventory_cover_summary();
  exception when others then
    inv := null; inv_failed := true;
  end;

  select * into cl from public.closing_ops_period(f, t);

  return jsonb_build_object(
    'generated_at', now(), 'days', p_days, 'from', f, 'to', t, 'previous_from', pf, 'previous_to', pt,
    'sales', jsonb_build_object('total', cur.total, 'recorded_days', cur.days,
      'avg_per_day', case when cur.days > 0 then round(cur.total / cur.days, 2) end,
      'previous_total', prv.total, 'previous_recorded_days', prv.days,
      'previous_avg_per_day', case when prv.days > 0 then round(prv.total / prv.days, 2) end,
      'series', series),
    'transactions', jsonb_build_object('total', cur.cust, 'counted_days', cur.cust_days,
      'avg_per_day', case when cur.cust_days > 0 then round(cur.cust::numeric / cur.cust_days, 1) end,
      'previous_total', prv.cust, 'previous_counted_days', prv.cust_days,
      'previous_avg_per_day', case when prv.cust_days > 0 then round(prv.cust::numeric / prv.cust_days, 1) end),
    'inventory', inv, 'inventory_failed', inv_failed,
    'operations', jsonb_build_object('days_in_period', p_days, 'days_with_sales', cur.days,
      'days_with_closing', coalesce(cl.days_with_closing, 0), 'closings_submitted', coalesce(cl.submitted, 0),
      'open_drafts', coalesce(cl.open_drafts, 0)));
end $$;
revoke all on function public.ops_bi_summary(integer) from public, anon, authenticated;
grant execute on function public.ops_bi_summary(integer) to authenticated;

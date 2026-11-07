-- 0007: monthly sales targets, per-person preferences, and the summary behind the Cover (home) page.

create table public.sales_targets (
  month date primary key check (month = date_trunc('month', month)::date),
  target numeric(14, 2) not null check (target > 0),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.user_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_.]{1,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.sales_targets enable row level security;
alter table public.user_prefs enable row level security;
create policy targets_read on public.sales_targets for select to authenticated using (public.has_perm('sales.view_history'));
create policy prefs_own_read on public.user_prefs for select to authenticated using (user_id = auth.uid());
grant select on public.sales_targets, public.user_prefs to authenticated;
grant all on public.sales_targets, public.user_prefs to service_role;

-- Set or clear (null) the target for one month.
create or replace function public.sales_set_target(p_month date, p_target numeric) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; old numeric;
begin
  if not public.has_perm('targets.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  select target into old from public.sales_targets where month = m;
  if p_target is null or p_target <= 0 then
    delete from public.sales_targets where month = m;
  else
    if p_target > 1000000000 then raise exception 'target out of range'; end if;
    insert into public.sales_targets (month, target, updated_by) values (m, p_target, auth.uid())
    on conflict (month) do update set target = excluded.target, updated_by = auth.uid(), updated_at = now();
  end if;
  perform public.log_activity('sales.target_set', 'sales_targets', m::text, to_jsonb(old), to_jsonb(p_target), null);
end $$;

-- A person's own settings (for example, which report rows to hide). Small, private, per person.
create or replace function public.prefs_set(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key is null or p_key !~ '^[a-z0-9_.]{1,60}$' then raise exception 'bad key'; end if;
  if length(coalesce(p_value::text, '')) > 20000 then raise exception 'value too large'; end if;
  if not exists (select 1 from public.profiles where user_id = auth.uid() and disabled_at is null) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.user_prefs (user_id, key, value) values (auth.uid(), p_key, p_value)
  on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
end $$;

-- Everything the Cover page shows, limited to what the caller may see.
create or replace function public.cover_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  mstart date := date_trunc('month', (now() at time zone 'Asia/Karachi'))::date;
  res jsonb := '{}'::jsonb; ld record; mtd numeric; mtd_days int; ly numeric; tgt numeric; missing jsonb; cl record;
begin
  if public.my_context() is null then return null; end if;

  if public.has_perm('sales.view_history') then
    select business_date, total, diff, customers, comp_sale into ld from public.daily_sales where business_date < today order by business_date desc limit 1;
    select coalesce(sum(total), 0), count(*) into mtd, mtd_days from public.daily_sales where business_date >= mstart and business_date <= today;
    select coalesce(sum(total), 0) into ly from public.daily_sales
      where business_date >= (mstart - interval '1 year')::date and business_date <= (today - interval '1 year')::date;
    select target into tgt from public.sales_targets where month = mstart;
    select coalesce(jsonb_agg(d::date order by d), '[]'::jsonb) into missing
      from generate_series(today - 3, today - 1, interval '1 day') d
      where not exists (select 1 from public.daily_sales s where s.business_date = d::date);
    res := res || jsonb_build_object('sales', jsonb_build_object(
      'last_day', case when ld.business_date is null then null else jsonb_build_object('date', ld.business_date, 'total', ld.total, 'diff', ld.diff, 'customers', ld.customers, 'has_comp', ld.comp_sale is not null) end,
      'mtd', jsonb_build_object('total', mtd, 'days', mtd_days, 'last_year_total', ly),
      'target', tgt, 'month', mstart, 'missing_days', missing));
  elsif public.has_perm('sales.view_last_day') then
    select business_date, total into ld from public.daily_sales where business_date < today order by business_date desc limit 1;
    res := res || jsonb_build_object('sales', jsonb_build_object('last_day', case when ld.business_date is null then null else jsonb_build_object('date', ld.business_date, 'total', ld.total) end));
  end if;

  if public.has_perm('checklist.view') or public.has_perm('checklist.fill') then
    select report_date, updated_at, version into cl from public.checklist_days where report_date = today;
    res := res || jsonb_build_object('checklist', jsonb_build_object('today_exists', cl.report_date is not null, 'updated_at', cl.updated_at));
  end if;
  return res;
end $$;

revoke all on function public.sales_set_target(date, numeric), public.prefs_set(text, jsonb), public.cover_summary() from public, anon, authenticated;
grant execute on function public.sales_set_target(date, numeric), public.prefs_set(text, jsonb), public.cover_summary() to authenticated;

-- 0220_closing_ops_period: Closing-owned read for the Operations Dashboard's "operational performance" figures (range 0200-0299).
-- Counts only; no amounts and no formula. Internal (callable from other database functions, not from the browser).
-- days_with_closing: business dates in [p_from, p_to] that have at least one submitted closing.
create or replace function public.closing_ops_period(p_from date, p_to date)
returns table (days_with_closing integer, submitted integer, open_drafts integer)
language sql stable security definer set search_path = public as $$
  select (count(distinct s.business_date) filter (where c.status = 'submitted'))::int,
         (count(*) filter (where c.status = 'submitted'))::int,
         (count(*) filter (where c.status = 'draft'))::int
    from public.closings c
    join public.closing_slots s on s.id = c.slot_id
   where c.status in ('draft', 'submitted') and s.business_date between p_from and p_to;
$$;
revoke all on function public.closing_ops_period(date, date) from public, anon, authenticated;

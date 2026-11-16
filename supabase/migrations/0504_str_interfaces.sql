-- 0504 (STR): interfaces published for Inventory (docs/MODULES.md 8). Both are read-only.
--
-- str_in_transit_lines(): what is on its way to Bahria Town. Lines of STRs that come IN, are Dispatched, are not Received
-- and not Closed, summed by product code in LOOSE units (STR-10). Inventory applies its own pack factor, so STR never needs
-- the product table. Only the live feed counts: an STR that has left Candela's export has no known status.
-- Allowed for `str.view` or `inventory.view` holders (the latter is Reorder's permission), checked inside.
--
-- str_cost_by_code(): the latest known cost per product code from STR lines (nonzero only), so Inventory can fill its own
-- cost data over time (STR-7). STR never writes into Inventory tables. Needs `inventory.view_cost`.
create or replace function public.str_in_transit_lines() returns table (code text, loose_qty numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('str.view') or public.has_perm('inventory.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select l.product_code, sum(l.dispatch_qty)::numeric
    from public.str_headers h
    join public.str_line_items l on l.str_id = h.str_id
    where h.direction = 'in'
      and public.str_stage(h.dispatch_status, h.receive_status) = 'dispatched'
      and lower(h.str_status) not like 'close%'
      and l.product_code <> '' and coalesce(l.dispatch_qty, 0) > 0
    group by l.product_code
    order by l.product_code;
end $$;

create or replace function public.str_cost_by_code(p_since date default null)
returns table (code text, cost_price numeric, str_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('inventory.view_cost') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select distinct on (x.product_code) x.product_code, x.cost_price, x.str_date
    from (
      select l.product_code, l.cost_price, h.str_date, h.str_id
      from public.str_headers h join public.str_line_items l on l.str_id = h.str_id
      union all
      select a.product_code, a.cost_price, ah.str_date, ah.str_id
      from public.str_archive_headers ah join public.str_archive_lines a on a.str_id = ah.str_id
      where not exists (select 1 from public.str_headers h where h.str_id = ah.str_id)
    ) x
    where x.product_code <> '' and x.cost_price > 0 and (p_since is null or x.str_date >= p_since)
    order by x.product_code, x.str_date desc nulls last, x.str_id desc;
end $$;

revoke all on function public.str_in_transit_lines(), public.str_cost_by_code(date) from public, anon, authenticated;
grant execute on function public.str_in_transit_lines(), public.str_cost_by_code(date) to authenticated;

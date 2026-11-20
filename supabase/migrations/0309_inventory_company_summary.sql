-- 0309_inventory_company_summary.sql — Inventory interface for the Audit company pickers.
--   inventory_company_summary()   every company once, with its product count (SKUs) and stock value at retail (qty × price)
-- inventory_companies() (0308) gives names only. The old Random app showed "10 SKUs · Rs 115,769" beside each company
-- when choosing what to audit; this gives the same numbers from the database, so a phone never loads the whole stock list.
-- Same permission rule as inventory_companies(). Read-only.
create or replace function public.inventory_company_summary()
returns table (company text, skus integer, value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('inventory.search') or public.has_perm('audit.manage') or public.has_perm('audit.compile')
          or public.has_perm('audit.individual')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select p.company, count(*)::integer, coalesce(sum(p.qty * p.price), 0)::numeric
    from public.inventory_products p
    group by p.company
    order by p.company;
end $$;

revoke all on function public.inventory_company_summary() from public, anon, authenticated;
grant execute on function public.inventory_company_summary() to authenticated;

-- 0505 (Inventory interface D1, requested by STR): inventory_product_meta(p_codes text[]).
-- Gives STR each product's supplier and pack size (conversion_factor = loose units per pack) so the Report, Zero Dispatch
-- and detail screens can group by supplier and show quantities in packs. Until this function exists STR shows loose
-- quantities under "Unassigned Supplier". Read only; changes no data.
--  * One row per distinct non-blank code asked for, in the order first asked. An unknown code comes back with
--    found = false and null supplier / factor (STR then uses "Unassigned Supplier" and factor 1).
--  * If a code has several rows in inventory_products, an active one wins, then the lowest id.
--  * A deactivated product is still answered (its supplier and pack size are still right for an old transfer);
--    an active product always takes priority.
--  * Allowed for holders of `inventory.search` or `str.view` (STR readers do not all hold inventory.search).
--  * At most 500 codes a call; more is refused, never silently cut.
create or replace function public.inventory_product_meta(p_codes text[])
returns table (code text, supplier text, conversion_factor numeric, found boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('inventory.search') or public.has_perm('str.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_codes, 1), 0) > 500 then
    raise exception 'at most 500 codes per call' using errcode = '22023';
  end if;
  return query
    select c.code, p.supplier, p.conversion_factor, (p.id is not null)
    from (
      select t.code, min(t.ord) as ord
      from (select nullif(btrim(x.c), '') as code, x.ord
            from unnest(coalesce(p_codes, array[]::text[])) with ordinality as x(c, ord)) t
      where t.code is not null
      group by t.code
    ) c
    left join lateral (
      select ip.id, ip.supplier, ip.conversion_factor from public.inventory_products ip
      where ip.code = c.code order by ip.active desc, ip.id limit 1
    ) p on true
    order by c.ord;
end $$;

revoke all on function public.inventory_product_meta(text[]) from public, anon, authenticated;
grant execute on function public.inventory_product_meta(text[]) to authenticated;

-- 0310_inventory_deactivated — deactivated products stay out of audits, and the Inventory tab can list them.
--  * inventory_products_for_scope: returns active products only. A product the stock feed no longer lists is flagged
--    active = false and keeps its last quantity (stale), so it must not be counted against that quantity in an audit.
--  * inventory_companies and inventory_company_summary: count active products only, so a company picker never offers a
--    company (or a product count) that an audit would then find empty.
--  * inventory_deactivated(p_limit, p_offset): the deactivated products, most recently deactivated first, for the new
--    Inventory > Deactivated screen. Needs inventory.view. Read only.
-- Rounds that already exist keep the items they were made with; nothing is changed or removed in them.
create or replace function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_type text; v_codes text[]; v_comps text[];
begin
  if not (public.has_perm('inventory.search') or public.has_perm('audit.manage') or public.has_perm('audit.compile')
          or public.has_perm('audit.individual')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_type := coalesce(p_scope ->> 'type', '');
  if v_type not in ('full', 'selected', 'single', 'template') then
    raise exception 'unknown scope' using errcode = '22023';
  end if;
  v_codes := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_scope -> 'codes', '[]'::jsonb)) x where btrim(x) <> ''), '{}');
  v_comps := coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p_scope -> 'companies', '[]'::jsonb)) x where btrim(x) <> ''), '{}');
  return query
    select p.code, p.name, p.company, p.qty, p.price
    from public.inventory_products p
    where p.active
      and case v_type
            when 'full' then true
            when 'template' then p.code = any (v_codes)
            else p.company = any (v_comps)
          end
    order by p.company, p.code, p.name;
end $$;

create or replace function public.inventory_companies()
returns table (company text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('inventory.search') or public.has_perm('audit.manage') or public.has_perm('audit.compile')
          or public.has_perm('audit.individual')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select distinct p.company from public.inventory_products p where p.active order by p.company;
end $$;

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
    where p.active
    group by p.company
    order by p.company;
end $$;

create function public.inventory_deactivated(p_limit integer default 1000, p_offset integer default 0)
returns table (code text, name text, company text, qty numeric, price numeric, deactivated_at timestamptz,
               last_sale_date date, last_receive_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('inventory.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select p.code, p.name, p.company, p.qty, p.price, p.deactivated_at, p.last_sale_date, p.last_receive_date
    from public.inventory_products p
    where not p.active
    order by p.deactivated_at desc nulls last, p.name, p.code
    limit greatest(1, least(coalesce(p_limit, 1000), 2000)) offset greatest(0, least(coalesce(p_offset, 0), 100000));
end $$;

revoke all on function public.inventory_deactivated(integer, integer) from public, anon, authenticated;
grant execute on function public.inventory_deactivated(integer, integer) to authenticated;

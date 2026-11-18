-- 0308_inventory_products_for_scope.sql — Inventory slice I4 (the interfaces Audit asked for).
--   inventory_products_for_scope(p_scope jsonb)  the current product list for an audit scope
--   inventory_companies()                        the distinct company names, for pickers
-- Audit calls the first one every time it creates a round, so each round starts from today's stock. Scope shapes:
--   {"type":"full"}                                       every product
--   {"type":"selected"|"single","companies":[...]}        the products of those companies
--   {"type":"template","codes":[...]}                     those product codes (also used for a typed code list)
-- A scope that names nothing returns nothing; it never falls back to "everything".
-- Allowed for people who hold inventory.search or one of the audit keys that start rounds. Read-only.
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
    where case v_type
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
  return query select distinct p.company from public.inventory_products p order by p.company;
end $$;

revoke all on function public.inventory_products_for_scope(jsonb), public.inventory_companies() from public, anon, authenticated;
grant execute on function public.inventory_products_for_scope(jsonb), public.inventory_companies() to authenticated;

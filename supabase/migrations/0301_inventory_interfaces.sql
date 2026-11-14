-- 0301_inventory_interfaces.sql — Inventory module, slice A2.
-- 1. New permission `inventory.view` (reports, ledgers and sales columns). No role template gets it;
--    the owner grants it by hand (decision INV-8). The owner (admin at MFA level 2) holds every key.
-- 2. The six read policies of 0009 are rewritten in the wrapped form `(select public.has_perm(...))`.
--    The bare form runs the check once per row (about 75 ms for 5,858 rows); the wrapped form runs it once
--    (about 2 ms). Same rules as before, only faster.
-- 3. Published interfaces (docs/MODULES.md §8.1) that other modules call:
--      inventory_balances(p_codes text[])                 current stock for up to 200 codes
--      inventory_search(p_text, p_limit, p_offset)        product lookup, at most 50 rows per call
--    `inventory_latest_sync()` from 0009 is left as it is.
-- Nothing here changes data, and nothing here is applied to the live project until the owner says so.

-- ───────── 1. permission ─────────
insert into public.permissions(key, description) values
 ('inventory.view', 'See inventory sales figures and run the inventory reports')
on conflict (key) do nothing;

-- ───────── 2. wrapped read policies (same rules as 0009) ─────────
drop policy if exists inv_products_read on public.inventory_products;
create policy inv_products_read on public.inventory_products for select to authenticated
  using ((select public.has_perm('inventory.search')));

drop policy if exists inv_sync_log_read on public.inventory_sync_log;
create policy inv_sync_log_read on public.inventory_sync_log for select to authenticated
  using ((select public.has_perm('inventory.sync')) or (status = 'ok' and (select public.has_perm('inventory.search'))));

drop policy if exists sales_pay_summary_read on public.sales_payment_summary;
create policy sales_pay_summary_read on public.sales_payment_summary for select to authenticated
  using ((select public.has_perm('sales.view_history')));

drop policy if exists sales_credit_cust_read on public.sales_credit_by_customer;
create policy sales_credit_cust_read on public.sales_credit_by_customer for select to authenticated
  using ((select public.has_perm('credit.view')));

drop policy if exists str_headers_read on public.str_headers;
create policy str_headers_read on public.str_headers for select to authenticated
  using ((select public.has_perm('str.approve')));

drop policy if exists str_lines_read on public.str_line_items;
create policy str_lines_read on public.str_line_items for select to authenticated
  using ((select public.has_perm('str.approve')));

-- ───────── 3a. inventory_balances ─────────
-- One row per distinct, non-blank code the caller asked for, in the order first asked.
-- An unknown code comes back with found = false and null name and qty (never as 0 stock).
-- More than 200 codes is refused: silently cutting the list would make a missing code look like "not found".
create or replace function public.inventory_balances(p_codes text[])
returns table (code text, name text, qty numeric, found boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('inventory.search') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(array_length(p_codes, 1), 0) > 200 then
    raise exception 'at most 200 codes per call' using errcode = '22023';
  end if;
  return query
    select c.code, p.name, p.qty, (p.id is not null)
    from (
      select t.code, min(t.ord) as ord
      from (select nullif(btrim(x.c), '') as code, x.ord
            from unnest(coalesce(p_codes, array[]::text[])) with ordinality as x(c, ord)) t
      where t.code is not null
      group by t.code
    ) c
    left join lateral (
      select ip.id, ip.name, ip.qty from public.inventory_products ip
      where ip.code = c.code order by ip.id limit 1
    ) p on true
    order by c.ord;
end $$;

-- ───────── 3b. inventory_search ─────────
-- Slim stock columns only (no sales columns: those need inventory.view and come with the delta feed).
-- Every word typed must appear somewhere in code, name, generic, company or supplier. Matching uses
-- position(), never LIKE, so a typed % or _ is an ordinary character.
-- Order: code equals the text, code starts with it, name starts with it, name contains it, anything else;
-- then name, then code. p_limit is clamped to 1..50 (default 20); p_offset to 0..10000.
create or replace function public.inventory_search(p_text text, p_limit integer default 20, p_offset integer default 0)
returns table (code text, name text, qty numeric, price numeric, company text, generic text, supplier text, conversion_factor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text; v_words text[]; v_limit int; v_offset int;
begin
  if not public.has_perm('inventory.search') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_q := lower(btrim(left(coalesce(p_text, ''), 100)));
  if v_q = '' then return; end if;
  v_words := (select coalesce(array_agg(w), array[]::text[]) from (select w from unnest(regexp_split_to_array(v_q, '\s+')) w where w <> '' limit 6) s);
  if array_length(v_words, 1) is null then return; end if;
  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset := greatest(0, least(coalesce(p_offset, 0), 10000));
  return query
    select p.code, p.name, p.qty, p.price, p.company, p.generic, p.supplier, p.conversion_factor
    from public.inventory_products p
    where not exists (
      select 1 from unnest(v_words) w
      where position(w in lower(p.code || ' ' || p.name || ' ' || p.generic || ' ' || p.company || ' ' || p.supplier)) = 0)
    order by
      case when lower(p.code) = v_q then 0
           when left(lower(p.code), length(v_q)) = v_q then 1
           when left(lower(p.name), length(v_q)) = v_q then 2
           when position(v_q in lower(p.name)) > 0 then 3
           else 4 end,
      p.name, p.code
    limit v_limit offset v_offset;
end $$;

revoke all on function public.inventory_balances(text[]), public.inventory_search(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.inventory_balances(text[]), public.inventory_search(text, integer, integer)
  to authenticated;

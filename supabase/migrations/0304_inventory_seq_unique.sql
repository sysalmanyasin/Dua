-- 0304_inventory_seq_unique.sql — Inventory module. Repairs a flaw in the 0302 backfill.
-- 0302 gave every product that already existed the same starting counter value (1). The feed pages by counter value
-- ("rows after N, oldest first"), so a phone installing on such a database would have received the first page of 1,000
-- rows (all at 1), been told "done", and missed the rest. New rows always got their own value; only the backfill was shared.
-- Fix: renumber every row 1..N (ordered by the old value, then code) in both groups, set the state counters to N, and
-- add partial unique indexes so two rows can never share a counter value again (value 0 means "never fed", exempt).
-- No phone holds a copy yet, so renumbering cannot invalidate anyone's position. inventory_renumber_seq() stays as a
-- service-role-only repair tool and is what the tests exercise.
create or replace function public.inventory_renumber_seq()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rows int; v_stock bigint; v_sales bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('inventory_apply_sync')::bigint) then
    return jsonb_build_object('ok', false, 'busy', true);
  end if;
  with n as (select id, row_number() over (order by seq_stock, code) as rn from public.inventory_products)
  update public.inventory_products p set seq_stock = n.rn from n where n.id = p.id;
  get diagnostics v_rows = row_count;
  with n as (select id, row_number() over (order by seq_sales, code) as rn from public.inventory_products)
  update public.inventory_products p set seq_sales = n.rn from n where n.id = p.id;
  select coalesce(max(seq_stock), 0), coalesce(max(seq_sales), 0) into v_stock, v_sales from public.inventory_products;
  update public.inventory_sync_state set seq_stock = v_stock, seq_sales = v_sales where id = 1;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'seqStock', v_stock, 'seqSales', v_sales);
end $$;
revoke all on function public.inventory_renumber_seq() from public, anon, authenticated;
grant execute on function public.inventory_renumber_seq() to service_role;

drop index if exists public.inventory_products_seq_stock_idx;
drop index if exists public.inventory_products_seq_sales_idx;

select public.inventory_renumber_seq();

create unique index inventory_products_seq_stock_uq on public.inventory_products (seq_stock) where seq_stock > 0;
create unique index inventory_products_seq_sales_uq on public.inventory_products (seq_sales) where seq_sales > 0;

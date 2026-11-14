-- 0305_inventory_pack_valid.sql — Inventory module, decision INV-18 (owner, 13 Nov 2026: keep the raw pack signal).
-- Until now a missing, zero or unusable pack size in the Candela file became 1, so the Stock Ledger could no longer tell
-- "really sold singly" from "pack size unknown" (2,725 of 5,308 in-stock products have pack 1). Now the Edge Function also
-- sends pack_valid (true when the file's value is a real number above zero). conversion_factor is unchanged: it still
-- holds a usable number (1 when the file's value was missing or zero), so every existing reader keeps working.
--  * pack_valid is a STOCK-group fact: it is part of the stock row hash and travels in the stock feed as the last column
--    ("packValid"). Direct column access is granted like the other stock columns.
--  * The stock hash function gains a 12th argument; the old 11-argument one is dropped so two definitions cannot drift.
--  * Existing rows get pack_valid = true and their hashes are recomputed with it, so nothing looks changed. A payload
--    that lacks the key (the Edge Function before this change) also means "valid"; the first sync from the new function
--    then updates only the products whose pack size really is unusable.
alter table public.inventory_products add column if not exists pack_valid boolean not null default true;
grant select (pack_valid) on public.inventory_products to authenticated;

drop function if exists public.inventory_hash_stock(text, text, numeric, numeric, text, text, text, numeric, date, date, date);
create or replace function public.inventory_hash_stock(p_code text, p_name text, p_qty numeric, p_price numeric, p_company text,
  p_generic text, p_supplier text, p_cf numeric, p_cd date, p_lrd date, p_lsd date, p_pack_valid boolean)
returns text language sql stable set search_path = public as $$
  select md5(concat_ws(chr(31), coalesce(p_code, ''), coalesce(p_name, ''), coalesce(trim_scale(p_qty)::text, ''),
    coalesce(trim_scale(p_price)::text, ''), coalesce(p_company, ''), coalesce(p_generic, ''), coalesce(p_supplier, ''),
    coalesce(trim_scale(p_cf)::text, ''), coalesce(to_char(p_cd, 'YYYY-MM-DD'), ''), coalesce(to_char(p_lrd, 'YYYY-MM-DD'), ''),
    coalesce(to_char(p_lsd, 'YYYY-MM-DD'), ''), case when p_pack_valid then 't' else 'f' end))
$$;
revoke all on function public.inventory_hash_stock(text, text, numeric, numeric, text, text, text, numeric, date, date, date, boolean)
  from public, anon, authenticated;

update public.inventory_products set
  row_hash_stock = public.inventory_hash_stock(code, name, qty, price, company, generic, supplier, conversion_factor, creation_date, last_receive_date, last_sale_date, pack_valid);

create or replace function public.inventory_apply_sync(p_payload jsonb, p_source text default 'dropbox', p_triggered_by uuid default null,
  p_force boolean default false, p_content_hash text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.inventory_sync_state%rowtype;
  v_in int; v_blank int; v_stage int; v_dup int;
  v_active int; v_remove int;
  v_base_stock bigint; v_base_sales bigint; v_n_stock int; v_n_sales int;
  v_added int; v_changed int; v_removed int; v_unchanged int;
  v_pay int; v_credit int; v_hdr int; v_lines int;
  v_result text; v_active_after int;
begin
  if not pg_try_advisory_xact_lock(hashtext('inventory_apply_sync')::bigint) then
    return jsonb_build_object('ok', false, 'busy', true);
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'products'), '') <> 'array' then
    raise exception 'products array is empty or missing' using errcode = '22023';
  elsif jsonb_array_length(p_payload -> 'products') = 0 then
    raise exception 'products array is empty or missing' using errcode = '22023';
  end if;
  v_in := jsonb_array_length(p_payload -> 'products');

  -- stage: cleaned, one row per code (the last one in the file wins), blank codes dropped, hashes computed
  drop table if exists pg_temp._inv_stage;
  create temp table _inv_stage on commit drop as
  select distinct on (a.code)
    a.code, a.name, a.qty, a.price, a.company, a.generic, a.supplier, a.cf, a.pv, a.cd, a.lrd, a.lsd,
    a.n0, a.n30, a.n60, a.n90, a.vi0, a.vi30, a.vi60, a.vi90, a.ve0, a.ve30, a.ve60, a.ve90, a.tax, a.taxable,
    public.inventory_hash_stock(a.code, a.name, a.qty, a.price, a.company, a.generic, a.supplier, a.cf, a.cd, a.lrd, a.lsd, a.pv) as hs,
    public.inventory_hash_sales(a.n0, a.n30, a.n60, a.n90, a.vi0, a.vi30, a.vi60, a.vi90, a.ve0, a.ve30, a.ve60, a.ve90, a.tax, a.taxable) as hv
  from (
    select btrim(x.code) as code, x.name,
      coalesce(x.qty, 0) as qty, coalesce(x.price, 0) as price,
      coalesce(x.company, 'Unassigned Manufacturer') as company, coalesce(x.generic, '') as generic,
      coalesce(x.supplier, 'Unassigned Supplier') as supplier, coalesce(nullif(x.conversion_factor, 0), 1) as cf,
      coalesce(x.pack_valid, true) as pv,
      x.creation_date as cd, x.last_receive_date as lrd, x.last_sale_date as lsd,
      coalesce(x.net_qty_today, 0) as n0, coalesce(x.net_qty_30_days, 0) as n30, coalesce(x.net_qty_60_days, 0) as n60, coalesce(x.net_qty_90_days, 0) as n90,
      coalesce(x.sale_value_incl_tax_today, 0) as vi0, coalesce(x.sale_value_incl_tax_30_days, 0) as vi30,
      coalesce(x.sale_value_incl_tax_60_days, 0) as vi60, coalesce(x.sale_value_incl_tax_90_days, 0) as vi90,
      coalesce(x.sale_value_excl_tax_today, 0) as ve0, coalesce(x.sale_value_excl_tax_30_days, 0) as ve30,
      coalesce(x.sale_value_excl_tax_60_days, 0) as ve60, coalesce(x.sale_value_excl_tax_90_days, 0) as ve90,
      coalesce(x.tax_percent, 0) as tax, coalesce(x.is_taxable, false) as taxable,
      row_number() over () as rn
    from jsonb_to_recordset(p_payload -> 'products') as x(
      code text, name text, qty numeric, price numeric, company text, generic text, supplier text, conversion_factor numeric, pack_valid boolean,
      creation_date date, last_receive_date date, last_sale_date date,
      net_qty_today numeric, net_qty_30_days numeric, net_qty_60_days numeric, net_qty_90_days numeric,
      sale_value_incl_tax_today numeric, sale_value_incl_tax_30_days numeric, sale_value_incl_tax_60_days numeric, sale_value_incl_tax_90_days numeric,
      sale_value_excl_tax_today numeric, sale_value_excl_tax_30_days numeric, sale_value_excl_tax_60_days numeric, sale_value_excl_tax_90_days numeric,
      tax_percent numeric, is_taxable boolean)
    where btrim(coalesce(x.code, '')) <> ''
  ) a
  order by a.code, a.rn desc;
  alter table pg_temp._inv_stage add primary key (code);

  select count(*) into v_stage from pg_temp._inv_stage;
  select count(*) into v_blank from jsonb_to_recordset(p_payload -> 'products') as x(code text) where btrim(coalesce(x.code, '')) = '';
  v_dup := v_in - v_blank - v_stage;
  if v_stage = 0 then raise exception 'no usable products in the payload' using errcode = '22023'; end if;
  if exists (select 1 from pg_temp._inv_stage where name is null or btrim(name) = '') then
    raise exception 'a product has no name' using errcode = '22023';
  end if;

  -- guard (INV-9)
  select count(*) into v_active from public.inventory_products where active;
  select count(*) into v_remove from public.inventory_products p
    where p.active and not exists (select 1 from pg_temp._inv_stage s where s.code = p.code);
  if not p_force and v_active > 0 and v_remove * 100 > v_active * 20 then
    insert into public.inventory_sync_log (synced_at, status, result, item_count, source, triggered_by, error)
    values (v_now, 'failed', 'refused', 0, p_source, p_triggered_by,
      format('Refused: this sync would remove %s of %s active products (more than 20%%). Nothing was changed.', v_remove, v_active));
    return jsonb_build_object('ok', false, 'refused', true, 'wouldRemove', v_remove, 'active', v_active);
  end if;

  insert into public.inventory_sync_state (id) values (1) on conflict (id) do nothing;
  select * into v_state from public.inventory_sync_state where id = 1 for update;
  v_base_stock := v_state.seq_stock; v_base_sales := v_state.seq_sales;

  -- which rows change in each group, numbered in code order (one counter value per row)
  drop table if exists pg_temp._inv_seq_stock;
  create temp table _inv_seq_stock on commit drop as
  select u.code, u.kind, row_number() over (order by u.code) as rn from (
    select s.code, 'new'::text as kind from pg_temp._inv_stage s
      where not exists (select 1 from public.inventory_products p where p.code = s.code)
    union all
    select s.code, 'upd' from pg_temp._inv_stage s join public.inventory_products p on p.code = s.code
      where not p.active or p.row_hash_stock is distinct from s.hs
    union all
    select p.code, 'gone' from public.inventory_products p
      where p.active and not exists (select 1 from pg_temp._inv_stage s where s.code = p.code)
  ) u;
  drop table if exists pg_temp._inv_seq_sales;
  create temp table _inv_seq_sales on commit drop as
  select u.code, u.kind, row_number() over (order by u.code) as rn from (
    select s.code, 'new'::text as kind from pg_temp._inv_stage s
      where not exists (select 1 from public.inventory_products p where p.code = s.code)
    union all
    select s.code, 'upd' from pg_temp._inv_stage s join public.inventory_products p on p.code = s.code
      where not p.active or p.row_hash_sales is distinct from s.hv
    union all
    select p.code, 'gone' from public.inventory_products p
      where p.active and not exists (select 1 from pg_temp._inv_stage s where s.code = p.code)
  ) u;
  select count(*) into v_n_stock from pg_temp._inv_seq_stock;
  select count(*) into v_n_sales from pg_temp._inv_seq_sales;

  -- new products
  insert into public.inventory_products (code, name, qty, price, company, generic, supplier, conversion_factor, pack_valid,
    creation_date, last_receive_date, last_sale_date,
    net_qty_today, net_qty_30_days, net_qty_60_days, net_qty_90_days,
    sale_value_incl_tax_today, sale_value_incl_tax_30_days, sale_value_incl_tax_60_days, sale_value_incl_tax_90_days,
    sale_value_excl_tax_today, sale_value_excl_tax_30_days, sale_value_excl_tax_60_days, sale_value_excl_tax_90_days,
    tax_percent, is_taxable, active, row_hash_stock, row_hash_sales, seq_stock, seq_sales)
  select s.code, s.name, s.qty, s.price, s.company, s.generic, s.supplier, s.cf, s.pv, s.cd, s.lrd, s.lsd,
    s.n0, s.n30, s.n60, s.n90, s.vi0, s.vi30, s.vi60, s.vi90, s.ve0, s.ve30, s.ve60, s.ve90, s.tax, s.taxable,
    true, s.hs, s.hv, v_base_stock + ss.rn, v_base_sales + sv.rn
  from pg_temp._inv_stage s
  join pg_temp._inv_seq_stock ss on ss.code = s.code and ss.kind = 'new'
  join pg_temp._inv_seq_sales sv on sv.code = s.code and sv.kind = 'new';

  -- changed stock group (also brings a returning product back)
  update public.inventory_products p set
    name = s.name, qty = s.qty, price = s.price, company = s.company, generic = s.generic, supplier = s.supplier,
    conversion_factor = s.cf, pack_valid = s.pv, creation_date = s.cd, last_receive_date = s.lrd, last_sale_date = s.lsd,
    active = true, deactivated_at = null, row_hash_stock = s.hs, seq_stock = v_base_stock + ss.rn
  from pg_temp._inv_stage s join pg_temp._inv_seq_stock ss on ss.code = s.code and ss.kind = 'upd'
  where p.code = s.code;

  -- changed sales group
  update public.inventory_products p set
    net_qty_today = s.n0, net_qty_30_days = s.n30, net_qty_60_days = s.n60, net_qty_90_days = s.n90,
    sale_value_incl_tax_today = s.vi0, sale_value_incl_tax_30_days = s.vi30, sale_value_incl_tax_60_days = s.vi60, sale_value_incl_tax_90_days = s.vi90,
    sale_value_excl_tax_today = s.ve0, sale_value_excl_tax_30_days = s.ve30, sale_value_excl_tax_60_days = s.ve60, sale_value_excl_tax_90_days = s.ve90,
    tax_percent = s.tax, is_taxable = s.taxable, row_hash_sales = s.hv, seq_sales = v_base_sales + sv.rn
  from pg_temp._inv_stage s join pg_temp._inv_seq_sales sv on sv.code = s.code and sv.kind = 'upd'
  where p.code = s.code;

  -- products no longer in the file: tombstones
  update public.inventory_products p set
    active = false, deactivated_at = v_now, seq_stock = v_base_stock + ss.rn, seq_sales = v_base_sales + sv.rn
  from pg_temp._inv_seq_stock ss, pg_temp._inv_seq_sales sv
  where ss.code = p.code and ss.kind = 'gone' and sv.code = p.code and sv.kind = 'gone';

  select count(*) into v_added from pg_temp._inv_seq_stock where kind = 'new';
  select count(*) into v_removed from pg_temp._inv_seq_stock where kind = 'gone';
  select count(*) into v_changed from (select code from pg_temp._inv_seq_stock where kind = 'upd'
                                       union select code from pg_temp._inv_seq_sales where kind = 'upd') c;
  v_unchanged := v_stage - v_added - v_changed;
  v_result := case when v_n_stock + v_n_sales = 0 then 'unchanged' else 'changed' end;
  select count(*) into v_active_after from public.inventory_products where active;

  update public.inventory_sync_state set
    seq_stock = seq_stock + v_n_stock, seq_sales = seq_sales + v_n_sales, active_count = v_active_after,
    content_hash = p_content_hash, last_checked_at = v_now,
    last_changed_at = case when v_n_stock + v_n_sales > 0 then v_now else last_changed_at end
  where id = 1;

  -- the small tables (last 4 / 7 days) are replaced as a whole, in this same transaction
  delete from public.sales_payment_summary where true;
  insert into public.sales_payment_summary (sale_day, cash_sale, card_sale, credit_sale, total_sale)
  select sale_day, coalesce(cash_sale, 0), coalesce(card_sale, 0), coalesce(credit_sale, 0), coalesce(total_sale, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'payment_summary', '[]'::jsonb))
    as x(sale_day date, cash_sale numeric, card_sale numeric, credit_sale numeric, total_sale numeric);
  get diagnostics v_pay = row_count;

  delete from public.sales_credit_by_customer where true;
  insert into public.sales_credit_by_customer (sale_day, customer_name, credit_amount, receipt_count)
  select sale_day, coalesce(customer_name, ''), coalesce(credit_amount, 0), coalesce(receipt_count, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'credit_by_customer', '[]'::jsonb))
    as x(sale_day date, customer_name text, credit_amount numeric, receipt_count integer);
  get diagnostics v_credit = row_count;

  delete from public.str_line_items where true;
  delete from public.str_headers where true;
  insert into public.str_headers (str_id, str_number, master_str_id, ref_no, media, str_status, str_date, issued_by,
    dispatched_date, dispatch_status, dispatched_by, receive_date, receive_status, received_by, comments,
    dispatch_shop_id, dispatch_branch, receive_shop_id, receive_branch, direction, driver_name, vehicle_number,
    consignment_no, no_of_boxes, weight_of_shipment)
  select str_id, coalesce(str_number, ''), coalesce(master_str_id, ''), coalesce(ref_no, ''), coalesce(media, ''),
    coalesce(str_status, ''), str_date, coalesce(issued_by, ''),
    dispatched_date, coalesce(dispatch_status, ''), coalesce(dispatched_by, ''), receive_date,
    coalesce(receive_status, ''), coalesce(received_by, ''), coalesce(comments, ''),
    dispatch_shop_id, coalesce(dispatch_branch, ''), receive_shop_id, coalesce(receive_branch, ''),
    coalesce(direction, ''), coalesce(driver_name, ''), coalesce(vehicle_number, ''),
    coalesce(consignment_no, ''), coalesce(no_of_boxes, ''), coalesce(weight_of_shipment, '')
  from jsonb_to_recordset(coalesce(p_payload -> 'str_headers', '[]'::jsonb)) as x(
    str_id bigint, str_number text, master_str_id text, ref_no text, media text, str_status text, str_date date, issued_by text,
    dispatched_date date, dispatch_status text, dispatched_by text, receive_date date, receive_status text, received_by text,
    comments text, dispatch_shop_id integer, dispatch_branch text, receive_shop_id integer, receive_branch text,
    direction text, driver_name text, vehicle_number text, consignment_no text, no_of_boxes text, weight_of_shipment text);
  get diagnostics v_hdr = row_count;

  insert into public.str_line_items (str_id, str_item_id, product_code, product_name, carton_no, str_qty,
    dispatch_qty, receive_qty, net_dispatch_qty, product_price, cost_price)
  select str_id, str_item_id, coalesce(product_code, ''), coalesce(product_name, ''), coalesce(carton_no, ''),
    coalesce(str_qty, 0), dispatch_qty, receive_qty, net_dispatch_qty, coalesce(product_price, 0), coalesce(cost_price, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'str_line_items', '[]'::jsonb)) as x(
    str_id bigint, str_item_id integer, product_code text, product_name text, carton_no text, str_qty numeric,
    dispatch_qty numeric, receive_qty numeric, net_dispatch_qty numeric, product_price numeric, cost_price numeric);
  get diagnostics v_lines = row_count;

  insert into public.inventory_sync_log (synced_at, status, result, item_count, source, triggered_by,
    added_count, changed_count, removed_count, unchanged_count, skipped_blank, duplicate_count)
  values (v_now, 'ok', v_result, v_active_after, p_source, p_triggered_by, v_added, v_changed, v_removed, v_unchanged, v_blank, v_dup);

  if v_state.last_pruned_at is null or v_state.last_pruned_at < v_now - interval '1 day' then
    perform public.inventory_prune();
  end if;

  return jsonb_build_object('ok', true, 'result', v_result, 'count', v_active_after,
    'added', v_added, 'changed', v_changed, 'removed', v_removed, 'unchanged', v_unchanged,
    'skippedBlank', v_blank, 'duplicates', v_dup,
    'seqStock', v_base_stock + v_n_stock, 'seqSales', v_base_sales + v_n_sales,
    'paymentSummaryCount', v_pay, 'creditByCustomerCount', v_credit, 'strHeaderCount', v_hdr, 'strLineItemCount', v_lines);
end $$;

create or replace function public.inventory_changes_stock(p_since bigint default 0, p_limit integer default 1000)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_since bigint; v_limit int; v_st public.inventory_sync_state%rowtype;
  v_rows jsonb; v_removed jsonb; v_cnt int; v_next bigint;
  c_cols constant jsonb := '["code","name","qty","price","company","generic","supplier","pack","created","received","sold","packValid"]'::jsonb;
begin
  if not public.has_perm('inventory.search') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_since := greatest(coalesce(p_since, 0), 0);
  v_limit := greatest(1, least(coalesce(p_limit, 1000), 1000));
  select * into v_st from public.inventory_sync_state where id = 1;
  if v_since > v_st.seq_stock or (v_since > 0 and v_since < v_st.purged_through_stock) then
    return jsonb_build_object('reset', true, 'cols', c_cols, 'rows', '[]'::jsonb, 'removed', '[]'::jsonb, 'next', 0,
                              'done', true, 'seq', v_st.seq_stock, 'activeCount', v_st.active_count);
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(g.code, g.name, g.qty, g.price, g.company, g.generic, g.supplier, g.conversion_factor,
                                              g.creation_date, g.last_receive_date, g.last_sale_date, g.pack_valid) order by g.seq_stock) filter (where g.active), '[]'::jsonb),
         coalesce(jsonb_agg(g.code order by g.seq_stock) filter (where not g.active), '[]'::jsonb),
         count(*), coalesce(max(g.seq_stock), v_since)
    into v_rows, v_removed, v_cnt, v_next
  from (select p.* from public.inventory_products p where p.seq_stock > v_since order by p.seq_stock limit v_limit) g;
  return jsonb_build_object('reset', false, 'cols', c_cols, 'rows', v_rows, 'removed', v_removed, 'next', v_next,
                            'done', v_cnt < v_limit, 'seq', v_st.seq_stock, 'activeCount', v_st.active_count);
end $$;

-- grants: create or replace keeps the existing ones (apply: service role only; changes_stock: signed-in users).

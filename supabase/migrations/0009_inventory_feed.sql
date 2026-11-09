-- 0009_inventory_feed.sql — Foundation task F3: the Candela → Dropbox → Edge Function feed.
-- Landing tables for what `sync-inventory-from-dropbox` pulls from Dropbox's inventory.json.
-- Latest-only (INV-1): each sync replaces the rows in ONE transaction, so readers never see a
-- half-finished sync and a failed sync leaves the old rows in place (inventory brief, rule I1).
-- Column set copied from the live table of the previous project (rule I2); no data is copied.
--
-- Landing tables only. STR and sales-summary screens belong to their own modules later.

-- ───────── permissions ─────────
insert into public.permissions(key, description) values
 ('inventory.sync', 'Trigger an inventory sync by hand and see sync errors')
on conflict (key) do nothing;

-- ───────── inventory_products (latest rows) ─────────
create table public.inventory_products (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null default '',
  name                        text not null,
  qty                         numeric not null default 0,
  price                       numeric not null default 0,   -- retail price (INV-5)
  company                     text not null default 'Unassigned Manufacturer',
  generic                     text not null default '',
  supplier                    text not null default 'Unassigned Supplier',
  conversion_factor           numeric not null default 1,
  creation_date               date,
  last_receive_date           date,
  last_sale_date              date,
  net_qty_today               numeric not null default 0,
  net_qty_30_days             numeric not null default 0,
  net_qty_60_days             numeric not null default 0,
  net_qty_90_days             numeric not null default 0,
  sale_value_incl_tax_today   numeric not null default 0,
  sale_value_incl_tax_30_days numeric not null default 0,
  sale_value_incl_tax_60_days numeric not null default 0,
  sale_value_incl_tax_90_days numeric not null default 0,
  sale_value_excl_tax_today   numeric not null default 0,
  sale_value_excl_tax_30_days numeric not null default 0,
  sale_value_excl_tax_60_days numeric not null default 0,
  sale_value_excl_tax_90_days numeric not null default 0,
  tax_percent                 numeric not null default 0,
  is_taxable                  boolean not null default false
);
create index inventory_products_code_idx on public.inventory_products (code);
create index inventory_products_company_idx on public.inventory_products (company);

-- ───────── inventory_sync_log (one row per sync attempt) ─────────
create table public.inventory_sync_log (
  id            uuid primary key default gen_random_uuid(),
  synced_at     timestamptz not null default now(),
  status        text not null default 'ok' check (status in ('ok', 'failed')),
  item_count    integer not null default 0,
  source        text not null default 'dropbox',
  triggered_by  uuid references auth.users(id),   -- null = scheduled / shared-secret call
  error         text
);
create index inventory_sync_log_at_idx on public.inventory_sync_log (synced_at desc);

-- ───────── Candela sales summaries (last 4 days) ─────────
create table public.sales_payment_summary (
  id          uuid primary key default gen_random_uuid(),
  sale_day    date not null unique,
  cash_sale   numeric not null default 0,
  card_sale   numeric not null default 0,
  credit_sale numeric not null default 0,
  total_sale  numeric not null default 0,
  synced_at   timestamptz not null default now()
);

create table public.sales_credit_by_customer (
  id            uuid primary key default gen_random_uuid(),
  sale_day      date not null,
  customer_name text not null default '',
  credit_amount numeric not null default 0,
  receipt_count integer not null default 0,
  synced_at     timestamptz not null default now()
);
create index sales_credit_by_customer_day_idx on public.sales_credit_by_customer (sale_day);

-- ───────── STR (stock transfer records, last 7 days) ─────────
create table public.str_headers (
  str_id             bigint primary key,
  str_number         text not null default '',
  master_str_id      text not null default '',
  ref_no             text not null default '',
  media              text not null default '',
  str_status         text not null default '',
  str_date           date,
  issued_by          text not null default '',
  dispatched_date    date,
  dispatch_status    text not null default '',
  dispatched_by      text not null default '',
  receive_date       date,
  receive_status     text not null default '',
  received_by        text not null default '',
  comments           text not null default '',
  dispatch_shop_id   integer,
  dispatch_branch    text not null default '',
  receive_shop_id    integer,
  receive_branch     text not null default '',
  direction          text not null default '' check (direction in ('in', 'out', '')),
  driver_name        text not null default '',
  vehicle_number     text not null default '',
  consignment_no     text not null default '',
  no_of_boxes        text not null default '',
  weight_of_shipment text not null default '',
  synced_at          timestamptz not null default now()
);
create index str_headers_date_idx on public.str_headers (str_date desc);

create table public.str_line_items (
  id               uuid primary key default gen_random_uuid(),
  str_id           bigint not null references public.str_headers(str_id) on delete cascade,
  str_item_id      integer not null,
  product_code     text not null default '',
  product_name     text not null default '',
  carton_no        text not null default '',
  str_qty          numeric not null default 0,
  dispatch_qty     numeric,
  receive_qty      numeric,
  net_dispatch_qty numeric,
  product_price    numeric not null default 0,
  cost_price       numeric not null default 0,
  synced_at        timestamptz not null default now()
);
create index str_line_items_str_idx on public.str_line_items (str_id);
create index str_line_items_code_idx on public.str_line_items (product_code);

-- ───────── RLS: on everywhere; anon has nothing; writes only via the service role ─────────
alter table public.inventory_products enable row level security;
alter table public.inventory_sync_log enable row level security;
alter table public.sales_payment_summary enable row level security;
alter table public.sales_credit_by_customer enable row level security;
alter table public.str_headers enable row level security;
alter table public.str_line_items enable row level security;

create policy inv_products_read on public.inventory_products for select to authenticated
  using (public.has_perm('inventory.search'));
-- Everyone who can search sees successful syncs (the "last synced" pill); only sync managers see failures.
create policy inv_sync_log_read on public.inventory_sync_log for select to authenticated
  using (public.has_perm('inventory.sync') or (status = 'ok' and public.has_perm('inventory.search')));
create policy sales_pay_summary_read on public.sales_payment_summary for select to authenticated
  using (public.has_perm('sales.view_history'));
create policy sales_credit_cust_read on public.sales_credit_by_customer for select to authenticated
  using (public.has_perm('credit.view'));
create policy str_headers_read on public.str_headers for select to authenticated
  using (public.has_perm('str.approve'));
create policy str_lines_read on public.str_line_items for select to authenticated
  using (public.has_perm('str.approve'));

revoke all on public.inventory_products, public.inventory_sync_log, public.sales_payment_summary,
  public.sales_credit_by_customer, public.str_headers, public.str_line_items from public, anon, authenticated;
grant select on public.inventory_products, public.inventory_sync_log, public.sales_payment_summary,
  public.sales_credit_by_customer, public.str_headers, public.str_line_items to authenticated;
grant all on public.inventory_products, public.inventory_sync_log, public.sales_payment_summary,
  public.sales_credit_by_customer, public.str_headers, public.str_line_items to service_role;

-- ───────── inventory_apply_sync: atomic replace (service role only) ─────────
-- Payload keys: products, payment_summary, credit_by_customer, str_headers, str_line_items (jsonb arrays).
-- Dates must already be real dates or null (the Edge Function cleans blanks). Any error rolls back
-- EVERYTHING, so the previous data stays; the Edge Function then calls inventory_log_sync_failure.
create or replace function public.inventory_apply_sync(p_payload jsonb, p_source text default 'dropbox', p_triggered_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_products int; v_pay int; v_credit int; v_hdr int; v_lines int;
begin
  if jsonb_typeof(p_payload -> 'products') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'products') = 0 then
    raise exception 'products array is empty or missing' using errcode = '22023';
  end if;

  delete from public.inventory_products where true;
  insert into public.inventory_products (code, name, qty, price, company, generic, supplier, conversion_factor,
    creation_date, last_receive_date, last_sale_date,
    net_qty_today, net_qty_30_days, net_qty_60_days, net_qty_90_days,
    sale_value_incl_tax_today, sale_value_incl_tax_30_days, sale_value_incl_tax_60_days, sale_value_incl_tax_90_days,
    sale_value_excl_tax_today, sale_value_excl_tax_30_days, sale_value_excl_tax_60_days, sale_value_excl_tax_90_days,
    tax_percent, is_taxable)
  select coalesce(code, ''), name, coalesce(qty, 0), coalesce(price, 0),
    coalesce(company, 'Unassigned Manufacturer'), coalesce(generic, ''), coalesce(supplier, 'Unassigned Supplier'),
    coalesce(nullif(conversion_factor, 0), 1),
    creation_date, last_receive_date, last_sale_date,
    coalesce(net_qty_today, 0), coalesce(net_qty_30_days, 0), coalesce(net_qty_60_days, 0), coalesce(net_qty_90_days, 0),
    coalesce(sale_value_incl_tax_today, 0), coalesce(sale_value_incl_tax_30_days, 0),
    coalesce(sale_value_incl_tax_60_days, 0), coalesce(sale_value_incl_tax_90_days, 0),
    coalesce(sale_value_excl_tax_today, 0), coalesce(sale_value_excl_tax_30_days, 0),
    coalesce(sale_value_excl_tax_60_days, 0), coalesce(sale_value_excl_tax_90_days, 0),
    coalesce(tax_percent, 0), coalesce(is_taxable, false)
  from jsonb_to_recordset(p_payload -> 'products') as x(
    code text, name text, qty numeric, price numeric, company text, generic text, supplier text, conversion_factor numeric,
    creation_date date, last_receive_date date, last_sale_date date,
    net_qty_today numeric, net_qty_30_days numeric, net_qty_60_days numeric, net_qty_90_days numeric,
    sale_value_incl_tax_today numeric, sale_value_incl_tax_30_days numeric, sale_value_incl_tax_60_days numeric, sale_value_incl_tax_90_days numeric,
    sale_value_excl_tax_today numeric, sale_value_excl_tax_30_days numeric, sale_value_excl_tax_60_days numeric, sale_value_excl_tax_90_days numeric,
    tax_percent numeric, is_taxable boolean);
  get diagnostics v_products = row_count;

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

  -- children before parents on the way out, parents before children on the way in
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

  insert into public.inventory_sync_log (status, item_count, source, triggered_by)
  values ('ok', v_products, p_source, p_triggered_by);

  return jsonb_build_object('count', v_products, 'paymentSummaryCount', v_pay, 'creditByCustomerCount', v_credit,
    'strHeaderCount', v_hdr, 'strLineItemCount', v_lines);
end $$;

-- Called by the Edge Function AFTER a rolled-back sync, so the failure is on record.
create or replace function public.inventory_log_sync_failure(p_error text, p_source text default 'dropbox', p_triggered_by uuid default null)
returns void
language sql security definer set search_path = public as $$
  insert into public.inventory_sync_log (status, item_count, source, triggered_by, error)
  values ('failed', 0, p_source, p_triggered_by, left(coalesce(p_error, 'unknown'), 500))
$$;

-- Interface (brief §7): when was the data last refreshed?
create or replace function public.inventory_latest_sync()
returns table (synced_at timestamptz, item_count integer, source text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('inventory.search') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select l.synced_at, l.item_count, l.source from public.inventory_sync_log l
    where l.status = 'ok' order by l.synced_at desc limit 1;
end $$;

revoke all on function public.inventory_apply_sync(jsonb, text, uuid), public.inventory_log_sync_failure(text, text, uuid),
  public.inventory_latest_sync() from public, anon, authenticated;
grant execute on function public.inventory_apply_sync(jsonb, text, uuid), public.inventory_log_sync_failure(text, text, uuid)
  to service_role;
grant execute on function public.inventory_latest_sync() to authenticated;

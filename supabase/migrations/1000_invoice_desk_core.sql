-- Invoice Desk core schema and owner-only transactional API.
-- Assigned range: 1000-1099. Money is numeric(14,2); invoice numbers are exact text.
insert into public.permissions (key, description) values
  ('invoice_desk.manage', 'Manage Invoice Desk invoices and product suggestions');

create table public.invoice_desk_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id text not null check (business_id in ('bs-mart','safari-book-land','best-choice-store')),
  invoice_number text not null check (length(invoice_number) between 1 and 120),
  invoice_date date not null,
  template_id text not null check (template_id in ('bs-mart-v1','safari-book-land-v1','best-choice-store-v1')),
  template_version integer not null check (template_version > 0),
  currency_code text not null default 'PKR' check (currency_code = 'PKR'),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  grand_total numeric(14,2) not null check (grand_total >= 0),
  amount_words text not null,
  printed_fields jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint invoice_desk_total_check check (grand_total = subtotal - discount)
);
alter table public.invoice_desk_invoices enable row level security;
create policy invoice_desk_invoices_read on public.invoice_desk_invoices
  for select to authenticated using (public.has_perm('invoice_desk.manage'));
grant select on public.invoice_desk_invoices to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.invoice_desk_invoices from anon, authenticated;

create table public.invoice_desk_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice_desk_invoices(id) on delete restrict,
  product_id uuid,
  description text not null check (length(trim(description)) between 1 and 500),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  constraint invoice_desk_line_math check (line_total = round(quantity * unit_price, 2))
);
alter table public.invoice_desk_lines enable row level security;
create policy invoice_desk_lines_read on public.invoice_desk_lines
  for select to authenticated using (
    public.has_perm('invoice_desk.manage')
    and exists (select 1 from public.invoice_desk_invoices i where i.id = invoice_id)
  );
grant select on public.invoice_desk_lines to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.invoice_desk_lines from anon, authenticated;
create index invoice_desk_lines_invoice_order_idx on public.invoice_desk_lines(invoice_id, display_order);

create table public.invoice_desk_products (
  id uuid primary key default gen_random_uuid(),
  business_id text not null check (business_id in ('bs-mart','safari-book-land','best-choice-store')),
  name text not null check (length(trim(name)) between 1 and 240),
  suggested_price numeric(14,2) not null check (suggested_price >= 0),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.invoice_desk_products enable row level security;
create policy invoice_desk_products_read on public.invoice_desk_products
  for select to authenticated using (public.has_perm('invoice_desk.manage'));
grant select on public.invoice_desk_products to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.invoice_desk_products from anon, authenticated;
create index invoice_desk_products_business_name_idx on public.invoice_desk_products(business_id, lower(name)) where active;

create table public.invoice_desk_idempotency (
  idempotency_key uuid primary key,
  invoice_id uuid not null references public.invoice_desk_invoices(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.invoice_desk_idempotency enable row level security;
revoke all on public.invoice_desk_idempotency from anon, authenticated;

create or replace function public.invoice_desk_save_invoice(p_invoice jsonb, p_lines jsonb, p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_business text;
  v_template text;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_total numeric(14,2);
  v_line jsonb;
  v_count integer := 0;
  v_order integer := 0;
  v_qty numeric(14,3);
  v_price numeric(14,2);
  v_line_total numeric(14,2);
begin
  if auth.uid() is null or not public.has_perm('invoice_desk.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select invoice_id into v_id from invoice_desk_idempotency where idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 200 then
    raise exception 'invoice must contain 1 to 200 lines' using errcode = '22023';
  end if;
  v_business := p_invoice->>'business_id';
  v_template := p_invoice->>'template_id';
  if (v_business, v_template) not in (
    ('bs-mart','bs-mart-v1'),
    ('safari-book-land','safari-book-land-v1'),
    ('best-choice-store','best-choice-store-v1')
  ) then raise exception 'business and template do not match' using errcode = '22023'; end if;
  if coalesce(length(p_invoice->>'invoice_number'),0) not between 1 and 120 then
    raise exception 'invoice number is required' using errcode = '22023';
  end if;
  if coalesce(p_invoice->>'amount_words','') = '' then raise exception 'amount in words is required' using errcode = '22023'; end if;
  v_subtotal := 0;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    if v_qty <= 0 or v_price < 0 or coalesce(length(trim(v_line->>'description')),0) not between 1 and 500 then
      raise exception 'invalid invoice line' using errcode = '22023';
    end if;
    v_line_total := round(v_qty * v_price, 2);
    v_subtotal := v_subtotal + v_line_total;
  end loop;
  v_subtotal := round(v_subtotal,2);
  v_discount := coalesce((p_invoice->>'discount')::numeric,0);
  if v_discount < 0 or v_discount > v_subtotal then raise exception 'invalid discount' using errcode = '22023'; end if;
  if v_business <> 'best-choice-store' and v_discount <> 0 then
    raise exception 'discount is not supported by this template' using errcode = '22023';
  end if;
  v_total := v_subtotal - v_discount;
  insert into invoice_desk_invoices(
    business_id, invoice_number, invoice_date, template_id, template_version,
    subtotal, discount, grand_total, amount_words, printed_fields, created_by
  ) values (
    v_business, p_invoice->>'invoice_number', (p_invoice->>'invoice_date')::date,
    v_template, coalesce((p_invoice->>'template_version')::integer,1),
    v_subtotal, v_discount, v_total, p_invoice->>'amount_words',
    coalesce(p_invoice->'printed_fields','{}'::jsonb), auth.uid()
  ) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_order := v_order + 1;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_line_total := round(v_qty * v_price,2);
    insert into invoice_desk_lines(invoice_id, product_id, description, quantity, unit_price, line_total, display_order)
    values (v_id, nullif(v_line->>'product_id','')::uuid, trim(v_line->>'description'), v_qty, v_price, v_line_total, v_order);
  end loop;
  insert into invoice_desk_idempotency(idempotency_key, invoice_id, created_by)
    values (p_key, v_id, auth.uid());
  perform public.log_activity('invoice_desk.invoice_created','invoice_desk_invoices',v_id::text,null,
    jsonb_build_object('business_id',v_business,'invoice_number',p_invoice->>'invoice_number'),null);
  return v_id;
end $$;
revoke all on function public.invoice_desk_save_invoice(jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.invoice_desk_save_invoice(jsonb,jsonb,uuid) to authenticated;

create or replace function public.invoice_desk_product_save(p_product jsonb, p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.has_perm('invoice_desk.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select (p_product->>'id')::uuid into v_id;
  if v_id is null then
    insert into invoice_desk_products(business_id,name,suggested_price,active,created_by)
    values (p_product->>'business_id',trim(p_product->>'name'),(p_product->>'suggested_price')::numeric,
      coalesce((p_product->>'active')::boolean,true),auth.uid()) returning id into v_id;
  else
    update invoice_desk_products set name=trim(p_product->>'name'),
      suggested_price=(p_product->>'suggested_price')::numeric,
      active=coalesce((p_product->>'active')::boolean,true), updated_at=now()
    where id=v_id and business_id=p_product->>'business_id';
    if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  end if;
  perform public.log_activity('invoice_desk.product_saved','invoice_desk_products',v_id::text,null,
    jsonb_build_object('business_id',p_product->>'business_id'),null);
  return v_id;
end $$;
revoke all on function public.invoice_desk_product_save(jsonb,uuid) from public, anon, authenticated;
grant execute on function public.invoice_desk_product_save(jsonb,uuid) to authenticated;

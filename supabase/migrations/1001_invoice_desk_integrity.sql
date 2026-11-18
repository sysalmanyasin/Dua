-- Invoice Desk integrity: product idempotency, product references, and authoritative amount words.
alter table public.invoice_desk_lines
  add constraint invoice_desk_lines_product_fk
  foreign key (product_id) references public.invoice_desk_products(id) on delete set null;

create table public.invoice_desk_product_idempotency (
  idempotency_key uuid primary key,
  product_id uuid not null references public.invoice_desk_products(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.invoice_desk_product_idempotency enable row level security;
revoke all on public.invoice_desk_product_idempotency from anon, authenticated;

create or replace function public.invoice_desk_under_thousand(p_n integer)
returns text language plpgsql immutable strict set search_path = public as $$
declare
  v_ones text[] := array['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  v_tens text[] := array['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  v_n integer := p_n;
  v_result text := '';
begin
  if v_n < 0 or v_n > 999 then raise exception 'number out of range'; end if;
  if v_n >= 100 then
    v_result := v_ones[(v_n / 100) + 1] || ' Hundred';
    v_n := v_n % 100;
  end if;
  if v_n >= 20 then
    v_result := concat_ws(' ', nullif(v_result,''), v_tens[(v_n / 10) + 1]);
    v_n := v_n % 10;
    if v_n > 0 then v_result := v_result || ' ' || v_ones[v_n + 1]; end if;
  elsif v_n > 0 then
    v_result := concat_ws(' ', nullif(v_result,''), v_ones[v_n + 1]);
  elsif v_result = '' then
    v_result := 'Zero';
  end if;
  return v_result;
end $$;

create or replace function public.invoice_desk_amount_words(p_amount numeric)
returns text language plpgsql immutable strict set search_path = public as $$
declare
  v_paisa bigint;
  v_rupees bigint;
  v_cents integer;
  v_crore integer;
  v_lakh integer;
  v_thousand integer;
  v_remainder integer;
  v_result text := '';
begin
  if p_amount < 0 or p_amount > 999999999.99 then
    raise exception 'amount out of range' using errcode = '22023';
  end if;
  v_paisa := round(p_amount * 100)::bigint;
  v_rupees := v_paisa / 100;
  v_cents := (v_paisa % 100)::integer;
  if v_rupees = 0 and v_cents = 0 then return 'Zero Pakistani Rupees Only'; end if;
  v_crore := (v_rupees / 10000000)::integer;
  v_lakh := (v_rupees / 100000 % 100)::integer;
  v_thousand := (v_rupees / 1000 % 100)::integer;
  v_remainder := (v_rupees % 1000)::integer;
  if v_crore > 0 then v_result := public.invoice_desk_under_thousand(v_crore) || ' Crore'; end if;
  if v_lakh > 0 then v_result := concat_ws(' ', nullif(v_result,''), public.invoice_desk_under_thousand(v_lakh) || ' Lakh'); end if;
  if v_thousand > 0 then v_result := concat_ws(' ', nullif(v_result,''), public.invoice_desk_under_thousand(v_thousand) || ' Thousand'); end if;
  if v_remainder > 0 then v_result := concat_ws(' ', nullif(v_result,''), public.invoice_desk_under_thousand(v_remainder)); end if;
  v_result := v_result || ' Pakistani Rupees';
  if v_cents > 0 then v_result := v_result || ' And ' || public.invoice_desk_under_thousand(v_cents) || ' Paisa'; end if;
  return v_result || ' Only';
end $$;

create or replace function public.invoice_desk_validate_amount_words()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.amount_words <> public.invoice_desk_amount_words(new.grand_total) then
    raise exception 'amount in words does not match invoice total' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger invoice_desk_amount_words_guard
before insert or update of grand_total, amount_words on public.invoice_desk_invoices
for each row execute function public.invoice_desk_validate_amount_words();

create or replace function public.invoice_desk_product_save(p_product jsonb, p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_existing uuid;
begin
  if auth.uid() is null or not public.has_perm('invoice_desk.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select product_id into v_existing from public.invoice_desk_product_idempotency
    where idempotency_key = p_key;
  if v_existing is not null then return v_existing; end if;
  v_id := nullif(p_product->>'id','')::uuid;
  if v_id is null then
    insert into public.invoice_desk_products(business_id,name,suggested_price,active,created_by)
    values (p_product->>'business_id',trim(p_product->>'name'),(p_product->>'suggested_price')::numeric,
      coalesce((p_product->>'active')::boolean,true),auth.uid()) returning id into v_id;
  else
    update public.invoice_desk_products set name=trim(p_product->>'name'),
      suggested_price=(p_product->>'suggested_price')::numeric,
      active=coalesce((p_product->>'active')::boolean,true), updated_at=now()
    where id=v_id and business_id=p_product->>'business_id';
    if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.invoice_desk_product_idempotency(idempotency_key,product_id,created_by)
    values (p_key,v_id,auth.uid());
  perform public.log_activity('invoice_desk.product_saved','invoice_desk_products',v_id::text,null,
    jsonb_build_object('business_id',p_product->>'business_id'),null);
  return v_id;
end $$;
revoke all on function public.invoice_desk_product_save(jsonb,uuid) from public, anon, authenticated;
grant execute on function public.invoice_desk_product_save(jsonb,uuid) to authenticated;

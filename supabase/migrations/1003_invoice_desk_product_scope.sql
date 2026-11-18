-- Enforce that a selected product suggestion belongs to the invoice's business.
create or replace function public.invoice_desk_validate_line_product()
returns trigger language plpgsql set search_path = public as $$
declare v_invoice_business text; v_product_business text;
begin
  if new.product_id is null then return new; end if;
  select business_id into v_invoice_business from public.invoice_desk_invoices where id = new.invoice_id;
  select business_id into v_product_business from public.invoice_desk_products where id = new.product_id;
  if v_invoice_business is null or v_product_business is null or v_invoice_business <> v_product_business then
    raise exception 'product suggestion belongs to a different business' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger invoice_desk_line_product_guard
before insert or update of invoice_id, product_id on public.invoice_desk_lines
for each row execute function public.invoice_desk_validate_line_product();

begin;
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000000123';
  v_product uuid;
  v_invoice uuid;
  v_rejected boolean := false;
begin
  insert into auth.users(id,email) values (v_user,'invoice-desk-test@example.invalid')
    on conflict (id) do nothing;
  insert into public.invoice_desk_products(business_id,name,suggested_price,created_by)
    values ('bs-mart','Test product',10,v_user) returning id into v_product;
  insert into public.invoice_desk_invoices(
    business_id,invoice_number,invoice_date,template_id,template_version,
    subtotal,discount,grand_total,amount_words,created_by
  ) values (
    'safari-book-land','TEST-1',date '2026-11-17','safari-book-land-v1',1,
    10,0,10,public.invoice_desk_amount_words(10),v_user
  ) returning id into v_invoice;

  begin
    insert into public.invoice_desk_lines(invoice_id,product_id,description,quantity,unit_price,line_total,display_order)
      values(v_invoice,v_product,'Test product',1,10,10,1);
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'cross-business product reference was not rejected'; end if;
end $$;
rollback;

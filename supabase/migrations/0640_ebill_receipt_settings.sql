-- 0640_ebill_receipt_settings.sql — receipt look and print defaults, and the right to export.
-- Receipt settings live in the shared settings table (versioned, audited) as one JSON object under 'ebill.receipt'. Anyone who bills may READ
-- them (to print); only managers may CHANGE them. Validation is here, not only on the screen. The logo is a small image kept inside the
-- setting (a data: URL, 150 KB at most), so it needs no storage bucket and works offline once downloaded.

insert into public.permissions (key, description) values
 ('ebill.export', 'Export Emergency Billing reports (CSV, Excel, PDF)');

insert into public.settings(key, value, staff_visible) values
 ('ebill.receipt', jsonb_build_object(
    'shop_name', '', 'address', '', 'phone', '', 'logo', '', 'width_mm', 80, 'footer', 'Thank you for your visit',
    'copies', 1, 'receipt_type', 'Primary Receipt', 'auto_print', false, 'show_customer', true, 'show_staff', true, 'show_generic', false), false);

create or replace function public.ebill_receipt_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('shop_name', '', 'address', '', 'phone', '', 'logo', '', 'width_mm', 80, 'footer', 'Thank you for your visit',
    'copies', 1, 'receipt_type', 'Primary Receipt', 'auto_print', false, 'show_customer', true, 'show_staff', true, 'show_generic', false)
$$;

create or replace function public.ebill_get_receipt() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('ebill.use') or public.has_perm('ebill.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return public.ebill_receipt_defaults() || coalesce((select value from public.settings where key = 'ebill.receipt'), '{}'::jsonb);
end $$;

create or replace function public.ebill_set_receipt(p_value jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_row public.settings; v jsonb; k text; new_version int; v_logo text;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then raise exception 'invalid settings' using errcode = '22023'; end if;
  select * into old_row from public.settings where key = 'ebill.receipt' for update;
  -- a partial update changes only what it names: defaults, then what is stored now, then the new values
  v := public.ebill_receipt_defaults() || coalesce(old_row.value, '{}'::jsonb) || p_value;
  for k in select jsonb_object_keys(v) loop
    if not (public.ebill_receipt_defaults() ? k) then raise exception 'unknown receipt setting %', k using errcode = '22023'; end if;
  end loop;
  if jsonb_typeof(v -> 'width_mm') <> 'number' or (v ->> 'width_mm')::numeric not in (58, 80) then raise exception 'receipt width must be 58 or 80 mm' using errcode = '22023'; end if;
  if jsonb_typeof(v -> 'copies') <> 'number' or (v ->> 'copies')::numeric not between 1 and 5 or (v ->> 'copies')::numeric <> trunc((v ->> 'copies')::numeric) then raise exception 'copies must be 1 to 5' using errcode = '22023'; end if;
  if (v ->> 'receipt_type') not in ('Primary Receipt', 'Gift Receipt', 'Summary Receipt', 'Secondary Receipt') then raise exception 'unknown receipt type' using errcode = '22023'; end if;
  if jsonb_typeof(v -> 'auto_print') <> 'boolean' or jsonb_typeof(v -> 'show_customer') <> 'boolean' or jsonb_typeof(v -> 'show_staff') <> 'boolean' or jsonb_typeof(v -> 'show_generic') <> 'boolean' then
    raise exception 'on/off settings must be true or false' using errcode = '22023';
  end if;
  foreach k in array array['shop_name', 'address', 'phone', 'footer', 'logo'] loop
    if jsonb_typeof(v -> k) <> 'string' then raise exception '% must be text', k using errcode = '22023'; end if;
  end loop;
  v := v || jsonb_build_object('shop_name', btrim(v ->> 'shop_name'), 'address', btrim(v ->> 'address'), 'phone', btrim(v ->> 'phone'), 'footer', btrim(v ->> 'footer'));
  if length(v ->> 'shop_name') > 80 or length(v ->> 'address') > 200 or length(v ->> 'phone') > 40 or length(v ->> 'footer') > 200 then raise exception 'a receipt text is too long' using errcode = '22023'; end if;
  v_logo := v ->> 'logo';
  if v_logo <> '' and (v_logo !~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' or length(v_logo) > 150000) then
    raise exception 'the logo must be a PNG, JPEG, WebP or GIF image under about 100 KB' using errcode = '22023';
  end if;
  new_version := old_row.version + 1;
  update public.settings set value = v, version = new_version, updated_at = now(), updated_by = auth.uid() where key = 'ebill.receipt';
  insert into public.settings_history(key, version, value, reason, changed_by) values ('ebill.receipt', new_version, v, btrim(p_reason), auth.uid());
  -- the audit log gets the setting without the (large) logo
  perform public.log_activity('ebill.receipt_set', 'settings', 'ebill.receipt', old_row.value - 'logo', v - 'logo', btrim(p_reason));
  return v;
end $$;

-- One query behind both the History list and the reports, so they can never disagree about status, refunds or who may see what.
create or replace function public.ebill_rows(p_from date, p_to date, p_text text, p_status text, p_mode text)
returns table (invoice_id uuid, invoice_no text, business_date date, created_at timestamptz, client_created_at timestamptz, staff_name text, device_id uuid,
  device_label text, pin_check text, customer text, payment_mode text, gross_total numeric, discounts numeric, net_total numeric, items bigint,
  refunded_amount numeric, status text)
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean := public.has_perm('ebill.history_all') or public.has_perm('ebill.manage'); v_uid uuid := auth.uid(); v_q text := lower(btrim(coalesce(p_text, '')));
begin
  return query
  with base as (
    select i.invoice_id, i.invoice_no, i.business_date, i.created_at, i.client_created_at, i.staff_name, i.device_id, d.label as device_label, i.pin_check,
           public.ebill_effective(i.invoice_id, 'customer') as customer,
           public.ebill_effective(i.invoice_id, 'payment_mode') as payment_mode,
           i.gross_total, round(i.line_discounts + i.customer_discount + i.receipt_discount, 2) as discounts, i.net_total,
           (select count(*) from public.ebill_invoice_lines l where l.invoice_id = i.invoice_id) as items,
           coalesce((select sum(e.amount) from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'refund'), 0) as refunded_amount,
           exists (select 1 from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'refund') as has_refund,
           exists (select 1 from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'correction') as has_correction
      from public.ebill_invoices i left join public.ebill_devices d on d.device_id = i.device_id
     where (v_all or i.staff_user = v_uid)
       and (p_from is null or i.business_date >= p_from) and (p_to is null or i.business_date <= p_to)
  ), st as (
    select b.*, case when b.has_refund and public.ebill_remaining_qty(b.invoice_id) = 0 then 'refunded'
                     when b.has_refund then 'partially_refunded'
                     when b.has_correction then 'corrected' else 'posted' end as status
      from base b
  )
  select s.invoice_id, s.invoice_no, s.business_date, s.created_at, s.client_created_at, s.staff_name, s.device_id, s.device_label, s.pin_check, s.customer,
         s.payment_mode, s.gross_total, s.discounts, s.net_total, s.items, s.refunded_amount, s.status
    from st s
   where (p_status is null or p_status = '' or s.status = p_status)
     and (p_mode is null or p_mode = '' or s.payment_mode = p_mode)
     and (v_q = '' or position(v_q in lower(s.invoice_no || ' ' || s.customer || ' ' || s.staff_name)) > 0);
end $$;

-- History now reads from ebill_rows.
create or replace function public.ebill_history(p_from date default null, p_to date default null, p_text text default null,
  p_status text default null, p_mode text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_rows jsonb; v_total int; v_sum numeric; v_refunded numeric;
begin
  if not (public.has_perm('ebill.use') or public.has_perm('ebill.history_all') or public.has_perm('ebill.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select count(*), coalesce(sum(r.net_total - r.refunded_amount), 0), coalesce(sum(r.refunded_amount), 0) into v_total, v_sum, v_refunded
    from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode) r;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.client_created_at desc, x.invoice_no desc), '[]'::jsonb) into v_rows
    from (select * from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode) order by client_created_at desc, invoice_no desc
           limit v_lim offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'sum_net', v_sum, 'sum_refunded', v_refunded);
end $$;

revoke all on function public.ebill_receipt_defaults(), public.ebill_rows(date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.ebill_get_receipt(), public.ebill_set_receipt(jsonb, text), public.ebill_history(date, date, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.ebill_get_receipt(), public.ebill_set_receipt(jsonb, text), public.ebill_history(date, date, text, text, text, int, int) to authenticated;

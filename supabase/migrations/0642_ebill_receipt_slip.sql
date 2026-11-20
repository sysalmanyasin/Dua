-- 0642: the receipt matches the shop's printed slip.
-- The shop's own slip carries a tax number (STN/NTN), a POS number, a title ("Purchase Slip") and a long terms footer.
-- Adds those three text settings and lets the footer run to 400 characters (the shop's terms are about 200). Additive:
-- existing values are kept, and a device that has not seen them yet falls back to the defaults below.

create or replace function public.ebill_receipt_defaults() returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('shop_name', '', 'address', '', 'phone', '', 'logo', '', 'width_mm', 80, 'footer', 'Thank you for your visit',
    'copies', 1, 'receipt_type', 'Primary Receipt', 'auto_print', false, 'show_customer', true, 'show_staff', true, 'show_generic', false,
    'tax_no', '', 'pos_no', '', 'slip_title', 'Purchase Slip')
$$;

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
  foreach k in array array['shop_name', 'address', 'phone', 'footer', 'logo', 'tax_no', 'pos_no', 'slip_title'] loop
    if jsonb_typeof(v -> k) <> 'string' then raise exception '% must be text', k using errcode = '22023'; end if;
  end loop;
  v := v || jsonb_build_object('shop_name', btrim(v ->> 'shop_name'), 'address', btrim(v ->> 'address'), 'phone', btrim(v ->> 'phone'), 'footer', btrim(v ->> 'footer'),
    'tax_no', btrim(v ->> 'tax_no'), 'pos_no', btrim(v ->> 'pos_no'), 'slip_title', btrim(v ->> 'slip_title'));
  if length(v ->> 'shop_name') > 80 or length(v ->> 'address') > 200 or length(v ->> 'phone') > 40 or length(v ->> 'footer') > 400
     or length(v ->> 'tax_no') > 40 or length(v ->> 'pos_no') > 40 or length(v ->> 'slip_title') > 40 then raise exception 'a receipt text is too long' using errcode = '22023'; end if;
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

revoke all on function public.ebill_receipt_defaults() from public, anon, authenticated;
revoke all on function public.ebill_set_receipt(jsonb, text) from public, anon, authenticated;
grant execute on function public.ebill_set_receipt(jsonb, text) to authenticated;

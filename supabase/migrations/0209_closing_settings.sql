-- 0209_closing_settings: Session D3. Narrow, logged write functions for the Closing settings screen. The catalog tables have no write
-- access of their own, so every change goes through one of these and needs closing.settings (admin). Nothing here changes how a
-- closing is calculated: a closing copies the strip label and price, the till float and the per-customer charge at the time it is
-- computed, so changing a catalog or a setting never alters a closing that was already submitted.
create function public.closing_strip_save(p_id uuid, p_label text, p_group text, p_price numeric, p_sort int, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare old_ jsonb; v_id uuid := p_id;
begin
  if not public.has_perm('closing.settings') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_label is null or length(trim(p_label)) not between 1 and 80 or length(coalesce(p_group, '')) > 60 then
    raise exception 'invalid text' using errcode = '22023', hint = 'invalid_text'; end if;
  if p_price is null or p_price < 0 then raise exception 'invalid amount' using errcode = '22023', hint = 'invalid_amount'; end if;
  if p_price > 1000000 then raise exception 'amount too large' using errcode = '22023', hint = 'amount_too_large'; end if;
  if v_id is null then
    insert into public.closing_strips (label, group_name, price, sort, active)
    values (trim(p_label), coalesce(trim(p_group), ''), p_price, coalesce(p_sort, 0), coalesce(p_active, true)) returning id into v_id;
    perform public.log_activity('closing.strip_saved', 'closing_strip', v_id::text, null, to_jsonb((select s from public.closing_strips s where s.id = v_id)), null);
  else
    select to_jsonb(s) into old_ from public.closing_strips s where s.id = v_id for update;
    if old_ is null then raise exception 'not found' using errcode = '42501', hint = 'not_allowed'; end if;
    update public.closing_strips set label = trim(p_label), group_name = coalesce(trim(p_group), ''), price = p_price,
      sort = coalesce(p_sort, sort), active = coalesce(p_active, active) where id = v_id;
    perform public.log_activity('closing.strip_saved', 'closing_strip', v_id::text, old_, to_jsonb((select s from public.closing_strips s where s.id = v_id)), null);
  end if;
  return v_id;
end $$;

create function public.closing_account_save(p_id uuid, p_kind text, p_tier_no int, p_label text, p_sort int, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare old_ jsonb; v_id uuid := p_id;
begin
  if not public.has_perm('closing.settings') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_kind not in ('named', 'tier_name') then raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload'; end if;
  if (p_kind = 'tier_name') is distinct from (p_tier_no is not null) or (p_tier_no is not null and p_tier_no not between 1 and 3) then
    raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload'; end if;
  if p_label is null or length(trim(p_label)) not between 1 and 80 then raise exception 'invalid text' using errcode = '22023', hint = 'invalid_text'; end if;
  if p_kind = 'tier_name' and coalesce(p_active, true) and exists (
       select 1 from public.closing_credit_accounts a where a.kind = 'tier_name' and a.tier_no = p_tier_no and a.active and a.id is distinct from v_id) then
    raise exception 'tier already has a name' using errcode = '23505', hint = 'tier_taken'; end if;
  if v_id is null then
    insert into public.closing_credit_accounts (kind, tier_no, label, sort, active)
    values (p_kind, p_tier_no, trim(p_label), coalesce(p_sort, 0), coalesce(p_active, true)) returning id into v_id;
    perform public.log_activity('closing.account_saved', 'closing_credit_account', v_id::text, null, to_jsonb((select a from public.closing_credit_accounts a where a.id = v_id)), null);
  else
    select to_jsonb(a) into old_ from public.closing_credit_accounts a where a.id = v_id for update;
    if old_ is null then raise exception 'not found' using errcode = '42501', hint = 'not_allowed'; end if;
    update public.closing_credit_accounts set kind = p_kind, tier_no = p_tier_no, label = trim(p_label), sort = coalesce(p_sort, sort), active = coalesce(p_active, active) where id = v_id;
    perform public.log_activity('closing.account_saved', 'closing_credit_account', v_id::text, old_, to_jsonb((select a from public.closing_credit_accounts a where a.id = v_id)), null);
  end if;
  return v_id;
end $$;

create function public.closing_audit_item_save(p_code text, p_name text, p_sort int, p_active boolean)
returns text language plpgsql security definer set search_path = public as $$
declare old_ jsonb;
begin
  if not public.has_perm('closing.settings') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{1,30}$' then raise exception 'invalid text' using errcode = '22023', hint = 'invalid_text'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'invalid text' using errcode = '22023', hint = 'invalid_text'; end if;
  select to_jsonb(i) into old_ from public.closing_audit_items i where i.code = p_code for update;
  insert into public.closing_audit_items (code, name, sort, active) values (p_code, trim(p_name), coalesce(p_sort, 0), coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, sort = coalesce(p_sort, public.closing_audit_items.sort), active = coalesce(p_active, public.closing_audit_items.active);
  perform public.log_activity('closing.audit_item_saved', 'closing_audit_item', p_code, old_, to_jsonb((select i from public.closing_audit_items i where i.code = p_code)), null);
  return p_code;
end $$;

-- till_float and per_customer_charge live in core settings (settings_set needs settings.manage). This wrapper lets the Closing
-- settings holder change ONLY these two keys, and writes the same history and activity rows settings_set writes.
create function public.closing_settings_set(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row public.settings; new_version int;
begin
  if not public.has_perm('closing.settings') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_key not in ('till_float', 'per_customer_charge') then raise exception 'unknown setting' using errcode = '22023', hint = 'unknown_setting'; end if;
  if p_value is null or jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 or (p_value #>> '{}')::numeric > 10000000 then
    raise exception 'bad value' using errcode = '22023', hint = 'bad_value'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into old_row from public.settings where key = p_key for update;
  if not found then raise exception 'unknown setting' using errcode = '22023', hint = 'unknown_setting'; end if;
  new_version := old_row.version + 1;
  update public.settings set value = p_value, version = new_version, updated_at = now(), updated_by = auth.uid() where key = p_key;
  insert into public.settings_history(key, version, value, reason, changed_by) values (p_key, new_version, p_value, trim(p_reason), auth.uid());
  perform public.log_activity('settings.set', 'settings', p_key, old_row.value, p_value, trim(p_reason));
end $$;

revoke all on function public.closing_strip_save(uuid, text, text, numeric, int, boolean), public.closing_account_save(uuid, text, int, text, int, boolean),
  public.closing_audit_item_save(text, text, int, boolean), public.closing_settings_set(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.closing_strip_save(uuid, text, text, numeric, int, boolean), public.closing_account_save(uuid, text, int, text, int, boolean),
  public.closing_audit_item_save(text, text, int, boolean), public.closing_settings_set(text, jsonb, text) to authenticated;

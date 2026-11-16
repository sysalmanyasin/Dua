-- 0620_ebill_devices.sql — register a device (any billing staff, once per installation) and deactivate it (manager).
-- A device id identifies an installation; it is NOT a security boundary and never replaces the per-invoice id.

create or replace function public.ebill_register_device(p_device_id uuid, p_label text default 'Device') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_label text := coalesce(nullif(left(btrim(coalesce(p_label, '')), 60), ''), 'Device'); v_ins uuid; d public.ebill_devices%rowtype;
begin
  if not public.has_perm('ebill.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_device_id is null then raise exception 'device id required' using errcode = '22023'; end if;
  insert into public.ebill_devices(device_id, label, registered_by) values (p_device_id, v_label, auth.uid())
  on conflict (device_id) do nothing returning device_id into v_ins;
  if v_ins is null then
    update public.ebill_devices set last_seen_at = now() where device_id = p_device_id;
  else
    perform public.log_activity('ebill.device_registered', 'ebill_devices', p_device_id::text, null, jsonb_build_object('label', v_label), null);
  end if;
  select * into d from public.ebill_devices where device_id = p_device_id;
  return jsonb_build_object('ok', true, 'status', d.status, 'label', d.label, 'registered_at', d.registered_at);
end $$;

create or replace function public.ebill_deactivate_device(p_device_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.ebill_devices%rowtype;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  select * into d from public.ebill_devices where device_id = p_device_id for update;
  if not found then raise exception 'unknown device' using errcode = '22023'; end if;
  if d.status = 'deactivated' then return; end if;
  update public.ebill_devices set status = 'deactivated', deactivated_at = now(), deactivated_by = auth.uid(), deactivate_reason = p_reason
   where device_id = p_device_id;
  perform public.log_activity('ebill.device_deactivated', 'ebill_devices', p_device_id::text,
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'deactivated'), p_reason);
end $$;

revoke all on function public.ebill_register_device(uuid, text), public.ebill_deactivate_device(uuid, text) from public, anon, authenticated;
grant execute on function public.ebill_register_device(uuid, text), public.ebill_deactivate_device(uuid, text) to authenticated;

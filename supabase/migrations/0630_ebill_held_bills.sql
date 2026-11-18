-- 0630_ebill_held_bills.sql — unfinished bills parked on the server so they can be picked up from any of the person's devices.
-- A hold is NOT an invoice: it is a working copy and may be replaced or deleted. The device keeps its own copy first (it works offline);
-- this table is where that copy is sent when there is a connection. Posted invoices are never touched by any of this.

create table public.ebill_held_bills (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id),
  device_id   uuid not null references public.ebill_devices(device_id),
  label       text not null default '',
  customer    text not null default '',
  item_count  integer not null default 0 check (item_count >= 0),
  net_total   numeric(14,2) not null default 0 check (net_total >= 0),
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ebill_held_user_idx on public.ebill_held_bills (user_id);
alter table public.ebill_held_bills enable row level security;
revoke all on public.ebill_held_bills from public, anon, authenticated;
grant select on public.ebill_held_bills to authenticated;
create policy ebill_held_read on public.ebill_held_bills for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.has_perm('ebill.use'))) or (select public.has_perm('ebill.manage')));

-- Park (or update) one held bill. Safe to repeat: the same id is the same hold.
create or replace function public.ebill_hold_bill(p_id uuid, p_device uuid, p_state jsonb, p_label text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_lines int; v_net numeric; v_n int; v_owner uuid;
begin
  if not public.has_perm('ebill.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_id is null or p_device is null or p_state is null or jsonb_typeof(p_state) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The held bill is not valid.');
  end if;
  if octet_length(p_state::text) > 200000 then return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The held bill is too large.'); end if;
  select status into v_status from public.ebill_devices where device_id = p_device;
  if not found then return jsonb_build_object('ok', false, 'code', 'device_unknown', 'message', 'This device is not registered yet.'); end if;
  if v_status <> 'active' then return jsonb_build_object('ok', false, 'code', 'device_inactive', 'message', 'This device has been deactivated.'); end if;
  select user_id into v_owner from public.ebill_held_bills where id = p_id;
  if found and v_owner <> v_uid then return jsonb_build_object('ok', false, 'code', 'id_conflict', 'message', 'That held bill belongs to someone else.'); end if;
  select count(*) into v_n from public.ebill_held_bills where user_id = v_uid and id <> p_id;
  if v_n >= 10 then return jsonb_build_object('ok', false, 'code', 'too_many', 'message', 'Too many held bills. Finish or delete some first.'); end if;
  v_lines := coalesce(jsonb_array_length(p_state -> 'lines'), 0);
  v_net := coalesce((p_state ->> 'net_total')::numeric, 0);
  insert into public.ebill_held_bills(id, user_id, device_id, label, customer, item_count, net_total, state)
  values (p_id, v_uid, p_device, left(btrim(coalesce(p_label, '')), 80), left(btrim(coalesce(p_state ->> 'customer', '')), 120), v_lines, greatest(v_net, 0), p_state)
  on conflict (id) do update set device_id = excluded.device_id, label = excluded.label, customer = excluded.customer,
    item_count = excluded.item_count, net_total = excluded.net_total, state = excluded.state, updated_at = now();
  return jsonb_build_object('ok', true, 'code', 'held');
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The held bill is not valid.');
end $$;

-- Remove a hold (resumed and saved, or deleted). Quiet if it is already gone, so a retried release is harmless.
create or replace function public.ebill_release_held(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('ebill.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.ebill_held_bills where id = p_id and (user_id = auth.uid() or public.has_perm('ebill.manage'));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ebill_hold_bill(uuid, uuid, jsonb, text), public.ebill_release_held(uuid) from public, anon, authenticated;
grant execute on function public.ebill_hold_bill(uuid, uuid, jsonb, text), public.ebill_release_held(uuid) to authenticated;

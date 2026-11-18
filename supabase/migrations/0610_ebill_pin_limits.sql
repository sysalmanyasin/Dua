-- 0610_ebill_pin_limits.sql — finalize PINs (owner sets, stored as a bcrypt hash) and staff discount limits.
-- PIN rules match staff login: 6 digits, not all the same, not a straight run. Five wrong PINs lock saving for 15 minutes.

create or replace function public.ebill_pin_valid(p text) returns boolean
language sql immutable as $$
  select p ~ '^[0-9]{6}$' and p !~ '^(.)\1{5}$'
     and position(p in '01234567890') = 0 and position(p in '09876543210') = 0
$$;

-- Owner only (ebill.set_pin). The PIN itself is never logged or returned.
create or replace function public.ebill_set_pin(p_user uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('ebill.set_pin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  if not public.ebill_pin_valid(p_pin) then
    raise exception 'PIN must be 6 digits, not all the same and not a run like 123456' using errcode = '22023';
  end if;
  insert into public.ebill_pins(user_id, pin_hash, set_by, set_at, failed_count, locked_until)
  values (p_user, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), auth.uid(), now(), 0, null)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, set_by = excluded.set_by, set_at = excluded.set_at, failed_count = 0, locked_until = null;
  perform public.log_activity('ebill.pin_set', 'ebill_pins', p_user::text, null, jsonb_build_object('set_by', auth.uid()), null);
end $$;

create or replace function public.ebill_remove_pin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('ebill.set_pin') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.ebill_pins where user_id = p_user;
  perform public.log_activity('ebill.pin_removed', 'ebill_pins', p_user::text, null, jsonb_build_object('removed_by', auth.uid()), null);
end $$;

-- Internal: 'ok' | 'no_pin' | 'bad_pin' | 'locked'. It records the failure, so the caller must RETURN a result
-- (not raise) or the count would roll back with the transaction.
create or replace function public.ebill_check_pin(p_user uuid, p_pin text) returns text
language plpgsql security definer set search_path = public as $$
declare r public.ebill_pins%rowtype;
begin
  select * into r from public.ebill_pins where user_id = p_user for update;
  if not found then return 'no_pin'; end if;
  if r.locked_until is not null and r.locked_until > now() then return 'locked'; end if;
  if r.pin_hash = extensions.crypt(p_pin, r.pin_hash) then
    update public.ebill_pins set failed_count = 0, locked_until = null where user_id = p_user;
    return 'ok';
  end if;
  update public.ebill_pins
     set failed_count = case when failed_count + 1 >= 5 then 0 else failed_count + 1 end,
         locked_until = case when failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
   where user_id = p_user;
  return 'bad_pin';
end $$;

-- Manager sets a person's discount limits; a null leaves that limit at the shop default (settings ebill.max_discount_*).
create or replace function public.ebill_set_limits(p_user uuid, p_pct numeric, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row public.ebill_staff_limits%rowtype;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then raise exception 'unknown user' using errcode = '22023'; end if;
  if (p_pct is not null and (p_pct < 0 or p_pct > 100)) or (p_amount is not null and p_amount < 0) then
    raise exception 'limit out of range' using errcode = '22023';
  end if;
  select * into old_row from public.ebill_staff_limits where user_id = p_user;
  if p_pct is null and p_amount is null then
    delete from public.ebill_staff_limits where user_id = p_user;
  else
    insert into public.ebill_staff_limits(user_id, max_discount_pct, max_discount_amount, updated_by, updated_at)
    values (p_user, p_pct, p_amount, auth.uid(), now())
    on conflict (user_id) do update set max_discount_pct = excluded.max_discount_pct, max_discount_amount = excluded.max_discount_amount,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  perform public.log_activity('ebill.limits_set', 'ebill_staff_limits', p_user::text,
    to_jsonb(old_row) - 'updated_by', jsonb_build_object('max_discount_pct', p_pct, 'max_discount_amount', p_amount), p_reason);
end $$;

revoke all on function public.ebill_pin_valid(text), public.ebill_set_pin(uuid, text), public.ebill_remove_pin(uuid),
  public.ebill_check_pin(uuid, text), public.ebill_set_limits(uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.ebill_set_pin(uuid, text), public.ebill_remove_pin(uuid), public.ebill_set_limits(uuid, numeric, numeric, text) to authenticated;

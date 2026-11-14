-- 0503 (STR): overdue alert (owner decision STR-9, 13/14 Nov 2026).
-- An STR (incoming or outgoing) is overdue from the end of the day after its STR date (created 1 Nov, still not received
-- at the start of 3 Nov = overdue). While it is overdue and neither Received nor Closed, the owner gets one alert at each of
-- 09:00, 13:00, 17:00 and 21:00 Pakistan time (cron below). One alert per slot summarises all overdue STRs; its
-- dedupe_key holds the slot, so every slot is a new alert but a repeated call in the same slot is not.
-- The payload holds ids, a count and a date only (no names or amounts: the push goes through a public server).
-- Only the live feed is checked. An STR that has left Candela's export no longer has a known status, so it stops alerting.
-- Callable only from inside the database (cron, service role).
create or replace function public.str_overdue_check(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_now at time zone 'Asia/Karachi')::date;
  v_ids bigint[]; v_count int; v_oldest date; v_slot text; v_nid uuid;
begin
  select array_agg(h.str_id order by h.str_date, h.str_id), count(*)::int, min(h.str_date)
    into v_ids, v_count, v_oldest
  from public.str_headers h
  where h.str_date is not null
    and h.str_date <= v_today - 2
    and public.str_stage(h.dispatch_status, h.receive_status) <> 'received'
    and lower(h.str_status) not like 'close%';
  if coalesce(v_count, 0) = 0 then
    return jsonb_build_object('count', 0, 'notified', false);
  end if;
  v_slot := to_char(p_now at time zone 'Asia/Karachi', 'YYYY-MM-DD"T"HH24');
  if to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    v_nid := public.notify_owner('str.overdue', jsonb_build_object(
      'count', v_count, 'str_ids', to_jsonb(v_ids[1:20]), 'oldest_date', v_oldest,
      'dedupe_key', 'str.overdue:' || v_slot));
  end if;
  return jsonb_build_object('count', v_count, 'notified', v_nid is not null, 'slot', v_slot);
end $$;
revoke all on function public.str_overdue_check(timestamptz) from public, anon, authenticated;
grant execute on function public.str_overdue_check(timestamptz) to service_role;

-- 04:00, 08:00, 12:00, 16:00 UTC = 09:00, 13:00, 17:00, 21:00 in Pakistan. Skipped where pg_cron is missing; no secret.
do $cron$
begin
  begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
  exception when others then
    raise notice 'could not enable pg_cron here: %', sqlerrm;
  end;
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not available: STR overdue schedule skipped';
  elsif not exists (select 1 from cron.job where jobname = 'str-overdue-check') then
    perform cron.schedule('str-overdue-check', '0 4,8,12,16 * * *', 'select public.str_overdue_check()');
  end if;
end $cron$;

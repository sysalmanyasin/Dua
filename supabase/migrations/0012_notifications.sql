-- 0012: owner notifications (Foundation F4).
-- Modules never talk to ntfy. They call notify_owner(kind, payload) from inside their own functions.
-- notify_owner only writes a row and can never raise an error, so a notification problem can never block a business action.
-- A separate sender (Edge Function notify-ntfy, called by pg_cron) delivers the rows, records every failure and retries.
-- Payloads carry ids and dates, never amounts or names (the push goes through a public ntfy server).

insert into public.permissions (key, description) values
  ('notifications.view', 'See and acknowledge owner alerts (owner only; admins hold every permission, nobody else is granted it)')
on conflict (key) do nothing;

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind ~ '^[a-z][a-z0-9_.]{0,59}$'),
  payload         jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 4096),
  dedupe_key      text check (length(dedupe_key) <= 120),
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz default now(),      -- null = nothing more will be tried
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  acked_at        timestamptz,
  acked_by        uuid references auth.users(id)
);
create index notifications_due_idx on public.notifications (next_attempt_at) where status in ('pending', 'failed') and next_attempt_at is not null;
create index notifications_created_idx on public.notifications (created_at desc);
-- While an alert with this key is still unacknowledged, a repeat is dropped instead of piling up.
create unique index notifications_dedupe_open on public.notifications (dedupe_key) where dedupe_key is not null and acked_at is null;

alter table public.notifications enable row level security;
create policy notifications_owner_read on public.notifications for select to authenticated
  using (public.has_perm('notifications.view'));
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ───────── the interface other modules call ─────────
-- Returns the new id, or null when nothing was queued (bad input, duplicate, backlog, or any internal problem).
-- It never raises. An optional payload key "dedupe_key" drops repeats while the earlier alert is unacknowledged.
create or replace function public.notify_owner(p_kind text, p_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid; dk text;
begin
  begin
    p_payload := coalesce(p_payload, '{}'::jsonb);
    dk := nullif(p_payload ->> 'dedupe_key', '');
    if (select count(*) from public.notifications where status in ('pending', 'failed') and acked_at is null) >= 200 then
      raise warning 'notify_owner: backlog full, dropped %', p_kind;
      return null;
    end if;
    insert into public.notifications (kind, payload, dedupe_key) values (p_kind, p_payload, dk)
    on conflict (dedupe_key) where dedupe_key is not null and acked_at is null do nothing
    returning id into nid;
  exception when others then
    raise warning 'notify_owner failed (%): %', p_kind, sqlerrm;
    return null;
  end;
  return nid;
end $$;

-- ───────── sender support (service role only; used by the notify-ntfy Edge Function) ─────────
-- Hands out due rows and leases them for 5 minutes so two runs never send the same alert twice.
-- A row whose sender died after 5 tries is marked failed here, so it can never be stuck out of sight.
create or replace function public.notifications_claim(p_limit integer default 20) returns setof public.notifications
language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set status = 'failed', next_attempt_at = null, last_error = coalesce(last_error, 'sender did not finish')
   where status = 'pending' and attempts >= 5 and next_attempt_at <= now();
  return query
    with due as (
      select id from public.notifications
       where status in ('pending', 'failed') and attempts < 5 and next_attempt_at <= now()
       order by created_at limit greatest(1, least(coalesce(p_limit, 20), 50))
       for update skip locked)
    update public.notifications n set attempts = n.attempts + 1, next_attempt_at = now() + interval '5 minutes'
      from due where n.id = due.id
    returning n.*;
end $$;

create or replace function public.notifications_mark(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select attempts into n from public.notifications where id = p_id;
  if not found then return; end if;
  if p_ok then
    update public.notifications set status = 'sent', sent_at = now(), next_attempt_at = null, last_error = null where id = p_id;
  else
    update public.notifications set status = 'failed', last_error = left(coalesce(p_error, 'unknown error'), 500),
      next_attempt_at = case when n >= 5 then null
        else now() + (case n when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes' else interval '60 minutes' end) end
     where id = p_id;
  end if;
end $$;

-- ───────── what the owner sees ─────────
-- For the Cover's "Needs attention": failed alerts, and alerts still unsent after 15 minutes (this works even when the sender is dead).
create or replace function public.notifications_attention() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.has_perm('notifications.view') then return null; end if;
  select jsonb_build_object(
    'failed', count(*) filter (where status = 'failed'),
    'stuck', count(*) filter (where status = 'pending'),
    'items', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, kind, status, attempts, last_error, created_at from public.notifications
         where acked_at is null and (status = 'failed' or (status = 'pending' and created_at < now() - interval '15 minutes'))
         order by created_at desc limit 5) x), '[]'::jsonb))
  into res
  from public.notifications
  where acked_at is null and (status = 'failed' or (status = 'pending' and created_at < now() - interval '15 minutes'));
  return res;
end $$;

create or replace function public.notifications_ack(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('notifications.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.notifications set acked_at = now(), acked_by = auth.uid() where id = p_id and acked_at is null;
  perform public.log_activity('notification.acked', 'notifications', p_id::text, null, null, null);
end $$;

-- ───────── feed watchdog (touches no Inventory code) ─────────
-- No successful inventory sync for 3 hours raises one alert per day. Silence before the first ever sync is not an alert.
create or replace function public.ops_check_inventory_feed() returns void
language plpgsql security definer set search_path = public as $$
declare last_ok timestamptz;
begin
  select max(synced_at) into last_ok from public.inventory_sync_log where status = 'ok';
  if last_ok is not null and last_ok < now() - interval '3 hours' then
    perform public.notify_owner('inventory.sync_stale', jsonb_build_object(
      'dedupe_key', 'inventory.sync_stale:' || to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD'), 'last_ok', last_ok));
  end if;
end $$;

revoke all on function public.notify_owner(text, jsonb), public.notifications_claim(integer), public.notifications_mark(uuid, boolean, text),
  public.notifications_attention(), public.notifications_ack(uuid), public.ops_check_inventory_feed() from public, anon, authenticated;
grant execute on function public.notify_owner(text, jsonb), public.notifications_claim(integer), public.notifications_mark(uuid, boolean, text),
  public.ops_check_inventory_feed() to service_role;
grant execute on function public.notifications_attention(), public.notifications_ack(uuid) to authenticated;

-- ───────── schedules (only where pg_cron and pg_net exist; nothing here holds a secret) ─────────
-- The sender's address and secret are read from Vault by name when the job runs. If either is missing the call is skipped,
-- the alerts stay unsent and the Cover shows them as undelivered. Create the Vault secrets first (docs/RUNBOOK.md).
do $cron$
begin
  if to_regclass('cron.job') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available: notification schedules skipped';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'notify-drain') then
    perform cron.schedule('notify-drain', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ops_function_base_url') || '/notify-ntfy',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ops-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_drain_secret')),
        body := '{"action":"drain"}'::jsonb, timeout_milliseconds := 10000)
      where exists (select 1 from public.notifications where status in ('pending', 'failed') and attempts < 5 and next_attempt_at <= now())
        and exists (select 1 from vault.decrypted_secrets where name = 'notify_drain_secret')
        and exists (select 1 from vault.decrypted_secrets where name = 'ops_function_base_url') $job$);
  end if;
  if not exists (select 1 from cron.job where jobname = 'ops-check-inventory-feed') then
    perform cron.schedule('ops-check-inventory-feed', '*/30 * * * *', 'select public.ops_check_inventory_feed()');
  end if;
end $cron$;

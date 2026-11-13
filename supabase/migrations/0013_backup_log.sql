-- 0013: backup record and the Tools overview (Foundation F7).
-- The backup workflow reports each result through the notify-ntfy function (action backup_report), which calls backup_report() here.
-- A failed backup raises an owner alert. A daily check raises one if no verified backup exists for 30 hours, which also catches
-- the case where the workflow never runs at all (for example GitHub pausing scheduled workflows on an inactive repository).
-- The log holds sizes, hashes and a fingerprint of the database (table names, row counts, content hashes). No business values.

insert into public.permissions (key, description) values
  ('tools.view', 'Open the owner Tools tab: notifications, backups, feed status (owner only; admins hold every permission, nobody else is granted it)')
on conflict (key) do nothing;

create table public.backup_log (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('daily', 'weekly', 'restore_drill')),
  status     text not null check (status in ('ok', 'failed')),
  day        date,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256     text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  manifest   jsonb check (manifest is null or octet_length(manifest::text) <= 30000),
  error      text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now()
);
create index backup_log_created_idx on public.backup_log (created_at desc);

alter table public.backup_log enable row level security;
create policy backup_log_owner_read on public.backup_log for select to authenticated using (public.has_perm('tools.view'));
revoke all on public.backup_log from public, anon, authenticated;
grant select on public.backup_log to authenticated;
grant all on public.backup_log to service_role;

-- Called only by the notify-ntfy function (service role). A failure also raises an owner alert, once per kind and day.
create or replace function public.backup_report(p_kind text, p_status text, p_day date, p_size bigint, p_sha text, p_manifest jsonb, p_error text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  insert into public.backup_log (kind, status, day, size_bytes, sha256, manifest, error)
  values (p_kind, p_status, p_day, p_size, p_sha, p_manifest, left(p_error, 500)) returning id into rid;
  if p_status = 'failed' then
    perform public.notify_owner(case when p_kind = 'restore_drill' then 'restore_drill.failed' else 'backup.failed' end,
      jsonb_build_object('dedupe_key', p_kind || '.failed:' || coalesce(p_day::text, to_char(now(), 'YYYY-MM-DD')), 'date', coalesce(p_day::text, to_char(now(), 'YYYY-MM-DD'))));
  end if;
  return rid;
end $$;

-- No alert before the very first successful backup (setup period). After that, 30 hours without one raises a single alert per day.
create or replace function public.ops_check_backups() returns void
language plpgsql security definer set search_path = public as $$
declare last_ok timestamptz;
begin
  select max(created_at) into last_ok from public.backup_log where kind = 'daily' and status = 'ok';
  if last_ok is not null and last_ok < now() - interval '30 hours' then
    perform public.notify_owner('backup.stale', jsonb_build_object('dedupe_key', 'backup.stale:' || to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD'), 'last_ok', last_ok));
  end if;
end $$;

-- Everything the Tools tab shows, in one call (owner only; null for everyone else).
create or replace function public.tools_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('tools.view') then return null; end if;
  return jsonb_build_object(
    'backups', jsonb_build_object(
      'last_ok_daily', (select max(created_at) from public.backup_log where kind = 'daily' and status = 'ok'),
      'last_failed', (select max(created_at) from public.backup_log where kind = 'daily' and status = 'failed'),
      'last_drill_ok', (select max(created_at) from public.backup_log where kind = 'restore_drill' and status = 'ok'),
      'recent', coalesce((select jsonb_agg(x order by x.created_at desc) from (
          select kind, status, day, size_bytes, error, created_at from public.backup_log order by created_at desc limit 10) x), '[]'::jsonb)),
    'notifications', jsonb_build_object(
      'failed', (select count(*) from public.notifications where status = 'failed' and acked_at is null),
      'unsent', (select count(*) from public.notifications where status = 'pending' and created_at < now() - interval '15 minutes' and acked_at is null),
      'recent', coalesce((select jsonb_agg(x order by x.created_at desc) from (
          select id, kind, status, attempts, last_error, created_at, sent_at, acked_at from public.notifications order by created_at desc limit 20) x), '[]'::jsonb)),
    'feed', jsonb_build_object(
      'last_ok', (select max(synced_at) from public.inventory_sync_log where status = 'ok'),
      'last_status', (select status from public.inventory_sync_log order by synced_at desc limit 1)));
end $$;

revoke all on function public.backup_report(text, text, date, bigint, text, jsonb, text), public.ops_check_backups(), public.tools_overview() from public, anon, authenticated;
grant execute on function public.backup_report(text, text, date, bigint, text, jsonb, text), public.ops_check_backups() to service_role;
grant execute on function public.tools_overview() to authenticated;

do $cron$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not available: backup check schedule skipped';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'ops-check-backups') then
    perform cron.schedule('ops-check-backups', '0 7 * * *', 'select public.ops_check_backups()');
  end if;
end $cron$;

-- 1402_notification_text: keep the full text of every alert that is sent (range 1400-1499, Android).
-- Until now the push text (for example the closing figures or the audit differences) was built when the alert went out and then
-- thrown away: the Tools tab could only say "Alert: closing.corrected". The sender (Edge Function notify-push) now saves the
-- exact title and message it sends, and the Tools tab shows them. Alerts sent before this change have no saved text and keep the
-- short label. Who can read it is unchanged: the notifications table is already limited to people with notifications.view, and
-- the Tools tab to the owner with the second factor. Additive only: two nullable columns, one function, one redefined function.

alter table public.notifications
  add column title text check (title is null or char_length(title) <= 200),
  add column body  text check (body  is null or char_length(body)  <= 4000);

-- Called by notify-push (service role only) with the text it is about to send. It never raises: a failed save must not stop an alert.
create function public.notifications_record_text(p_id uuid, p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set title = left(p_title, 200), body = left(p_body, 4000) where id = p_id;
exception when others then
  raise warning 'notifications_record_text failed: %', sqlerrm;
end $$;
revoke all on function public.notifications_record_text(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notifications_record_text(uuid, text, text) to service_role;

-- Same function as in 0013, with title and body added to each recent alert (nothing else changed).
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
          select id, kind, status, attempts, last_error, title, body, created_at, sent_at, acked_at from public.notifications order by created_at desc limit 20) x), '[]'::jsonb)),
    'feed', jsonb_build_object(
      'last_ok', (select max(synced_at) from public.inventory_sync_log where status = 'ok'),
      'last_status', (select status from public.inventory_sync_log order by synced_at desc limit 1)));
end $$;
revoke all on function public.tools_overview() from public, anon;
grant execute on function public.tools_overview() to authenticated;

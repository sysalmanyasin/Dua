-- 0303_inventory_heartbeat.sql — Inventory module.
-- Foundation's feed watchdog (ops_check_inventory_feed, 0012) raises an alert when the sync log has no successful
-- ('ok') row for 3 hours. Since 0302 the Edge Function skips an unchanged Dropbox file without a sync, and a skipped
-- check wrote no log row, so an unchanged file would have looked like a dead feed.
-- Now a scheduled "file unchanged" check writes one heartbeat row (ok / unchanged) when the newest successful row is
-- older than 2 hours: at most 12 extra rows a day, and the watchdog's 3-hour window is never reached while checks
-- keep arriving. A check started by a person is always logged, as before. Same signature and grants as 0302.
create or replace function public.inventory_note_unchanged(p_content_hash text, p_source text default 'dropbox', p_triggered_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_active int; v_now timestamptz := clock_timestamp();
begin
  update public.inventory_sync_state set last_checked_at = v_now, content_hash = coalesce(p_content_hash, content_hash)
  where id = 1 returning active_count into v_active;
  if p_triggered_by is not null
     or not exists (select 1 from public.inventory_sync_log where status = 'ok' and synced_at > v_now - interval '2 hours') then
    insert into public.inventory_sync_log (synced_at, status, result, item_count, source, triggered_by)
    values (v_now, 'ok', 'unchanged', coalesce(v_active, 0), p_source, p_triggered_by);
  end if;
  return jsonb_build_object('ok', true, 'result', 'unchanged');
end $$;

-- 0413_audit_round_alert: every compiled audit round raises the full "Audit Round Complete" push (D-64).
--   * audit_round_alert_json(compilation) gives the push sender the round's figures in one call: round, counters, items that differ
--     (short, over, net) and, per company, the differing items with system count, counted quantity and value (R20).
--   * audit.compiled is now raised for every round, individual self-picks included, and keyed by the compilation, so a recompile
--     raises a new alert. The key still is the only thing in the payload: the sender reads the figures from the compilation.
--   * audit.submitted is no longer raised for an individual self-pick, which compiles itself at once and raises audit.compiled
--     instead (one push for one event, not two). Other rounds keep audit.submitted for each counter's submission.
-- The sender is the only caller of audit_round_alert_json. No money rule changes.
create function public.audit_round_alert_json(p_compilation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.audit_compilations; r public.audit_rounds; v_people jsonb; v_companies jsonb; v_short numeric; v_over numeric;
begin
  select * into c from public.audit_compilations where id = p_compilation;
  if not found then return null; end if;
  select * into r from public.audit_rounds where id = c.round_id;
  select coalesce(jsonb_agg(x.n order by x.n), '[]'::jsonb) into v_people
    from (select distinct public.audit_person_name(a.auditor_id) as n from public.audit_assignments a
          where a.round_id = c.round_id and a.status = 'submitted') x
   where x.n is not null;
  select coalesce(sum(variance_value) filter (where variance_value < 0), 0), coalesce(sum(variance_value) filter (where variance_value > 0), 0)
    into v_short, v_over from public.audit_compiled_rows where compilation_id = c.id and variance <> 0;
  select coalesce(jsonb_agg(jsonb_build_object('company', g.company, 'net', g.net, 'items', g.items) order by g.first_pos), '[]'::jsonb) into v_companies
    from (select company, sum(variance_value) as net, min(position) as first_pos,
                 jsonb_agg(jsonb_build_object('code', code, 'name', name, 'system', system_qty, 'counted', counted_qty, 'value', variance_value) order by position) as items
            from public.audit_compiled_rows where compilation_id = c.id and variance <> 0 group by company) g;
  return jsonb_build_object('round', r.round_number, 'suffix', r.round_suffix, 'people', v_people,
    'date', to_char(c.compiled_at at time zone 'Asia/Karachi', 'DD Mon YYYY'),
    'item_count', c.item_count, 'variance_count', c.variance_count, 'short', v_short, 'over', v_over, 'net', c.variance_value,
    'companies', v_companies);
end $$;
revoke all on function public.audit_round_alert_json(uuid) from public, anon, authenticated;
grant execute on function public.audit_round_alert_json(uuid) to service_role;

create or replace function public.audit_alert_compiled() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_owner('audit.compiled', jsonb_build_object('dedupe_key', 'audit.compiled:' || new.id::text));
  return null;
end $$;

create or replace function public.audit_alert_submitted() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.audit_engagements e where e.id = new.engagement_id and e.scope_type = 'individual') then
    return null; -- an individual self-pick compiles itself and raises audit.compiled
  end if;
  perform public.notify_owner('audit.submitted', jsonb_build_object('dedupe_key', 'audit.submitted:' || new.round_id::text));
  return null;
end $$;

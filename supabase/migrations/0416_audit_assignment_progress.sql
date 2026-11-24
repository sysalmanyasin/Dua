-- 0416_audit_assignment_progress — what one person has counted and not counted (F7 / O6). Read only.
--  * audit_assignment_progress(p_assignment): the assignment, and every item given to that person with their latest count, note and the
--    auto-matched flag. Counted items carry the latest count event; the earlier events stay in the log, nothing is changed.
--  * Who may call it: audit.assign, audit.compile or audit.view, and only for an engagement the caller may view
--    (audit_can_view: administrators see all; others only audits they are a member of). System quantities are not returned.
--  * Refusals: not_allowed (no key, or outside the engagement), assignment_not_found.

create function public.audit_assignment_progress(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.audit_assignments; v_items jsonb;
begin
  if not (public.has_perm('audit.assign') or public.has_perm('audit.compile') or public.has_perm('audit.view')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select * into a from public.audit_assignments where id = p_assignment;
  if not found then raise exception 'assignment not found' using errcode = '22023', hint = 'assignment_not_found'; end if;
  if not public.audit_can_view(a.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'round_item_id', ri.id, 'code', ri.code, 'name', ri.name, 'company', ri.company,
           'counted', l.round_item_id is not null, 'qty', l.qty, 'auto_matched', coalesce(l.auto_matched, false),
           'confirmed_same', coalesce(l.confirmed_same, false), 'note', coalesce(l.note, ''), 'counted_at', l.created_at)
           order by ri.company, ri.name, ri.code, ri.id), '[]'::jsonb)
    into v_items
  from public.audit_assignment_items ai
  join public.audit_round_items ri on ri.id = ai.round_item_id
  left join lateral (select e.round_item_id, e.qty, e.auto_matched, e.confirmed_same, e.note, e.created_at
                     from public.audit_count_events e
                     where e.assignment_id = ai.assignment_id and e.round_item_id = ai.round_item_id
                     order by e.seq desc limit 1) l on true
  where ai.assignment_id = p_assignment;

  return jsonb_build_object(
    'assignment', jsonb_build_object('id', a.id, 'round_id', a.round_id, 'engagement_id', a.engagement_id, 'auditor_id', a.auditor_id,
      'name', public.audit_person_name(a.auditor_id), 'status', a.status, 'started_at', a.started_at,
      'round_state', (select r.state from public.audit_rounds r where r.id = a.round_id)),
    'items', v_items);
end $$;

revoke all on function public.audit_assignment_progress(uuid) from public, anon, authenticated;
grant execute on function public.audit_assignment_progress(uuid) to authenticated;

-- 0420_audit_round_live — the live view of a whole round for the main auditor / owner (Audit slice F8), and Force Submit for Individual rounds.
--  * audit_round_live(p_round): every item given to a counter in the round, with the count so far, the system quantity the counter was
--    shown, the difference (counted - system, as the compile works it out, R20) and its value, plus each counter's progress. Read only.
--    Items sort A-Z by name. An item is "counted" when the counter has a count for it; a "not counted" item has no quantity and no
--    difference (it is not zero). A counter who was force-submitted "as matching" shows those items counted at the system quantity,
--    flagged as assumed, exactly as the compile will read them.
--  * Who may call it: whoever may see the results of that engagement (audit_can_see_results), the same gate as audit_compile_overview.
--    A counter, who must not see system quantities during a blind count, is refused (not_allowed). Unknown round: round_not_found.
--  * audit_force_submit: unchanged except that an Individual Audit compiles itself after a forced submit, exactly like a normal
--    submit (0412). Without it the round would stay "counting" with nobody left to submit it.

create function public.audit_round_live(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.audit_rounds; v_out jsonb;
begin
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_see_results(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;

  with rows as (
    select a.id as assignment_id, a.status as a_status, public.audit_person_name(a.auditor_id) as person,
           ri.id as round_item_id, ri.code, ri.name, ri.company, ri.system_qty, ri.retail_price,
           (ev.round_item_id is not null or sb.round_item_id is not null) as counted,
           coalesce(ev.qty, sb.qty) as qty,
           coalesce(ev.auto_matched, sb.auto_matched, false) as auto_matched,
           coalesce(ev.note, sb.note, '') as note,
           coalesce(ev.created_at, sb.submitted_at) as counted_at
    from public.audit_assignments a
    join public.audit_assignment_items ai on ai.assignment_id = a.id
    join public.audit_round_items ri on ri.id = ai.round_item_id
    left join lateral (select e.round_item_id, e.qty, e.auto_matched, e.note, e.created_at
                       from public.audit_count_events e
                       where a.status <> 'submitted' and e.assignment_id = a.id and e.round_item_id = ri.id
                       order by e.seq desc limit 1) ev on true
    left join lateral (select sl.round_item_id, sl.qty, sl.auto_matched, sl.note, s.submitted_at
                       from public.audit_submission_lines sl join public.audit_submissions s on s.id = sl.submission_id
                       where a.status = 'submitted' and s.assignment_id = a.id and sl.round_item_id = ri.id
                       order by s.revision desc limit 1) sb on true
    where a.round_id = p_round and a.status <> 'revoked'
  )
  select jsonb_build_object(
    'round', jsonb_build_object('id', r.id, 'engagement_id', r.engagement_id, 'state', r.state),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', g.assignment_id, 'name', g.person, 'status', g.a_status,
        'items', g.n, 'counted', g.c, 'differences', g.d,
        'forced', coalesce((select s.forced from public.audit_submissions s where s.assignment_id = g.assignment_id order by s.revision desc limit 1), false))
        order by g.person, g.assignment_id), '[]'::jsonb)
      from (select assignment_id, person, a_status, count(*) as n, count(*) filter (where counted) as c,
                   count(*) filter (where counted and qty is not null and qty <> system_qty) as d
            from rows group by assignment_id, person, a_status) g),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'round_item_id', x.round_item_id, 'assignment_id', x.assignment_id, 'person', x.person,
        'code', x.code, 'name', x.name, 'company', x.company,
        'system_qty', x.system_qty, 'counted', x.counted, 'qty', x.qty, 'auto_matched', x.auto_matched, 'note', x.note,
        'counted_at', x.counted_at,
        'difference', case when x.counted and x.qty is not null then x.qty - x.system_qty end,
        'difference_value', case when x.counted and x.qty is not null then round((x.qty - x.system_qty) * x.retail_price, 2) end)
        order by lower(x.name), x.code, x.round_item_id, x.assignment_id), '[]'::jsonb)
      from rows x))
  into v_out;
  return v_out;
end $$;

revoke all on function public.audit_round_live(uuid) from public, anon, authenticated;
grant execute on function public.audit_round_live(uuid) to authenticated;

-- ───────── Force Submit: an Individual Audit compiles itself ─────────
create or replace function public.audit_force_submit(p_assignment uuid, p_mode text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; v_state text; v_rev int; v_id uuid; v_lines int; v_added int := 0; v_comp jsonb;
begin
  perform public.audit_require('audit.compile');
  if p_mode is null or p_mode not in ('as_counted', 'match') then raise exception 'invalid mode' using errcode = '22023', hint = 'invalid_mode'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into a from public.audit_assignments where id = p_assignment for update;
  if not found then raise exception 'assignment not found' using errcode = '22023', hint = 'assignment_not_found'; end if;
  if a.status = 'revoked' then raise exception 'the assignment was revoked' using errcode = '55000', hint = 'assignment_revoked'; end if;
  if a.status = 'submitted' then raise exception 'the assignment is already submitted' using errcode = '55000', hint = 'assignment_submitted'; end if;
  select state into v_state from public.audit_rounds where id = a.round_id for update;
  if v_state <> 'counting' then raise exception 'the round is not open for counting' using errcode = '55000', hint = 'round_not_counting'; end if;

  select coalesce(max(revision), 0) + 1 into v_rev from public.audit_submissions where assignment_id = p_assignment;
  insert into public.audit_submissions (assignment_id, round_id, engagement_id, revision, submitted_by, forced, forced_reason)
    values (p_assignment, a.round_id, a.engagement_id, v_rev, auth.uid(), true, left(btrim(p_reason), 500)) returning id into v_id;
  insert into public.audit_submission_lines (submission_id, round_item_id, qty, auto_matched, note, confirmed_same, row_seconds)
    select v_id, l.round_item_id, l.qty, l.auto_matched, l.note, l.confirmed_same, t.secs
    from (select distinct on (e.round_item_id) e.* from public.audit_count_events e
          where e.assignment_id = p_assignment order by e.round_item_id, e.seq desc) l
    join (select round_item_id, sum(row_seconds)::int secs from public.audit_count_events where assignment_id = p_assignment group by 1) t
      on t.round_item_id = l.round_item_id;
  get diagnostics v_lines = row_count;
  if p_mode = 'match' then
    insert into public.audit_submission_lines (submission_id, round_item_id, qty, auto_matched, note, confirmed_same, row_seconds)
      select v_id, ri.id, ri.system_qty, true, '', false, 0
      from public.audit_assignment_items ai join public.audit_round_items ri on ri.id = ai.round_item_id
      where ai.assignment_id = p_assignment
        and not exists (select 1 from public.audit_submission_lines sl where sl.submission_id = v_id and sl.round_item_id = ri.id);
    get diagnostics v_added = row_count;
  end if;
  update public.audit_assignments set status = 'submitted', updated_at = now() where id = p_assignment;
  perform public.log_activity('audit.force_submitted', 'audit_assignments', p_assignment::text, null,
    jsonb_build_object('mode', p_mode, 'revision', v_rev, 'counted', v_lines, 'matched', v_added), btrim(p_reason));
  -- An Individual Audit compiles itself the moment it is submitted (0412); a submission made for the person is no different, so the
  -- round does not stay open with nobody left to submit it. Every other kind of round stays with the main auditor, as before.
  if a.method = 'individual-self-pick' then
    v_comp := public.audit_compile_round_core(a.round_id, false, null);
  end if;
  return jsonb_build_object('submission_id', v_id, 'revision', v_rev, 'counted', v_lines, 'matched', v_added,
    'compiled', v_comp is not null, 'compilation_id', v_comp ->> 'compilation_id');
end $$;

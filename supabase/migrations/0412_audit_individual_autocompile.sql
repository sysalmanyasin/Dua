-- 0412_audit_individual_autocompile — Individual rounds compile themselves on submit.
-- Scope: only rounds of the monthly Individual engagement (assignment method 'individual-self-pick'). Every other round is
-- unchanged: submit freezes the count, the main auditor compiles by hand.
--  * audit_compile_round_core: the compile body of 0402 without the permission check, internal only. audit_compile_round keeps
--    the audit.compile check and calls it. In an individual engagement no cross-round conflicts are raised.
--  * audit_submit: an individual submit calls the core, so the round is 'compiled' at once and the person may start the next.
--  * audit_reopen: refuses (self_pick_open) when the person already has another open Individual Audit, instead of failing on
--    the one-open-self-pick unique index.
--  * audit_alert_compiled: no 'compiled' owner alert for individual engagements (the 'submitted' alert still fires).

-- ───────── 1. compile core ─────────
create function public.audit_compile_round_core(p_round uuid, p_allow_missing boolean default false, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_id uuid := gen_random_uuid(); v_rev int; v_missing uuid[]; v_notes jsonb;
        v_items int; v_var int; v_val numeric; v_conf int := 0; v_ver int; v_scope text;
begin
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  select e.scope_type into v_scope from public.audit_engagements e where e.id = r.engagement_id;
  if r.state = 'final' then raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final'; end if;
  if r.state not in ('counting', 'compiled') then raise exception 'the round is not ready to compile' using errcode = '55000', hint = 'round_not_compilable'; end if;

  select coalesce(array_agg(a.id order by a.created_at, a.id), '{}') into v_missing
    from public.audit_assignments a where a.round_id = p_round and a.status <> 'revoked' and a.status <> 'submitted';
  if cardinality(v_missing) > 0 and not coalesce(p_allow_missing, false) then
    raise exception '% assignment(s) have not submitted', cardinality(v_missing) using errcode = '55000', hint = 'missing_assignments';
  end if;

  select coalesce(max(revision), 0) + 1 into v_rev from public.audit_compilations where round_id = p_round;

  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', s.assignment_id, 'auditor_id', a.auditor_id,
            'note', btrim(s.extra_note), 'submitted_at', s.submitted_at) order by s.submitted_at, s.assignment_id), '[]'::jsonb)
    into v_notes
    from (select distinct on (assignment_id) * from public.audit_submissions where round_id = p_round order by assignment_id, revision desc) s
    join public.audit_assignments a on a.id = s.assignment_id
    where btrim(s.extra_note) <> '';

  with latest_sub as (
    select distinct on (assignment_id) id, assignment_id from public.audit_submissions
      where round_id = p_round order by assignment_id, revision desc
  ), corr as (
    select distinct on (round_item_id) round_item_id, counted_qty, decided_by, decided_at from public.audit_corrections
      where round_id = p_round and status = 'approved' order by round_item_id, decided_at desc, id desc
  ), rows as (
    select ri.id as round_item_id, ri.position, ri.company, ri.code, ri.name, ri.system_qty, ri.retail_price,
           coalesce(c.counted_qty, l.qty, 0) as counted_qty,
           (c.round_item_id is not null or l.round_item_id is not null) as touched,
           (c.round_item_id is null and coalesce(l.auto_matched, false)) as auto_matched,
           a.auditor_id, coalesce(l.note, '') as note, coalesce(l.confirmed_same, false) as confirmed_same,
           c.decided_by as corrected_by, c.decided_at as corrected_at
    from public.audit_round_items ri
    left join public.audit_assignment_items ai on ai.round_item_id = ri.id
    left join public.audit_assignments a on a.id = ai.assignment_id
    left join latest_sub s on s.assignment_id = a.id
    left join public.audit_submission_lines l on l.submission_id = s.id and l.round_item_id = ri.id
    left join corr c on c.round_item_id = ri.id
    where ri.round_id = p_round
  ), calc as (
    select *, counted_qty - system_qty as variance, round((counted_qty - system_qty) * retail_price, 2) as variance_value,
           (not touched or auto_matched) as missing
    from rows
  ), ins as (
    insert into public.audit_compilations (id, round_id, engagement_id, revision, compiled_by, with_missing, missing_assignment_ids,
        item_count, variance_count, variance_value, auditor_notes)
      select v_id, p_round, r.engagement_id, v_rev, auth.uid(), cardinality(v_missing) > 0, v_missing,
             count(*), count(*) filter (where variance <> 0), coalesce(sum(variance_value), 0), v_notes
      from calc
      returning item_count, variance_count, variance_value
  )
  insert into public.audit_compiled_rows (compilation_id, round_item_id, position, company, code, name, system_qty, retail_price,
      counted_qty, variance, variance_value, missing, auto_matched, auditor_id, note, confirmed_same, corrected_by, corrected_at)
    select v_id, round_item_id, position, company, code, name, system_qty, retail_price, counted_qty, variance, variance_value,
           missing, auto_matched, auditor_id, note, confirmed_same, corrected_by, corrected_at
    from calc;

  select item_count, variance_count, variance_value into v_items, v_var, v_val from public.audit_compilations where id = v_id;

  -- Individual rounds are personal counts against that day's stock; the same product counted on another day or by another
  -- person is not a conflict, so no cross-round conflicts are raised in an individual engagement.
  if v_scope is distinct from 'individual' then
    insert into public.audit_conflicts (compilation_id, engagement_id, company, code, name, a_round_id, a_round_item_id, a_qty, a_auditor_id,
        b_round_id, b_round_item_id, b_qty, b_auditor_id)
      select v_id, r.engagement_id, mine.company, mine.code, mine.name, p_round, mine.round_item_id, mine.counted_qty, mine.auditor_id,
             oc.round_id, o.round_item_id, o.counted_qty, o.auditor_id
      from (select distinct on (company, code) * from public.audit_compiled_rows
              where compilation_id = v_id and not missing and code <> '' order by company, code, position desc) mine
      join (select distinct on (c.round_id) c.id, c.round_id from public.audit_compilations c
              join public.audit_rounds rr on rr.id = c.round_id
              where c.engagement_id = r.engagement_id and c.round_id <> p_round and rr.state in ('compiled', 'final')
              order by c.round_id, c.revision desc) oc on true
      join public.audit_compiled_rows o on o.compilation_id = oc.id and not o.missing and o.code <> ''
           and o.company = mine.company and o.code = mine.code and o.counted_qty <> mine.counted_qty;
    get diagnostics v_conf = row_count;
  end if;

  update public.audit_rounds set state = 'compiled', compiled_at = now(), version = version + 1
    where id = p_round returning version into v_ver;
  perform public.log_activity(case when v_rev > 1 then 'audit.recompiled' else 'audit.compiled' end, 'audit_rounds', p_round::text, null,
    jsonb_build_object('revision', v_rev, 'items', v_items, 'variances', v_var, 'with_missing', cardinality(v_missing) > 0, 'conflicts', v_conf), null);
  return jsonb_build_object('compilation_id', v_id, 'revision', v_rev, 'items', v_items, 'variances', v_var,
    'variance_value', v_val, 'with_missing', cardinality(v_missing) > 0, 'missing_assignments', to_jsonb(v_missing),
    'conflicts', v_conf, 'version', v_ver);
end $$;

-- ───────── 2. public compile (permission check, then the core) ─────────
create or replace function public.audit_compile_round(p_round uuid, p_allow_missing boolean default false, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.audit_require('audit.compile');
  return public.audit_compile_round_core(p_round, p_allow_missing, p_expected_version);
end $$;

-- ───────── 3. submit ─────────
create or replace function public.audit_submit(p_assignment uuid, p_extra_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; v_state text; v_rev int; v_id uuid; v_lines int; v_prev uuid; v_comp jsonb;
begin
  perform public.audit_require('audit.count');
  select * into a from public.audit_assignments where id = p_assignment for update;
  if not found or a.auditor_id <> auth.uid() then raise exception 'assignment not found' using errcode = '42501', hint = 'not_allowed'; end if;
  if a.status = 'revoked' then raise exception 'the assignment was revoked' using errcode = '55000', hint = 'assignment_revoked'; end if;
  if a.status = 'submitted' then
    select id, revision into v_id, v_rev from public.audit_submissions where assignment_id = p_assignment order by revision desc limit 1;
    return jsonb_build_object('submission_id', v_id, 'revision', v_rev, 'replay', true);
  end if;
  select state into v_state from public.audit_rounds where id = a.round_id;
  if v_state <> 'counting' then raise exception 'the round is not open for counting' using errcode = '55000', hint = 'round_not_counting'; end if;

  select coalesce(max(revision), 0) + 1 into v_rev from public.audit_submissions where assignment_id = p_assignment;
  insert into public.audit_submissions (assignment_id, round_id, engagement_id, revision, submitted_by, extra_note)
    values (p_assignment, a.round_id, a.engagement_id, v_rev, auth.uid(), left(coalesce(p_extra_note, ''), 2000))
    returning id into v_id;
  insert into public.audit_submission_lines (submission_id, round_item_id, qty, auto_matched, note, confirmed_same, row_seconds)
    select v_id, l.round_item_id, l.qty, l.auto_matched, l.note, l.confirmed_same, t.secs
    from (select distinct on (e.round_item_id) e.* from public.audit_count_events e
          where e.assignment_id = p_assignment order by e.round_item_id, e.seq desc) l
    join (select round_item_id, sum(row_seconds)::int secs from public.audit_count_events where assignment_id = p_assignment group by 1) t
      on t.round_item_id = l.round_item_id;
  get diagnostics v_lines = row_count;
  update public.audit_assignments set status = 'submitted', updated_at = now() where id = p_assignment;
  perform public.log_activity('audit.submitted', 'audit_assignments', p_assignment::text, null,
    jsonb_build_object('revision', v_rev, 'lines', v_lines), null);
  -- An Individual Audit compiles itself the moment it is submitted, so the person can start the next one without waiting.
  -- Everything else (corrections, review, finalize) stays with the main auditor.
  if a.method = 'individual-self-pick' then
    v_comp := public.audit_compile_round_core(a.round_id, false, null);
  end if;
  return jsonb_build_object('submission_id', v_id, 'revision', v_rev, 'lines', v_lines, 'replay', false,
    'compiled', v_comp is not null, 'compilation_id', v_comp ->> 'compilation_id');
end $$;

-- ───────── 4. reopen ─────────
create or replace function public.audit_reopen(p_assignment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; r public.audit_rounds;
begin
  perform public.audit_require('audit.reopen');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into a from public.audit_assignments where id = p_assignment for update;
  if not found then raise exception 'assignment not found' using errcode = '22023', hint = 'assignment_not_found'; end if;
  select * into r from public.audit_rounds where id = a.round_id for update;
  if r.state = 'final' then raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final'; end if;
  if a.status <> 'submitted' then raise exception 'only a submitted assignment can be reopened' using errcode = '55000', hint = 'assignment_not_submitted'; end if;
  if a.method = 'individual-self-pick' and exists (select 1 from public.audit_assignments x where x.auditor_id = a.auditor_id
      and x.method = 'individual-self-pick' and x.status in ('assigned', 'counting') and x.id <> a.id) then
    raise exception 'that person already has another Individual Audit open' using errcode = '55000', hint = 'self_pick_open';
  end if;
  update public.audit_assignments set status = 'counting', updated_at = now() where id = p_assignment;
  if r.state = 'compiled' then
    update public.audit_rounds set state = 'counting', version = version + 1 where id = r.id;
  else
    update public.audit_rounds set version = version + 1 where id = r.id;
  end if;
  perform public.log_activity('audit.reopened', 'audit_assignments', p_assignment::text, jsonb_build_object('status', 'submitted'),
    jsonb_build_object('round_state', case when r.state = 'compiled' then 'counting' else r.state end), btrim(p_reason));
  return jsonb_build_object('status', 'counting', 'round_state', case when r.state = 'compiled' then 'counting' else r.state end);
end $$;

-- ───────── 5. owner alert ─────────
create or replace function public.audit_alert_compiled() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.audit_engagements e where e.id = new.engagement_id and e.scope_type = 'individual') then
    return null;
  end if;
  perform public.notify_owner('audit.compiled', jsonb_build_object('dedupe_key', 'audit.compiled:' || new.round_id::text));
  return null;
end $$;

-- ───────── 6. grants ─────────
revoke all on function public.audit_compile_round_core(uuid, boolean, int) from public, anon, authenticated;
revoke all on function public.audit_compile_round(uuid, boolean, int), public.audit_submit(uuid, text), public.audit_reopen(uuid, text),
  public.audit_alert_compiled() from public, anon, authenticated;
grant execute on function public.audit_compile_round(uuid, boolean, int), public.audit_submit(uuid, text), public.audit_reopen(uuid, text) to authenticated;

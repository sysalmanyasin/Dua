-- 0407_audit_review_followup — Audit slice B1: review, corrections, conflicts, Force Submit and follow-up rounds.
-- Compile and reopen already exist (0402). This adds what the owner does with a compiled round:
--   * corrections: proposed with a reason, approved or rejected; the original count is always kept and an approved
--     correction takes effect at the next compile (R6)
--   * conflicts between rounds are never settled by the system; the owner picks a side and the choice is recorded (R5);
--     a choice carries over when the round is compiled again and the two counts have not changed
--   * Force Submit: the owner submits for a counter who has not (R1, R3), as counted or by marking the rest as matching
--   * follow-up rounds (1A, 1B, ...): differences only, a whole company, or a random sample drawn from a stored seed (R4, R15).
--     Items, system quantities and prices are carried from the compiled round, so a follow-up never depends on Inventory
--   * one read function that gives the review screen names and counts in a single call

alter table public.audit_corrections add column decision_note text not null default '';
alter table public.audit_submissions add column forced boolean not null default false, add column forced_reason text not null default '';
alter table public.audit_rounds
  add column next_mode text check (next_mode in ('differences', 'company', 'spot')),
  add column spot_seed text,
  add column spot_size int check (spot_size is null or spot_size between 1 and 1000);

-- A person's display name for the screens (staff name, else username).
create function public.audit_person_name(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(s.full_name, pr.username) from public.profiles pr left join public.staff s on s.id = pr.staff_id where pr.user_id = p_user
$$;

-- ───────── corrections ─────────
create function public.audit_correction_propose(p_round uuid, p_item uuid, p_qty numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_id uuid;
begin
  perform public.audit_require('audit.suggest');
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_view(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if r.state <> 'compiled' then raise exception 'the round is not compiled' using errcode = '55000', hint = 'round_not_compiled'; end if;
  if not exists (select 1 from public.audit_round_items where id = p_item and round_id = p_round) then
    raise exception 'that item is not in this round' using errcode = '22023', hint = 'item_not_in_round';
  end if;
  if p_qty is null or p_qty < 0 or p_qty > 999999999 then raise exception 'the quantity is not valid' using errcode = '22023', hint = 'invalid_qty'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  if exists (select 1 from public.audit_corrections where round_item_id = p_item and status = 'proposed') then
    raise exception 'a correction for this item is already waiting' using errcode = '55000', hint = 'correction_pending';
  end if;
  insert into public.audit_corrections (round_id, engagement_id, round_item_id, counted_qty, proposed_by, reason)
    values (p_round, r.engagement_id, p_item, p_qty, auth.uid(), left(btrim(p_reason), 500)) returning id into v_id;
  perform public.log_activity('audit.correction_proposed', 'audit_corrections', v_id::text, null,
    jsonb_build_object('round', p_round, 'item', p_item, 'qty', p_qty), btrim(p_reason));
  return v_id;
end $$;

create function public.audit_correction_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.audit_corrections; v_state text; v_status text;
begin
  perform public.audit_require('audit.review');
  select * into c from public.audit_corrections where id = p_id for update;
  if not found then raise exception 'correction not found' using errcode = '22023', hint = 'correction_not_found'; end if;
  if c.status <> 'proposed' then raise exception 'that correction was already decided' using errcode = '55000', hint = 'correction_decided'; end if;
  select state into v_state from public.audit_rounds where id = c.round_id;
  if v_state = 'final' then raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final'; end if;
  if p_approve is null then raise exception 'approve or reject' using errcode = '22023', hint = 'invalid_decision'; end if;
  if not p_approve and (p_note is null or length(btrim(p_note)) < 3) then
    raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required';
  end if;
  v_status := case when p_approve then 'approved' else 'rejected' end;
  update public.audit_corrections set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = left(coalesce(btrim(p_note), ''), 500)
    where id = p_id;
  perform public.log_activity('audit.correction_' || v_status, 'audit_corrections', p_id::text, jsonb_build_object('status', 'proposed'),
    jsonb_build_object('status', v_status), nullif(btrim(coalesce(p_note, '')), ''));
  return jsonb_build_object('status', v_status, 'applies_at_next_compile', p_approve);
end $$;

-- ───────── conflicts ─────────
-- A resolved choice is copied onto an identical conflict found again at the next compile (same two rounds, same two counts),
-- in either direction, so recompiling never makes the owner decide the same thing twice.
create function public.audit_conflicts_carry() returns trigger language plpgsql set search_path = public as $$
declare p public.audit_conflicts; v_flip boolean := false;
begin
  select * into p from public.audit_conflicts x
    where x.engagement_id = new.engagement_id and x.company = new.company and x.code = new.code and x.resolved_side is not null
      and x.a_round_id = new.a_round_id and x.b_round_id = new.b_round_id and x.a_qty = new.a_qty and x.b_qty = new.b_qty
    order by x.resolved_at desc limit 1;
  if not found then
    select * into p from public.audit_conflicts x
      where x.engagement_id = new.engagement_id and x.company = new.company and x.code = new.code and x.resolved_side is not null
        and x.a_round_id = new.b_round_id and x.b_round_id = new.a_round_id and x.a_qty = new.b_qty and x.b_qty = new.a_qty
      order by x.resolved_at desc limit 1;
    v_flip := found;
    if not found then return new; end if;
  end if;
  new.resolved_side := case when v_flip then (case p.resolved_side when 'a' then 'b' else 'a' end) else p.resolved_side end;
  new.resolved_by := p.resolved_by;
  new.resolved_at := p.resolved_at;
  new.resolved_reason := p.resolved_reason;
  return new;
end $$;
create trigger audit_conflicts_carry before insert on public.audit_conflicts for each row execute function public.audit_conflicts_carry();

create function public.audit_conflict_resolve(p_conflict uuid, p_side text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.audit_conflicts;
begin
  perform public.audit_require('audit.review');
  if p_side is null or p_side not in ('a', 'b') then raise exception 'choose side a or b' using errcode = '22023', hint = 'invalid_side'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into c from public.audit_conflicts where id = p_conflict for update;
  if not found then raise exception 'conflict not found' using errcode = '22023', hint = 'conflict_not_found'; end if;
  if c.resolved_side is not null then raise exception 'that conflict is already settled' using errcode = '55000', hint = 'conflict_resolved'; end if;
  if exists (select 1 from public.audit_rounds where id in (c.a_round_id, c.b_round_id) and state = 'final') then
    raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final';
  end if;
  update public.audit_conflicts set resolved_side = p_side, resolved_by = auth.uid(), resolved_at = now(), resolved_reason = left(btrim(p_reason), 500)
    where id = p_conflict;
  perform public.log_activity('audit.conflict_resolved', 'audit_conflicts', p_conflict::text, null,
    jsonb_build_object('side', p_side, 'company', c.company, 'code', c.code), btrim(p_reason));
end $$;

-- ───────── Force Submit ─────────
-- p_mode 'as_counted': submit what the counter has counted; every other item stays uncounted (a shortage, R1).
-- p_mode 'match': also record every uncounted item as matching the system quantity; those rows stay marked auto-matched.
create function public.audit_force_submit(p_assignment uuid, p_mode text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; v_state text; v_rev int; v_id uuid; v_lines int; v_added int := 0;
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
  return jsonb_build_object('submission_id', v_id, 'revision', v_rev, 'counted', v_lines, 'matched', v_added);
end $$;

-- ───────── follow-up rounds ─────────
-- Makes the next lettered round (1A, 1B, ...) from the newest compilation of a compiled round.
--   'differences': items whose count differs from the system quantity (an uncounted item is a difference)
--   'company': every item of every company that has at least one difference
--   'spot': p_sample items drawn at random from the whole round; the seed is stored, so the same seed gives the same draw
-- The new round starts as a draft with its items; assigning and locking use the same functions as any round.
create function public.audit_round_next(p_key uuid, p_base_round uuid, p_mode text, p_sample int default null, p_seed text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.audit_rounds; v_id uuid; v_owner uuid; v_comp uuid; v_max text; v_suffix text; v_seed text; v_n int; v_status text;
begin
  perform public.audit_require('audit.compile');
  if p_key is null then raise exception 'a key is required' using errcode = '22023', hint = 'key_required'; end if;
  select id, created_by into v_id, v_owner from public.audit_rounds where idempotency_key = p_key;
  if found then
    if v_owner = auth.uid() then
      return jsonb_build_object('round_id', v_id, 'replay', true);
    end if;
    raise exception 'this key belongs to someone else' using errcode = '42501', hint = 'key_in_use';
  end if;
  if p_mode is null or p_mode not in ('differences', 'company', 'spot') then raise exception 'invalid mode' using errcode = '22023', hint = 'invalid_mode'; end if;
  if p_mode = 'spot' and (p_sample is null or p_sample < 1 or p_sample > 1000) then
    raise exception 'the sample size must be 1 to 1000' using errcode = '22023', hint = 'invalid_sample';
  end if;
  select * into b from public.audit_rounds where id = p_base_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if b.state <> 'compiled' then raise exception 'the round is not compiled' using errcode = '55000', hint = 'round_not_compiled'; end if;
  select status into v_status from public.audit_engagements where id = b.engagement_id;
  if v_status <> 'open' then raise exception 'the engagement is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;
  select id into v_comp from public.audit_compilations where round_id = p_base_round order by revision desc limit 1;

  select coalesce(max(round_suffix), '') into v_max from public.audit_rounds
    where engagement_id = b.engagement_id and round_number = b.round_number and round_suffix is not null;
  if v_max = 'Z' then raise exception 'no more lettered rounds' using errcode = '55000', hint = 'suffix_exhausted'; end if;
  v_suffix := case when v_max = '' then 'A' else chr(ascii(v_max) + 1) end;
  v_seed := case when p_mode = 'spot' then coalesce(nullif(btrim(p_seed), ''), md5(random()::text || clock_timestamp()::text)) end;

  insert into public.audit_rounds (engagement_id, round_number, round_suffix, unit, base_round_id, created_by, idempotency_key, next_mode, spot_seed, spot_size)
    values (b.engagement_id, b.round_number, v_suffix, b.unit, p_base_round, auth.uid(), p_key, p_mode, v_seed, case when p_mode = 'spot' then p_sample end)
    returning id into v_id;

  insert into public.audit_round_items (round_id, engagement_id, position, code, company, name, system_qty, retail_price, prev_variance, source_item_id)
    select v_id, b.engagement_id, row_number() over (order by cr.company, cr.code, cr.name, cr.position), cr.code, cr.company, cr.name,
           cr.system_qty, cr.retail_price, cr.variance, cr.round_item_id
    from public.audit_compiled_rows cr
    where cr.compilation_id = v_comp
      and case p_mode
            when 'differences' then cr.variance <> 0
            when 'company' then cr.company in (select x.company from public.audit_compiled_rows x where x.compilation_id = v_comp and x.variance <> 0)
            else cr.round_item_id in (select y.round_item_id from public.audit_compiled_rows y where y.compilation_id = v_comp
                                      order by md5(v_seed || y.round_item_id::text) limit p_sample)
          end;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'there is nothing to count again' using errcode = '22023', hint = 'no_items'; end if;

  perform public.log_activity('audit.round_next', 'audit_rounds', v_id::text, null,
    jsonb_build_object('base', p_base_round, 'mode', p_mode, 'suffix', v_suffix, 'items', v_n, 'seed', v_seed), null);
  return jsonb_build_object('round_id', v_id, 'round_number', b.round_number, 'round_suffix', v_suffix, 'items', v_n,
    'seed', v_seed, 'replay', false);
end $$;

-- ───────── one read for the review screen ─────────
create function public.audit_compile_overview(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.audit_rounds; v_comp public.audit_compilations;
begin
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_see_results(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  select * into v_comp from public.audit_compilations where round_id = p_round order by revision desc limit 1;
  return jsonb_build_object(
    'round', jsonb_build_object('id', r.id, 'engagement_id', r.engagement_id, 'round_number', r.round_number, 'round_suffix', r.round_suffix,
      'unit', r.unit, 'state', r.state, 'version', r.version, 'base_round_id', r.base_round_id, 'next_mode', r.next_mode,
      'spot_size', r.spot_size, 'items', (select count(*) from public.audit_round_items i where i.round_id = r.id)),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'auditor_id', a.auditor_id, 'name', public.audit_person_name(a.auditor_id),
        'status', a.status,
        'items', (select count(*) from public.audit_assignment_items ai where ai.assignment_id = a.id),
        'counted', (select count(distinct ev.round_item_id) from public.audit_count_events ev where ev.assignment_id = a.id),
        'revisions', (select count(*) from public.audit_submissions s where s.assignment_id = a.id),
        'forced', coalesce((select s.forced from public.audit_submissions s where s.assignment_id = a.id order by s.revision desc limit 1), false))
        order by public.audit_person_name(a.auditor_id), a.id), '[]'::jsonb)
      from public.audit_assignments a where a.round_id = p_round and a.status <> 'revoked'),
    'compilation', case when v_comp.id is null then null else jsonb_build_object('id', v_comp.id, 'revision', v_comp.revision,
      'compiled_at', v_comp.compiled_at, 'with_missing', v_comp.with_missing, 'missing_assignment_ids', to_jsonb(v_comp.missing_assignment_ids),
      'item_count', v_comp.item_count, 'variance_count', v_comp.variance_count, 'variance_value', v_comp.variance_value,
      'auditor_notes', v_comp.auditor_notes) end,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('revision', c.revision, 'compiled_at', c.compiled_at, 'with_missing', c.with_missing,
        'variance_count', c.variance_count, 'variance_value', c.variance_value) order by c.revision desc), '[]'::jsonb)
      from (select * from public.audit_compilations where round_id = p_round order by revision desc limit 20) c),
    'conflicts', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'company', k.company, 'code', k.code, 'name', k.name,
        'a_round', ra.round_number::text || coalesce(ra.round_suffix, ''), 'a_qty', k.a_qty, 'a_name', public.audit_person_name(k.a_auditor_id),
        'b_round', rb.round_number::text || coalesce(rb.round_suffix, ''), 'b_qty', k.b_qty, 'b_name', public.audit_person_name(k.b_auditor_id),
        'resolved_side', k.resolved_side, 'resolved_reason', k.resolved_reason, 'resolved_by', public.audit_person_name(k.resolved_by),
        'resolved_at', k.resolved_at) order by k.company, k.code)
      from public.audit_conflicts k join public.audit_rounds ra on ra.id = k.a_round_id join public.audit_rounds rb on rb.id = k.b_round_id
      where k.compilation_id = v_comp.id), '[]'::jsonb),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'round_item_id', c.round_item_id, 'code', ri.code, 'name', ri.name,
        'company', ri.company, 'system_qty', ri.system_qty, 'counted_qty', c.counted_qty, 'status', c.status, 'reason', c.reason,
        'decision_note', c.decision_note, 'proposed_by', public.audit_person_name(c.proposed_by), 'proposed_at', c.proposed_at,
        'decided_by', public.audit_person_name(c.decided_by), 'decided_at', c.decided_at) order by c.proposed_at desc), '[]'::jsonb)
      from public.audit_corrections c join public.audit_round_items ri on ri.id = c.round_item_id where c.round_id = p_round));
end $$;

revoke all on function public.audit_person_name(uuid), public.audit_conflicts_carry() from public, anon, authenticated;
revoke all on function public.audit_correction_propose(uuid, uuid, numeric, text), public.audit_correction_decide(uuid, boolean, text),
  public.audit_conflict_resolve(uuid, text, text), public.audit_force_submit(uuid, text, text),
  public.audit_round_next(uuid, uuid, text, int, text), public.audit_compile_overview(uuid) from public, anon, authenticated;
grant execute on function public.audit_correction_propose(uuid, uuid, numeric, text), public.audit_correction_decide(uuid, boolean, text),
  public.audit_conflict_resolve(uuid, text, text), public.audit_force_submit(uuid, text, text),
  public.audit_round_next(uuid, uuid, text, int, text), public.audit_compile_overview(uuid) to authenticated;

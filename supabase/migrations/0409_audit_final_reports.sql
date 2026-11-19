-- 0409_audit_final_reports: Audit module, slice B2. Brief: docs/modules/audit.md (section 4, 9).
--  * audit_finals / audit_final_lines: the immutable Final Snapshot of a round (compiled -> final)
--  * audit_finalize: owner only (audit.finalize). Refuses while a conflict is unsettled, a correction is waiting,
--    or the compilation is older than the newest submission / approved correction. A settled conflict decides the
--    quantity of that row; the original counted quantity stays on the same line.
--  * read functions for the report screens: final overview, final lines (paged), engagement report, audit trail
--  * owner alerts through notify_owner (submitted, compiled, conflict, finalized). Alerts carry no names or amounts.

-- ───────── 1. tables ─────────
create table public.audit_finals (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null unique references public.audit_rounds (id),
  engagement_id uuid not null references public.audit_engagements (id),
  compilation_id uuid not null references public.audit_compilations (id),
  finalized_by uuid not null references auth.users (id),
  finalized_at timestamptz not null default now(),
  note text not null default '' check (length(note) <= 500),
  with_missing boolean not null default false,
  item_count int not null,
  variance_count int not null,
  variance_value numeric(14, 2) not null,
  missing_count int not null,
  conflict_count int not null,
  conflict_changed int not null
);
alter table public.audit_finals enable row level security;
create index audit_finals_engagement on public.audit_finals (engagement_id);

create table public.audit_final_lines (
  final_id uuid not null references public.audit_finals (id),
  round_item_id uuid not null references public.audit_round_items (id),
  position int not null,
  company text not null,
  code text not null,
  name text not null,
  system_qty numeric not null,
  retail_price numeric(14, 2) not null,
  counted_qty numeric(12, 3) not null,     -- what the compile held (original count or approved correction)
  final_qty numeric(12, 3) not null,       -- counted_qty, or the side chosen for a settled conflict
  variance numeric not null,
  variance_value numeric(14, 2) not null,
  missing boolean not null,
  auto_matched boolean not null,
  auditor_id uuid references auth.users (id),
  note text not null default '',
  conflict_id uuid references public.audit_conflicts (id),
  conflict_side text check (conflict_side in ('a', 'b')),
  primary key (final_id, round_item_id)
);
alter table public.audit_final_lines enable row level security;
create index audit_final_lines_code on public.audit_final_lines (company, code);

create trigger audit_finals_append_only before update or delete on public.audit_finals
  for each row execute function public.audit_append_only();
create trigger audit_final_lines_append_only before update or delete on public.audit_final_lines
  for each row execute function public.audit_append_only();

create policy audit_finals_read on public.audit_finals for select to authenticated
  using (public.audit_can_see_results(engagement_id));
create policy audit_final_lines_read on public.audit_final_lines for select to authenticated
  using (exists (select 1 from public.audit_finals f where f.id = final_id and public.audit_can_see_results(f.engagement_id)));
grant select on public.audit_finals, public.audit_final_lines to authenticated;

-- ───────── 2. finalize ─────────
create function public.audit_finalize(p_round uuid, p_expected_version int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; c public.audit_compilations; v_id uuid; v_ver int;
        v_items int; v_var int; v_val numeric; v_missing int; v_conf int; v_changed int;
begin
  perform public.audit_require('audit.finalize');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if r.state = 'final' then raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  select * into c from public.audit_compilations where round_id = p_round order by revision desc limit 1;
  if r.state <> 'compiled' or c.id is null then
    raise exception 'the round is not compiled' using errcode = '55000', hint = 'round_not_compiled';
  end if;
  if exists (select 1 from public.audit_submissions s where s.round_id = p_round and s.submitted_at > c.compiled_at)
     or exists (select 1 from public.audit_corrections k where k.round_id = p_round and k.status = 'approved' and k.decided_at > c.compiled_at) then
    raise exception 'the compilation is older than the latest count or correction' using errcode = '55000', hint = 'compile_stale';
  end if;
  if exists (select 1 from public.audit_corrections k where k.round_id = p_round and k.status = 'proposed') then
    raise exception 'a correction is still waiting for a decision' using errcode = '55000', hint = 'corrections_pending';
  end if;
  if exists (select 1 from public.audit_conflicts k where k.compilation_id = c.id and k.resolved_side is null) then
    raise exception 'a conflict is still unsettled' using errcode = '55000', hint = 'conflicts_unresolved';
  end if;

  v_id := gen_random_uuid();
  -- one statement: the header (with its totals) and the lines are written together, because both are append-only
  with calc as (
    select cr.round_item_id, cr.position, cr.company, cr.code, cr.name, cr.system_qty, cr.retail_price, cr.counted_qty,
           coalesce(case k.resolved_side when 'a' then k.a_qty when 'b' then k.b_qty end, cr.counted_qty) as final_qty,
           cr.missing, cr.auto_matched, cr.auditor_id, cr.note, k.id as conflict_id, k.resolved_side
    from public.audit_compiled_rows cr
    left join lateral (select * from public.audit_conflicts x where x.compilation_id = c.id and x.a_round_item_id = cr.round_item_id
                       order by x.resolved_at desc nulls last, x.id limit 1) k on true
    where cr.compilation_id = c.id
  ), lines as (
    select *, final_qty - system_qty as variance, round((final_qty - system_qty) * retail_price, 2) as variance_value from calc
  ), hdr as (
    insert into public.audit_finals (id, round_id, engagement_id, compilation_id, finalized_by, note, with_missing,
        item_count, variance_count, variance_value, missing_count, conflict_count, conflict_changed)
      select v_id, p_round, r.engagement_id, c.id, auth.uid(), left(coalesce(btrim(p_note), ''), 500), c.with_missing,
             count(*), count(*) filter (where variance <> 0), coalesce(sum(variance_value), 0), count(*) filter (where missing),
             count(*) filter (where conflict_id is not null), count(*) filter (where resolved_side = 'b' and final_qty <> counted_qty)
      from lines
      returning item_count, variance_count, variance_value, missing_count, conflict_count, conflict_changed
  )
  insert into public.audit_final_lines (final_id, round_item_id, position, company, code, name, system_qty, retail_price, counted_qty,
      final_qty, variance, variance_value, missing, auto_matched, auditor_id, note, conflict_id, conflict_side)
    select v_id, round_item_id, position, company, code, name, system_qty, retail_price, counted_qty, final_qty, variance,
           variance_value, missing, auto_matched, auditor_id, note, conflict_id, resolved_side
    from lines;

  select item_count, variance_count, variance_value, missing_count, conflict_count, conflict_changed
    into v_items, v_var, v_val, v_missing, v_conf, v_changed from public.audit_finals where id = v_id;

  update public.audit_rounds set state = 'final', finalized_at = now(), version = version + 1
    where id = p_round returning version into v_ver;
  perform public.log_activity('audit.finalized', 'audit_rounds', p_round::text, null,
    jsonb_build_object('final_id', v_id, 'compilation_revision', c.revision, 'items', v_items, 'variances', v_var,
      'variance_value', v_val, 'with_missing', c.with_missing, 'conflicts', v_conf, 'conflicts_changed', v_changed), nullif(btrim(coalesce(p_note, '')), ''));
  perform public.notify_owner('audit.finalized', jsonb_build_object('dedupe_key', 'audit.finalized:' || p_round::text));
  return jsonb_build_object('final_id', v_id, 'items', v_items, 'variances', v_var, 'variance_value', v_val,
    'missing', v_missing, 'conflicts', v_conf, 'conflicts_changed', v_changed, 'version', v_ver);
end $$;

-- ───────── 2b. conflict choices against an earlier final round ─────────
-- 0407 refused to settle a conflict when either round was final. A conflict is always raised by the round being compiled
-- (side a) against an earlier one (side b), and the earlier one is often already final, so it could never be settled.
-- Only the round that owns the conflict (side a) blocks a change once it is final. Everything else is as in 0407.
create or replace function public.audit_conflict_resolve(p_conflict uuid, p_side text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.audit_conflicts;
begin
  perform public.audit_require('audit.review');
  if p_side is null or p_side not in ('a', 'b') then raise exception 'choose side a or b' using errcode = '22023', hint = 'invalid_side'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into c from public.audit_conflicts where id = p_conflict for update;
  if not found then raise exception 'conflict not found' using errcode = '22023', hint = 'conflict_not_found'; end if;
  if c.resolved_side is not null then raise exception 'that conflict is already settled' using errcode = '55000', hint = 'conflict_resolved'; end if;
  if exists (select 1 from public.audit_rounds where id = c.a_round_id and state = 'final') then
    raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final';
  end if;
  update public.audit_conflicts set resolved_side = p_side, resolved_by = auth.uid(), resolved_at = now(), resolved_reason = left(btrim(p_reason), 500)
    where id = p_conflict;
  perform public.log_activity('audit.conflict_resolved', 'audit_conflicts', p_conflict::text, null,
    jsonb_build_object('side', p_side, 'company', c.company, 'code', c.code), btrim(p_reason));
end $$;
revoke all on function public.audit_conflict_resolve(uuid, text, text) from public, anon, authenticated;
grant execute on function public.audit_conflict_resolve(uuid, text, text) to authenticated;

-- ───────── 3. reads for the report screens ─────────
-- Round label as shown to people: 1, 1A, 2 ...
create function public.audit_round_label(p_number int, p_suffix text) returns text language sql immutable set search_path = public as $$
  select p_number::text || coalesce(p_suffix, '')
$$;

create function public.audit_final_overview(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.audit_rounds; f public.audit_finals;
begin
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_see_results(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  select * into f from public.audit_finals where round_id = p_round;
  if not found then raise exception 'there is no final snapshot yet' using errcode = '22023', hint = 'final_not_found'; end if;
  return jsonb_build_object(
    'round', jsonb_build_object('id', r.id, 'engagement_id', r.engagement_id, 'label', public.audit_round_label(r.round_number, r.round_suffix),
      'unit', r.unit, 'state', r.state, 'version', r.version),
    'engagement', (select jsonb_build_object('id', e.id, 'name', e.name, 'scope_type', e.scope_type) from public.audit_engagements e where e.id = r.engagement_id),
    'final', jsonb_build_object('id', f.id, 'finalized_at', f.finalized_at, 'finalized_by', public.audit_person_name(f.finalized_by), 'note', f.note,
      'with_missing', f.with_missing, 'item_count', f.item_count, 'variance_count', f.variance_count, 'variance_value', f.variance_value,
      'missing_count', f.missing_count, 'conflict_count', f.conflict_count, 'conflict_changed', f.conflict_changed,
      'compilation_revision', (select c.revision from public.audit_compilations c where c.id = f.compilation_id)),
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('company', t.company, 'items', t.items, 'variance_count', t.variance_count,
        'shortage_value', t.shortage_value, 'excess_value', t.excess_value, 'variance_value', t.variance_value) order by t.company), '[]'::jsonb)
      from (select company, count(*) as items, count(*) filter (where variance <> 0) as variance_count,
                   coalesce(sum(variance_value) filter (where variance_value < 0), 0) as shortage_value,
                   coalesce(sum(variance_value) filter (where variance_value > 0), 0) as excess_value,
                   coalesce(sum(variance_value), 0) as variance_value
            from public.audit_final_lines where final_id = f.id group by company) t),
    'conflicts', (select coalesce(jsonb_agg(jsonb_build_object('company', l.company, 'code', l.code, 'name', l.name, 'side', l.conflict_side,
        'counted_qty', l.counted_qty, 'final_qty', l.final_qty, 'reason', k.resolved_reason, 'by', public.audit_person_name(k.resolved_by),
        'at', k.resolved_at) order by l.company, l.code), '[]'::jsonb)
      from public.audit_final_lines l join public.audit_conflicts k on k.id = l.conflict_id where l.final_id = f.id),
    'auditor_notes', (select c.auditor_notes from public.audit_compilations c where c.id = f.compilation_id));
end $$;

-- Lines of a Final Snapshot, paged. p_only_variance keeps only the rows whose final count differs from the system.
create function public.audit_final_lines_page(p_round uuid, p_only_variance boolean default false, p_limit int default 500, p_offset int default 0)
returns table (total bigint, round_item_id uuid, "position" int, company text, code text, name text, system_qty numeric, retail_price numeric,
  counted_qty numeric, final_qty numeric, variance numeric, variance_value numeric, missing boolean, auto_matched boolean,
  auditor_name text, note text, conflict_side text)
language plpgsql stable security definer set search_path = public as $$
declare r public.audit_rounds; v_final uuid;
begin
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_see_results(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  select id into v_final from public.audit_finals where round_id = p_round;
  if v_final is null then raise exception 'there is no final snapshot yet' using errcode = '22023', hint = 'final_not_found'; end if;
  return query
    select count(*) over (), l.round_item_id, l.position, l.company, l.code, l.name, l.system_qty, l.retail_price, l.counted_qty, l.final_qty,
           l.variance, l.variance_value, l.missing, l.auto_matched, public.audit_person_name(l.auditor_id), l.note, l.conflict_side
    from public.audit_final_lines l
    where l.final_id = v_final and (not coalesce(p_only_variance, false) or l.variance <> 0)
    order by l.company, l.position
    limit least(greatest(coalesce(p_limit, 500), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- One read for the report page of an audit: every round with its newest compilation and, when final, its snapshot totals.
create function public.audit_report_engagement(p_engagement uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.audit_engagements;
begin
  select * into e from public.audit_engagements where id = p_engagement;
  if not found then raise exception 'audit not found' using errcode = '22023', hint = 'engagement_not_found'; end if;
  if not public.audit_can_see_results(p_engagement) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  return jsonb_build_object(
    'engagement', jsonb_build_object('id', e.id, 'name', e.name, 'scope_type', e.scope_type, 'status', e.status, 'created_at', e.created_at),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'label', public.audit_round_label(r.round_number, r.round_suffix), 'unit', r.unit, 'state', r.state,
        'items', (select count(*) from public.audit_round_items i where i.round_id = r.id),
        'people', (select count(*) from public.audit_assignments a where a.round_id = r.id and a.status <> 'revoked'),
        'submissions', (select count(*) from public.audit_submissions s where s.round_id = r.id),
        'forced', (select count(*) from public.audit_submissions s where s.round_id = r.id and s.forced),
        'compilations', (select count(*) from public.audit_compilations c where c.round_id = r.id),
        'variance_count', (select c.variance_count from public.audit_compilations c where c.round_id = r.id order by c.revision desc limit 1),
        'variance_value', (select c.variance_value from public.audit_compilations c where c.round_id = r.id order by c.revision desc limit 1),
        'compiled_at', r.compiled_at, 'finalized_at', r.finalized_at,
        'final_variance_count', (select f.variance_count from public.audit_finals f where f.round_id = r.id),
        'final_variance_value', (select f.variance_value from public.audit_finals f where f.round_id = r.id),
        'final_conflicts_changed', (select f.conflict_changed from public.audit_finals f where f.round_id = r.id))
        order by r.round_number, coalesce(r.round_suffix, '')), '[]'::jsonb)
      from public.audit_rounds r where r.engagement_id = p_engagement),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('name', public.audit_person_name(a.auditor_id),
        'round', public.audit_round_label(r.round_number, r.round_suffix), 'status', a.status,
        'items', (select count(*) from public.audit_assignment_items ai where ai.assignment_id = a.id))
        order by r.round_number, coalesce(r.round_suffix, ''), public.audit_person_name(a.auditor_id)), '[]'::jsonb)
      from public.audit_assignments a join public.audit_rounds r on r.id = a.round_id
      where a.engagement_id = p_engagement and a.status <> 'revoked'));
end $$;

-- The audit trail of one audit: what was done, by whom, when, and the reason given. Newest first; p_before pages backwards.
create function public.audit_trail(p_engagement uuid, p_limit int default 100, p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not exists (select 1 from public.audit_engagements where id = p_engagement) then
    raise exception 'audit not found' using errcode = '22023', hint = 'engagement_not_found';
  end if;
  if not public.audit_can_see_results(p_engagement)
     or not (public.has_perm('audit.report') or public.has_perm('audit.review') or public.has_perm('audit.manage')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  with ids as (
    select p_engagement::text as id
    union all select id::text from public.audit_rounds where engagement_id = p_engagement
    union all select id::text from public.audit_assignments where engagement_id = p_engagement
    union all select id::text from public.audit_conflicts where engagement_id = p_engagement
    union all select id::text from public.audit_corrections where engagement_id = p_engagement
  ), page as (
    select l.* from public.activity_log l
    where l.action like 'audit.%' and l.entity_id in (select id from ids) and (p_before is null or l.id < p_before)
    order by l.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', at, 'action', action, 'actor', public.audit_person_name(user_id),
      'reason', reason, 'detail', new_value) order by id desc), '[]'::jsonb) into v_rows from page;
  return jsonb_build_object('rows', v_rows);
end $$;

-- ───────── 4. owner alerts ─────────
-- Triggers rather than edits to the compile and submit functions, so those stay as they were. One alert per round while the
-- earlier one is unacknowledged (dedupe_key). Payloads carry nothing but the key: no names, no amounts.
create function public.audit_alert_submitted() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_owner('audit.submitted', jsonb_build_object('dedupe_key', 'audit.submitted:' || new.round_id::text));
  return null;
end $$;
create trigger audit_submissions_alert after insert on public.audit_submissions
  for each row execute function public.audit_alert_submitted();

create function public.audit_alert_compiled() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_owner('audit.compiled', jsonb_build_object('dedupe_key', 'audit.compiled:' || new.round_id::text));
  return null;
end $$;
create trigger audit_compilations_alert after insert on public.audit_compilations
  for each row execute function public.audit_alert_compiled();

create function public.audit_alert_conflict() returns trigger language plpgsql security definer set search_path = public as $$
declare v_round uuid;
begin
  select a_round_id into v_round from new_rows where resolved_side is null limit 1;
  if v_round is not null then
    perform public.notify_owner('audit.conflict', jsonb_build_object('dedupe_key', 'audit.conflict:' || v_round::text));
  end if;
  return null;
end $$;
create trigger audit_conflicts_alert after insert on public.audit_conflicts
  referencing new table as new_rows for each statement execute function public.audit_alert_conflict();

-- ───────── 5. grants ─────────
revoke all on function public.audit_alert_submitted(), public.audit_alert_compiled(), public.audit_alert_conflict(),
  public.audit_round_label(int, text) from public, anon, authenticated;
revoke all on function public.audit_finalize(uuid, int, text), public.audit_final_overview(uuid),
  public.audit_final_lines_page(uuid, boolean, int, int), public.audit_report_engagement(uuid), public.audit_trail(uuid, int, bigint)
  from public, anon, authenticated;
grant execute on function public.audit_finalize(uuid, int, text), public.audit_final_overview(uuid),
  public.audit_final_lines_page(uuid, boolean, int, int), public.audit_report_engagement(uuid), public.audit_trail(uuid, int, bigint)
  to authenticated;

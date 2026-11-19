-- 0402_audit_counting_compile — Audit slice A2: count events, submissions, compile (R1–R7, R11–R14).
-- Builds on 0401. Counting is append-only: a count is an event, never an overwrite. A submission freezes the latest
-- count of every touched item into an immutable revision. Compile runs in SQL (R12) and stores an immutable
-- compilation revision; a recompile adds a new revision and keeps the old one. Every refusal carries a machine
-- code in the error HINT. Writes happen only through the functions below; the browser has select access only.

-- ───────── 1. tables ─────────
create table public.audit_count_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  engagement_id uuid not null references public.audit_engagements (id),
  round_id uuid not null references public.audit_rounds (id),
  assignment_id uuid not null references public.audit_assignments (id),
  round_item_id uuid not null references public.audit_round_items (id),
  counter_id uuid not null references auth.users (id),
  client_event_id uuid not null,
  qty numeric(12, 3) not null check (qty >= 0),
  auto_matched boolean not null default false,
  note text not null default '' check (length(note) <= 500),
  confirmed_same boolean not null default false,
  row_seconds int not null default 0 check (row_seconds between 0 and 600), -- R7: at most 600 s per row
  client_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assignment_id, client_event_id) -- replaying a batch changes nothing (R14)
);
alter table public.audit_count_events enable row level security;
create index audit_count_events_item on public.audit_count_events (assignment_id, round_item_id, seq desc);

create table public.audit_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.audit_assignments (id),
  round_id uuid not null references public.audit_rounds (id),
  engagement_id uuid not null references public.audit_engagements (id),
  revision int not null check (revision >= 1),
  submitted_by uuid not null references auth.users (id),
  submitted_at timestamptz not null default now(),
  extra_note text not null default '' check (length(extra_note) <= 2000),
  unique (assignment_id, revision)
);
alter table public.audit_submissions enable row level security;

create table public.audit_submission_lines (
  submission_id uuid not null references public.audit_submissions (id),
  round_item_id uuid not null references public.audit_round_items (id),
  qty numeric(12, 3) not null check (qty >= 0),
  auto_matched boolean not null default false,
  note text not null default '',
  confirmed_same boolean not null default false,
  row_seconds int not null default 0,
  primary key (submission_id, round_item_id)
);
alter table public.audit_submission_lines enable row level security;

-- A correction is proposed, reviewed, then approved or rejected (R6). The functions arrive in slice B1; compile
-- already honours an approved one, and the original count is never touched.
create table public.audit_corrections (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.audit_rounds (id),
  engagement_id uuid not null references public.audit_engagements (id),
  round_item_id uuid not null references public.audit_round_items (id),
  counted_qty numeric(12, 3) not null check (counted_qty >= 0),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  proposed_by uuid not null references auth.users (id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  reason text not null default ''
);
alter table public.audit_corrections enable row level security;
create index audit_corrections_item on public.audit_corrections (round_item_id, status, decided_at desc);

create table public.audit_compilations (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.audit_rounds (id),
  engagement_id uuid not null references public.audit_engagements (id),
  revision int not null check (revision >= 1),
  compiled_by uuid not null references auth.users (id),
  compiled_at timestamptz not null default now(),
  with_missing boolean not null default false, -- R3: an explicit, stored choice
  missing_assignment_ids uuid[] not null default '{}',
  item_count int not null,
  variance_count int not null,
  variance_value numeric(14, 2) not null, -- sum of variance x retail price (R20)
  auditor_notes jsonb not null default '[]'::jsonb,
  unique (round_id, revision)
);
alter table public.audit_compilations enable row level security;

create table public.audit_compiled_rows (
  compilation_id uuid not null references public.audit_compilations (id),
  round_item_id uuid not null references public.audit_round_items (id),
  position int not null,
  company text not null,
  code text not null,
  name text not null,
  system_qty numeric not null,
  retail_price numeric(14, 2) not null,
  counted_qty numeric(12, 3) not null,
  variance numeric not null,
  variance_value numeric(14, 2) not null,
  missing boolean not null,        -- not a verified physical count: untouched, or auto-matched (R1)
  auto_matched boolean not null,
  auditor_id uuid references auth.users (id),
  note text not null default '',
  confirmed_same boolean not null default false,
  corrected_by uuid references auth.users (id),
  corrected_at timestamptz,
  primary key (compilation_id, round_item_id)
);
alter table public.audit_compiled_rows enable row level security;
create index audit_compiled_rows_code on public.audit_compiled_rows (company, code);

-- Cross-round conflicts are detected here and never auto-resolved (R5). Choosing a side is slice B1.
create table public.audit_conflicts (
  id uuid primary key default gen_random_uuid(),
  compilation_id uuid not null references public.audit_compilations (id),
  engagement_id uuid not null references public.audit_engagements (id),
  company text not null,
  code text not null,
  name text not null,
  a_round_id uuid not null references public.audit_rounds (id),
  a_round_item_id uuid not null references public.audit_round_items (id),
  a_qty numeric(12, 3) not null,
  a_auditor_id uuid,
  b_round_id uuid not null references public.audit_rounds (id),
  b_round_item_id uuid not null references public.audit_round_items (id),
  b_qty numeric(12, 3) not null,
  b_auditor_id uuid,
  resolved_side text check (resolved_side in ('a', 'b')),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  resolved_reason text
);
alter table public.audit_conflicts enable row level security;
create index audit_conflicts_compilation on public.audit_conflicts (compilation_id);

-- ───────── 2. immutability ─────────
create function public.audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% rows never change', tg_table_name using errcode = '55000', hint = 'append_only';
end $$;
create trigger audit_count_events_append_only before update or delete on public.audit_count_events
  for each row execute function public.audit_append_only();
create trigger audit_submissions_append_only before update or delete on public.audit_submissions
  for each row execute function public.audit_append_only();
create trigger audit_submission_lines_append_only before update or delete on public.audit_submission_lines
  for each row execute function public.audit_append_only();
create trigger audit_compilations_append_only before update or delete on public.audit_compilations
  for each row execute function public.audit_append_only();
create trigger audit_compiled_rows_append_only before update or delete on public.audit_compiled_rows
  for each row execute function public.audit_append_only();

-- ───────── 3. who may see results (AUD-3, AUD-5, R21) ─────────
-- Results are visible to anyone who can view the engagement, to a member holding audit.review or audit.report, and
-- to a counter for the items of their own assignment.
create function public.audit_can_see_results(p_engagement uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.audit_can_view(p_engagement)
      or ((public.has_perm('audit.review') or public.has_perm('audit.report'))
          and exists (select 1 from public.audit_members m where m.engagement_id = p_engagement and m.user_id = auth.uid()))
$$;

create policy audit_count_events_read on public.audit_count_events for select to authenticated
  using (counter_id = (select auth.uid()) or public.audit_can_see_results(engagement_id));
create policy audit_submissions_read on public.audit_submissions for select to authenticated
  using (submitted_by = (select auth.uid()) or public.audit_can_see_results(engagement_id));
create policy audit_submission_lines_read on public.audit_submission_lines for select to authenticated
  using (exists (select 1 from public.audit_submissions s where s.id = submission_id
                 and (s.submitted_by = (select auth.uid()) or public.audit_can_see_results(s.engagement_id))));
create policy audit_corrections_read on public.audit_corrections for select to authenticated
  using (proposed_by = (select auth.uid()) or public.audit_can_see_results(engagement_id));
create policy audit_compilations_read on public.audit_compilations for select to authenticated
  using (public.audit_can_see_results(engagement_id)
         or exists (select 1 from public.audit_assignments a where a.round_id = audit_compilations.round_id and a.auditor_id = (select auth.uid())));
create policy audit_compiled_rows_read on public.audit_compiled_rows for select to authenticated
  using (exists (select 1 from public.audit_compilations c where c.id = compilation_id and public.audit_can_see_results(c.engagement_id))
         or exists (select 1 from public.audit_assignment_items ai join public.audit_assignments a on a.id = ai.assignment_id
                    where ai.round_item_id = audit_compiled_rows.round_item_id and a.auditor_id = (select auth.uid())));
create policy audit_conflicts_read on public.audit_conflicts for select to authenticated
  using (public.audit_can_see_results(engagement_id));

grant select on public.audit_count_events, public.audit_submissions, public.audit_submission_lines,
  public.audit_corrections, public.audit_compilations, public.audit_compiled_rows, public.audit_conflicts to authenticated;

-- ───────── 4. start counting ─────────
create function public.audit_round_start(p_round uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_ver int;
begin
  perform public.audit_require('audit.manage');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  if r.state <> 'locked' then raise exception 'the round is not locked' using errcode = '55000', hint = 'round_not_locked'; end if;
  update public.audit_rounds set state = 'counting', version = version + 1 where id = p_round returning version into v_ver;
  perform public.log_activity('audit.round_started', 'audit_rounds', p_round::text, null, null, null);
  return jsonb_build_object('state', 'counting', 'version', v_ver);
end $$;

-- ───────── 5. count batch (idempotent) ─────────
-- p_events: [{event_id, item, qty, auto, note, confirmed, row_seconds, at}]. Only the assigned person may count.
-- An auto-match takes the system quantity on the server (R1); a client cannot choose a quantity for it.
-- The whole batch is accepted or refused. Replaying a batch inserts nothing twice.
create function public.audit_count_batch(p_assignment uuid, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; v_state text; e jsonb; v_item uuid; v_eid uuid; v_qty numeric; v_sys numeric;
        v_auto boolean; v_new int := 0; v_dup int := 0; v_rows int;
begin
  perform public.audit_require('audit.count');
  select * into a from public.audit_assignments where id = p_assignment for update;
  if not found or a.auditor_id <> auth.uid() then raise exception 'assignment not found' using errcode = '42501', hint = 'not_allowed'; end if;
  if a.status = 'revoked' then raise exception 'the assignment was revoked' using errcode = '55000', hint = 'assignment_revoked'; end if;
  if a.status = 'submitted' then raise exception 'the assignment is already submitted' using errcode = '55000', hint = 'assignment_submitted'; end if;
  select state into v_state from public.audit_rounds where id = a.round_id;
  if v_state <> 'counting' then raise exception 'the round is not open for counting' using errcode = '55000', hint = 'round_not_counting'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'events must be a list' using errcode = '22023', hint = 'invalid_events'; end if;
  if jsonb_array_length(p_events) > 500 then raise exception 'too many events in one batch' using errcode = '22023', hint = 'batch_too_large'; end if;

  for e in select x from jsonb_array_elements(p_events) x loop
    begin
      v_eid := (e ->> 'event_id')::uuid;
      v_item := (e ->> 'item')::uuid;
    exception when others then
      raise exception 'an event has a bad id' using errcode = '22023', hint = 'invalid_events';
    end;
    if v_eid is null or v_item is null then raise exception 'an event has no id' using errcode = '22023', hint = 'invalid_events'; end if;
    select ri.system_qty into v_sys from public.audit_assignment_items ai join public.audit_round_items ri on ri.id = ai.round_item_id
      where ai.assignment_id = p_assignment and ai.round_item_id = v_item;
    if not found then raise exception 'the item is not in this assignment' using errcode = '22023', hint = 'item_not_assigned'; end if;
    v_auto := coalesce((e ->> 'auto')::boolean, false);
    if v_auto then
      v_qty := v_sys;
    else
      begin v_qty := (e ->> 'qty')::numeric; exception when others then v_qty := null; end;
      if v_qty is null or v_qty < 0 or v_qty > 999999999 then raise exception 'the quantity is not valid' using errcode = '22023', hint = 'invalid_qty'; end if;
    end if;
    insert into public.audit_count_events (engagement_id, round_id, assignment_id, round_item_id, counter_id, client_event_id,
        qty, auto_matched, note, confirmed_same, row_seconds, client_at)
      values (a.engagement_id, a.round_id, p_assignment, v_item, auth.uid(), v_eid, v_qty, v_auto,
        left(coalesce(e ->> 'note', ''), 500), coalesce((e ->> 'confirmed')::boolean, false),
        least(greatest(coalesce((e ->> 'row_seconds')::int, 0), 0), 600),
        nullif(e ->> 'at', '')::timestamptz)
      on conflict (assignment_id, client_event_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_new := v_new + 1; else v_dup := v_dup + 1; end if;
  end loop;

  if a.status = 'assigned' then
    update public.audit_assignments set status = 'counting', started_at = coalesce(started_at, now()), updated_at = now() where id = p_assignment;
  end if;
  return jsonb_build_object('accepted', v_new, 'duplicates', v_dup);
end $$;

-- ───────── 6. submit ─────────
-- Freezes the latest count of every touched item into a new immutable revision. Submitting twice is safe.
create function public.audit_submit(p_assignment uuid, p_extra_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; v_state text; v_rev int; v_id uuid; v_lines int; v_prev uuid;
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
  return jsonb_build_object('submission_id', v_id, 'revision', v_rev, 'lines', v_lines, 'replay', false);
end $$;

-- ───────── 7. reopen (owner, with a reason) ─────────
create function public.audit_reopen(p_assignment uuid, p_reason text)
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

-- ───────── 8. compile (R1–R7, R12) ─────────
-- Rule set (the old tests are the spec; see tests/fixtures/audit/compile-cases.json):
--  * every round item gets a row; an item with no count reads as 0 and is flagged missing (R1)
--  * an auto-matched count reads as the system quantity and stays flagged missing (R1)
--  * an approved correction wins over any count, is never an auto-match, and is not missing (R6)
--  * variance = counted - system; value = round(variance x retail price, 2) (R20)
--  * an assignment without a submitted submission is missing; compile needs p_allow_missing then, and stores it (R3)
--  * the latest submission revision of each assignment supplies the counts
--  * a conflict is a row counted differently in another compiled round of the same engagement, matched by company +
--    code, ignoring missing and codeless rows; it is stored, never resolved (R5)
create function public.audit_compile_round(p_round uuid, p_allow_missing boolean default false, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_id uuid := gen_random_uuid(); v_rev int; v_missing uuid[]; v_notes jsonb;
        v_items int; v_var int; v_val numeric; v_conf int; v_ver int;
begin
  perform public.audit_require('audit.compile');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
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

  update public.audit_rounds set state = 'compiled', compiled_at = now(), version = version + 1
    where id = p_round returning version into v_ver;
  perform public.log_activity(case when v_rev > 1 then 'audit.recompiled' else 'audit.compiled' end, 'audit_rounds', p_round::text, null,
    jsonb_build_object('revision', v_rev, 'items', v_items, 'variances', v_var, 'with_missing', cardinality(v_missing) > 0, 'conflicts', v_conf), null);
  return jsonb_build_object('compilation_id', v_id, 'revision', v_rev, 'items', v_items, 'variances', v_var,
    'variance_value', v_val, 'with_missing', cardinality(v_missing) > 0, 'missing_assignments', to_jsonb(v_missing),
    'conflicts', v_conf, 'version', v_ver);
end $$;

-- ───────── 9. grants ─────────
revoke all on function public.audit_append_only(), public.audit_can_see_results(uuid) from public, anon, authenticated;
grant execute on function public.audit_can_see_results(uuid) to authenticated; -- used by the read policies
revoke all on function public.audit_round_start(uuid, int), public.audit_count_batch(uuid, jsonb), public.audit_submit(uuid, text),
  public.audit_reopen(uuid, text), public.audit_compile_round(uuid, boolean, int) from public, anon, authenticated;
grant execute on function public.audit_round_start(uuid, int), public.audit_count_batch(uuid, jsonb), public.audit_submit(uuid, text),
  public.audit_reopen(uuid, text), public.audit_compile_round(uuid, boolean, int) to authenticated;

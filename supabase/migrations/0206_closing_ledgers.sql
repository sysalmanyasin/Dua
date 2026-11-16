-- 0206_closing_ledgers: Session C. Brief: docs/modules/closing.md (section 6 screens, 8.2 / work order section 7 feed).
-- READ-ONLY. Nothing here writes a table, and closing_calc / closing_build_input / closing_write_result are untouched,
-- so no money rule changes.
--   * closing_credit_feed(p_after)  -> Manager's Credit Inbox. Needs credit.view. Lines only, never balances.
--   * closing_credit_ledger(...)    -> Credit Ledger: one snapshot per submitted shift, newest first.
--   * closing_misc_ledger()         -> Misc / Ongoing Ledger: open and closed charges, aged by the stable charge_id (C8).
-- The two ledgers read through row-level security and are allowed only to people who may see every closing
-- (closing.view_all / closing.review / closing.correct), because a ledger built from a cashier's own closings alone would mislead.

-- ── credit feed ──────────────────────────────────────────────────────────────────────────────────
-- One row per credit line (line_id is stable across corrections), as it stands in the LATEST submitted revision of its slot.
--  * a line counts once it has been live (not struck through, amount <> 0) in some submitted or superseded revision
--  * removed = the latest revision no longer has it live (struck, zeroed or dropped); label and amount are then the last live ones
--  * changed_after_first = label or amount differ from the first revision in which it was live
--  * the credit adjustment is a line too (kind 'adjustment', its own stable id), emitted only while it is not zero
--  * the opening closing is excluded: its figures are starting balances, not things that happened at the counter (CLS-10)
--  * p_after filters on the latest revision's submitted_at, so a correction re-emits every line of that closing
--    (a superset of the lines it touched; Manager keeps one filing row per line_id, so a repeat is harmless)
create function public.closing_credit_feed(p_after timestamptz default null)
returns table (
  line_id uuid, business_date date, slot_kind text, slot_seq int, kind text, label text, amount numeric,
  closing_id uuid, revision int, submitted_at timestamptz, changed_after_first boolean, removed boolean, account_id uuid
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('credit.view') then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return query
  with revs as (
    select c.id, c.slot_id, c.revision, c.submitted_at, c.credit_adj, c.credit_adj_line_id,
           s.business_date, s.kind as slot_kind, s.seq as slot_seq
    from public.closings c
    join public.closing_slots s on s.id = c.slot_id
    where c.status in ('submitted', 'superseded') and not c.is_opening
  ),
  lines as (
    select r.id as closing_id, r.slot_id, r.revision, l.line_id, l.kind, l.account_id,
           coalesce(nullif(trim(l.label), ''), a.label, '') as label, l.amount,
           (l.deleted_at is null and l.amount <> 0) as live
    from revs r
    join public.closing_credit_lines l on l.closing_id = r.id
    left join public.closing_credit_accounts a on a.id = l.account_id
    union all
    select r.id, r.slot_id, r.revision, r.credit_adj_line_id, 'adjustment', null::uuid, 'Credit adjustment', r.credit_adj, (r.credit_adj <> 0)
    from revs r
  ),
  latest as (
    select distinct on (slot_id) id, slot_id, revision, submitted_at, business_date, slot_kind, slot_seq
    from revs order by slot_id, revision desc
  ),
  ever as (select distinct l.line_id, l.slot_id from lines l where l.live),
  first_live as (select distinct on (l.line_id) l.line_id, l.label, l.amount from lines l where l.live order by l.line_id, l.revision asc),
  last_live as (select distinct on (l.line_id) l.line_id, l.kind, l.account_id, l.label, l.amount from lines l where l.live order by l.line_id, l.revision desc),
  cur as (select l.line_id, l.live from lines l join latest la on la.id = l.closing_id)
  select e.line_id, la.business_date, la.slot_kind, la.slot_seq, ll.kind, ll.label, ll.amount,
         la.id, la.revision, la.submitted_at,
         (ll.label is distinct from fl.label or ll.amount <> fl.amount),
         not coalesce(cu.live, false),
         ll.account_id
  from ever e
  join latest la on la.slot_id = e.slot_id
  join last_live ll on ll.line_id = e.line_id
  join first_live fl on fl.line_id = e.line_id
  left join cur cu on cu.line_id = e.line_id
  where p_after is null or la.submitted_at > p_after
  order by la.business_date, la.slot_seq, ll.kind, ll.label, e.line_id;
end $$;

-- ── Credit Ledger ────────────────────────────────────────────────────────────────────────────────
-- One snapshot per submitted closing (status 'submitted' = the current revision of its slot), newest first. Figures are the
-- ones the closing STORED (closing_results.debt_e, closings.prev_credit, closings.credit_adj); nothing is recomputed here.
create function public.closing_credit_ledger(p_from date default null, p_to date default null, p_limit int default 60)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.business_date desc, x.seq desc) from (
      select s.business_date, s.seq,
        jsonb_build_object(
          'closing_id', c.id, 'business_date', s.business_date, 'kind', s.kind, 'seq', s.seq, 'mode', c.mode,
          'revision', c.revision, 'is_opening', c.is_opening, 'submitted_at', c.submitted_at,
          'prev_credit', c.prev_credit, 'credit_adj', c.credit_adj, 'debt_e', r.debt_e,
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'line_id', l.line_id, 'kind', l.kind,
                     'label', coalesce(nullif(trim(l.label), ''), a.label, ''), 'amount', l.amount)
                   order by l.sort, l.label)
            from public.closing_credit_lines l
            left join public.closing_credit_accounts a on a.id = l.account_id
            where l.closing_id = c.id and l.deleted_at is null and l.amount <> 0), '[]'::jsonb)
        ) as j
      from public.closings c
      join public.closing_slots s on s.id = c.slot_id
      left join public.closing_results r on r.closing_id = c.id
      where c.status = 'submitted'
        and (p_from is null or s.business_date >= p_from)
        and (p_to is null or s.business_date <= p_to)
      order by s.business_date desc, s.seq desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) x), '[]'::jsonb);
end $$;

-- ── Misc / Ongoing Ledger ────────────────────────────────────────────────────────────────────────
-- A charge is identified by its stable charge_id (never by label text). OPEN = live in the latest submitted closing.
-- CLOSED = was live earlier but is struck or gone in the latest one. first_date = the first slot date it was live;
-- age_days counts from there to today (Karachi) for open charges, and to the last date it was live for closed ones.
create function public.closing_misc_ledger(p_closed_limit int default 100)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_asof record; v_today date := (now() at time zone 'Asia/Karachi')::date; r jsonb;
begin
  if not (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select c.id, s.business_date, s.kind, s.seq into v_asof
  from public.closings c join public.closing_slots s on s.id = c.slot_id
  where c.status = 'submitted' order by s.business_date desc, s.seq desc limit 1;
  if not found then
    return jsonb_build_object('as_of', null, 'open', '[]'::jsonb, 'closed', '[]'::jsonb);
  end if;

  with hist as (
    select m.charge_id, m.label, m.amount, s.business_date, s.seq, c.revision, c.id as closing_id
    from public.closing_misc_rows m
    join public.closings c on c.id = m.closing_id and c.status in ('submitted', 'superseded')
    join public.closing_slots s on s.id = c.slot_id
    where m.deleted_at is null and m.amount <> 0
  ),
  agg as (
    select distinct on (h.charge_id) h.charge_id, h.label, h.amount, h.business_date as last_date
    from hist h order by h.charge_id, h.business_date desc, h.seq desc, h.revision desc
  ),
  firsts as (select h.charge_id, min(h.business_date) as first_date from hist h group by h.charge_id),
  is_open as (
    select distinct m.charge_id from public.closing_misc_rows m
    where m.closing_id = v_asof.id and m.deleted_at is null and m.amount <> 0
  ),
  rows_ as (
    select a.charge_id, a.label, a.amount, f.first_date, a.last_date, (o.charge_id is not null) as open_
    from agg a join firsts f using (charge_id) left join is_open o using (charge_id)
  )
  select jsonb_build_object(
    'as_of', jsonb_build_object('closing_id', v_asof.id, 'business_date', v_asof.business_date, 'kind', v_asof.kind, 'seq', v_asof.seq),
    'open', coalesce((select jsonb_agg(jsonb_build_object(
              'charge_id', q.charge_id, 'label', q.label, 'amount', q.amount, 'first_date', q.first_date,
              'age_days', greatest(v_today - q.first_date, 0)) order by q.first_date, q.label)
            from rows_ q where q.open_), '[]'::jsonb),
    'closed', coalesce((select jsonb_agg(z.j order by z.last_date desc, z.label) from (
              select q.last_date, q.label, jsonb_build_object(
                'charge_id', q.charge_id, 'label', q.label, 'amount', q.amount, 'first_date', q.first_date,
                'last_date', q.last_date, 'age_days', greatest(q.last_date - q.first_date, 0)) as j
              from rows_ q where not q.open_
              order by q.last_date desc, q.label
              limit greatest(1, least(coalesce(p_closed_limit, 100), 500))) z), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ── grants: signed-in people only; each function checks its own permission ────────────────────────
revoke all on function public.closing_credit_feed(timestamptz), public.closing_credit_ledger(date, date, int),
  public.closing_misc_ledger(int) from public, anon, authenticated;
grant execute on function public.closing_credit_feed(timestamptz), public.closing_credit_ledger(date, date, int),
  public.closing_misc_ledger(int) to authenticated;

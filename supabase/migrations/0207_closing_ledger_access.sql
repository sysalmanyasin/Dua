-- 0207_closing_ledger_access: owner decision (14 Nov 2026): the owner, the manager AND cashiers see the Credit Ledger and the Misc Ledger.
-- A cashier's row-level security shows only their own closings, so the two ledger functions now run as SECURITY DEFINER and read the
-- whole shop, but only after checking the caller holds closing.enter_own, closing.view_all, closing.review or closing.correct.
-- Someone with none of these (or with closing.enter_own denied) is still refused. The credit FEED (credit.view) is unchanged.
-- Read-only; no money rule changes. This records an exception to SECURITY_MODEL C10 (a cashier otherwise sees only their own closings).

create or replace function public.closing_credit_ledger(p_from date default null, p_to date default null, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')) then
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
create or replace function public.closing_misc_ledger(p_closed_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_asof record; v_today date := (now() at time zone 'Asia/Karachi')::date; r jsonb;
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')) then
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

-- grants are kept by CREATE OR REPLACE; stated again so this file stands on its own
revoke all on function public.closing_credit_ledger(date, date, int), public.closing_misc_ledger(int) from public, anon, authenticated;
grant execute on function public.closing_credit_ledger(date, date, int), public.closing_misc_ledger(int) to authenticated;

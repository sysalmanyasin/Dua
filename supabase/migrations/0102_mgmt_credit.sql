-- 0102_mgmt_credit: staff credit as an append-only ledger (owner only). See docs/modules/manager.md §4 and MGR-3, 9, 12, 16, 19.
--
-- Old behaviour reproduced: Net = previous balance + dated entries - salary deduction - "less generic" deduction.
-- Old "Copy to next month" is gone: the previous balance of any month is DERIVED = opening + every earlier row (G5).
-- Nothing is edited or deleted. A mistake is a reversal row (same person, kind and date as the original, opposite sign,
-- mandatory reason), so the month reads as if the mistake never happened while both lines stay visible.
-- The two monthly deductions are ledger rows too (kind), changed by adding a delta row.

create table public.mgmt_credit_openings (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  staff_id uuid not null references public.staff(id) on delete restrict,
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  amount numeric(14,2) not null check (abs(amount) <= 1000000000),
  reason text not null check (length(trim(reason)) >= 3),
  set_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index mgmt_credit_openings_staff on public.mgmt_credit_openings (staff_id, seq desc);
alter table public.mgmt_credit_openings enable row level security;
create trigger mgmt_credit_openings_append_only before update or delete on public.mgmt_credit_openings
  for each row execute function public.mgmt_append_only();

create table public.mgmt_credit_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  staff_id uuid not null references public.staff(id) on delete restrict,
  entry_date date not null,
  kind text not null check (kind in ('entry', 'salary_deduction', 'generic_deduction')),
  amount numeric(14,2) not null check (amount <> 0 and abs(amount) <= 1000000000),
  description text not null default '' check (length(description) <= 200),
  source text not null default 'manual' check (source in ('manual', 'closing_inbox')),
  reverses_id uuid unique references public.mgmt_credit_entries(id),
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (reverses_id is null or (reason is not null and length(trim(reason)) >= 3))
);
create index mgmt_credit_entries_staff_date on public.mgmt_credit_entries (staff_id, entry_date);
create index mgmt_credit_entries_date on public.mgmt_credit_entries (entry_date);
alter table public.mgmt_credit_entries enable row level security;
create trigger mgmt_credit_entries_append_only before update or delete on public.mgmt_credit_entries
  for each row execute function public.mgmt_append_only();

-- Wrapped form: the permission is checked once per query, not once per row. Editing implies reading (MGR-18).
create policy mgmt_credit_openings_read on public.mgmt_credit_openings for select to authenticated
  using ((select public.has_perm('credit.view') or public.has_perm('mgmt.credit_manage')));
create policy mgmt_credit_entries_read on public.mgmt_credit_entries for select to authenticated
  using ((select public.has_perm('credit.view') or public.has_perm('mgmt.credit_manage')));
grant select on public.mgmt_credit_openings, public.mgmt_credit_entries to authenticated;
-- no insert / update / delete policy and no write grant: every write is one of the functions below

-- ───────── add an entry (advance +, repayment −) ─────────
create function public.mgmt_credit_add(p_staff_id uuid, p_date date, p_description text, p_amount numeric, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; op public.mgmt_credit_openings; v_id uuid; res jsonb;
  v_desc text := trim(coalesce(p_description, ''));
begin
  if not public.has_perm('mgmt.credit_manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'credit_add');
  if cached is not null then return cached; end if;
  if p_amount is null or p_amount = 0 then raise exception 'enter an amount (negative for a repayment)'; end if;
  if abs(p_amount) > 1000000000 or p_amount <> round(p_amount, 2) then raise exception 'amount is out of range or has more than 2 decimals'; end if;
  if p_date is null or p_date > today or p_date < date '2000-01-01' then raise exception 'date cannot be in the future'; end if;
  if length(v_desc) > 200 then raise exception 'description is too long'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id) then raise exception 'unknown staff member'; end if;
  select * into op from public.mgmt_credit_openings where staff_id = p_staff_id order by seq desc limit 1;
  if op.id is not null and p_date < op.effective_month then raise exception 'date is before this person''s opening balance month'; end if;

  insert into public.mgmt_credit_entries (staff_id, entry_date, kind, amount, description, source, created_by)
    values (p_staff_id, p_date, 'entry', p_amount, v_desc, 'manual', auth.uid()) returning id into v_id;
  perform public.log_activity('mgmt.credit_added', 'mgmt_credit_entries', v_id::text, null,
    jsonb_build_object('staff_id', p_staff_id, 'entry_date', p_date, 'amount', p_amount), null);
  res := jsonb_build_object('id', v_id, 'entry_date', p_date);
  perform public.mgmt_idem_put(p_key, 'credit_add', res);
  return res;
end $$;

-- ───────── reverse an entry ─────────
create function public.mgmt_credit_reverse(p_entry_id uuid, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cached jsonb; e public.mgmt_credit_entries; v_id uuid; res jsonb;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_perm('mgmt.credit_manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'credit_reverse');
  if cached is not null then return cached; end if;
  if length(v_reason) not between 3 and 200 then raise exception 'a reason of 3 to 200 characters is required'; end if;
  select * into e from public.mgmt_credit_entries where id = p_entry_id for update;
  if not found then raise exception 'unknown entry'; end if;
  if e.reverses_id is not null then raise exception 'a reversal cannot be reversed: add a new entry instead'; end if;
  if exists (select 1 from public.mgmt_credit_entries where reverses_id = p_entry_id) then raise exception 'this entry is already reversed'; end if;

  -- same date as the original, so that month shows the mistake and its reversal cancelling each other
  insert into public.mgmt_credit_entries (staff_id, entry_date, kind, amount, description, source, reverses_id, reason, created_by)
    values (e.staff_id, e.entry_date, e.kind, -e.amount, left('Reversal: ' || e.description, 200), 'manual', e.id, v_reason, auth.uid())
    returning id into v_id;
  perform public.log_activity('mgmt.credit_reversed', 'mgmt_credit_entries', e.id::text,
    jsonb_build_object('staff_id', e.staff_id, 'entry_date', e.entry_date, 'amount', e.amount),
    jsonb_build_object('reversal_id', v_id), v_reason);
  res := jsonb_build_object('id', v_id, 'reverses_id', e.id);
  perform public.mgmt_idem_put(p_key, 'credit_reverse', res);
  return res;
end $$;

-- ───────── set a month's salary / less-generic deduction (old typed fields) ─────────
-- p_amount is the TOTAL deducted that month (a positive number). A delta row is added so the month's sum equals it.
create function public.mgmt_credit_set_deduction(p_staff_id uuid, p_month date, p_kind text, p_amount numeric, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; op public.mgmt_credit_openings; v_cur numeric; v_delta numeric; v_date date; v_id uuid; res jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_perm('mgmt.credit_manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'credit_deduction');
  if cached is not null then return cached; end if;
  if p_kind not in ('salary_deduction', 'generic_deduction') then raise exception 'unknown deduction type'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  if p_month > date_trunc('month', today)::date then raise exception 'that month has not started yet'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 or p_amount <> round(p_amount, 2) then raise exception 'deduction must be 0 or more, with at most 2 decimals'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id) then raise exception 'unknown staff member'; end if;

  select coalesce(-sum(amount), 0) into v_cur from public.mgmt_credit_entries
    where staff_id = p_staff_id and kind = p_kind and entry_date >= p_month and entry_date < (p_month + interval '1 month')::date;
  v_delta := p_amount - v_cur;
  if v_delta = 0 then
    res := jsonb_build_object('unchanged', true, 'total', v_cur);
    perform public.mgmt_idem_put(p_key, 'credit_deduction', res);
    return res;
  end if;
  if v_cur <> 0 and (v_reason is null or length(v_reason) < 3) then raise exception 'a reason is required to change a deduction'; end if;
  v_date := least(today, ((p_month + interval '1 month')::date - 1));
  select * into op from public.mgmt_credit_openings where staff_id = p_staff_id order by seq desc limit 1;
  if op.id is not null and v_date < op.effective_month then raise exception 'that month is before this person''s opening balance month'; end if;

  insert into public.mgmt_credit_entries (staff_id, entry_date, kind, amount, description, source, reason, created_by)
    values (p_staff_id, v_date, p_kind, -v_delta,
            case p_kind when 'salary_deduction' then 'Salary deduction' else 'Less generic' end, 'manual', v_reason, auth.uid())
    returning id into v_id;
  perform public.log_activity('mgmt.credit_deduction_set', 'mgmt_credit_entries', v_id::text,
    jsonb_build_object('staff_id', p_staff_id, 'month', p_month, 'kind', p_kind, 'total', v_cur),
    jsonb_build_object('total', p_amount), v_reason);
  res := jsonb_build_object('id', v_id, 'total', p_amount);
  perform public.mgmt_idem_put(p_key, 'credit_deduction', res);
  return res;
end $$;

-- ───────── opening balance (admin level: its own key, MGR-9) ─────────
create function public.mgmt_credit_set_opening(p_staff_id uuid, p_month date, p_amount numeric, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; old_o public.mgmt_credit_openings; v_id uuid; res jsonb;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_perm('mgmt.openings') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'credit_opening');
  if cached is not null then return cached; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  if p_month > date_trunc('month', today)::date or p_month < date '2000-01-01' then raise exception 'opening month cannot be in the future'; end if;
  if p_amount is null or abs(p_amount) > 1000000000 or p_amount <> round(p_amount, 2) then raise exception 'amount is out of range or has more than 2 decimals'; end if;
  if length(v_reason) not between 3 and 200 then raise exception 'a reason of 3 to 200 characters is required'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id) then raise exception 'unknown staff member'; end if;
  if exists (select 1 from public.mgmt_credit_entries where staff_id = p_staff_id and entry_date < p_month) then
    raise exception 'this person already has entries before that month';
  end if;
  select * into old_o from public.mgmt_credit_openings where staff_id = p_staff_id order by seq desc limit 1;

  insert into public.mgmt_credit_openings (staff_id, effective_month, amount, reason, set_by)
    values (p_staff_id, p_month, p_amount, v_reason, auth.uid()) returning id into v_id;
  perform public.log_activity('mgmt.credit_opening_set', 'mgmt_credit_openings', v_id::text,
    case when old_o.id is null then null else jsonb_build_object('effective_month', old_o.effective_month, 'amount', old_o.amount) end,
    jsonb_build_object('staff_id', p_staff_id, 'effective_month', p_month, 'amount', p_amount), v_reason);
  res := jsonb_build_object('id', v_id);
  perform public.mgmt_idem_put(p_key, 'credit_opening', res);
  return res;
end $$;

-- ───────── the month view (the one definition of the credit maths; domain/credit.js repeats it for live preview) ─────────
--   prev            = opening amount (when the month is on/after the opening's month) + every row dated before the month
--   entries_total   = sum of kind 'entry' rows in the month
--   salary / generic deduction = minus the sum of that kind's rows in the month (shown as positive numbers)
--   net             = prev + entries_total - salary_deduction - generic_deduction
-- A person is listed when active, or carrying a balance, or having rows in the month (MGR-13).
create function public.mgmt_credit_month(p_month date)
returns table (staff_id uuid, full_name text, staff_code text, sort_order int, active boolean,
               opening_month date, opening_amount numeric, prev_balance numeric, entries jsonb, entries_total numeric,
               salary_deduction numeric, generic_deduction numeric, net numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.has_perm('credit.view') or public.has_perm('mgmt.credit_manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  return query
  with op as (
    select distinct on (o.staff_id) o.staff_id, o.effective_month, o.amount
    from public.mgmt_credit_openings o order by o.staff_id, o.seq desc
  ), prior as (
    select e.staff_id, sum(e.amount) as amt from public.mgmt_credit_entries e where e.entry_date < p_month group by e.staff_id
  ), cur as (
    select e.staff_id,
      coalesce(sum(e.amount) filter (where e.kind = 'entry'), 0) as entries_total,
      coalesce(-sum(e.amount) filter (where e.kind = 'salary_deduction'), 0) as sal,
      coalesce(-sum(e.amount) filter (where e.kind = 'generic_deduction'), 0) as gen,
      coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'entry_date', e.entry_date, 'description', e.description,
        'amount', e.amount, 'source', e.source, 'reverses_id', e.reverses_id, 'reversed_by', rv.id, 'reason', e.reason)
        order by e.entry_date, e.seq) filter (where e.kind = 'entry'), '[]'::jsonb) as entries
    from public.mgmt_credit_entries e
    left join public.mgmt_credit_entries rv on rv.reverses_id = e.id
    where e.entry_date >= p_month and e.entry_date < (p_month + interval '1 month')::date
    group by e.staff_id
  ), base as (
    select s.id as sid, s.full_name as fname, d.staff_code as scode, coalesce(d.sort_order, 999) as so, s.active as act,
      op.effective_month as om, op.amount as oa,
      case when op.staff_id is not null and p_month < op.effective_month then 0
           else coalesce(op.amount, 0) + coalesce(prior.amt, 0) end as prev,
      coalesce(cur.entries_total, 0) as et, coalesce(cur.sal, 0) as sal, coalesce(cur.gen, 0) as gen,
      coalesce(cur.entries, '[]'::jsonb) as ent, (cur.staff_id is not null) as has_rows
    from public.staff s
    left join public.mgmt_staff_details d on d.staff_id = s.id
    left join op on op.staff_id = s.id
    left join prior on prior.staff_id = s.id
    left join cur on cur.staff_id = s.id
  )
  select b.sid, b.fname, b.scode, b.so, b.act, b.om, b.oa, b.prev, b.ent, b.et, b.sal, b.gen,
         b.prev + b.et - b.sal - b.gen
  from base b
  where b.act or b.has_rows or b.prev <> 0 or (b.prev + b.et - b.sal - b.gen) <> 0
  order by b.so, b.fname, b.sid;
end $$;

-- ───────── grants ─────────
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_credit_add(uuid, date, text, numeric, uuid), public.mgmt_credit_reverse(uuid, text, uuid),
  public.mgmt_credit_set_deduction(uuid, date, text, numeric, text, uuid), public.mgmt_credit_set_opening(uuid, date, numeric, text, uuid),
  public.mgmt_credit_month(date) from public, anon, authenticated;
grant execute on function public.mgmt_credit_add(uuid, date, text, numeric, uuid), public.mgmt_credit_reverse(uuid, text, uuid),
  public.mgmt_credit_set_deduction(uuid, date, text, numeric, text, uuid), public.mgmt_credit_set_opening(uuid, date, numeric, text, uuid),
  public.mgmt_credit_month(date) to authenticated;

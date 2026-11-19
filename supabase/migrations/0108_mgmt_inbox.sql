-- 0108_mgmt_inbox: the Credit Inbox (owner only). See docs/modules/manager.md R13, R18, R19 and MGR-2, MGR-10, MGR-12.
--
-- Credit recorded by staff in Closing arrives through Closing's read-only feed, public.closing_credit_feed(p_after) (0206).
-- Manager never changes Closing and never files anything by itself: the owner files each line BY HAND into one place
--   * Staff Credit (a person), or
--   * a ledger (Expense, Jazz Cash or any Misc Section, with a category), or
--   * dismisses it, with a reason.
-- The amount and the date are LOCKED to what Closing recorded (the business date and the line amount); only the description
-- can be edited. If Closing changes a line after it was filed or dismissed, the inbox only SHOWS "changed after filing"
-- and the owner decides (Reopen reverses the entry, with a reason, and the line becomes unfiled again).
--
-- Filing state is Manager's own: mgmt_credit_filings is an append-only event list. The Closing line id is a plain uuid
-- (no foreign key), so Closing can evolve and Manager still stands. The current state of a line = its latest event.
-- Keys: mgmt.inbox_file (see the inbox and file) AND the target's own key (mgmt.credit_manage for staff credit,
-- mgmt.ledgers for a ledger). Closing's feed itself needs credit.view, so seeing the inbox needs that key too.

create table public.mgmt_credit_filings (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  line_id uuid not null,
  action text not null check (action in ('filed', 'dismissed', 'reopened')),
  -- the line as Closing showed it when this event happened (so a later change can be shown)
  business_date date not null,
  amount numeric(14,2) not null,
  label text not null default '' check (length(label) <= 200),
  -- where a filed line went
  target_kind text check (target_kind in ('credit', 'ledger')),
  staff_id uuid references public.staff(id) on delete restrict,
  ledger_id uuid references public.mgmt_ledgers(id) on delete restrict,
  category_id uuid references public.mgmt_ledger_categories(id) on delete restrict,
  credit_entry_id uuid unique references public.mgmt_credit_entries(id) on delete restrict,
  ledger_entry_id uuid unique references public.mgmt_ledger_entries(id) on delete restrict,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (action <> 'filed' or (
    target_kind is not null and
    ((target_kind = 'credit' and staff_id is not null and credit_entry_id is not null and ledger_id is null and category_id is null and ledger_entry_id is null) or
     (target_kind = 'ledger' and ledger_id is not null and category_id is not null and ledger_entry_id is not null and staff_id is null and credit_entry_id is null)))),
  check (action = 'filed' or (target_kind is null and staff_id is null and ledger_id is null and category_id is null and credit_entry_id is null and ledger_entry_id is null)),
  check (action = 'filed' or (reason is not null and length(trim(reason)) >= 3))
);
create index mgmt_credit_filings_line on public.mgmt_credit_filings (line_id, seq desc);
alter table public.mgmt_credit_filings enable row level security;
create trigger mgmt_credit_filings_append_only before update or delete on public.mgmt_credit_filings
  for each row execute function public.mgmt_append_only();
create policy mgmt_credit_filings_read on public.mgmt_credit_filings for select to authenticated
  using ((select public.has_perm('mgmt.inbox_file')));
grant select on public.mgmt_credit_filings to authenticated;
-- no write policy and no write grant: every write is one of the functions below

-- ───────── read: every credit line with its filing state ─────────
-- state: unfiled | filed | dismissed. A filed line whose entry was reversed (here or on the Staff Credit / ledger page) is unfiled again.
create function public.mgmt_inbox_lines(p_state text default null)
returns table (line_id uuid, business_date date, slot_kind text, slot_seq int, kind text, label text, amount numeric,
               closing_id uuid, revision int, submitted_at timestamptz, changed_after_first boolean, removed boolean, account_id uuid,
               state text, filing_id uuid, filed_at timestamptz, target_kind text, staff_id uuid, ledger_id uuid, category_id uuid,
               credit_entry_id uuid, ledger_entry_id uuid, target_label text, filed_amount numeric, filed_label text,
               changed_after_filing boolean, entry_reversed boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.has_perm('mgmt.inbox_file') and public.has_perm('credit.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('unfiled', 'filed', 'dismissed') then raise exception 'unknown state'; end if;
  return query
  with feed as (select * from public.closing_credit_feed()),
  lastf as (select distinct on (x.line_id) x.* from public.mgmt_credit_filings x order by x.line_id, x.seq desc),
  joined as (
    select f.line_id, f.business_date, f.slot_kind, f.slot_seq, f.kind, f.label, f.amount, f.closing_id, f.revision, f.submitted_at,
           f.changed_after_first, f.removed, f.account_id,
           l.id as filing_id, l.action, l.created_at as filed_at, l.target_kind, l.staff_id, l.ledger_id, l.category_id,
           l.credit_entry_id, l.ledger_entry_id, l.amount as snap_amount, l.label as snap_label, l.reason,
           (case l.target_kind
              when 'credit' then exists (select 1 from public.mgmt_credit_entries r where r.reverses_id = l.credit_entry_id)
              when 'ledger' then exists (select 1 from public.mgmt_ledger_entries r where r.reverses_id = l.ledger_entry_id)
              else false end) as reversed
    from feed f left join lastf l on l.line_id = f.line_id
  ),
  st as (
    select j.*, (case when j.filing_id is null or j.action = 'reopened' then 'unfiled'
                      when j.action = 'dismissed' then 'dismissed'
                      when j.reversed then 'unfiled'
                      else 'filed' end) as cur
    from joined j
  )
  select s.line_id, s.business_date, s.slot_kind, s.slot_seq, s.kind, s.label, s.amount, s.closing_id, s.revision, s.submitted_at,
         s.changed_after_first, s.removed, s.account_id,
         s.cur, s.filing_id, s.filed_at,
         case when s.cur = 'filed' then s.target_kind end,
         case when s.cur = 'filed' then s.staff_id end, case when s.cur = 'filed' then s.ledger_id end, case when s.cur = 'filed' then s.category_id end,
         case when s.cur = 'filed' then s.credit_entry_id end, case when s.cur = 'filed' then s.ledger_entry_id end,
         case when s.cur = 'filed' and s.target_kind = 'credit' then 'Staff credit · ' || (select st2.full_name from public.staff st2 where st2.id = s.staff_id)
              when s.cur = 'filed' and s.target_kind = 'ledger' then (select lg.name || ' · ' || ct.name from public.mgmt_ledgers lg, public.mgmt_ledger_categories ct
                                                                       where lg.id = s.ledger_id and ct.id = s.category_id) end,
         case when s.cur in ('filed', 'dismissed') then s.snap_amount end, case when s.cur in ('filed', 'dismissed') then s.snap_label end,
         (s.cur in ('filed', 'dismissed') and (s.amount <> s.snap_amount or s.removed or s.label is distinct from s.snap_label)),
         (s.action = 'filed' and s.reversed),
         case when s.cur = 'dismissed' then s.reason end
  from st s
  where p_state is null or s.cur = p_state
  order by s.business_date desc, s.slot_seq desc, s.kind, s.label, s.line_id;
end $$;

-- How many lines still wait for the owner (not counting lines Closing has since removed). Drives the status pill.
create function public.mgmt_inbox_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('mgmt.inbox_file') and public.has_perm('credit.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select count(*)::int from public.mgmt_inbox_lines('unfiled') x where not x.removed);
end $$;

-- ───────── file one line, by hand ─────────
-- p_target = 'credit' (needs p_staff_id) or 'ledger' (needs p_ledger and p_category; p_shift for a ledger with shifts).
-- The amount and date are taken from the line, never from the caller. The description may be changed.
create function public.mgmt_inbox_file(p_line_id uuid, p_target text, p_staff_id uuid, p_ledger uuid, p_category uuid, p_shift text,
                                       p_description text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; ln record; op public.mgmt_credit_openings; lg public.mgmt_ledgers; ct public.mgmt_ledger_categories;
  v_desc text; v_shift text := nullif(trim(coalesce(p_shift, '')), ''); v_entry uuid; v_filing uuid; res jsonb;
begin
  if not (public.has_perm('mgmt.inbox_file') and public.has_perm('credit.view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_target not in ('credit', 'ledger') then raise exception 'pick where this line goes'; end if;
  if p_target = 'credit' and not public.has_perm('mgmt.credit_manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_target = 'ledger' and not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'inbox_file');
  if cached is not null then return cached; end if;
  perform pg_advisory_xact_lock(hashtextextended('mgmt_inbox:' || coalesce(p_line_id::text, ''), 0));

  select * into ln from public.mgmt_inbox_lines() x where x.line_id = p_line_id;
  if not found then raise exception 'unknown line'; end if;
  if ln.state = 'filed' then raise exception 'this line is already filed'; end if;
  if ln.state = 'dismissed' then raise exception 'this line was dismissed: reopen it first'; end if;
  if ln.removed then raise exception 'Closing has since removed this line: dismiss it instead'; end if;
  if ln.amount = 0 then raise exception 'this line has no amount'; end if;
  if ln.business_date > today or ln.business_date < date '2000-01-01' then raise exception 'the line''s date is out of range'; end if;
  v_desc := left(coalesce(nullif(trim(coalesce(p_description, '')), ''), nullif(trim(ln.label), ''), 'Closing credit'), 200);

  if p_target = 'credit' then
    if not exists (select 1 from public.staff where id = p_staff_id) then raise exception 'pick a person'; end if;
    select * into op from public.mgmt_credit_openings where staff_id = p_staff_id order by seq desc limit 1;
    if op.id is not null and ln.business_date < op.effective_month then raise exception 'the line''s date is before this person''s opening balance month'; end if;
    insert into public.mgmt_credit_entries (staff_id, entry_date, kind, amount, description, source, created_by)
      values (p_staff_id, ln.business_date, 'entry', ln.amount, v_desc, 'closing_inbox', auth.uid()) returning id into v_entry;
    insert into public.mgmt_credit_filings (line_id, action, business_date, amount, label, target_kind, staff_id, credit_entry_id, created_by)
      values (p_line_id, 'filed', ln.business_date, ln.amount, ln.label, 'credit', p_staff_id, v_entry, auth.uid()) returning id into v_filing;
  else
    select * into lg from public.mgmt_ledgers where id = p_ledger;
    if not found then raise exception 'pick a ledger'; end if;
    select * into ct from public.mgmt_ledger_categories where id = p_category and ledger_id = p_ledger;
    if not found then raise exception 'that category does not belong to this ledger'; end if;
    if ct.retired_at is not null then raise exception 'that category is retired'; end if;
    if ln.amount < 0 then raise exception 'a negative line can only go to staff credit, or be dismissed'; end if;
    if lg.has_shift then
      if v_shift is null then raise exception 'pick a shift'; end if;
      if v_shift not in ('Morning', 'Evening', 'Night', 'Both', 'Off') then raise exception 'unknown shift'; end if;
    elsif v_shift is not null then raise exception 'this ledger has no shifts';
    end if;
    insert into public.mgmt_ledger_entries (ledger_id, category_id, entry_date, shift, description, amount, effect, source, created_by)
      values (p_ledger, p_category, ln.business_date, v_shift, v_desc, ln.amount, ct.direction, 'closing_inbox', auth.uid()) returning id into v_entry;
    insert into public.mgmt_credit_filings (line_id, action, business_date, amount, label, target_kind, ledger_id, category_id, ledger_entry_id, created_by)
      values (p_line_id, 'filed', ln.business_date, ln.amount, ln.label, 'ledger', p_ledger, p_category, v_entry, auth.uid()) returning id into v_filing;
  end if;

  perform public.log_activity('mgmt.inbox_filed', 'mgmt_credit_filings', v_filing::text, null,
    jsonb_build_object('line_id', p_line_id, 'target', p_target, 'business_date', ln.business_date, 'amount', ln.amount, 'entry_id', v_entry), null);
  res := jsonb_build_object('filing_id', v_filing, 'entry_id', v_entry, 'target', p_target);
  perform public.mgmt_idem_put(p_key, 'inbox_file', res);
  return res;
end $$;

-- ───────── dismiss a line (no ledger entry), with a reason ─────────
create function public.mgmt_inbox_dismiss(p_line_id uuid, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; ln record; v_reason text := trim(coalesce(p_reason, '')); v_filing uuid; res jsonb;
begin
  if not (public.has_perm('mgmt.inbox_file') and public.has_perm('credit.view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'inbox_dismiss');
  if cached is not null then return cached; end if;
  if length(v_reason) not between 3 and 200 then raise exception 'a reason of 3 to 200 characters is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mgmt_inbox:' || coalesce(p_line_id::text, ''), 0));
  select * into ln from public.mgmt_inbox_lines() x where x.line_id = p_line_id;
  if not found then raise exception 'unknown line'; end if;
  if ln.state = 'filed' then raise exception 'this line is filed: reopen it first'; end if;
  if ln.state = 'dismissed' then raise exception 'this line is already dismissed'; end if;
  insert into public.mgmt_credit_filings (line_id, action, business_date, amount, label, reason, created_by)
    values (p_line_id, 'dismissed', ln.business_date, ln.amount, ln.label, v_reason, auth.uid()) returning id into v_filing;
  perform public.log_activity('mgmt.inbox_dismissed', 'mgmt_credit_filings', v_filing::text, null,
    jsonb_build_object('line_id', p_line_id, 'business_date', ln.business_date, 'amount', ln.amount), v_reason);
  res := jsonb_build_object('filing_id', v_filing);
  perform public.mgmt_idem_put(p_key, 'inbox_dismiss', res);
  return res;
end $$;

-- ───────── reopen a filed or dismissed line ─────────
-- A filed line's entry is REVERSED (same date, opposite sign / direction, the reason) and the line is unfiled again.
-- Needs the target's own key as well. Nothing is erased: the entry, its reversal and every filing event stay.
create function public.mgmt_inbox_reopen(p_line_id uuid, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cached jsonb; ln record; v_reason text := trim(coalesce(p_reason, '')); v_filing uuid; v_rev uuid; res jsonb;
  ce public.mgmt_credit_entries; le public.mgmt_ledger_entries;
begin
  if not (public.has_perm('mgmt.inbox_file') and public.has_perm('credit.view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'inbox_reopen');
  if cached is not null then return cached; end if;
  if length(v_reason) not between 3 and 200 then raise exception 'a reason of 3 to 200 characters is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mgmt_inbox:' || coalesce(p_line_id::text, ''), 0));
  select * into ln from public.mgmt_inbox_lines() x where x.line_id = p_line_id;
  if not found then raise exception 'unknown line'; end if;
  if ln.state = 'unfiled' then raise exception 'this line is already open'; end if;

  if ln.state = 'filed' then
    if ln.target_kind = 'credit' then
      if not public.has_perm('mgmt.credit_manage') then raise exception 'not allowed' using errcode = '42501'; end if;
      select * into ce from public.mgmt_credit_entries where id = ln.credit_entry_id for update;
      insert into public.mgmt_credit_entries (staff_id, entry_date, kind, amount, description, source, reverses_id, reason, created_by)
        values (ce.staff_id, ce.entry_date, ce.kind, -ce.amount, left('Reversal: ' || ce.description, 200), 'manual', ce.id, v_reason, auth.uid())
        returning id into v_rev;
    else
      if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
      select * into le from public.mgmt_ledger_entries where id = ln.ledger_entry_id for update;
      insert into public.mgmt_ledger_entries (ledger_id, category_id, entry_date, shift, description, amount, effect, source, reverses_id, reason, created_by)
        values (le.ledger_id, le.category_id, le.entry_date, le.shift, left('Reversal: ' || le.description, 200), le.amount, -le.effect, 'manual', le.id, v_reason, auth.uid())
        returning id into v_rev;
    end if;
  end if;

  insert into public.mgmt_credit_filings (line_id, action, business_date, amount, label, reason, created_by)
    values (p_line_id, 'reopened', ln.business_date, ln.amount, ln.label, v_reason, auth.uid()) returning id into v_filing;
  perform public.log_activity('mgmt.inbox_reopened', 'mgmt_credit_filings', v_filing::text,
    jsonb_build_object('line_id', p_line_id, 'was', ln.state), jsonb_build_object('reversal_id', v_rev), v_reason);
  res := jsonb_build_object('filing_id', v_filing, 'reversal_id', v_rev);
  perform public.mgmt_idem_put(p_key, 'inbox_reopen', res);
  return res;
end $$;

-- ───────── grants ─────────
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_inbox_lines(text), public.mgmt_inbox_count(),
  public.mgmt_inbox_file(uuid, text, uuid, uuid, uuid, text, text, uuid),
  public.mgmt_inbox_dismiss(uuid, text, uuid), public.mgmt_inbox_reopen(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mgmt_inbox_lines(text), public.mgmt_inbox_count(),
  public.mgmt_inbox_file(uuid, text, uuid, uuid, uuid, text, text, uuid),
  public.mgmt_inbox_dismiss(uuid, text, uuid), public.mgmt_inbox_reopen(uuid, text, uuid) to authenticated;

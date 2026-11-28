-- 0227_closing_ops_summary: Closing-owned read for the Owner's "Latest closing summary" on Home (range 0200-0299).
-- Internal only (callable from other database functions, not from the browser); the caller checks the person's permission.
-- It reads the latest SUBMITTED closing and adds up the period since the last Final exactly as the Final page does
-- (closing_final_breakdown, 0210): the closings after the last Final plus the Final's own figures, up to and including the
-- latest closing. A Final closing uses only its own values. No money rule is changed or repeated: it adds stored values.
--   book_bills / manual_returns / mediq_collected : totals for the period since the last Final
--   deposits                                      : the latest closing's Total Cash Deposits (H), which already carries on until a Final
--   carried_cc                                    : the Carried CC the latest closing used (cc_total - cc_curr, as its saved page shows)
-- Returns { has_closing: false } when nothing has been submitted yet.
create or replace function public.closing_ops_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.closings; s public.closing_slots; r public.closing_results; a jsonb; v_start date; v_n integer;
begin
  select c0.* into c
    from public.closings c0
    join public.closing_slots s0 on s0.id = c0.slot_id
   where c0.status = 'submitted'
   order by s0.business_date desc, s0.seq desc
   limit 1;
  if not found then return jsonb_build_object('has_closing', false); end if;
  select * into s from public.closing_slots where id = c.slot_id;
  select * into r from public.closing_results where closing_id = c.id;
  if r.closing_id is null then return jsonb_build_object('has_closing', false); end if;

  a := case when c.mode = 'final' then '{}'::jsonb else public.closing_period_agg(c.id) end;
  if c.mode = 'final' then
    v_start := s.business_date; v_n := 1;
  else
    v_n := coalesce((a ->> 'closings_in_period')::integer, 0) + 1 + case when a ->> 'last_final_id' is null then 0 else 1 end;
    select sl.business_date into v_start
      from public.closings f join public.closing_slots sl on sl.id = f.slot_id
     where f.id = nullif(a ->> 'last_final_id', '')::uuid;
  end if;

  return jsonb_build_object(
    'has_closing', true,
    'closing_id', c.id, 'business_date', s.business_date, 'kind', s.kind, 'seq', s.seq,
    'day_no', (select count(*) from public.closing_slots d where d.business_date = s.business_date and d.seq <= s.seq),
    'mode', c.mode, 'revision', c.revision, 'is_opening', c.is_opening, 'submitted_at', c.submitted_at,
    'period_start', v_start, 'period_closings', v_n,
    'book_bills', public.closing_n(a -> 'total_book_bills') + c.book_bill_1 + c.book_bill_2,
    'manual_returns', public.closing_n(a -> 'total_manual_returns') + c.ret_manual_1 + c.ret_manual_2 + c.ret_manual_3,
    'mediq_collected', public.closing_n(a -> 'total_mediq_extra') + r.mediq_extra,
    'deposits', r.deposits_f,
    'carried_cc', r.cc_total - r.cc_curr);
end $$;
revoke all on function public.closing_ops_summary() from public, anon, authenticated;

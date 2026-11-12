-- 0204_closing_period: Session A, step A2 (gap G1). The "since the last Final" roll-up for shift closings.
-- Until now closing_build_input left `agg` empty, so every shift closing would have STORED a wrong final_net_sale / final_net_cash
-- (closing_results is append-only, D-12). The money formula itself (closing_calc) is untouched; this only supplies its inputs.
--
-- Source of truth: the old app's aggregateSinceLastFinal (old Closing repo, js/actions.js) and BUSINESS_RULES section 5:
--   * walk back from this slot to the LATEST EARLIER Final (nothing before that Final counts);
--   * the closings strictly between that Final and this slot are summed: shift sale, customers, system returns (split into
--     "same date as this closing" and "earlier date"), plus manual returns, book bills, extra cash and MEDIQ extra (totals);
--   * the Final's OWN sale, customers and system returns are added by date (lf_*), and its own manual returns, book bills,
--     extra cash and MEDIQ extra are added to the totals;
--   * only live SUBMITTED closings count: never drafts, never superseded revisions, never anything after this slot.
-- Shift sale and customers are the stored result values (hand overrides already applied); struck-through rows are already out.
-- Fixtures: tests/fixtures/closing-period-cases.json (hand-worked), run by supabase/tests/0204_closing_period_test.sql and by
-- tests/unit/closing-period.test.js (an independent JavaScript implementation).

create function public.closing_period_agg(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.closings; me public.closing_slots; v_lf uuid; v_lf_date date; v_lf_seq int; lf record; v jsonb;
begin
  select * into c from public.closings where id = p_closing;
  if not found then raise exception 'not found' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.mode = 'final' then return '{}'::jsonb; end if; -- a Final uses only its own values
  select * into me from public.closing_slots where id = c.slot_id;

  select cl.id, sl.business_date, sl.seq into v_lf, v_lf_date, v_lf_seq
  from public.closings cl join public.closing_slots sl on sl.id = cl.slot_id
  where cl.status = 'submitted' and cl.mode = 'final' and (sl.business_date, sl.seq) < (me.business_date, me.seq)
  order by sl.business_date desc, sl.seq desc limit 1;

  -- the Final's own figures (no row when there is no Final: every field is then null and counts as 0 below)
  select sl.business_date as d, r.shift_sale, r.customers, r.mediq_extra, cl.ret_system,
         cl.ret_manual_1 + cl.ret_manual_2 + cl.ret_manual_3 as manual, cl.book_bill_1 + cl.book_bill_2 as books, cl.extra_cash
    into lf
  from public.closings cl join public.closing_slots sl on sl.id = cl.slot_id join public.closing_results r on r.closing_id = cl.id
  where cl.id = v_lf;

  select jsonb_build_object(
    'same_date_shift_sale', coalesce(sum(p.shift_sale) filter (where p.d = me.business_date), 0),
    'pre_date_shift_sale', coalesce(sum(p.shift_sale) filter (where p.d < me.business_date), 0),
    'same_date_customers', coalesce(sum(p.customers) filter (where p.d = me.business_date), 0),
    'pre_date_customers', coalesce(sum(p.customers) filter (where p.d < me.business_date), 0),
    'same_date_sys_returns', coalesce(sum(p.ret_system) filter (where p.d = me.business_date), 0),
    'pre_date_sys_returns', coalesce(sum(p.ret_system) filter (where p.d < me.business_date), 0),
    'total_manual_returns', coalesce(sum(p.manual), 0) + coalesce(lf.manual, 0),
    'total_book_bills', coalesce(sum(p.books), 0) + coalesce(lf.books, 0),
    'total_extra_cash', coalesce(sum(p.extra_cash), 0) + coalesce(lf.extra_cash, 0),
    'total_mediq_extra', coalesce(sum(p.mediq_extra), 0) + coalesce(lf.mediq_extra, 0),
    'lf_same_date_sale', case when lf.d = me.business_date then lf.shift_sale else 0 end,
    'lf_pre_date_sale', case when lf.d < me.business_date then lf.shift_sale else 0 end,
    'lf_same_date_cust', case when lf.d = me.business_date then lf.customers else 0 end,
    'lf_pre_date_cust', case when lf.d < me.business_date then lf.customers else 0 end,
    'lf_same_date_sys_ret', case when lf.d = me.business_date then lf.ret_system else 0 end,
    'lf_pre_date_sys_ret', case when lf.d < me.business_date then lf.ret_system else 0 end,
    'closings_in_period', count(p.d),
    'last_final_id', v_lf)
  into v
  from (
    select sl.business_date as d, r.shift_sale, r.customers, r.mediq_extra, cl.ret_system,
           cl.ret_manual_1 + cl.ret_manual_2 + cl.ret_manual_3 as manual, cl.book_bill_1 + cl.book_bill_2 as books, cl.extra_cash
    from public.closings cl join public.closing_slots sl on sl.id = cl.slot_id join public.closing_results r on r.closing_id = cl.id
    where cl.status = 'submitted' and (sl.business_date, sl.seq) < (me.business_date, me.seq)
      and (v_lf is null or (sl.business_date, sl.seq) > (v_lf_date, v_lf_seq))
  ) p;
  return v;
end $$;
revoke all on function public.closing_period_agg(uuid) from public, anon, authenticated;

-- the same figures for the screen (the closing's owner or someone allowed to review), so the live preview can show them
create function public.closing_period(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if not found or not (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
          or (public.has_perm('closing.enter_own') and c.entered_by = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return public.closing_period_agg(p_closing);
end $$;
revoke all on function public.closing_period(uuid) from public, anon, authenticated;
grant execute on function public.closing_period(uuid) to authenticated;

-- closing_build_input: as in 0201, plus the `agg` key (internal; callers check the permission)
create or replace function public.closing_build_input(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings; src public.closings; src_date date; this_date date; v_in jsonb;
begin
  select * into c from public.closings where id = p_closing;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select business_date into this_date from public.closing_slots where id = c.slot_id;
  if c.source_closing_id is not null then
    select * into src from public.closings where id = c.source_closing_id;
    select business_date into src_date from public.closing_slots where id = src.slot_id;
  end if;

  v_in := jsonb_build_object(
    'mode', c.mode,
    'agg', public.closing_period_agg(c.id), -- the period since the last Final (0204); the calculation ignores it for a Final
    'settings', jsonb_build_object(
      'till_float', (select value from public.settings where key = 'till_float'),
      'per_customer_charge', (select value from public.settings where key = 'per_customer_charge')),
    'pos', jsonb_build_object('sys_cash', c.sys_cash, 'last_bill_no', c.last_bill_no, 'comp_sale', c.comp_sale, 'alfalah', c.alfalah, 'keenu', c.keenu),
    'returns', jsonb_build_object('manual', jsonb_build_array(c.ret_manual_1, c.ret_manual_2, c.ret_manual_3), 'system', c.ret_system),
    'book', jsonb_build_array(c.book_bill_1, c.book_bill_2),
    'extra_cash', c.extra_cash, 'credit_adj', c.credit_adj, 'prev_mediq', c.prev_mediq, 'final_sys_returns', c.final_sys_returns,
    'prev', jsonb_build_object(
      'exists', c.source_closing_id is not null,
      'day_changed', c.source_closing_id is not null and src_date <> this_date,
      'sys_cash', coalesce(src.sys_cash, 0), 'last_bill_no', coalesce(src.last_bill_no, 0)),
    'carried', jsonb_build_object('cc', c.prev_cc, 'credit', c.prev_credit, 'deposits', c.prev_deposits, 'cash', c.prev_cash),
    'overrides', jsonb_build_object('shift_sale', c.ov_shift_sale, 'customers', c.ov_customers, 'curr_cc', c.ov_curr_cc, 'prev_cash', c.ov_prev_cash),
    'hs', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_hs_rows where closing_id = c.id), '[]'),
    'strips', coalesce((select jsonb_agg(jsonb_build_object('price', price, 'qty', qty, 'deleted', deleted_at is not null) order by sort, id) from public.closing_strip_lines where closing_id = c.id), '[]'),
    'mediq', coalesce((select jsonb_agg(jsonb_build_object('collected', collected, 'bill', pharmacy_bill, 'deleted', deleted_at is not null) order by sort, id) from public.closing_mediq_orders where closing_id = c.id), '[]'),
    'deposits', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_deposits where closing_id = c.id), '[]'),
    'misc', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_misc_rows where closing_id = c.id), '[]'),
    'till', (select jsonb_agg(coalesce(k.qty, 0) order by d.ord)
             from unnest(array[5000, 1000, 500, 100, 50, 20, 10, 1]) with ordinality d(val, ord)
             left join public.closing_cash_counts k on k.closing_id = c.id and k.area = 'till' and k.denomination = d.val),
    'vault', (select jsonb_agg(coalesce(k.qty, 0) order by d.ord)
              from unnest(array[5000, 1000, 500, 100, 50, 20, 10, 1]) with ordinality d(val, ord)
              left join public.closing_cash_counts k on k.closing_id = c.id and k.area = 'vault' and k.denomination = d.val),
    'credit', jsonb_build_object(
      'named', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_credit_lines where closing_id = c.id and kind = 'named'), '[]'),
      'tier', coalesce((select jsonb_agg(case when deleted_at is null then amount else 0 end order by tier_slot) from public.closing_credit_lines where closing_id = c.id and kind = 'tier'), '[]'),
      'free', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_credit_lines where closing_id = c.id and kind = 'free'), '[]'))
  );
  return v_in;
end $$;
revoke all on function public.closing_build_input(uuid) from public, anon, authenticated;

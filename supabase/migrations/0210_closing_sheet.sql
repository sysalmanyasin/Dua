-- 0210_closing_sheet: Session D (Closing Book as the old PDF sheet). READ-ONLY apart from two new settings rows; no money rule changes
-- (closing_calc, closing_build_input and closing_write_result are untouched).
--   * closing.sheet_title / closing.sheet_branch: the shop name and branch printed at the top of every sheet.
--   * closing_final_breakdown: the lines of the sheet's Final page (Part 1 net final sale, Part 2 net final cash) worked out from the stored closing and
--     the same period roll-up closing_calc used. It mirrors closing_calc's final expressions line by line and REPORTS whether the lines add up to the
--     figures that were stored (ties.sale / ties.cash); if an earlier closing was corrected after this one was submitted they stop adding up, and the
--     sheet says so instead of hiding it. The stored final_net_sale / final_net_cash are always the ones printed as the totals.
--   * closing_book: now also returns day_no (this slot's place in its day, for "Closing 3"), shop, hs_plus_strips, each strip line's amount and final_part.
--   * closing_settings_set: also accepts the two sheet text settings.

insert into public.settings (key, value, staff_visible) values
  ('closing.sheet_title', to_jsonb('Fazal Din''s Pharma Plus'::text), false),
  ('closing.sheet_branch', to_jsonb('Bahria Town Branch'::text), false)
on conflict (key) do nothing;

create function public.closing_final_breakdown(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.closings; s public.closing_slots; r public.closing_results; a jsonb; ch numeric;
  lfd date; lfs int; v_period jsonb; v_lf jsonb;
  pos numeric; books numeric; cust numeric; mq numeric; man numeric; sysr numeric; addl numeric;
  pre_pos numeric; pre_cust numeric; pre_sys numeric; pre_total numeric; extra numeric; p1 numeric; p2 numeric;
begin
  select * into c from public.closings where id = p_closing;
  if not found then return null; end if;
  select * into s from public.closing_slots where id = c.slot_id;
  select * into r from public.closing_results where closing_id = p_closing;
  if r.closing_id is null then return null; end if;
  a := case when c.mode = 'final' then '{}'::jsonb else public.closing_period_agg(p_closing) end;
  ch := r.per_customer_charge;

  pos := public.closing_n(a -> 'same_date_shift_sale') + public.closing_n(a -> 'lf_same_date_sale') + r.shift_sale;
  books := public.closing_n(a -> 'total_book_bills') + c.book_bill_1 + c.book_bill_2;
  cust := (trunc(public.closing_n(a -> 'same_date_customers')) + trunc(public.closing_n(a -> 'lf_same_date_cust')) + r.customers) * ch;
  mq := public.closing_n(a -> 'total_mediq_extra') + r.mediq_extra;
  man := public.closing_n(a -> 'total_manual_returns') + c.ret_manual_1 + c.ret_manual_2 + c.ret_manual_3;
  sysr := public.closing_n(a -> 'same_date_sys_returns') + public.closing_n(a -> 'lf_same_date_sys_ret') + c.ret_system;
  addl := c.final_sys_returns;
  pre_pos := public.closing_n(a -> 'pre_date_shift_sale') + public.closing_n(a -> 'lf_pre_date_sale');
  pre_cust := (trunc(public.closing_n(a -> 'pre_date_customers')) + trunc(public.closing_n(a -> 'lf_pre_date_cust'))) * ch;
  pre_sys := public.closing_n(a -> 'pre_date_sys_returns') + public.closing_n(a -> 'lf_pre_date_sys_ret');
  pre_total := pre_pos + pre_cust - pre_sys;
  extra := public.closing_n(a -> 'total_extra_cash') + c.extra_cash;
  p1 := pos + books + cust + mq - man - sysr - addl;
  p2 := r.liquid - pre_total - extra - r.final_net_sale;

  select sl.business_date, sl.seq into lfd, lfs
  from public.closings cl join public.closing_slots sl on sl.id = cl.slot_id
  where cl.status = 'submitted' and cl.mode = 'final' and (sl.business_date, sl.seq) < (s.business_date, s.seq)
  order by sl.business_date desc, sl.seq desc limit 1;
  v_lf := case when lfd is null then null else jsonb_build_object('business_date', lfd, 'seq', lfs) end;
  select coalesce(jsonb_agg(jsonb_build_object('business_date', sl.business_date, 'kind', sl.kind, 'seq', sl.seq) order by sl.business_date, sl.seq), '[]'::jsonb) into v_period
  from public.closings cl join public.closing_slots sl on sl.id = cl.slot_id
  where cl.status = 'submitted'
    and ((c.mode = 'final' and cl.id = c.id)
      or (c.mode <> 'final' and (sl.business_date, sl.seq) <= (s.business_date, s.seq) and (lfd is null or (sl.business_date, sl.seq) > (lfd, lfs))));

  return jsonb_build_object(
    'part1', jsonb_build_object('pos_sale', pos, 'book_bills', books, 'customers', cust, 'mediq_extra', mq, 'manual_returns', man,
                                'system_returns', sysr, 'additional_system_returns', addl, 'net_final_sale', r.final_net_sale),
    'part2', jsonb_build_object('net_cash_available', r.liquid, 'pre_date_pos', pre_pos, 'pre_date_customers', pre_cust, 'pre_date_system_returns', pre_sys,
                                'pre_date_total', pre_total, 'extra_cash', extra, 'target_net_sale', r.final_net_sale, 'net_final_cash', r.final_net_cash),
    'ties', jsonb_build_object('sale', p1 = r.final_net_sale, 'cash', p2 = r.final_net_cash),
    'period', v_period, 'last_final', v_lf);
end $$;
revoke all on function public.closing_final_breakdown(uuid) from public, anon, authenticated;

create or replace function public.closing_book(p_from date default null, p_to date default null, p_limit int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
          'correction_reason', c.correction_reason, 'staff', st.full_name,
          'day_no', (select count(*) from public.closing_slots d where d.business_date = s.business_date and d.seq <= s.seq),
          'shop', jsonb_build_object(
            'title', coalesce((select value #>> '{}' from public.settings where key = 'closing.sheet_title'), ''),
            'branch', coalesce((select value #>> '{}' from public.settings where key = 'closing.sheet_branch'), '')),
          'hs_plus_strips', coalesce(r.hs_total, 0) + coalesce(r.strips_a, 0),
          'final_part', public.closing_final_breakdown(c.id),
          'inputs', to_jsonb(c) - array['id', 'slot_id', 'idempotency_key', 'entered_by', 'corrected_by', 'supersedes_id', 'source_closing_id', 'responsible_staff_id'],
          'results', coalesce(to_jsonb(r) - 'closing_id', '{}'::jsonb),
          'hs', coalesce((select jsonb_agg(jsonb_build_object('label', h.label, 'amount', h.amount) order by h.sort, h.label)
                          from public.closing_hs_rows h where h.closing_id = c.id and h.deleted_at is null), '[]'::jsonb),
          'strips', coalesce((select jsonb_agg(jsonb_build_object('label', l.label, 'price', l.price, 'qty', l.qty, 'amount', l.price * l.qty) order by l.sort, l.label)
                          from public.closing_strip_lines l where l.closing_id = c.id and l.deleted_at is null), '[]'::jsonb),
          'cash', coalesce((select jsonb_agg(jsonb_build_object('area', k.area, 'denomination', k.denomination, 'qty', k.qty) order by k.area, k.denomination desc)
                          from public.closing_cash_counts k where k.closing_id = c.id), '[]'::jsonb),
          'credit', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'label', coalesce(nullif(trim(l.label), ''), a.label, ''), 'amount', l.amount) order by l.sort, l.label)
                          from public.closing_credit_lines l left join public.closing_credit_accounts a on a.id = l.account_id
                          where l.closing_id = c.id and l.deleted_at is null and l.amount <> 0), '[]'::jsonb),
          'deposits', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'amount', d.amount) order by d.sort, d.label)
                          from public.closing_deposits d where d.closing_id = c.id and d.deleted_at is null), '[]'::jsonb),
          'mediq', coalesce((select jsonb_agg(jsonb_build_object('bill_no', m.bill_no, 'collected', m.collected, 'pharmacy_bill', m.pharmacy_bill) order by m.sort, m.bill_no)
                          from public.closing_mediq_orders m where m.closing_id = c.id and m.deleted_at is null), '[]'::jsonb),
          'misc', coalesce((select jsonb_agg(jsonb_build_object('label', m.label, 'amount', m.amount) order by m.sort, m.label)
                          from public.closing_misc_rows m where m.closing_id = c.id and m.deleted_at is null and m.amount <> 0), '[]'::jsonb),
          'audit', (select jsonb_build_object('verified_at', ia.verified_at, 'data_as_of', ia.data_as_of, 'codes_checked', ia.codes_checked, 'not_found', to_jsonb(ia.not_found))
                    from public.closing_inventory_audit ia where ia.closing_id = c.id)
        ) as j
      from public.closings c
      join public.closing_slots s on s.id = c.slot_id
      left join public.closing_results r on r.closing_id = c.id
      left join public.staff st on st.id = c.responsible_staff_id
      where c.status = 'submitted'
        and (p_from is null or s.business_date >= p_from)
        and (p_to is null or s.business_date <= p_to)
      order by s.business_date desc, s.seq desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) x), '[]'::jsonb);
end $$;

create or replace function public.closing_settings_set(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row public.settings; new_version int;
begin
  if not public.has_perm('closing.settings') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_key in ('till_float', 'per_customer_charge') then
    if p_value is null or jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0 or (p_value #>> '{}')::numeric > 10000000 then
      raise exception 'bad value' using errcode = '22023', hint = 'bad_value'; end if;
  elsif p_key in ('closing.sheet_title', 'closing.sheet_branch') then
    if p_value is null or jsonb_typeof(p_value) <> 'string' or length(trim(p_value #>> '{}')) not between 1 and 80 then
      raise exception 'bad value' using errcode = '22023', hint = 'bad_value'; end if;
  else
    raise exception 'unknown setting' using errcode = '22023', hint = 'unknown_setting';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into old_row from public.settings where key = p_key for update;
  if not found then raise exception 'unknown setting' using errcode = '22023', hint = 'unknown_setting'; end if;
  new_version := old_row.version + 1;
  update public.settings set value = p_value, version = new_version, updated_at = now(), updated_by = auth.uid() where key = p_key;
  insert into public.settings_history(key, version, value, reason, changed_by) values (p_key, new_version, p_value, trim(p_reason), auth.uid());
  perform public.log_activity('settings.set', 'settings', p_key, old_row.value, p_value, trim(p_reason));
end $$;


revoke all on function public.closing_book(date, date, int), public.closing_settings_set(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.closing_book(date, date, int), public.closing_settings_set(text, jsonb, text) to authenticated;

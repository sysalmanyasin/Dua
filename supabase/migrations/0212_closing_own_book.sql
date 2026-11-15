-- 0212_closing_own_book: staff can read the sheets they are allowed to see (READ-ONLY; no table is written, no money rule changes).
-- closing_book (0208 / 0210) needs closing.view_all / review / correct, so a cashier could not open or print their own submitted
-- closing, or see what the previous shift entered. These add two functions that return the SAME page object as closing_book:
--   closing_book_own(from, to, limit, closing)  people with view_all / review / correct get every submitted closing;
--                                               people with only enter_own get the ones they entered or corrected.
--   closing_prev_page(closing)                  the submitted closing a draft carries from (its source_closing_id), for the
--                                               "previous closing" card. Allowed only for a closing the caller may read.
-- closing_page_json(uuid) holds the page object once; it is internal (not callable by the browser).
create function public.closing_page_json(p_closing uuid) returns jsonb language sql stable security definer set search_path = public as $$
      select jsonb_build_object(
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
        )
      from public.closings c
      join public.closing_slots s on s.id = c.slot_id
      left join public.closing_results r on r.closing_id = c.id
      left join public.staff st on st.id = c.responsible_staff_id
      where c.id = p_closing and c.status = 'submitted'
$$;

create function public.closing_can_read(p_closing uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.closings c
    where c.id = p_closing
      and (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
           or (public.has_perm('closing.enter_own') and (c.entered_by = auth.uid() or c.corrected_by = auth.uid())))
  )
$$;

create function public.closing_book_own(p_from date default null, p_to date default null, p_limit int default 60, p_closing uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare see_all boolean;
begin
  see_all := public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct');
  if not (see_all or public.has_perm('closing.enter_own')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(public.closing_page_json(x.id) order by x.business_date desc, x.seq desc) from (
      select c.id, s.business_date, s.seq
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      where c.status = 'submitted'
        and (p_closing is null or c.id = p_closing)
        and (see_all or c.entered_by = auth.uid() or c.corrected_by = auth.uid())
        and (p_from is null or s.business_date >= p_from)
        and (p_to is null or s.business_date <= p_to)
      order by s.business_date desc, s.seq desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) x), '[]'::jsonb);
end $$;

create function public.closing_prev_page(p_closing uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare src uuid;
begin
  if not public.closing_can_read(p_closing) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select source_closing_id into src from public.closings where id = p_closing;
  if src is null then return null; end if;
  return public.closing_page_json(src);
end $$;

revoke all on function public.closing_page_json(uuid), public.closing_can_read(uuid), public.closing_book_own(date, date, int, uuid),
  public.closing_prev_page(uuid) from public, anon, authenticated;
grant execute on function public.closing_book_own(date, date, int, uuid), public.closing_prev_page(uuid) to authenticated;

-- 0208_closing_book: Session D1. READ-ONLY (no table is written; no money rule changes).
-- One page per SUBMITTED closing (the current revision of its slot), newest first, with everything the Closing Book, the Register
-- views and the CC / RBD / MEDIQ history tabs print: the typed figures, the stored results, and every live (not struck-out) row.
-- Superseded revisions and drafts are never shown. Needs closing.view_all, closing.review or closing.correct (the owner, and
-- seniors the owner has given view-all). Runs as SECURITY DEFINER so the permission above, not row-level security, decides.
create function public.closing_book(p_from date default null, p_to date default null, p_limit int default 60)
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
          'inputs', to_jsonb(c) - array['id', 'slot_id', 'idempotency_key', 'entered_by', 'corrected_by', 'supersedes_id', 'source_closing_id', 'responsible_staff_id'],
          'results', coalesce(to_jsonb(r) - 'closing_id', '{}'::jsonb),
          'hs', coalesce((select jsonb_agg(jsonb_build_object('label', h.label, 'amount', h.amount) order by h.sort, h.label)
                          from public.closing_hs_rows h where h.closing_id = c.id and h.deleted_at is null), '[]'::jsonb),
          'strips', coalesce((select jsonb_agg(jsonb_build_object('label', l.label, 'price', l.price, 'qty', l.qty) order by l.sort, l.label)
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
revoke all on function public.closing_book(date, date, int) from public, anon, authenticated;
grant execute on function public.closing_book(date, date, int) to authenticated;

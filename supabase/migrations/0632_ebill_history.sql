-- 0632_ebill_history.sql — the history list and an invoice's detail, with refunds and corrections applied on top of the saved record.
-- Staff see their own invoices; ebill.history_all and ebill.manage see everyone's. Text search is a plain substring match (no wildcards).

create or replace function public.ebill_history(p_from date default null, p_to date default null, p_text text default null,
  p_status text default null, p_mode text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean; v_uid uuid := auth.uid(); v_q text := lower(btrim(coalesce(p_text, ''))); v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb; v_total int; v_sum numeric; v_refunded numeric;
begin
  v_all := public.has_perm('ebill.history_all') or public.has_perm('ebill.manage');
  if not (v_all or public.has_perm('ebill.use')) then raise exception 'not allowed' using errcode = '42501'; end if;

  with base as (
    select i.invoice_id, i.invoice_no, i.business_date, i.created_at, i.client_created_at, i.staff_name, i.device_id, d.label as device_label, i.pin_check,
           public.ebill_effective(i.invoice_id, 'customer') as customer,
           public.ebill_effective(i.invoice_id, 'payment_mode') as payment_mode,
           i.gross_total, round(i.line_discounts + i.customer_discount + i.receipt_discount, 2) as discounts, i.net_total,
           (select count(*) from public.ebill_invoice_lines l where l.invoice_id = i.invoice_id) as items,
           case when exists (select 1 from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'refund') then 'refunded'
                when exists (select 1 from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'correction') then 'corrected'
                else 'posted' end as status
      from public.ebill_invoices i left join public.ebill_devices d on d.device_id = i.device_id
     where (v_all or i.staff_user = v_uid)
       and (p_from is null or i.business_date >= p_from) and (p_to is null or i.business_date <= p_to)
  ), f as (
    select * from base b
     where (p_status is null or p_status = '' or b.status = p_status)
       and (p_mode is null or p_mode = '' or b.payment_mode = p_mode)
       and (v_q = '' or position(v_q in lower(b.invoice_no || ' ' || b.customer || ' ' || b.staff_name)) > 0)
  )
  select (select count(*) from f),
         coalesce((select sum(net_total) from f where status <> 'refunded'), 0),
         coalesce((select sum(net_total) from f where status = 'refunded'), 0),
         coalesce((select jsonb_agg(to_jsonb(x) order by x.client_created_at desc, x.invoice_no desc)
                     from (select * from f order by client_created_at desc, invoice_no desc limit v_lim offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
    into v_total, v_sum, v_refunded, v_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'sum_net', v_sum, 'sum_refunded', v_refunded);
end $$;

create or replace function public.ebill_invoice_detail(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i public.ebill_invoices%rowtype; v_all boolean;
begin
  v_all := public.has_perm('ebill.history_all') or public.has_perm('ebill.manage');
  if not (v_all or public.has_perm('ebill.use')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into i from public.ebill_invoices where invoice_id = p_invoice and (v_all or staff_user = auth.uid());
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true,
    'invoice', to_jsonb(i) || jsonb_build_object(
      'customer', public.ebill_effective(i.invoice_id, 'customer'), 'payment_mode', public.ebill_effective(i.invoice_id, 'payment_mode'),
      'comments', public.ebill_effective(i.invoice_id, 'comments'),
      'device_label', (select label from public.ebill_devices where device_id = i.device_id),
      'status', case when exists (select 1 from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'refund') then 'refunded'
                     when exists (select 1 from public.ebill_invoice_events e where e.invoice_id = i.invoice_id and e.kind = 'correction') then 'corrected' else 'posted' end),
    'lines', coalesce((select jsonb_agg(to_jsonb(l) - 'id' order by l.line_no) from public.ebill_invoice_lines l where l.invoice_id = i.invoice_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'reason', e.reason, 'amount', e.amount, 'changes', e.changes, 'by', e.created_by_name, 'at', e.created_at) order by e.id)
                          from public.ebill_invoice_events e where e.invoice_id = i.invoice_id), '[]'::jsonb));
end $$;

revoke all on function public.ebill_history(date, date, text, text, text, int, int), public.ebill_invoice_detail(uuid) from public, anon, authenticated;
grant execute on function public.ebill_history(date, date, text, text, text, int, int), public.ebill_invoice_detail(uuid) to authenticated;

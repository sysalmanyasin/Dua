-- 0641_ebill_report.sql — date-wise totals and the full list behind the CSV / Excel / PDF exports.
-- Exporting is a right of its own (ebill.export, or ebill.manage): the server refuses everyone else, so hiding a button is not the only guard.
-- Who may see which invoices is the same as in History (own, or everyone's with ebill.history_all / ebill.manage). Money in the totals is NET OF
-- REFUNDS. At most p_max invoices (5000) come back; `truncated` says if there were more, so an export can warn instead of silently cutting.

create or replace function public.ebill_report(p_from date, p_to date, p_text text default null, p_status text default null, p_mode text default null, p_max int default 5000) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_max int := least(greatest(coalesce(p_max, 5000), 1), 5000); v_days jsonb; v_rows jsonb; v_total int; v_totals jsonb;
begin
  if not (public.has_perm('ebill.export') or public.has_perm('ebill.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'choose a date range of up to 400 days' using errcode = '22023'; end if;

  select count(*) into v_total from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode);

  select coalesce(jsonb_agg(jsonb_build_object('date', d.business_date, 'count', d.n, 'gross', d.gross, 'discounts', d.disc, 'net', d.net, 'refunded', d.refunded,
           'net_after_refunds', d.net - d.refunded, 'by_mode', d.by_mode) order by d.business_date), '[]'::jsonb) into v_days
    from (select r.business_date, count(*) as n, sum(r.gross_total) as gross, sum(r.discounts) as disc, sum(r.net_total) as net, sum(r.refunded_amount) as refunded,
                 (select coalesce(jsonb_object_agg(m.payment_mode, m.s), '{}'::jsonb) from
                    (select r2.payment_mode, sum(r2.net_total - r2.refunded_amount) as s
                       from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode) r2 where r2.business_date = r.business_date group by r2.payment_mode) m) as by_mode
            from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode) r group by r.business_date) d;

  select jsonb_build_object('count', count(*), 'gross', coalesce(sum(gross_total), 0), 'discounts', coalesce(sum(discounts), 0), 'net', coalesce(sum(net_total), 0),
           'refunded', coalesce(sum(refunded_amount), 0), 'net_after_refunds', coalesce(sum(net_total - refunded_amount), 0)) into v_totals
    from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.client_created_at, x.invoice_no), '[]'::jsonb) into v_rows
    from (select * from public.ebill_rows(p_from, p_to, p_text, p_status, p_mode) order by client_created_at, invoice_no limit v_max) x;

  perform public.log_activity('ebill.report_run', 'ebill_invoices', null, null, jsonb_build_object('from', p_from, 'to', p_to, 'invoices', v_total), null);
  return jsonb_build_object('days', v_days, 'rows', v_rows, 'totals', v_totals, 'total_invoices', v_total, 'truncated', v_total > v_max);
end $$;

revoke all on function public.ebill_report(date, date, text, text, text, int) from public, anon, authenticated;
grant execute on function public.ebill_report(date, date, text, text, text, int) to authenticated;

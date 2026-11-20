-- 0633_ebill_partial_refunds.sql — refunds by item and quantity, as many times as needed until everything is back.
--
-- A refund is still an append-only EVENT (0631); it now says which lines and how many of each ("lines": [{line_no, qty}]). An older
-- full-refund event with no lines counts as every line, fully. The money is shared out the way the sale was made: a refund of part of
-- the lines gets that share of the invoice's NET total, so customer discounts, receipt discount, tax and adjustment come back in
-- proportion. The last refund that takes the final item returns exactly what is left, so the refunds always add up to the net total
-- to the paisa, however many there were. The server decides the amount; the screen only previews it.
-- Each refund carries a request id, so a retry after a lost reply is recognised and never refunds twice.
-- Refunds of one invoice are serialised with an advisory lock, so two managers cannot both refund the last item.

alter table public.ebill_invoice_events add column lines jsonb;
alter table public.ebill_invoice_events add column request_id uuid;
create unique index ebill_events_request_once on public.ebill_invoice_events (invoice_id, request_id) where request_id is not null;
drop index public.ebill_events_one_refund;

-- Per line: how many were sold, how many are already refunded, how many remain. Plus the money refunded so far.
create or replace function public.ebill_refund_state(p_invoice uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'code', l.code, 'name', l.name, 'unit', l.unit, 'qty', l.qty, 'rate', l.rate,
                'line_total', l.line_total, 'refunded', r.refunded, 'remaining', l.qty - r.refunded) order by l.line_no), '[]'::jsonb),
    'refunded_amount', (select coalesce(sum(e.amount), 0) from public.ebill_invoice_events e where e.invoice_id = p_invoice and e.kind = 'refund'))
  from public.ebill_invoice_lines l
  left join lateral (
    select coalesce(sum(case when e.lines is null then l.qty
                             else coalesce((select sum((x ->> 'qty')::numeric) from jsonb_array_elements(e.lines) x where (x ->> 'line_no')::int = l.line_no), 0) end), 0) as refunded
      from public.ebill_invoice_events e where e.invoice_id = l.invoice_id and e.kind = 'refund') r on true
  where l.invoice_id = p_invoice;
$$;

-- Total quantity still to be refunded on an invoice (0 = fully refunded), and whether any refund exists.
create or replace function public.ebill_remaining_qty(p_invoice uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum((x ->> 'remaining')::numeric), 0) from jsonb_array_elements(public.ebill_refund_state(p_invoice) -> 'lines') x;
$$;

-- p_lines: [{ "line_no": 1, "qty": 2 }, ...]. p_request: any uuid the screen made for this attempt (optional but recommended).
create or replace function public.ebill_refund_lines(p_invoice uuid, p_lines jsonb, p_reason text, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.ebill_invoices%rowtype; st jsonb; x jsonb; v_name text; prior public.ebill_invoice_events%rowtype;
  want jsonb := '{}'::jsonb; k text; v numeric; l jsonb; rem numeric;
  total_lt numeric; before_val numeric := 0; add_val numeric := 0; cum_before numeric; cum_after numeric; amount numeric;
  left_after numeric := 0; out_lines jsonb := '[]'::jsonb; v_new bigint;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('ebill_refund:' || coalesce(p_invoice::text, '')));
  select * into i from public.ebill_invoices where invoice_id = p_invoice;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'No such invoice.'); end if;

  -- a retry of an attempt that already went through: report it again, change nothing
  if p_request is not null then
    select * into prior from public.ebill_invoice_events where invoice_id = p_invoice and request_id = p_request;
    if found then
      st := public.ebill_refund_state(p_invoice);
      return jsonb_build_object('ok', true, 'code', 'duplicate', 'amount', prior.amount, 'refunded_total', st ->> 'refunded_amount', 'remaining_qty', public.ebill_remaining_qty(p_invoice));
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose what to refund.');
  end if;
  begin
    for x in select value from jsonb_array_elements(p_lines) loop
      v := (x ->> 'qty')::numeric;
      if v is null or v <= 0 or v > 1000000 or (x ->> 'line_no') is null then raise exception 'bad'; end if;
      want := jsonb_set(want, array[(x ->> 'line_no')::int::text], to_jsonb(coalesce((want ->> ((x ->> 'line_no')::int)::text)::numeric, 0) + v));
    end loop;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The refund lines are not valid.');
  end;

  st := public.ebill_refund_state(p_invoice);
  select coalesce(sum((y ->> 'line_total')::numeric), 0) into total_lt from jsonb_array_elements(st -> 'lines') y;
  for l in select value from jsonb_array_elements(st -> 'lines') loop
    rem := (l ->> 'remaining')::numeric;
    if (l ->> 'qty')::numeric > 0 then before_val := before_val + (l ->> 'refunded')::numeric / (l ->> 'qty')::numeric * (l ->> 'line_total')::numeric; end if;
    k := l ->> 'line_no';
    if want ? k then
      v := (want ->> k)::numeric;
      if v > rem then
        return jsonb_build_object('ok', false, 'code', 'too_much', 'message', format('Only %s of "%s" can still be refunded.', rem, l ->> 'name'));
      end if;
      add_val := add_val + v / (l ->> 'qty')::numeric * (l ->> 'line_total')::numeric;
      out_lines := out_lines || jsonb_build_object('line_no', (l ->> 'line_no')::int, 'qty', v);
      rem := rem - v;
    end if;
    left_after := left_after + rem;
  end loop;
  if jsonb_array_length(out_lines) <> (select count(*) from jsonb_object_keys(want)) then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'One of those lines is not on this invoice.');
  end if;

  cum_before := coalesce((st ->> 'refunded_amount')::numeric, 0);
  if left_after = 0 then cum_after := i.net_total;                                  -- the last item: exactly what is left
  elsif total_lt > 0 then cum_after := round(i.net_total * (before_val + add_val) / total_lt, 2);
  else cum_after := cum_before; end if;
  amount := greatest(round(cum_after - cum_before, 2), 0);

  select coalesce(s.full_name, pr.username) into v_name from public.profiles pr left join public.staff s on s.id = pr.staff_id where pr.user_id = auth.uid();
  insert into public.ebill_invoice_events(invoice_id, kind, reason, amount, lines, request_id, created_by, created_by_name)
  values (p_invoice, 'refund', btrim(p_reason), amount, out_lines, p_request, auth.uid(), coalesce(v_name, 'Manager'))
  returning id into v_new;
  perform public.log_activity('ebill.invoice_refunded', 'ebill_invoices', p_invoice::text, null,
    jsonb_build_object('invoice_no', i.invoice_no, 'amount', amount, 'lines', out_lines, 'fully_refunded', left_after = 0), btrim(p_reason));
  return jsonb_build_object('ok', true, 'code', case when left_after = 0 then 'refunded' else 'partially_refunded' end,
    'amount', amount, 'refunded_total', cum_after, 'remaining_amount', round(i.net_total - cum_after, 2), 'remaining_qty', left_after);
end $$;

-- The whole of what is left (the Phase 4 button, kept): refund every remaining quantity.
create or replace function public.ebill_refund_invoice(p_invoice uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rest jsonb;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if not exists (select 1 from public.ebill_invoices where invoice_id = p_invoice) then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'No such invoice.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('line_no', (y ->> 'line_no')::int, 'qty', (y ->> 'remaining')::numeric)), '[]'::jsonb)
    into rest from jsonb_array_elements(public.ebill_refund_state(p_invoice) -> 'lines') y where (y ->> 'remaining')::numeric > 0;
  if jsonb_array_length(rest) = 0 then return jsonb_build_object('ok', true, 'code', 'already_refunded', 'message', 'This invoice was already refunded.'); end if;
  return public.ebill_refund_lines(p_invoice, rest, p_reason, null);
end $$;

-- Corrections stay blocked only once EVERYTHING has been refunded.
create or replace function public.ebill_correct_invoice(p_invoice uuid, p_changes jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.ebill_invoices%rowtype; k text; v text; old_v text; diff jsonb := '{}'::jsonb; v_name text;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Nothing to correct.'); end if;
  select * into i from public.ebill_invoices where invoice_id = p_invoice for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'No such invoice.'); end if;
  if exists (select 1 from public.ebill_invoice_events where invoice_id = p_invoice and kind = 'refund') and public.ebill_remaining_qty(p_invoice) = 0 then
    return jsonb_build_object('ok', false, 'code', 'refunded', 'message', 'A fully refunded invoice cannot be corrected.');
  end if;
  for k, v in select key, value from jsonb_each_text(p_changes) loop
    if k not in ('customer', 'payment_mode', 'comments') then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Only customer, payment mode and comments can be corrected. For amounts, refund and bill again.');
    end if;
    v := btrim(coalesce(v, ''));
    if k = 'payment_mode' and v not in ('Cash', 'Card', 'Credit') then return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Payment mode must be Cash, Card or Credit.'); end if;
    if (k = 'customer' and length(v) > 120) or (k = 'comments' and length(v) > 500) then return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'That text is too long.'); end if;
    old_v := public.ebill_effective(p_invoice, k);
    if v is distinct from old_v then diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_v, 'to', v)); end if;
  end loop;
  if diff = '{}'::jsonb then return jsonb_build_object('ok', false, 'code', 'no_change', 'message', 'Nothing was different.'); end if;
  select coalesce(s.full_name, pr.username) into v_name from public.profiles pr left join public.staff s on s.id = pr.staff_id where pr.user_id = auth.uid();
  insert into public.ebill_invoice_events(invoice_id, kind, reason, changes, created_by, created_by_name)
  values (p_invoice, 'correction', btrim(p_reason), diff, auth.uid(), coalesce(v_name, 'Manager'));
  perform public.log_activity('ebill.invoice_corrected', 'ebill_invoices', p_invoice::text, null, jsonb_build_object('invoice_no', i.invoice_no, 'changes', diff), btrim(p_reason));
  return jsonb_build_object('ok', true, 'code', 'corrected', 'changes', diff);
end $$;

revoke all on function public.ebill_refund_state(uuid), public.ebill_remaining_qty(uuid) from public, anon, authenticated;
revoke all on function public.ebill_refund_lines(uuid, jsonb, text, uuid), public.ebill_refund_invoice(uuid, text), public.ebill_correct_invoice(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.ebill_refund_lines(uuid, jsonb, text, uuid), public.ebill_refund_invoice(uuid, text), public.ebill_correct_invoice(uuid, jsonb, text) to authenticated;

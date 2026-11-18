-- 0631_ebill_events.sql — refunds and corrections. A posted invoice is never edited or deleted. A manager adds an EVENT to it:
--   refund      the whole invoice is given back (one per invoice, enforced by an index);
--   correction  a change to customer, payment mode or comments. Money fields are never corrected in place: refund and bill again.
-- Every event needs a reason, is attributed to the manager, is append-only, and is also written to the audit log.
-- What an invoice "is now" (refunded / corrected, corrected values) is worked out from its events, in ebill_history / ebill_invoice_detail.

create table public.ebill_invoice_events (
  id               bigint generated always as identity primary key,
  invoice_id       uuid not null references public.ebill_invoices(invoice_id),
  kind             text not null check (kind in ('refund','correction')),
  reason           text not null check (length(btrim(reason)) >= 3),
  amount           numeric(14,2) check (amount >= 0),
  changes          jsonb,
  created_by       uuid not null references auth.users(id),
  created_by_name  text not null,
  created_at       timestamptz not null default now()
);
create unique index ebill_events_one_refund on public.ebill_invoice_events (invoice_id) where kind = 'refund';
create index ebill_events_invoice_idx on public.ebill_invoice_events (invoice_id);
alter table public.ebill_invoice_events enable row level security;
create trigger ebill_events_frozen before update or delete on public.ebill_invoice_events for each row execute function public.ebill_no_change();
create trigger ebill_events_no_truncate before truncate on public.ebill_invoice_events for each statement execute function public.ebill_no_change();
revoke all on public.ebill_invoice_events from public, anon, authenticated;
grant select on public.ebill_invoice_events to authenticated;
create policy ebill_events_read on public.ebill_invoice_events for select to authenticated
  using (exists (select 1 from public.ebill_invoices i where i.invoice_id = ebill_invoice_events.invoice_id));

-- The value a field has NOW: the latest correction that set it, else what was originally saved.
create or replace function public.ebill_effective(p_invoice uuid, p_field text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.changes #>> array[p_field, 'to'] from public.ebill_invoice_events e
      where e.invoice_id = p_invoice and e.kind = 'correction' and e.changes ? p_field order by e.id desc limit 1),
    (select case p_field when 'customer' then i.customer when 'payment_mode' then i.payment_mode when 'comments' then i.comments end
       from public.ebill_invoices i where i.invoice_id = p_invoice));
$$;

create or replace function public.ebill_refund_invoice(p_invoice uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.ebill_invoices%rowtype; v_name text; v_new bigint;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  select * into i from public.ebill_invoices where invoice_id = p_invoice;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'No such invoice.'); end if;
  select coalesce(s.full_name, pr.username) into v_name from public.profiles pr left join public.staff s on s.id = pr.staff_id where pr.user_id = auth.uid();
  insert into public.ebill_invoice_events(invoice_id, kind, reason, amount, created_by, created_by_name)
  values (p_invoice, 'refund', btrim(p_reason), i.net_total, auth.uid(), coalesce(v_name, 'Manager'))
  on conflict (invoice_id) where kind = 'refund' do nothing returning id into v_new;
  if v_new is null then return jsonb_build_object('ok', true, 'code', 'already_refunded', 'message', 'This invoice was already refunded.'); end if;
  perform public.log_activity('ebill.invoice_refunded', 'ebill_invoices', p_invoice::text, null,
    jsonb_build_object('invoice_no', i.invoice_no, 'amount', i.net_total), btrim(p_reason));
  return jsonb_build_object('ok', true, 'code', 'refunded', 'amount', i.net_total);
end $$;

-- p_changes: { "customer": "...", "payment_mode": "Cash|Card|Credit", "comments": "..." }, any of them.
create or replace function public.ebill_correct_invoice(p_invoice uuid, p_changes jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.ebill_invoices%rowtype; k text; v text; old_v text; diff jsonb := '{}'::jsonb; v_name text;
begin
  if not public.has_perm('ebill.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Nothing to correct.'); end if;
  select * into i from public.ebill_invoices where invoice_id = p_invoice for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'No such invoice.'); end if;
  if exists (select 1 from public.ebill_invoice_events where invoice_id = p_invoice and kind = 'refund') then
    return jsonb_build_object('ok', false, 'code', 'refunded', 'message', 'A refunded invoice cannot be corrected.');
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

revoke all on function public.ebill_effective(uuid, text), public.ebill_refund_invoice(uuid, text), public.ebill_correct_invoice(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.ebill_refund_invoice(uuid, text), public.ebill_correct_invoice(uuid, jsonb, text) to authenticated;

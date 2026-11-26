-- 0226: the Credit Inbox may correct the date and amount of the entry it files (like Add to Ledger in the old app).
-- The filing snapshot keeps the Closing values, so "changed after filing" still compares Closing with Closing.
drop function public.mgmt_inbox_file(uuid, text, uuid, uuid, uuid, text, text, uuid);

create function public.mgmt_inbox_file(p_line_id uuid, p_target text, p_staff_id uuid, p_ledger uuid, p_category uuid, p_shift text,
                                       p_description text, p_key uuid, p_date date default null, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; ln record; op public.mgmt_credit_openings; lg public.mgmt_ledgers; ct public.mgmt_ledger_categories;
  v_desc text; v_shift text := nullif(trim(coalesce(p_shift, '')), ''); v_entry uuid; v_filing uuid; res jsonb; v_date date; v_amount numeric;
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
  -- The owner may correct the date and the amount of the entry that is made. The filing itself still records what Closing said
  -- (ln.business_date / ln.amount), so "changed after filing" keeps comparing Closing with Closing.
  v_date := coalesce(p_date, ln.business_date);
  v_amount := coalesce(p_amount, ln.amount);
  if v_amount = 0 then raise exception 'the amount cannot be zero'; end if;
  if v_date > today or v_date < date '2000-01-01' then raise exception 'the date is out of range'; end if;
  v_desc := left(coalesce(nullif(trim(coalesce(p_description, '')), ''), nullif(trim(ln.label), ''), 'Closing credit'), 200);

  if p_target = 'credit' then
    if not exists (select 1 from public.staff where id = p_staff_id) then raise exception 'pick a person'; end if;
    select * into op from public.mgmt_credit_openings where staff_id = p_staff_id order by seq desc limit 1;
    if op.id is not null and v_date < op.effective_month then raise exception 'the line''s date is before this person''s opening balance month'; end if;
    insert into public.mgmt_credit_entries (staff_id, entry_date, kind, amount, description, source, created_by)
      values (p_staff_id, v_date, 'entry', v_amount, v_desc, 'closing_inbox', auth.uid()) returning id into v_entry;
    insert into public.mgmt_credit_filings (line_id, action, business_date, amount, label, target_kind, staff_id, credit_entry_id, created_by)
      values (p_line_id, 'filed', ln.business_date, ln.amount, ln.label, 'credit', p_staff_id, v_entry, auth.uid()) returning id into v_filing;
  else
    select * into lg from public.mgmt_ledgers where id = p_ledger;
    if not found then raise exception 'pick a ledger'; end if;
    select * into ct from public.mgmt_ledger_categories where id = p_category and ledger_id = p_ledger;
    if not found then raise exception 'that category does not belong to this ledger'; end if;
    if ct.retired_at is not null then raise exception 'that category is retired'; end if;
    if v_amount < 0 then raise exception 'a negative line can only go to staff credit, or be dismissed'; end if;
    if lg.has_shift then
      if v_shift is null then raise exception 'pick a shift'; end if;
      if v_shift not in ('Morning', 'Evening', 'Night', 'Both', 'Off') then raise exception 'unknown shift'; end if;
    elsif v_shift is not null then raise exception 'this ledger has no shifts';
    end if;
    insert into public.mgmt_ledger_entries (ledger_id, category_id, entry_date, shift, description, amount, effect, source, created_by)
      values (p_ledger, p_category, v_date, v_shift, v_desc, v_amount, ct.direction, 'closing_inbox', auth.uid()) returning id into v_entry;
    insert into public.mgmt_credit_filings (line_id, action, business_date, amount, label, target_kind, ledger_id, category_id, ledger_entry_id, created_by)
      values (p_line_id, 'filed', ln.business_date, ln.amount, ln.label, 'ledger', p_ledger, p_category, v_entry, auth.uid()) returning id into v_filing;
  end if;

  perform public.log_activity('mgmt.inbox_filed', 'mgmt_credit_filings', v_filing::text, null,
    jsonb_build_object('line_id', p_line_id, 'target', p_target, 'business_date', v_date, 'amount', v_amount, 'closing_date', ln.business_date, 'closing_amount', ln.amount, 'entry_id', v_entry), null);
  res := jsonb_build_object('filing_id', v_filing, 'entry_id', v_entry, 'target', p_target);
  perform public.mgmt_idem_put(p_key, 'inbox_file', res);
  return res;
end $$;

revoke all on function public.mgmt_inbox_file(uuid, text, uuid, uuid, uuid, text, text, uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.mgmt_inbox_file(uuid, text, uuid, uuid, uuid, text, text, uuid, date, numeric) to authenticated;

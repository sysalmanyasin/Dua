-- 0202_closing_flow: create slot + save draft (with carry-forward), submit, correct by revision. Rules: BUSINESS_RULES 3-7.
-- Browsers call only the three public RPCs at the bottom; everything else here is internal.

alter table public.closings add column corrected_by uuid references auth.users (id);

-- Submit refuses until the inventory audit card is verified (brief C3). The owner can switch the check off while
-- Inventory is not live yet (settings_set, logged with a reason); it ships ON.
insert into public.settings (key, value, staff_visible) values ('closing.require_inventory_audit', 'true', false);

-- ── strict input readers (a bad value is refused, never silently turned into 0) ──────────────────
create function public.closing_amt(v jsonb, field text) returns numeric language plpgsql immutable set search_path = public as $$
declare x numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'number' then x := (v #>> '{}')::numeric;
  elsif jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then x := (v #>> '{}')::numeric;
  else raise exception 'invalid amount in %', field using errcode = '22023'; end if;
  if abs(x) > 99999999999 then raise exception 'amount too large in %', field using errcode = '22023'; end if;
  return round(x, 2);
end $$;

create function public.closing_qty(v jsonb, field text) returns numeric language plpgsql immutable set search_path = public as $$
declare x numeric;
begin
  x := public.closing_amt(v, field);
  if x < 0 or x > 10000000 then raise exception 'invalid quantity in %', field using errcode = '22023'; end if;
  return x;
end $$;

create function public.closing_txt(v jsonb, field text, max_len int default 120) returns text language plpgsql immutable set search_path = public as $$
declare t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return ''; end if;
  if jsonb_typeof(v) <> 'string' then raise exception 'invalid text in %', field using errcode = '22023'; end if;
  t := trim(v #>> '{}');
  if length(t) > max_len then raise exception 'text too long in %', field using errcode = '22023'; end if;
  return t;
end $$;

-- rows array of a payload key: absent -> null (leave as is), not an array or over 200 rows -> refused
create function public.closing_rows(p jsonb, k text) returns jsonb language plpgsql immutable set search_path = public as $$
begin
  if not (p ? k) or jsonb_typeof(p -> k) = 'null' then return null; end if;
  if jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 200 then
    raise exception 'invalid rows in %', k using errcode = '22023';
  end if;
  return p -> k;
end $$;

-- ── timeline and carry-forward ───────────────────────────────────────────────────────────────────
-- the latest SUBMITTED closing before this slot (drafts never carry). Brief CLS-6: if the slot just before was never
-- closed we carry from the latest earlier submitted one (the old app carried zeros there).
create function public.closing_previous(p_slot uuid) returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.closings c
  join public.closing_slots s on s.id = c.slot_id
  join public.closing_slots me on me.id = p_slot
  where c.status = 'submitted' and (s.business_date, s.seq) < (me.business_date, me.seq)
  order by s.business_date desc, s.seq desc limit 1
$$;
revoke all on function public.closing_previous(uuid) from public, anon, authenticated;

-- sets the carried-in figures of a DRAFT from its previous submitted closing (BUSINESS_RULES 6)
create function public.closing_apply_carry(p_closing uuid, p_copy_misc boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c public.closings; s public.closing_slots; v_src uuid; r public.closing_results; v_cc numeric := 0; v_night public.closings;
begin
  select * into c from public.closings where id = p_closing;
  select * into s from public.closing_slots where id = c.slot_id;
  v_src := public.closing_previous(c.slot_id);
  if v_src is null then
    update public.closings set source_closing_id = null, prev_cc = 0, prev_credit = 0, prev_deposits = 0, prev_cash = 0 where id = p_closing;
    return;
  end if;
  select * into r from public.closing_results where closing_id = v_src;
  if s.kind = 'night' then
    v_cc := r.cc_total;
  else
    -- Morning / Handover / Evening keep the Night's opening card figure of the same day (POS card totals are cumulative per day)
    select c2.* into v_night from public.closings c2 join public.closing_slots s2 on s2.id = c2.slot_id
      where c2.status = 'submitted' and s2.business_date = s.business_date and s2.kind = 'night';
    v_cc := coalesce(v_night.prev_cc, (select prev_cc from public.closings where id = v_src));
  end if;
  update public.closings set
    source_closing_id = v_src,
    prev_cc = v_cc,
    prev_credit = r.debt_e,
    prev_deposits = case when c.mode = 'final' then 0 else r.deposits_f end,
    prev_cash = case when c.mode = 'final' then 0 else r.liquid end
  where id = p_closing;
  if p_copy_misc then
    -- open misc charges carry on, keeping their charge_id so aging never depends on the label (C8)
    insert into public.closing_misc_rows (closing_id, charge_id, label, amount, sort)
    select p_closing, m.charge_id, m.label, m.amount, m.sort
    from public.closing_misc_rows m where m.closing_id = v_src and m.deleted_at is null;
  end if;
end $$;
revoke all on function public.closing_apply_carry(uuid, boolean) from public, anon, authenticated;

-- ── apply a payload to a DRAFT (internal) ────────────────────────────────────────────────────────
-- Scalars: a missing key keeps the stored value. Row lists: a present list replaces all rows of that section.
create function public.closing_apply_payload(p_closing uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare rows_ jsonb; e jsonb; i int; d int; vals int[] := array[5000, 1000, 500, 100, 50, 20, 10, 1]; area_ text; arr jsonb; o jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid payload' using errcode = '22023'; end if;
  update public.closings set
    sys_cash = case when p ? 'sys_cash' then public.closing_amt(p -> 'sys_cash', 'sys_cash') else sys_cash end,
    last_bill_no = case when p ? 'last_bill_no' then public.closing_qty(p -> 'last_bill_no', 'last_bill_no')::int else last_bill_no end,
    comp_sale = case when p ? 'comp_sale' then public.closing_amt(p -> 'comp_sale', 'comp_sale') else comp_sale end,
    alfalah = case when p ? 'alfalah' then public.closing_amt(p -> 'alfalah', 'alfalah') else alfalah end,
    keenu = case when p ? 'keenu' then public.closing_amt(p -> 'keenu', 'keenu') else keenu end,
    ret_manual_1 = case when p ? 'ret_manual_1' then public.closing_amt(p -> 'ret_manual_1', 'ret_manual_1') else ret_manual_1 end,
    ret_manual_2 = case when p ? 'ret_manual_2' then public.closing_amt(p -> 'ret_manual_2', 'ret_manual_2') else ret_manual_2 end,
    ret_manual_3 = case when p ? 'ret_manual_3' then public.closing_amt(p -> 'ret_manual_3', 'ret_manual_3') else ret_manual_3 end,
    ret_system = case when p ? 'ret_system' then public.closing_amt(p -> 'ret_system', 'ret_system') else ret_system end,
    book_bill_1 = case when p ? 'book_bill_1' then public.closing_amt(p -> 'book_bill_1', 'book_bill_1') else book_bill_1 end,
    book_bill_2 = case when p ? 'book_bill_2' then public.closing_amt(p -> 'book_bill_2', 'book_bill_2') else book_bill_2 end,
    extra_cash = case when p ? 'extra_cash' then public.closing_amt(p -> 'extra_cash', 'extra_cash') else extra_cash end,
    credit_adj = case when p ? 'credit_adj' then public.closing_amt(p -> 'credit_adj', 'credit_adj') else credit_adj end,
    prev_mediq = case when p ? 'prev_mediq' then public.closing_amt(p -> 'prev_mediq', 'prev_mediq') else prev_mediq end,
    final_sys_returns = case when p ? 'final_sys_returns' then public.closing_amt(p -> 'final_sys_returns', 'final_sys_returns') else final_sys_returns end
  where id = p_closing;

  if p ? 'overrides' and jsonb_typeof(p -> 'overrides') = 'object' then
    o := p -> 'overrides';
    update public.closings set
      ov_shift_sale = case when o -> 'shift_sale' is null or jsonb_typeof(o -> 'shift_sale') = 'null' or (o ->> 'shift_sale') = '' then null else public.closing_amt(o -> 'shift_sale', 'ov_shift_sale') end,
      ov_customers = case when o -> 'customers' is null or jsonb_typeof(o -> 'customers') = 'null' or (o ->> 'customers') = '' then null else public.closing_qty(o -> 'customers', 'ov_customers')::int end,
      ov_curr_cc = case when o -> 'curr_cc' is null or jsonb_typeof(o -> 'curr_cc') = 'null' or (o ->> 'curr_cc') = '' then null else public.closing_amt(o -> 'curr_cc', 'ov_curr_cc') end,
      ov_prev_cash = case when o -> 'prev_cash' is null or jsonb_typeof(o -> 'prev_cash') = 'null' or (o ->> 'prev_cash') = '' then null else public.closing_amt(o -> 'prev_cash', 'ov_prev_cash') end
    where id = p_closing;
  end if;

  rows_ := public.closing_rows(p, 'hs');
  if rows_ is not null then
    delete from public.closing_hs_rows where closing_id = p_closing; i := 0;
    for e in select * from jsonb_array_elements(rows_) loop
      i := i + 1;
      insert into public.closing_hs_rows (closing_id, label, amount, sort, deleted_at)
      values (p_closing, public.closing_txt(e -> 'label', 'hs.label'), public.closing_amt(e -> 'amount', 'hs.amount'), i,
              case when coalesce((e ->> 'deleted')::boolean, false) then now() end);
    end loop;
  end if;

  rows_ := public.closing_rows(p, 'strips');
  if rows_ is not null then
    delete from public.closing_strip_lines where closing_id = p_closing; i := 0;
    for e in select * from jsonb_array_elements(rows_) loop
      i := i + 1;
      insert into public.closing_strip_lines (closing_id, strip_id, label, price, qty, sort, deleted_at)
      values (p_closing, nullif(e ->> 'strip_id', '')::uuid, public.closing_txt(e -> 'label', 'strips.label'),
              public.closing_amt(e -> 'price', 'strips.price'), public.closing_qty(e -> 'qty', 'strips.qty'), i,
              case when coalesce((e ->> 'deleted')::boolean, false) then now() end);
    end loop;
  end if;

  rows_ := public.closing_rows(p, 'mediq');
  if rows_ is not null then
    delete from public.closing_mediq_orders where closing_id = p_closing; i := 0;
    for e in select * from jsonb_array_elements(rows_) loop
      i := i + 1;
      insert into public.closing_mediq_orders (closing_id, bill_no, collected, pharmacy_bill, sort, deleted_at)
      values (p_closing, public.closing_txt(e -> 'bill_no', 'mediq.bill_no', 60), public.closing_amt(e -> 'collected', 'mediq.collected'),
              public.closing_amt(e -> 'pharmacy_bill', 'mediq.pharmacy_bill'), i,
              case when coalesce((e ->> 'deleted')::boolean, false) then now() end);
    end loop;
  end if;

  rows_ := public.closing_rows(p, 'deposits');
  if rows_ is not null then
    delete from public.closing_deposits where closing_id = p_closing; i := 0;
    for e in select * from jsonb_array_elements(rows_) loop
      i := i + 1;
      insert into public.closing_deposits (closing_id, label, amount, sort, deleted_at)
      values (p_closing, public.closing_txt(e -> 'label', 'deposits.label'), public.closing_amt(e -> 'amount', 'deposits.amount'), i,
              case when coalesce((e ->> 'deleted')::boolean, false) then now() end);
    end loop;
  end if;

  rows_ := public.closing_rows(p, 'misc');
  if rows_ is not null then
    delete from public.closing_misc_rows where closing_id = p_closing; i := 0;
    for e in select * from jsonb_array_elements(rows_) loop
      i := i + 1;
      insert into public.closing_misc_rows (closing_id, charge_id, label, amount, sort, deleted_at)
      values (p_closing, coalesce(nullif(e ->> 'charge_id', '')::uuid, gen_random_uuid()), public.closing_txt(e -> 'label', 'misc.label'),
              public.closing_amt(e -> 'amount', 'misc.amount'), i,
              case when coalesce((e ->> 'deleted')::boolean, false) then now() end);
    end loop;
  end if;

  -- cash counts: till / vault, each an array of 8 counts in the order 5000, 1000, 500, 100, 50, 20, 10, 1
  foreach area_ in array array['till', 'vault'] loop
    if p ? area_ and jsonb_typeof(p -> area_) <> 'null' then
      if jsonb_typeof(p -> area_) <> 'array' or jsonb_array_length(p -> area_) > 8 then
        raise exception 'invalid cash count in %', area_ using errcode = '22023';
      end if;
      delete from public.closing_cash_counts where closing_id = p_closing and area = area_;
      for d in 1..8 loop
        insert into public.closing_cash_counts (closing_id, area, denomination, qty)
        values (p_closing, area_, vals[d], public.closing_qty(p -> area_ -> (d - 1), area_ || '.' || vals[d]));
      end loop;
    end if;
  end loop;

  -- credit: named / tier / free lines are THIS shift's new amounts (CLS-4). line_id stays the same across saves and revisions.
  if p ? 'credit' and jsonb_typeof(p -> 'credit') = 'object' then
    arr := p -> 'credit';
    if arr ? 'named' or arr ? 'tier' or arr ? 'free' then
      delete from public.closing_credit_lines where closing_id = p_closing
        and kind = any (array[case when arr ? 'named' then 'named' end, case when arr ? 'tier' then 'tier' end, case when arr ? 'free' then 'free' end]);
    end if;
    foreach area_ in array array['named', 'free'] loop
      rows_ := public.closing_rows(arr, area_); i := 0;
      if rows_ is not null then
        for e in select * from jsonb_array_elements(rows_) loop
          i := i + 1;
          insert into public.closing_credit_lines (closing_id, line_id, kind, account_id, label, amount, sort, deleted_at)
          values (p_closing, coalesce(nullif(e ->> 'line_id', '')::uuid, gen_random_uuid()), area_, nullif(e ->> 'account_id', '')::uuid,
                  public.closing_txt(e -> 'label', 'credit.label'), public.closing_amt(e -> 'amount', 'credit.amount'), i,
                  case when coalesce((e ->> 'deleted')::boolean, false) then now() end);
        end loop;
      end if;
    end loop;
    rows_ := public.closing_rows(arr, 'tier');
    if rows_ is not null then
      if jsonb_array_length(rows_) > 3 then raise exception 'at most 3 tier slots' using errcode = '22023'; end if;
      i := 0;
      for e in select * from jsonb_array_elements(rows_) loop
        i := i + 1;
        insert into public.closing_credit_lines (closing_id, line_id, kind, tier_slot, label, amount, sort)
        values (p_closing, coalesce(nullif(e ->> 'line_id', '')::uuid, gen_random_uuid()), 'tier', i,
                public.closing_txt(e -> 'label', 'credit.tier.label'), public.closing_amt(e -> 'amount', 'credit.tier.amount'), i);
      end loop;
    end if;
  end if;
end $$;
revoke all on function public.closing_apply_payload(uuid, jsonb) from public, anon, authenticated;

-- ── RPC 1: save a draft (creates the slot and the draft on first save; idempotent on p_key) ──────
create function public.closing_save_draft(p_key uuid, p_date date, p_kind text, p_mode text, p_payload jsonb, p_handover_seq int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.closings; v_slot uuid; v_seq int; v_today date; v_staff uuid; v_new boolean := false;
begin
  if not public.has_perm('closing.enter_own') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key is null or p_date is null then raise exception 'key and date are required' using errcode = '22023'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid payload' using errcode = '22023'; end if;
  if p_kind not in ('night', 'morning', 'evening', 'handover') then raise exception 'invalid slot kind' using errcode = '22023'; end if;
  if p_mode not in ('shift', 'final') then raise exception 'invalid mode' using errcode = '22023'; end if;
  v_today := (now() at time zone coalesce((select value #>> '{}' from public.settings where key = 'business_timezone'), 'Asia/Karachi'))::date;
  if p_date < date '2000-01-01' or p_date > v_today + 1 then raise exception 'date out of range' using errcode = '22023'; end if;

  select * into c from public.closings where idempotency_key = p_key for update;
  if found then
    if c.entered_by <> auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
    if c.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000'; end if;
    if (select business_date from public.closing_slots where id = c.slot_id) <> p_date
       or (select kind from public.closing_slots where id = c.slot_id) <> p_kind then
      raise exception 'this key belongs to another slot' using errcode = '22023';
    end if;
  else
    v_new := true;
    v_seq := case p_kind when 'night' then 10 when 'morning' then 20 when 'evening' then 9999
      else coalesce(p_handover_seq,
        (select greatest(coalesce(max(seq) filter (where kind <> 'evening'), 20), 20) + 10 from public.closing_slots where business_date = p_date)) end;
    insert into public.closing_slots (business_date, kind, seq) values (p_date, p_kind, v_seq) on conflict do nothing;
    select id into v_slot from public.closing_slots where business_date = p_date and kind = p_kind and seq = v_seq;
    if exists (select 1 from public.closings where slot_id = v_slot and status in ('draft', 'submitted')) then
      raise exception 'a closing already exists for this slot' using errcode = '23505';
    end if;
    select staff_id into v_staff from public.profiles where user_id = auth.uid();
    insert into public.closings (slot_id, mode, entered_by, idempotency_key, responsible_staff_id)
    values (v_slot, p_mode, auth.uid(), p_key, v_staff) returning * into c;
  end if;

  if p_payload ? 'responsible_staff_id' and jsonb_typeof(p_payload -> 'responsible_staff_id') = 'string' then
    if not exists (select 1 from public.staff where id = (p_payload ->> 'responsible_staff_id')::uuid and active) then
      raise exception 'responsible staff member not found' using errcode = '22023';
    end if;
    update public.closings set responsible_staff_id = (p_payload ->> 'responsible_staff_id')::uuid where id = c.id;
  end if;
  update public.closings set mode = p_mode where id = c.id;
  if v_new then perform public.closing_apply_carry(c.id, true); end if;
  perform public.closing_apply_payload(c.id, p_payload);
  perform public.closing_apply_carry(c.id, false); -- mode or an earlier closing may have changed since the last save
  select * into c from public.closings where id = c.id;
  return jsonb_build_object('closing_id', c.id, 'slot_id', c.slot_id, 'status', c.status, 'updated_at', c.updated_at);
end $$;

-- ── RPC 2: submit (checks run here, never only in the browser) ───────────────────────────────────
create function public.closing_submit(p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.closings; r jsonb; v_require boolean; v_audit public.closing_inventory_audit; v_notified boolean := false;
begin
  if not public.has_perm('closing.enter_own') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.closings where idempotency_key = p_key for update;
  if not found or c.entered_by <> auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.status = 'submitted' then -- a retry after a lost reply: same answer, nothing done twice
    return jsonb_build_object('closing_id', c.id, 'status', c.status, 'already', true, 'result', to_jsonb((select x from public.closing_results x where x.closing_id = c.id)));
  end if;
  if c.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000'; end if;

  if c.responsible_staff_id is null or not exists (select 1 from public.staff where id = c.responsible_staff_id and active) then
    raise exception 'choose the responsible staff member' using errcode = '22023';
  end if;
  v_require := coalesce((select (value #>> '{}')::boolean from public.settings where key = 'closing.require_inventory_audit'), true);
  if v_require then
    select * into v_audit from public.closing_inventory_audit where closing_id = c.id;
    if not found or v_audit.verified_at is null then raise exception 'inventory audit not verified' using errcode = '22023'; end if;
  end if;

  perform public.closing_apply_carry(c.id, false); -- last look at the previous closing before it freezes
  update public.closings set status = 'submitted', submitted_at = now() where id = c.id;
  perform public.closing_write_result(c.id);
  r := to_jsonb((select x from public.closing_results x where closing_id = c.id));
  perform public.log_activity('closing.submitted', 'closing', c.id::text, null, r, null);

  -- tell the owner (Foundation F4). A failure here never undoes a saved closing.
  if to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    begin
      execute 'select public.notify_owner($1, $2)' using 'closing.submitted', jsonb_build_object('closing_id', c.id);
      v_notified := true;
    exception when others then
      perform public.log_activity('closing.notify_failed', 'closing', c.id::text, null, jsonb_build_object('error', sqlerrm), null);
    end;
  end if;
  return jsonb_build_object('closing_id', c.id, 'status', 'submitted', 'already', false, 'notified', v_notified, 'result', r);
end $$;

-- ── RPC 3: correct a submitted closing (new revision; the original is kept, D-12) ────────────────
create function public.closing_correct(p_closing uuid, p_reason text, p_changes jsonb, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_ public.closings; n public.closings; r jsonb; ex public.closings;
begin
  if not public.has_perm('closing.correct') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  -- a retry after a lost reply returns the revision that already exists
  select * into ex from public.closings where idempotency_key = p_key;
  if found then
    if ex.supersedes_id is distinct from p_closing then raise exception 'this key is already used' using errcode = '22023'; end if;
    return jsonb_build_object('closing_id', ex.id, 'revision', ex.revision, 'already', true);
  end if;
  select * into old_ from public.closings where id = p_closing for update;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  if old_.status <> 'submitted' then raise exception 'only the current submitted closing can be corrected' using errcode = '55000'; end if;

  update public.closings set status = 'superseded' where id = old_.id;
  insert into public.closings (slot_id, mode, revision, supersedes_id, responsible_staff_id, entered_by, idempotency_key, correction_reason, corrected_by,
    sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, book_bill_2,
    extra_cash, credit_adj, credit_adj_line_id, prev_mediq, final_sys_returns, ov_shift_sale, ov_customers, ov_curr_cc, ov_prev_cash,
    prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id)
  select slot_id, mode, revision + 1, id, responsible_staff_id, entered_by, p_key, trim(p_reason), auth.uid(),
    sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, book_bill_2,
    extra_cash, credit_adj, credit_adj_line_id, prev_mediq, final_sys_returns, ov_shift_sale, ov_customers, ov_curr_cc, ov_prev_cash,
    prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id
  from public.closings where id = old_.id
  returning * into n;
  -- copy every section; credit lines and misc rows keep their stable ids
  insert into public.closing_hs_rows (closing_id, label, amount, sort, deleted_at) select n.id, label, amount, sort, deleted_at from public.closing_hs_rows where closing_id = old_.id;
  insert into public.closing_strip_lines (closing_id, strip_id, label, price, qty, sort, deleted_at) select n.id, strip_id, label, price, qty, sort, deleted_at from public.closing_strip_lines where closing_id = old_.id;
  insert into public.closing_cash_counts (closing_id, area, denomination, qty) select n.id, area, denomination, qty from public.closing_cash_counts where closing_id = old_.id;
  insert into public.closing_credit_lines (closing_id, line_id, kind, account_id, tier_slot, label, amount, sort, deleted_at) select n.id, line_id, kind, account_id, tier_slot, label, amount, sort, deleted_at from public.closing_credit_lines where closing_id = old_.id;
  insert into public.closing_deposits (closing_id, label, amount, sort, deleted_at) select n.id, label, amount, sort, deleted_at from public.closing_deposits where closing_id = old_.id;
  insert into public.closing_mediq_orders (closing_id, bill_no, collected, pharmacy_bill, sort, deleted_at) select n.id, bill_no, collected, pharmacy_bill, sort, deleted_at from public.closing_mediq_orders where closing_id = old_.id;
  insert into public.closing_misc_rows (closing_id, charge_id, label, amount, sort, deleted_at) select n.id, charge_id, label, amount, sort, deleted_at from public.closing_misc_rows where closing_id = old_.id;
  insert into public.closing_inventory_audit select n.id, verified_at, verified_by, data_as_of, codes_checked, not_found from public.closing_inventory_audit where closing_id = old_.id;
  insert into public.closing_inventory_audit_items select n.id, item_code, item_name, qty from public.closing_inventory_audit_items where closing_id = old_.id;

  if p_changes is not null and jsonb_typeof(p_changes) = 'object' then perform public.closing_apply_payload(n.id, p_changes); end if;
  update public.closings set status = 'submitted', submitted_at = now() where id = n.id;
  perform public.closing_write_result(n.id);
  r := to_jsonb((select x from public.closing_results x where closing_id = n.id));
  perform public.log_activity('closing.corrected', 'closing', n.id::text,
    to_jsonb((select x from public.closing_results x where closing_id = old_.id)), r, trim(p_reason));
  return jsonb_build_object('closing_id', n.id, 'revision', n.revision, 'already', false, 'result', r);
end $$;

revoke all on function public.closing_amt(jsonb, text), public.closing_qty(jsonb, text), public.closing_txt(jsonb, text, int),
  public.closing_rows(jsonb, text) from public, anon, authenticated;
revoke all on function public.closing_save_draft(uuid, date, text, text, jsonb, int), public.closing_submit(uuid),
  public.closing_correct(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.closing_save_draft(uuid, date, text, text, jsonb, int), public.closing_submit(uuid),
  public.closing_correct(uuid, text, jsonb, uuid) to authenticated;

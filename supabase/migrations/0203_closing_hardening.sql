-- 0203_closing_hardening: Session A, step A1. Brief: docs/modules/closing.md (CLS-6..CLS-15). Rules: BUSINESS_RULES 3-7.
--  * every refusal carries a machine code in the error HINT (the English message is unchanged), so the screens can explain it (G3)
--  * CLS-6  a slot cannot be skipped: the slot before must be submitted, unless this closing is Final or the opening
--  * CLS-10 the first closing is an OPENING Final entered by an admin (closing.settings); its carried-in figures can be typed
--  * CLS-12 submit refuses when the carried-in figures (or their source closing) changed since the cashier last saved
--  * CLS-13 a draft has a version; an older save is refused (draft_conflict)
--  * CLS-7  "reopen" a submitted closing = a draft revision of it; resubmitting replaces it, the original is kept (D-12)
--  * CLS-14 closing_staff_choices(); G7 closing_my_recent()
-- Money rules are NOT touched: closing_calc / closing_build_input / closing_write_result stay exactly as in 0201.

-- ── columns and indexes ──────────────────────────────────────────────────────────────────────────
alter table public.closings
  add column is_opening boolean not null default false,
  add column draft_version int not null default 1 check (draft_version >= 1);

-- a reopened submitted closing has a draft revision beside it until it is resubmitted, so "one live" becomes
-- "one submitted" and "one draft" per slot (superseded revisions are still kept for audit)
drop index public.closings_one_live_per_slot;
create unique index closings_one_submitted_per_slot on public.closings (slot_id) where status = 'submitted';
create unique index closings_one_draft_per_slot on public.closings (slot_id) where status = 'draft';
-- only one opening closing may ever be live (a reopened revision of it is not a second opening)
create unique index closings_one_opening on public.closings ((true)) where is_opening and supersedes_id is null and status in ('draft', 'submitted');

-- ── strict readers, now with machine codes (same checks and messages as 0202) ───────────────────
create or replace function public.closing_amt(v jsonb, field text) returns numeric language plpgsql immutable set search_path = public as $$
declare x numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'number' then x := (v #>> '{}')::numeric;
  elsif jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then x := (v #>> '{}')::numeric;
  else raise exception 'invalid amount in %', field using errcode = '22023', hint = 'invalid_amount'; end if;
  if abs(x) > 99999999999 then raise exception 'amount too large in %', field using errcode = '22023', hint = 'amount_too_large'; end if;
  return round(x, 2);
end $$;

create or replace function public.closing_qty(v jsonb, field text) returns numeric language plpgsql immutable set search_path = public as $$
declare x numeric;
begin
  x := public.closing_amt(v, field);
  if x < 0 or x > 10000000 then raise exception 'invalid quantity in %', field using errcode = '22023', hint = 'invalid_quantity'; end if;
  return x;
end $$;

create or replace function public.closing_txt(v jsonb, field text, max_len int default 120) returns text language plpgsql immutable set search_path = public as $$
declare t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return ''; end if;
  if jsonb_typeof(v) <> 'string' then raise exception 'invalid text in %', field using errcode = '22023', hint = 'invalid_text'; end if;
  t := trim(v #>> '{}');
  if length(t) > max_len then raise exception 'text too long in %', field using errcode = '22023', hint = 'text_too_long'; end if;
  return t;
end $$;

create or replace function public.closing_rows(p jsonb, k text) returns jsonb language plpgsql immutable set search_path = public as $$
begin
  if not (p ? k) or jsonb_typeof(p -> k) = 'null' then return null; end if;
  if jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 200 then
    raise exception 'invalid rows in %', k using errcode = '22023', hint = 'invalid_rows';
  end if;
  return p -> k;
end $$;

-- ── who may edit a closing (internal) ────────────────────────────────────────────────────────────
-- ordinary draft: its cashier. Opening draft: an admin (closing.settings). Draft revision of a submitted closing: whoever
-- reopened it, with closing.correct. A cashier can therefore never edit or submit a revision of their own closing.
create function public.closing_can_edit(c public.closings) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when c.supersedes_id is not null then c.corrected_by = auth.uid() and public.has_perm('closing.correct')
    when c.is_opening then c.entered_by = auth.uid() and public.has_perm('closing.settings')
    else c.entered_by = auth.uid() and public.has_perm('closing.enter_own') end
$$;
revoke all on function public.closing_can_edit(public.closings) from public, anon, authenticated;

-- CLS-6: is the slot before this one submitted? Night needs yesterday's Evening, Morning needs the Night, a handover or the
-- Evening needs the latest Morning/handover before it on the same day. Handovers are optional, Morning and Night are not.
create function public.closing_previous_slot_submitted(p_date date, p_kind text, p_seq int) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_slot uuid;
begin
  if p_kind = 'night' then
    select s.id into v_slot from public.closing_slots s where s.business_date = p_date - 1 and s.kind = 'evening';
  elsif p_kind = 'morning' then
    select s.id into v_slot from public.closing_slots s where s.business_date = p_date and s.kind = 'night';
  else
    select s.id into v_slot from public.closing_slots s
      where s.business_date = p_date and s.kind in ('morning', 'handover') and s.seq < p_seq order by s.seq desc limit 1;
  end if;
  if v_slot is null then return false; end if;
  return exists (select 1 from public.closings c where c.slot_id = v_slot and c.status = 'submitted');
end $$;
revoke all on function public.closing_previous_slot_submitted(date, text, int) from public, anon, authenticated;

-- ── carry-forward: an opening closing keeps the figures typed by the admin ───────────────────────
create or replace function public.closing_apply_carry(p_closing uuid, p_copy_misc boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c public.closings; s public.closing_slots; v_src uuid; r public.closing_results; v_cc numeric := 0; v_night public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if c.is_opening then return; end if; -- the opening's carried-in figures are typed, not derived
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
    insert into public.closing_misc_rows (closing_id, charge_id, label, amount, sort)
    select p_closing, m.charge_id, m.label, m.amount, m.sort
    from public.closing_misc_rows m where m.closing_id = v_src and m.deleted_at is null;
  end if;
end $$;

-- ── apply a payload to a DRAFT (internal). Same as 0202, plus machine codes and the opening's typed figures ──
create or replace function public.closing_apply_payload(p_closing uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare rows_ jsonb; e jsonb; i int; d int; vals int[] := array[5000, 1000, 500, 100, 50, 20, 10, 1]; area_ text; arr jsonb; o jsonb; op jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload'; end if;
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

  -- CLS-10: the carried-in figures of the OPENING closing are typed (card, credit, deposits, cash). Refused anywhere else.
  if p ? 'opening' and jsonb_typeof(p -> 'opening') <> 'null' then
    if not (select is_opening from public.closings where id = p_closing) then
      raise exception 'opening figures belong only to the opening closing' using errcode = '22023', hint = 'opening_only';
    end if;
    if jsonb_typeof(p -> 'opening') <> 'object' then raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload'; end if;
    op := p -> 'opening';
    update public.closings set
      prev_cc = case when op ? 'cc' then public.closing_amt(op -> 'cc', 'opening.cc') else prev_cc end,
      prev_credit = case when op ? 'credit' then public.closing_amt(op -> 'credit', 'opening.credit') else prev_credit end,
      prev_deposits = case when op ? 'deposits' then public.closing_amt(op -> 'deposits', 'opening.deposits') else prev_deposits end,
      prev_cash = case when op ? 'cash' then public.closing_amt(op -> 'cash', 'opening.cash') else prev_cash end
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

  foreach area_ in array array['till', 'vault'] loop
    if p ? area_ and jsonb_typeof(p -> area_) <> 'null' then
      if jsonb_typeof(p -> area_) <> 'array' or jsonb_array_length(p -> area_) > 8 then
        raise exception 'invalid cash count in %', area_ using errcode = '22023', hint = 'invalid_cash_count';
      end if;
      delete from public.closing_cash_counts where closing_id = p_closing and area = area_;
      for d in 1..8 loop
        insert into public.closing_cash_counts (closing_id, area, denomination, qty)
        values (p_closing, area_, vals[d], public.closing_qty(p -> area_ -> (d - 1), area_ || '.' || vals[d]));
      end loop;
    end if;
  end loop;

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
      if jsonb_array_length(rows_) > 3 then raise exception 'at most 3 tier slots' using errcode = '22023', hint = 'too_many_tiers'; end if;
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

-- copy every section of one closing onto another (used by correct and reopen). Credit lines and misc rows keep their stable ids.
create function public.closing_clone_children(p_from uuid, p_to uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.closing_hs_rows (closing_id, label, amount, sort, deleted_at) select p_to, label, amount, sort, deleted_at from public.closing_hs_rows where closing_id = p_from;
  insert into public.closing_strip_lines (closing_id, strip_id, label, price, qty, sort, deleted_at) select p_to, strip_id, label, price, qty, sort, deleted_at from public.closing_strip_lines where closing_id = p_from;
  insert into public.closing_cash_counts (closing_id, area, denomination, qty) select p_to, area, denomination, qty from public.closing_cash_counts where closing_id = p_from;
  insert into public.closing_credit_lines (closing_id, line_id, kind, account_id, tier_slot, label, amount, sort, deleted_at) select p_to, line_id, kind, account_id, tier_slot, label, amount, sort, deleted_at from public.closing_credit_lines where closing_id = p_from;
  insert into public.closing_deposits (closing_id, label, amount, sort, deleted_at) select p_to, label, amount, sort, deleted_at from public.closing_deposits where closing_id = p_from;
  insert into public.closing_mediq_orders (closing_id, bill_no, collected, pharmacy_bill, sort, deleted_at) select p_to, bill_no, collected, pharmacy_bill, sort, deleted_at from public.closing_mediq_orders where closing_id = p_from;
  insert into public.closing_misc_rows (closing_id, charge_id, label, amount, sort, deleted_at) select p_to, charge_id, label, amount, sort, deleted_at from public.closing_misc_rows where closing_id = p_from;
  insert into public.closing_inventory_audit select p_to, verified_at, verified_by, data_as_of, codes_checked, not_found from public.closing_inventory_audit where closing_id = p_from;
  insert into public.closing_inventory_audit_items select p_to, item_code, item_name, qty from public.closing_inventory_audit_items where closing_id = p_from;
end $$;
revoke all on function public.closing_clone_children(uuid, uuid) from public, anon, authenticated;

-- ── RPC 1: save a draft (CLS-6, CLS-13) ──────────────────────────────────────────────────────────
drop function public.closing_save_draft(uuid, date, text, text, jsonb, int);
create function public.closing_save_draft(p_key uuid, p_date date, p_kind text, p_mode text, p_payload jsonb,
  p_handover_seq int default null, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.closings; v_slot uuid; v_seq int; v_today date; v_staff uuid; v_new boolean := false;
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_key is null or p_date is null then raise exception 'key and date are required' using errcode = '22023', hint = 'invalid_payload'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload'; end if;
  if p_kind not in ('night', 'morning', 'evening', 'handover') then raise exception 'invalid slot kind' using errcode = '22023', hint = 'invalid_slot_kind'; end if;
  if p_mode not in ('shift', 'final') then raise exception 'invalid mode' using errcode = '22023', hint = 'invalid_mode'; end if;
  v_today := (now() at time zone coalesce((select value #>> '{}' from public.settings where key = 'business_timezone'), 'Asia/Karachi'))::date;
  if p_date < date '2000-01-01' or p_date > v_today + 1 then raise exception 'date out of range' using errcode = '22023', hint = 'date_out_of_range'; end if;

  select * into c from public.closings where idempotency_key = p_key for update;
  if found then
    if not public.closing_can_edit(c) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
    if c.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000', hint = 'closing_locked'; end if;
    if (select business_date from public.closing_slots where id = c.slot_id) <> p_date
       or (select kind from public.closing_slots where id = c.slot_id) <> p_kind then
      raise exception 'this key belongs to another slot' using errcode = '22023', hint = 'key_other_slot';
    end if;
    if c.is_opening and p_mode <> 'final' then raise exception 'the opening closing is always Final' using errcode = '22023', hint = 'invalid_mode'; end if;
    -- CLS-13: the browser sends the version it last saw. A missing version is accepted only as the retry of the very first save.
    if (p_expected_version is null and c.draft_version > 1) or (p_expected_version is not null and p_expected_version <> c.draft_version) then
      raise exception 'this draft was changed on another device' using errcode = '55000', hint = 'draft_conflict', detail = 'version=' || c.draft_version;
    end if;
  else
    if not public.has_perm('closing.enter_own') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
    v_new := true;
    v_seq := case p_kind when 'night' then 10 when 'morning' then 20 when 'evening' then 9999
      else coalesce(p_handover_seq,
        (select greatest(coalesce(max(seq) filter (where kind <> 'evening'), 20), 20) + 10 from public.closing_slots where business_date = p_date)) end;
    if p_kind = 'handover' and (v_seq < 21 or v_seq > 9998) then raise exception 'invalid slot kind' using errcode = '22023', hint = 'invalid_slot_kind'; end if;
    -- CLS-10: nothing can be entered before the opening closing exists and is submitted
    if not exists (select 1 from public.closings where status = 'submitted' and is_opening) then
      raise exception 'the opening closing must be submitted first' using errcode = '55000', hint = 'opening_required';
    end if;
    -- a new closing must come after everything already submitted (history is never filled in behind later closings)
    if exists (select 1 from public.closings x join public.closing_slots xs on xs.id = x.slot_id
               where x.status = 'submitted' and (xs.business_date, xs.seq) > (p_date, v_seq)) then
      raise exception 'a later closing is already submitted' using errcode = '55000', hint = 'slot_in_past';
    end if;
    -- CLS-6: no skipped slots. A Final closing is the only way past a gap.
    if p_mode = 'shift' and not public.closing_previous_slot_submitted(p_date, p_kind, v_seq) then
      raise exception 'the slot before has not been submitted' using errcode = '55000', hint = 'previous_slot_open';
    end if;
    insert into public.closing_slots (business_date, kind, seq) values (p_date, p_kind, v_seq) on conflict do nothing;
    select id into v_slot from public.closing_slots where business_date = p_date and kind = p_kind and seq = v_seq;
    if exists (select 1 from public.closings where slot_id = v_slot and status in ('draft', 'submitted')) then
      raise exception 'a closing already exists for this slot' using errcode = '23505', hint = 'slot_taken';
    end if;
    select staff_id into v_staff from public.profiles where user_id = auth.uid();
    insert into public.closings (slot_id, mode, entered_by, idempotency_key, responsible_staff_id)
    values (v_slot, p_mode, auth.uid(), p_key, v_staff) returning * into c;
  end if;

  if p_payload ? 'responsible_staff_id' and jsonb_typeof(p_payload -> 'responsible_staff_id') = 'string' then
    if not exists (select 1 from public.staff where id = (p_payload ->> 'responsible_staff_id')::uuid and active) then
      raise exception 'responsible staff member not found' using errcode = '22023', hint = 'responsible_not_found';
    end if;
    update public.closings set responsible_staff_id = (p_payload ->> 'responsible_staff_id')::uuid where id = c.id;
  end if;
  update public.closings set mode = p_mode where id = c.id;
  if v_new then perform public.closing_apply_carry(c.id, true); end if;
  perform public.closing_apply_payload(c.id, p_payload);
  perform public.closing_apply_carry(c.id, false); -- mode or an earlier closing may have changed since the last save
  if not v_new then update public.closings set draft_version = draft_version + 1 where id = c.id; end if;
  select * into c from public.closings where id = c.id;
  return jsonb_build_object('closing_id', c.id, 'slot_id', c.slot_id, 'status', c.status, 'version', c.draft_version,
    'updated_at', c.updated_at, 'is_opening', c.is_opening);
end $$;

-- ── RPC 1b: start the opening closing (CLS-10). Admin only; it is always Final and must be the first closing ──
create function public.closing_start_opening(p_key uuid, p_date date, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.closings; v_slot uuid; v_seq int; v_today date;
begin
  if not public.has_perm('closing.settings') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  select * into c from public.closings where idempotency_key = p_key;
  if found then -- a retry after a lost reply
    if not c.is_opening or c.entered_by <> auth.uid() then raise exception 'this key is already used' using errcode = '22023', hint = 'key_used'; end if;
    return jsonb_build_object('closing_id', c.id, 'slot_id', c.slot_id, 'status', c.status, 'version', c.draft_version, 'already', true);
  end if;
  if p_key is null or p_date is null then raise exception 'key and date are required' using errcode = '22023', hint = 'invalid_payload'; end if;
  if p_kind not in ('night', 'morning', 'evening') then raise exception 'invalid slot kind' using errcode = '22023', hint = 'invalid_slot_kind'; end if;
  v_today := (now() at time zone coalesce((select value #>> '{}' from public.settings where key = 'business_timezone'), 'Asia/Karachi'))::date;
  if p_date < date '2000-01-01' or p_date > v_today + 1 then raise exception 'date out of range' using errcode = '22023', hint = 'date_out_of_range'; end if;
  if exists (select 1 from public.closings where status = 'submitted') then
    raise exception 'an opening closing must be the first closing' using errcode = '55000', hint = 'opening_not_first';
  end if;
  if exists (select 1 from public.closings where is_opening and status in ('draft', 'submitted')) then
    raise exception 'an opening closing already exists' using errcode = '23505', hint = 'opening_exists';
  end if;
  v_seq := case p_kind when 'night' then 10 when 'morning' then 20 else 9999 end;
  insert into public.closing_slots (business_date, kind, seq) values (p_date, p_kind, v_seq) on conflict do nothing;
  select id into v_slot from public.closing_slots where business_date = p_date and kind = p_kind and seq = v_seq;
  if exists (select 1 from public.closings where slot_id = v_slot and status in ('draft', 'submitted')) then
    raise exception 'a closing already exists for this slot' using errcode = '23505', hint = 'slot_taken';
  end if;
  insert into public.closings (slot_id, mode, entered_by, idempotency_key, is_opening)
  values (v_slot, 'final', auth.uid(), p_key, true) returning * into c;
  perform public.log_activity('closing.opening_started', 'closing', c.id::text, null,
    jsonb_build_object('business_date', p_date, 'kind', p_kind), null);
  return jsonb_build_object('closing_id', c.id, 'slot_id', c.slot_id, 'status', c.status, 'version', c.draft_version, 'already', false);
end $$;

-- ── RPC 2: submit (CLS-6 re-check, CLS-12 guard, revision replaces its original) ─────────────────
create or replace function public.closing_submit(p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.closings; c2 public.closings; old_ public.closings; s public.closing_slots; r jsonb; v_require boolean;
  v_audit public.closing_inventory_audit; v_notified boolean := false; v_old_result jsonb;
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select * into c from public.closings where idempotency_key = p_key for update;
  if not found or not public.closing_can_edit(c) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.status = 'submitted' then -- a retry after a lost reply: same answer, nothing done twice
    return jsonb_build_object('closing_id', c.id, 'status', c.status, 'already', true, 'result', to_jsonb((select x from public.closing_results x where x.closing_id = c.id)));
  end if;
  if c.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000', hint = 'closing_locked'; end if;
  select * into s from public.closing_slots where id = c.slot_id;

  -- the opening closing is typed by an admin: no responsible-staff or inventory-audit step. A revision keeps what the original had.
  if not c.is_opening and (c.responsible_staff_id is null or not exists (select 1 from public.staff where id = c.responsible_staff_id and active)) then
    raise exception 'choose the responsible staff member' using errcode = '22023', hint = 'choose_responsible';
  end if;
  v_require := coalesce((select (value #>> '{}')::boolean from public.settings where key = 'closing.require_inventory_audit'), true);
  if v_require and not c.is_opening and c.supersedes_id is null then
    select * into v_audit from public.closing_inventory_audit where closing_id = c.id;
    if not found or v_audit.verified_at is null then raise exception 'inventory audit not verified' using errcode = '22023', hint = 'audit_not_verified'; end if;
  end if;

  -- CLS-6 again at the moment of submitting (the earlier slot must still be submitted, and a first closing must be the opening)
  if c.mode = 'shift' and not c.is_opening and c.supersedes_id is null
     and not public.closing_previous_slot_submitted(s.business_date, s.kind, s.seq) then
    raise exception 'the slot before has not been submitted' using errcode = '55000', hint = 'previous_slot_open';
  end if;

  -- CLS-12: look at the previous closing one last time. If what this closing carries in has changed since the cashier last
  -- saved, refuse (the refusal also undoes the refresh); the next save pulls the new figures in and the cashier reviews them.
  if not c.is_opening then
    perform public.closing_apply_carry(c.id, false);
    select * into c2 from public.closings where id = c.id;
    if c2.source_closing_id is distinct from c.source_closing_id or c2.prev_cc <> c.prev_cc or c2.prev_credit <> c.prev_credit
       or c2.prev_deposits <> c.prev_deposits or c2.prev_cash <> c.prev_cash then
      raise exception 'opening figures changed, review and submit again' using errcode = '55000', hint = 'carry_changed';
    end if;
  end if;

  if c.supersedes_id is not null then
    select * into old_ from public.closings where id = c.supersedes_id for update;
    if old_.status <> 'submitted' then raise exception 'only the current submitted closing can be corrected' using errcode = '55000', hint = 'not_current'; end if;
    v_old_result := to_jsonb((select x from public.closing_results x where x.closing_id = old_.id));
    update public.closings set status = 'superseded' where id = old_.id;
  end if;
  update public.closings set status = 'submitted', submitted_at = now() where id = c.id;
  perform public.closing_write_result(c.id);
  r := to_jsonb((select x from public.closing_results x where closing_id = c.id));
  if c.supersedes_id is not null then
    perform public.log_activity('closing.corrected', 'closing', c.id::text, v_old_result, r, c.correction_reason);
    return jsonb_build_object('closing_id', c.id, 'status', 'submitted', 'already', false, 'revision', c.revision, 'notified', false, 'result', r);
  end if;
  perform public.log_activity(case when c.is_opening then 'closing.opening_submitted' else 'closing.submitted' end, 'closing', c.id::text, null, r, null);

  if not c.is_opening and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    begin
      execute 'select public.notify_owner($1, $2)' using 'closing.submitted', jsonb_build_object('closing_id', c.id);
      v_notified := true;
    exception when others then
      perform public.log_activity('closing.notify_failed', 'closing', c.id::text, null, jsonb_build_object('error', sqlerrm), null);
    end;
  end if;
  return jsonb_build_object('closing_id', c.id, 'status', 'submitted', 'already', false, 'notified', v_notified, 'result', r);
end $$;

-- ── RPC 3: correct a submitted closing in one step (new revision, original kept, D-12) ───────────
create or replace function public.closing_correct(p_closing uuid, p_reason text, p_changes jsonb, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_ public.closings; n public.closings; r jsonb; ex public.closings;
begin
  if not public.has_perm('closing.correct') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into ex from public.closings where idempotency_key = p_key;
  if found then
    if ex.supersedes_id is distinct from p_closing then raise exception 'this key is already used' using errcode = '22023', hint = 'key_used'; end if;
    return jsonb_build_object('closing_id', ex.id, 'revision', ex.revision, 'already', true);
  end if;
  select * into old_ from public.closings where id = p_closing for update;
  if not found then raise exception 'not found' using errcode = '42501', hint = 'not_allowed'; end if;
  if old_.status <> 'submitted' then raise exception 'only the current submitted closing can be corrected' using errcode = '55000', hint = 'not_current'; end if;
  if exists (select 1 from public.closings where slot_id = old_.slot_id and status = 'draft') then
    raise exception 'this closing is already open for editing' using errcode = '55000', hint = 'revision_open';
  end if;

  update public.closings set status = 'superseded' where id = old_.id;
  insert into public.closings (slot_id, mode, revision, supersedes_id, responsible_staff_id, entered_by, idempotency_key, correction_reason, corrected_by, is_opening,
    sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, book_bill_2,
    extra_cash, credit_adj, credit_adj_line_id, prev_mediq, final_sys_returns, ov_shift_sale, ov_customers, ov_curr_cc, ov_prev_cash,
    prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id)
  select slot_id, mode, revision + 1, id, responsible_staff_id, entered_by, p_key, trim(p_reason), auth.uid(), is_opening,
    sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, book_bill_2,
    extra_cash, credit_adj, credit_adj_line_id, prev_mediq, final_sys_returns, ov_shift_sale, ov_customers, ov_curr_cc, ov_prev_cash,
    prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id
  from public.closings where id = old_.id
  returning * into n;
  perform public.closing_clone_children(old_.id, n.id);

  if p_changes is not null and jsonb_typeof(p_changes) = 'object' then perform public.closing_apply_payload(n.id, p_changes); end if;
  update public.closings set status = 'submitted', submitted_at = now() where id = n.id;
  perform public.closing_write_result(n.id);
  r := to_jsonb((select x from public.closing_results x where closing_id = n.id));
  perform public.log_activity('closing.corrected', 'closing', n.id::text,
    to_jsonb((select x from public.closing_results x where x.closing_id = old_.id)), r, trim(p_reason));
  return jsonb_build_object('closing_id', n.id, 'revision', n.revision, 'already', false, 'result', r);
end $$;

-- ── RPC 4: reopen a submitted closing for editing (CLS-7) ────────────────────────────────────────
-- Makes a DRAFT revision with the original's figures. The original stays submitted (and keeps feeding later closings) until
-- the revision is submitted; then it becomes superseded and stays on record with the reason.
create function public.closing_reopen(p_closing uuid, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_ public.closings; n public.closings; ex public.closings;
begin
  if not public.has_perm('closing.correct') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  if p_key is null then raise exception 'key and date are required' using errcode = '22023', hint = 'invalid_payload'; end if;
  select * into ex from public.closings where idempotency_key = p_key;
  if found then
    if ex.supersedes_id is distinct from p_closing or ex.corrected_by is distinct from auth.uid() then raise exception 'this key is already used' using errcode = '22023', hint = 'key_used'; end if;
    return jsonb_build_object('closing_id', ex.id, 'revision', ex.revision, 'version', ex.draft_version, 'status', ex.status, 'already', true);
  end if;
  select * into old_ from public.closings where id = p_closing for update;
  if not found then raise exception 'not found' using errcode = '42501', hint = 'not_allowed'; end if;
  if old_.status <> 'submitted' then raise exception 'only the current submitted closing can be corrected' using errcode = '55000', hint = 'not_current'; end if;
  if exists (select 1 from public.closings where slot_id = old_.slot_id and status = 'draft') then
    raise exception 'this closing is already open for editing' using errcode = '55000', hint = 'revision_open';
  end if;
  insert into public.closings (slot_id, mode, revision, supersedes_id, responsible_staff_id, entered_by, idempotency_key, correction_reason, corrected_by, is_opening,
    sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, book_bill_2,
    extra_cash, credit_adj, credit_adj_line_id, prev_mediq, final_sys_returns, ov_shift_sale, ov_customers, ov_curr_cc, ov_prev_cash,
    prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id)
  select slot_id, mode, revision + 1, id, responsible_staff_id, entered_by, p_key, trim(p_reason), auth.uid(), is_opening,
    sys_cash, last_bill_no, comp_sale, alfalah, keenu, ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, book_bill_2,
    extra_cash, credit_adj, credit_adj_line_id, prev_mediq, final_sys_returns, ov_shift_sale, ov_customers, ov_curr_cc, ov_prev_cash,
    prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id
  from public.closings where id = old_.id
  returning * into n;
  perform public.closing_clone_children(old_.id, n.id);
  perform public.log_activity('closing.reopened', 'closing', n.id::text, null, jsonb_build_object('original', old_.id, 'revision', n.revision), trim(p_reason));
  return jsonb_build_object('closing_id', n.id, 'revision', n.revision, 'version', n.draft_version, 'status', n.status, 'already', false);
end $$;

-- ── RPC 5: give up a reopened revision (the original is untouched) ───────────────────────────────
create function public.closing_discard_revision(p_closing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing for update;
  if not found or c.supersedes_id is null or not public.closing_can_edit(c) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000', hint = 'closing_locked'; end if;
  delete from public.closings where id = c.id;
  perform public.log_activity('closing.revision_discarded', 'closing', c.id::text, null, jsonb_build_object('original', c.supersedes_id), c.correction_reason);
  return jsonb_build_object('discarded', true, 'original', c.supersedes_id);
end $$;

-- ── G7: reads the screens need (CLS-14) ──────────────────────────────────────────────────────────
-- names of active staff members, for "responsible staff". A junior can read only their own staff row, so this is a function.
create function public.closing_staff_choices() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review')
          or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name) order by full_name) from public.staff where active), '[]');
end $$;

-- my own live closings, newest first: drafts to resume (with their key and version) and submitted ones
create function public.closing_my_recent(p_limit int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.business_date desc, x.seq desc, x.revision desc) from (
      select c.id as closing_id, c.idempotency_key as key, s.business_date, s.kind, s.seq, c.mode, c.status, c.revision, c.is_opening,
             c.supersedes_id, c.draft_version as version, c.submitted_at, c.updated_at
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      where c.status in ('draft', 'submitted')
        and ((c.supersedes_id is null and c.entered_by = auth.uid())
          or (c.supersedes_id is not null and c.status = 'draft' and c.corrected_by = auth.uid()))
      order by s.business_date desc, s.seq desc, c.revision desc
      limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) x), '[]');
end $$;

-- ── grants: the browser calls only the public RPCs ───────────────────────────────────────────────
revoke all on function public.closing_save_draft(uuid, date, text, text, jsonb, int, int), public.closing_start_opening(uuid, date, text),
  public.closing_submit(uuid), public.closing_correct(uuid, text, jsonb, uuid), public.closing_reopen(uuid, text, uuid),
  public.closing_discard_revision(uuid), public.closing_staff_choices(), public.closing_my_recent(int) from public, anon, authenticated;
grant execute on function public.closing_save_draft(uuid, date, text, text, jsonb, int, int), public.closing_start_opening(uuid, date, text),
  public.closing_submit(uuid), public.closing_correct(uuid, text, jsonb, uuid), public.closing_reopen(uuid, text, uuid),
  public.closing_discard_revision(uuid), public.closing_staff_choices(), public.closing_my_recent(int) to authenticated;
revoke all on function public.closing_amt(jsonb, text), public.closing_qty(jsonb, text), public.closing_txt(jsonb, text, int),
  public.closing_rows(jsonb, text), public.closing_apply_payload(uuid, jsonb), public.closing_apply_carry(uuid, boolean)
  from public, anon, authenticated;

-- 0217: shared drafts + live sync + field-level saving for the closing ledger.
--  * a regular draft (not an opening, not a correction) can be seen and edited by every user who can enter closings;
--    the owner (closing.review / closing.correct) can always save it, author or not.        (amends C10)
--  * closings joins the Realtime publication so every open device hears about a change at once.
--  * closing_patch_draft saves single simple fields (amounts, returns, books, overrides, responsible) without the whole-draft
--    version check; the list sections still go through closing_save_draft with its version check (CLS-13).
begin;

-- ── who counts as the owner, and what a shared draft is ──
create or replace function public.closing_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm('closing.review') or public.has_perm('closing.correct')
$$;
create or replace function public.closing_is_shared_draft(c public.closings) returns boolean
language sql stable set search_path = public as $$
  select c.status = 'draft' and c.supersedes_id is null and not c.is_opening
$$;
revoke all on function public.closing_is_owner() from public, anon, authenticated;
revoke all on function public.closing_is_shared_draft(public.closings) from public, anon, authenticated;

create or replace function public.closing_can_edit(c public.closings) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when c.supersedes_id is not null then (c.corrected_by = auth.uid() and public.has_perm('closing.correct')) or public.closing_is_owner()
    when c.is_opening then (c.entered_by = auth.uid() and public.has_perm('closing.settings')) or public.closing_is_owner()
    else public.has_perm('closing.enter_own') or public.closing_is_owner() end
$$;

-- ── reading: every closing user sees the shared drafts ──
drop policy if exists closings_read on public.closings;
create policy closings_read on public.closings for select to authenticated using (
  public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
  or (public.has_perm('closing.enter_own')
      and (entered_by = auth.uid() or (status = 'draft' and supersedes_id is null and not is_opening)))
);

create or replace function public.closing_compute(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if not found or not (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
          or (public.has_perm('closing.enter_own') and (c.entered_by = auth.uid() or public.closing_is_shared_draft(c)))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.closing_calc(public.closing_build_input(p_closing));
end $$;

create or replace function public.closing_period(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if not found or not (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
          or (public.has_perm('closing.enter_own') and (c.entered_by = auth.uid() or public.closing_is_shared_draft(c)))) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return public.closing_period_agg(p_closing);
end $$;

create or replace function public.closing_prev_page(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if not found or not (
       public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
       or (public.has_perm('closing.enter_own')
           and (c.entered_by = auth.uid() or c.corrected_by = auth.uid() or public.closing_is_shared_draft(c)))
     ) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if c.source_closing_id is null then return null; end if;
  -- closing_page_json only returns submitted closings, and 0214 lets every closing user read those
  return public.closing_page_json(c.source_closing_id);
end $$;

-- the inventory audit of a shared draft can be verified by anyone who may edit it
create or replace function public.closing_audit_verify(p_key uuid, p_digest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.closings; p jsonb; v_staff uuid;
begin
  select * into c from public.closings where idempotency_key = p_key and status = 'draft';
  if not found or not (public.has_perm('closing.correct') or public.closing_can_edit(c)) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.is_opening then raise exception 'the opening closing has no audit' using errcode = '22023', hint = 'audit_not_needed'; end if;
  if exists (select 1 from public.closing_inventory_audit a where a.closing_id = c.id) then
    raise exception 'already verified' using errcode = '22023', hint = 'audit_already_verified'; end if;
  p := public.closing_audit_preview();
  if p ->> 'digest' is distinct from p_digest then raise exception 'stock changed' using errcode = '22023', hint = 'audit_changed'; end if;
  select staff_id into v_staff from public.profiles where user_id = auth.uid();
  insert into public.closing_inventory_audit (closing_id, verified_at, verified_by, data_as_of, codes_checked, not_found)
  values (c.id, now(), v_staff, nullif(p ->> 'data_as_of', '')::timestamptz, (p ->> 'codes_checked')::int,
          coalesce(array(select jsonb_array_elements_text(p -> 'not_found')), '{}'::text[]));
  insert into public.closing_inventory_audit_items (closing_id, item_code, item_name, qty)
  select c.id, e ->> 'code', coalesce(e ->> 'name', ''), (e ->> 'qty')::numeric from jsonb_array_elements(p -> 'items') e;
  perform public.log_activity('closing.audit_verified', 'closing', c.id::text, null,
    jsonb_build_object('items', jsonb_array_length(p -> 'items'), 'codes_checked', p -> 'codes_checked'), null);
  return (p - 'digest') || jsonb_build_object('verified_at', now());
end $$;

create or replace function public.closing_refresh_draft(p_closing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.closings;
  v_old_source uuid;
  v_new_source uuid;
begin
  if not (public.has_perm('closing.enter_own') or public.closing_is_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into c from public.closings where id = p_closing for update;
  if not found or not public.closing_can_edit(c) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.status <> 'draft' then
    raise exception 'only a draft can refresh carry-forward values' using errcode = '55000';
  end if;

  v_old_source := c.source_closing_id;
  v_new_source := public.closing_previous(c.slot_id);

  perform public.closing_apply_carry(c.id, false);

  if v_old_source is distinct from v_new_source and v_old_source is not null then
    update public.closing_misc_rows target
       set deleted_at = coalesce(target.deleted_at, now())
     where target.closing_id = c.id
       and target.deleted_at is null
       and exists (
         select 1 from public.closing_misc_rows old_row
          where old_row.closing_id = v_old_source
            and old_row.charge_id = target.charge_id
       )
       and not exists (
         select 1 from public.closing_misc_rows new_row
          where new_row.closing_id = v_new_source
            and new_row.charge_id = target.charge_id
            and new_row.deleted_at is null
       );
  end if;

  if v_new_source is not null then
    insert into public.closing_misc_rows (closing_id, charge_id, label, amount, sort)
    select c.id, source_row.charge_id, source_row.label, source_row.amount, source_row.sort
      from public.closing_misc_rows source_row
     where source_row.closing_id = v_new_source
       and source_row.deleted_at is null
       and not exists (
         select 1 from public.closing_misc_rows target
          where target.closing_id = c.id
            and target.charge_id = source_row.charge_id
       );
  end if;

  return jsonb_build_object('closing_id', c.id, 'source_closing_id', v_new_source, 'refreshed', true);
end $$;

-- the start page lists the shared drafts too, with who is responsible and whether the draft is the caller's own
create or replace function public.closing_my_recent(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.business_date desc, x.seq desc, x.revision desc) from (
      select c.id as closing_id, c.idempotency_key as key, s.business_date, s.kind, s.seq, c.mode, c.status, c.revision, c.is_opening,
             c.supersedes_id, c.draft_version as version, c.submitted_at, c.updated_at,
             (c.entered_by = auth.uid()) as mine, st.full_name as staff
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      left join public.staff st on st.id = c.responsible_staff_id
      where c.status in ('draft', 'submitted')
        and ((c.supersedes_id is null and c.entered_by = auth.uid())
          or (c.supersedes_id is not null and c.status = 'draft' and c.corrected_by = auth.uid())
          or (c.status = 'draft' and c.supersedes_id is null and not c.is_opening
              and (public.has_perm('closing.enter_own') or public.closing_is_owner())))
      order by s.business_date desc, s.seq desc, c.revision desc
      limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) x), '[]');
end $$;

-- ── field-level saving (Step B) ──
-- Saves only the simple fields it is given. No whole-draft version check: two people typing in different fields never collide,
-- and two people typing in the same field end up with the last one saved (as in a shared sheet).
-- The list sections (rows, cash counts, credit, opening figures) are refused here: they go through closing_save_draft.
create or replace function public.closing_patch_draft(p_key uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.closings; k text; o jsonb; merged jsonb;
  allowed text[] := array['sys_cash', 'last_bill_no', 'last_bill_amt', 'comp_sale', 'alfalah', 'keenu', 'ret_manual_1', 'ret_manual_2',
    'ret_manual_3', 'ret_system', 'book_bill_1', 'book_bill_2', 'prev_mediq', 'extra_cash', 'final_sys_returns', 'credit_adj',
    'responsible_staff_id', 'overrides'];
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_key is null or p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any (allowed)) then
      raise exception 'only simple fields can be patched: %', k using errcode = '22023', hint = 'patch_simple_only';
    end if;
  end loop;

  select * into c from public.closings where idempotency_key = p_key for update;
  if not found or not public.closing_can_edit(c) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000', hint = 'closing_locked'; end if;

  merged := p_fields - 'responsible_staff_id';
  if p_fields ? 'overrides' then
    if jsonb_typeof(p_fields -> 'overrides') <> 'object' then raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload'; end if;
    for k in select jsonb_object_keys(p_fields -> 'overrides') loop
      if k not in ('shift_sale', 'customers', 'curr_cc', 'prev_cash') then
        raise exception 'invalid payload' using errcode = '22023', hint = 'invalid_payload';
      end if;
    end loop;
    -- closing_apply_payload sets all four overrides from one object, so start from the saved values and lay the given ones over them
    o := jsonb_build_object('shift_sale', c.ov_shift_sale, 'customers', c.ov_customers, 'curr_cc', c.ov_curr_cc, 'prev_cash', c.ov_prev_cash)
         || (p_fields -> 'overrides');
    merged := jsonb_set(merged, '{overrides}', o);
  end if;

  if p_fields ? 'responsible_staff_id' and jsonb_typeof(p_fields -> 'responsible_staff_id') = 'string' then
    if not exists (select 1 from public.staff where id = (p_fields ->> 'responsible_staff_id')::uuid and active) then
      raise exception 'responsible staff member not found' using errcode = '22023', hint = 'responsible_not_found';
    end if;
    update public.closings set responsible_staff_id = (p_fields ->> 'responsible_staff_id')::uuid where id = c.id;
  end if;

  perform public.closing_apply_payload(c.id, merged);
  select * into c from public.closings where id = c.id;
  return jsonb_build_object('closing_id', c.id, 'version', c.draft_version, 'updated_at', c.updated_at);
end $$;
revoke all on function public.closing_patch_draft(uuid, jsonb) from public, anon;
grant execute on function public.closing_patch_draft(uuid, jsonb) to authenticated;

-- ── live sync: every open device hears about a change to a draft ──
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'closings') then
    alter publication supabase_realtime add table public.closings;
  end if;
end $$;

commit;

-- Refresh carried-forward values when an existing draft is reopened.
-- Preserve the draft's entered fields and manual misc edits; only reconcile carry data.
create or replace function public.closing_refresh_draft(p_closing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.closings;
  v_old_source uuid;
  v_new_source uuid;
begin
  if not public.has_perm('closing.enter_own') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into c from public.closings where id = p_closing for update;
  if not found or c.entered_by <> auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.status <> 'draft' then
    raise exception 'only a draft can refresh carry-forward values' using errcode = '55000';
  end if;

  v_old_source := c.source_closing_id;
  v_new_source := public.closing_previous(c.slot_id);

  -- Refresh scalar balances from the latest submitted predecessor.
  perform public.closing_apply_carry(c.id, false);

  -- If the predecessor changed, retire only carried charges that were present in
  -- the old predecessor but are no longer outstanding in the new predecessor.
  -- User-created rows and rows the user already struck through are untouched.
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

  -- Add newly outstanding charges once. Existing rows (including struck-through
  -- rows) are deliberately not revived or duplicated.
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

  return jsonb_build_object(
    'closing_id', c.id,
    'source_closing_id', v_new_source,
    'refreshed', true
  );
end $$;

revoke all on function public.closing_refresh_draft(uuid) from public, anon;
grant execute on function public.closing_refresh_draft(uuid) to authenticated;

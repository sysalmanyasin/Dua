-- 0218_closing_mode_change: the Owner can change a closing between Shift and Final.
--  * Only the Owner (an active admin profile at MFA level aal2) may change a closing's mode. Enforced twice in the database:
--    inside closing_change_mode, and by a trigger on closings that refuses ANY change of `mode` made outside that function,
--    whoever calls and by whatever route (closing_save_draft included). A frontend check alone is never enough.
--  * A DRAFT changes mode in place. Every figure and every child row stays; only the carried-in figures are re-derived for
--    the new mode (the same closing_apply_carry a normal save runs), and draft_version goes up so other devices reload.
--  * A SUBMITTED closing goes through the existing correction workflow: closing_change_mode calls closing_reopen (new draft
--    revision, original stays submitted, reason kept) and then changes the revision's mode. The Owner edits the revision with
--    the normal screens and resubmits with the normal closing_submit, which supersedes the original only at that moment (CLS-7).
--  * CLS-6 (no skipped slot) is re-checked when the new mode is Shift: only a Final may follow a gap.
--  * Audit: one activity_log row per change (old mode, new mode, who, reason, revision, original), written in the same
--    transaction as the change. A reopen also writes its own closing.reopened row, as it always did.
-- Money rules are NOT touched: closing_calc, closing_build_input, closing_write_result, closing_apply_carry, closing_reopen,
-- closing_submit and closing_save_draft are all unchanged.
begin;

-- ── who is the Owner ──
-- Deliberately not has_perm(): a senior who was granted closing.correct by hand is not the Owner. Admin + aal2 (MFA), active profile.
create or replace function public.closing_is_admin_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
    where pr.user_id = auth.uid()
      and pr.role_template = 'admin'
      and pr.disabled_at is null
      and (pr.expires_at is null or pr.expires_at > now())
      and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;
revoke all on function public.closing_is_admin_owner() from public, anon, authenticated;

-- ── the database-level guard: mode never changes except through closing_change_mode ──
-- The function sets a transaction-local token equal to the current transaction id; nothing else can know it in advance, and
-- authenticated users have no UPDATE grant on closings at all. The trigger also re-checks the Owner and that the row is a draft.
create or replace function public.closing_mode_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mode is distinct from old.mode then
    if coalesce(current_setting('dua.closing_mode_change', true), '') is distinct from pg_current_xact_id()::text
       or not public.closing_is_admin_owner() then
      raise exception 'only the Owner can change the closing type' using errcode = '42501', hint = 'mode_change_owner_only';
    end if;
    if old.status <> 'draft' then
      raise exception 'closing is locked' using errcode = '55000', hint = 'closing_locked';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.closing_mode_guard() from public, anon, authenticated;
drop trigger if exists closings_mode_guard on public.closings;
create trigger closings_mode_guard before update of mode on public.closings
  for each row execute function public.closing_mode_guard();

-- ── RPC: change the mode of a draft, or of a submitted closing by reopening it as a revision ──
create or replace function public.closing_change_mode(p_closing uuid, p_new_mode text, p_reason text, p_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.closings; d public.closings; s public.closing_slots;
  v_old text; v_rev jsonb; v_orig uuid; v_orig_rev int; v_from text;
begin
  if not public.closing_is_admin_owner() then
    raise exception 'only the Owner can change the closing type' using errcode = '42501', hint = 'mode_change_owner_only';
  end if;
  if p_new_mode is null or p_new_mode not in ('shift', 'final') then
    raise exception 'invalid mode' using errcode = '22023', hint = 'invalid_mode';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required';
  end if;

  select * into c from public.closings where id = p_closing for update;
  if not found then raise exception 'not found' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.is_opening then
    raise exception 'the opening closing is always Final' using errcode = '22023', hint = 'invalid_mode';
  end if;
  select * into s from public.closing_slots where id = c.slot_id;
  v_from := c.status;

  if c.status = 'submitted' then
    -- the existing correction workflow: a draft revision with the original's figures and child rows; the original stays
    -- submitted (and keeps feeding later closings) until the revision is submitted. closing_reopen checks the permission,
    -- the reason, "no revision already open" and replays safely for the same key.
    if p_key is null then raise exception 'key is required' using errcode = '22023', hint = 'invalid_payload'; end if;
    v_rev := public.closing_reopen(c.id, p_reason, p_key);
    v_orig := c.id;
    v_orig_rev := c.revision;
    select * into d from public.closings where id = (v_rev ->> 'closing_id')::uuid for update;
    if coalesce((v_rev ->> 'already')::boolean, false) and d.mode = p_new_mode then
      -- a retry after a lost reply: the revision exists and already has the new mode, nothing more is done
      return jsonb_build_object('closing_id', d.id, 'original_closing_id', v_orig, 'revision', d.revision, 'status', d.status,
        'old_mode', c.mode, 'new_mode', d.mode, 'version', d.draft_version, 'already', true);
    end if;
    if d.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000', hint = 'closing_locked'; end if;
  elsif c.status = 'draft' then
    d := c;
  else
    raise exception 'only the current submitted closing can be corrected' using errcode = '55000', hint = 'not_current';
  end if;

  v_old := case when v_orig is not null then c.mode else d.mode end;
  if d.mode = p_new_mode then
    raise exception 'the closing is already of that type' using errcode = '22023', hint = 'mode_unchanged';
  end if;

  -- CLS-6: a slot cannot be skipped. A Final closing is the only way past a gap, so a closing may become Shift only when the
  -- slot before it is submitted. (Anything refused here rolls back the whole call, including a revision just reopened.)
  if p_new_mode = 'shift' and not public.closing_previous_slot_submitted(s.business_date, s.kind, s.seq) then
    raise exception 'the slot before has not been submitted' using errcode = '55000', hint = 'previous_slot_open';
  end if;

  perform set_config('dua.closing_mode_change', pg_current_xact_id()::text, true);
  update public.closings set mode = p_new_mode, draft_version = draft_version + 1 where id = d.id;
  perform set_config('dua.closing_mode_change', '', true);
  -- the carried-in figures depend on the mode (a Final starts cash and deposits at 0); re-derive them exactly as a save does,
  -- so the later closing_submit carry check (CLS-12) sees figures that match the new mode. Child rows are not touched.
  perform public.closing_apply_carry(d.id, false);

  select * into d from public.closings where id = d.id;
  perform public.log_activity('closing.mode_changed', 'closing', d.id::text,
    jsonb_build_object('mode', v_old, 'closing_id', coalesce(v_orig, d.id), 'revision', coalesce(v_orig_rev, d.revision), 'status', v_from),
    jsonb_build_object('mode', d.mode, 'closing_id', d.id, 'revision', d.revision, 'status', d.status,
      'original_closing_id', v_orig, 'slot_id', d.slot_id, 'business_date', s.business_date, 'slot_kind', s.kind,
      'reopened', v_orig is not null),
    trim(p_reason));

  return jsonb_build_object('closing_id', d.id, 'original_closing_id', v_orig, 'revision', d.revision, 'status', d.status,
    'old_mode', v_old, 'new_mode', d.mode, 'version', d.draft_version, 'already', false);
end $$;
revoke all on function public.closing_change_mode(uuid, text, text, uuid) from public, anon;
grant execute on function public.closing_change_mode(uuid, text, text, uuid) to authenticated;

commit;

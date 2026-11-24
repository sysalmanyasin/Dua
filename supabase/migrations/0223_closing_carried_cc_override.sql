-- 0223_closing_carried_cc_override.sql — "Carried CC from Previous" is editable on a FINAL closing.
-- Range 0200-0299 (Closing).
--
-- Until now every draft re-derived prev_cc from the previous closing on each open, save and submit (closing_apply_carry),
-- so a typed value could never stick. This adds a hand override, like ov_curr_cc / ov_prev_cash:
--   * closings.ov_prev_cc (null = use the carried figure). A typed 0 counts.
--   * closing_apply_carry honours it ONLY while the closing's mode is 'final'; a Shift closing always carries the real figure,
--     so switching a closing back to Shift drops the override's effect without losing what was typed.
--   * closing_apply_payload / closing_patch_draft accept overrides.prev_cc (apply_payload leaves it alone when the key is
--     absent, so an older cached page that does not send it cannot wipe it).
--   * closing_reopen / closing_correct copy it to the revision, so a Final opened for correction starts from what was entered.
-- The functions are rewritten from their live definitions with exact-string replacements; each replacement is asserted.

alter table public.closings add column if not exists ov_prev_cc numeric(14, 2);

do $mig$
declare
  d text;
  oid_ oid;
  fn text;
  patched text;
begin
  -- closing_apply_carry
  select p.oid into oid_ from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'closing_apply_carry';
  d := pg_get_functiondef(oid_);
  patched := replace(d, 'prev_cc = 0, prev_credit = 0', 'prev_cc = case when c.mode = ''final'' then coalesce(c.ov_prev_cc, 0) else 0 end, prev_credit = 0');
  patched := replace(patched, '    prev_cc = v_cc,', '    prev_cc = case when c.mode = ''final'' then coalesce(c.ov_prev_cc, v_cc) else v_cc end,');
  if patched = d or position('ov_prev_cc' in patched) = 0 or (length(patched) - length(replace(patched, 'ov_prev_cc', ''))) / length('ov_prev_cc') <> 2 then
    raise exception 'closing_apply_carry: expected text not found';
  end if;
  execute patched;

  -- closing_apply_payload
  select p.oid into oid_ from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'closing_apply_payload';
  d := pg_get_functiondef(oid_);
  patched := replace(d, 'public.closing_amt(o -> ''prev_cash'', ''ov_prev_cash'') end',
    'public.closing_amt(o -> ''prev_cash'', ''ov_prev_cash'') end,' || E'\n' ||
    '      ov_prev_cc = case when not (o ? ''prev_cc'') then ov_prev_cc when o -> ''prev_cc'' is null or jsonb_typeof(o -> ''prev_cc'') = ''null'' or (o ->> ''prev_cc'') = '''' then null else public.closing_amt(o -> ''prev_cc'', ''ov_prev_cc'') end');
  if patched = d then raise exception 'closing_apply_payload: expected text not found'; end if;
  execute patched;

  -- closing_patch_draft
  select p.oid into oid_ from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'closing_patch_draft';
  d := pg_get_functiondef(oid_);
  patched := replace(d, '''curr_cc'', ''prev_cash'') then', '''curr_cc'', ''prev_cash'', ''prev_cc'') then');
  patched := replace(patched, '''prev_cash'', c.ov_prev_cash)', '''prev_cash'', c.ov_prev_cash, ''prev_cc'', c.ov_prev_cc)');
  if (length(patched) - length(replace(patched, 'prev_cc', ''))) / length('prev_cc') <> 3 then
    raise exception 'closing_patch_draft: expected text not found';
  end if;
  execute patched;

  -- closing_reopen, closing_correct
  foreach fn in array array['closing_reopen', 'closing_correct'] loop
    select p.oid into oid_ from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    d := pg_get_functiondef(oid_);
    patched := replace(d, 'ov_curr_cc, ov_prev_cash,', 'ov_curr_cc, ov_prev_cash, ov_prev_cc,');
    if patched = d then raise exception '%: expected text not found', fn; end if;
    execute patched;
  end loop;
end
$mig$;

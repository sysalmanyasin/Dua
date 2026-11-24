-- 0224_closing_carried_cc_all_modes.sql — the typed "Carried CC from Previous" (closings.ov_prev_cc, migration 0223)
-- now applies to Shift closings as well as Final ones. Empty still means "use the carried figure"; a typed 0 counts.
do $mig$
declare d text; patched text;
begin
  d := pg_get_functiondef('public.closing_apply_carry(uuid, boolean)'::regprocedure);
  patched := replace(d, 'case when c.mode = ''final'' then coalesce(c.ov_prev_cc, 0) else 0 end', 'coalesce(c.ov_prev_cc, 0)');
  patched := replace(patched, 'case when c.mode = ''final'' then coalesce(c.ov_prev_cc, v_cc) else v_cc end', 'coalesce(c.ov_prev_cc, v_cc)');
  if patched = d or position('c.mode = ''final'' then coalesce(c.ov_prev_cc' in patched) > 0 then
    raise exception 'closing_apply_carry: expected text not found';
  end if;
  execute patched;
end
$mig$;

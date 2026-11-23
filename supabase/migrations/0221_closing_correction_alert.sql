-- 0221_closing_correction_alert: the owner gets a push when a submitted closing is corrected (D-63).
-- Until now only a first submission raised closing.submitted. A correction goes two ways, and both now raise closing.corrected
-- (payload: closing_id of the new revision, and its revision number):
--   closing_correct   the one-step correction by the owner,
--   closing_submit    the submit of a reopened revision (closing_reopen -> edit -> submit).
-- The opening closing never raises an alert, as before. A failing alert never blocks the correction: the error is logged.
-- The functions are patched from their live definitions with a guard: if a replacement does not match, the migration stops.
-- Running it twice changes nothing. No money rule changes.
do $mig$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'closing_submit';
  if d is null then raise exception 'closing_submit not found'; end if;
  if position($g$using 'closing.corrected'$g$ in d) = 0 then
    d2 := replace(d,
      $a$return jsonb_build_object('closing_id', c.id, 'status', 'submitted', 'already', false, 'revision', c.revision, 'notified', false, 'result', r);$a$,
      $a$if not c.is_opening and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
      begin
        execute 'select public.notify_owner($1, $2)' using 'closing.corrected', jsonb_build_object('closing_id', c.id, 'revision', c.revision);
        v_notified := true;
      exception when others then
        perform public.log_activity('closing.notify_failed', 'closing', c.id::text, null, jsonb_build_object('error', sqlerrm), null);
      end;
    end if;
    return jsonb_build_object('closing_id', c.id, 'status', 'submitted', 'already', false, 'revision', c.revision, 'notified', v_notified, 'result', r);$a$);
    if d2 = d then raise exception 'closing_submit was not patched'; end if;
    execute d2;
  end if;

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'closing_correct';
  if d is null then raise exception 'closing_correct not found'; end if;
  if position($g$using 'closing.corrected'$g$ in d) = 0 then
    d2 := replace(d,
      $a$return jsonb_build_object('closing_id', n.id, 'revision', n.revision, 'already', false, 'result', r);$a$,
      $a$if not n.is_opening and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    begin
      execute 'select public.notify_owner($1, $2)' using 'closing.corrected', jsonb_build_object('closing_id', n.id, 'revision', n.revision);
    exception when others then
      perform public.log_activity('closing.notify_failed', 'closing', n.id::text, null, jsonb_build_object('error', sqlerrm), null);
    end;
  end if;
  return jsonb_build_object('closing_id', n.id, 'revision', n.revision, 'already', false, 'result', r);$a$);
    if d2 = d then raise exception 'closing_correct was not patched'; end if;
    execute d2;
  end if;
end $mig$;

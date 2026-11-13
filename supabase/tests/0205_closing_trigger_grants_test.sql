-- 0205: Closing's trigger functions are not callable by anyone from the API, and the triggers still protect the data.
\set ON_ERROR_STOP on
do $$
declare f text;
begin
  foreach f in array array['public.closing_lock_closing()', 'public.closing_lock_children()', 'public.closing_results_append_only()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'FAIL: % can still be executed from the API', f;
    end if;
  end loop;
  -- the triggers are still attached (a revoked EXECUTE must not switch them off)
  if (select count(*) from pg_trigger where tgname in ('closings_lock', 'closing_results_frozen', 'closing_hs_rows_lock') and not tgisinternal) <> 3 then
    raise exception 'FAIL: a closing trigger is missing';
  end if;
  raise notice '0205 pass: trigger functions are not exposed; triggers still attached';
end $$;

-- 0602_ebill_harden.sql — the trigger helper from 0601 is only ever fired by its triggers; nobody needs to be able to call it.
revoke all on function public.ebill_no_change() from public, anon, authenticated;

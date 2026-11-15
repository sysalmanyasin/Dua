-- 0622_ebill_search_path.sql — pin the search path of the two helper functions the security advisor flagged.
alter function public.ebill_pin_valid(text) set search_path = public;
alter function public.ebill_no_change() set search_path = public;

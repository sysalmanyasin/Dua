-- 1004: close KI-1 for Invoice Desk. Postgres gives EXECUTE on every new function to PUBLIC, and the schema-level default-privilege revoke in
-- 0001_core.sql cannot take that built-in right away, so three Invoice Desk functions could be run by the visitor role (anon):
-- the pure helpers invoice_desk_under_thousand and invoice_desk_amount_words, and the trigger function invoice_desk_validate_amount_words
-- and invoice_desk_validate_line_product. None is SECURITY DEFINER and none reads or writes data, so the exposure was low; this removes it.
--
-- The two helpers stay callable by signed-in people and by the service role (the browser does not call them today, but a signed-in session
-- must keep working if it ever does). The trigger functions need no EXECUTE right to fire: Postgres checks it only when a trigger is created.
-- Safe to re-run. Rollback: grant execute on function <name> to public;
revoke execute on function public.invoice_desk_under_thousand(integer) from public, anon;
revoke execute on function public.invoice_desk_amount_words(numeric) from public, anon;
grant execute on function public.invoice_desk_under_thousand(integer) to authenticated, service_role;
grant execute on function public.invoice_desk_amount_words(numeric) to authenticated, service_role;

revoke execute on function public.invoice_desk_validate_amount_words() from public, anon, authenticated;
revoke execute on function public.invoice_desk_validate_line_product() from public, anon, authenticated;

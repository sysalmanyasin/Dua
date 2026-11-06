-- 0004: removes the temporary one-time import helper (function, token table, pg_net). The import was applied and verified on 5 Nov 2026.
drop function if exists public.import_sales_batch(jsonb, jsonb, jsonb);
drop function if exists public.import_check_token(text, boolean);
drop table if exists public.import_tokens;
drop extension if exists pg_net;

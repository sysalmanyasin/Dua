-- Tests for 1300_ntf_core: the sender, the table and the permission.
\set ON_ERROR_STOP on
-- The full inbox behaviour is covered in 1301_ntf_reads_test.sql, which builds on this migration; these checks are the sender's contract.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
do $t$
begin
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.ntf_send(uuid, text, text, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.ntf_send(uuid, text, text, text, text, text)', 'execute'), 'ntf_send cannot be called from the browser');
  perform pg_temp.ok((select prosecdef and 'search_path=public' = any (proconfig) from pg_proc where proname = 'ntf_send'), 'ntf_send is a definer function with search_path pinned');
  perform pg_temp.ok(exists (select 1 from pg_indexes where indexname = 'ntf_messages_dedupe_uq'), 'one message per person per dedupe key is enforced by an index');
  perform pg_temp.ok((select count(*) from pg_constraint where conrelid = 'public.ntf_messages'::regclass and contype = 'c') >= 4, 'title, body, kind and link are checked by the table');
  perform pg_temp.ok((select confdeltype from pg_constraint where conrelid = 'public.ntf_messages'::regclass and contype = 'f') = 'c', 'messages go when the login is deleted');
end $t$;
rollback;

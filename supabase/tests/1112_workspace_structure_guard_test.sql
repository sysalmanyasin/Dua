-- Tests for 1102_workspace_sheets. All people, sheets and numbers here are invented.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql as $$ select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.d(n int) returns uuid language sql as $$ select ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql as $$ select ('90000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.sh(n int) returns uuid language sql as $$ select ('a0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- one operation envelope, and "apply one operation to document n, return its answer"
create function pg_temp.opn(n int, typ text, payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('operation_id', pg_temp.k(n), 'operation_type', typ, 'payload', payload) $$;
create function pg_temp.one(docn int, n int, typ text, payload jsonb) returns jsonb language sql as $$
  select public.workspace_apply_ops(pg_temp.d(docn), jsonb_build_array(pg_temp.opn(n, typ, payload))) -> 'results' -> 0 $$;
create function pg_temp.head(docn int) returns bigint language sql as $$ select head_version from public.workspace_documents where id = pg_temp.d(docn) $$;
-- set_cells on sheet shn of document docn, based on seq base
create function pg_temp.setc(docn int, n int, shn int, base bigint, cells jsonb) returns jsonb language sql as $$
  select pg_temp.one(docn, n, 'set_cells', jsonb_build_object('sheet_id', pg_temp.sh(shn), 'base_seq', base, 'cells', cells)) $$;
create function pg_temp.cell(docn int, shn int, r int, c int) returns jsonb language sql security definer as $$
  select to_jsonb(x) from (select value, formula, style_id, last_seq from public.workspace_cells where sheet_id = pg_temp.sh(shn) and row_id = r and col_id = c) x $$;
create function pg_temp.order_of(shn int, which text) returns int[] language sql security definer as $$
  select case when which = 'rows' then row_order else col_order end from public.workspace_sheets where id = pg_temp.sh(shn) $$;

-- Tests for 1112_workspace_structure_guard. All people, sheets and numbers here are invented.
create function pg_temp.sseq(shn int) returns bigint language sql security definer as $$ select structure_seq from public.workspace_sheets where id = pg_temp.sh(shn) $$;
-- status of one answer (what pg_temp.one / setc return), or of the i-th answer of a whole batch (what workspace_apply_ops returns)
create function pg_temp.status_of(res jsonb, i int default null) returns text language sql as $$
  select case when i is null then res ->> 'status' else res -> 'results' -> i ->> 'status' end $$;
create function pg_temp.kinds(docn int) returns text language sql security definer as $$
  select coalesce(string_agg(kind, ',' order by created_at, id), '') from public.workspace_conflicts where document_id = pg_temp.d(docn) $$;

-- people: 1 Alice (owner of the workbook) · 2 Bob (editor)
insert into auth.users(id, email) select pg_temp.u(n), n || '@t' from generate_series(1, 10) n;
select public.bootstrap_first_admin(pg_temp.u(10), 'owner', 'Test Owner');
insert into public.staff(id, full_name) values (pg_temp.s(1), 'Alice Author'), (pg_temp.s(2), 'Bob Editor');
insert into public.profiles(user_id, staff_id, username, role_template) select pg_temp.u(n), pg_temp.s(n), 'user' || n, 'junior' from generate_series(1, 2) n;
insert into public.user_permissions(user_id, perm_key, effect) values
 (pg_temp.u(1), 'workspace.use', 'grant'), (pg_temp.u(1), 'workspace.create', 'grant'), (pg_temp.u(2), 'workspace.use', 'grant');

select pg_temp.as_user(pg_temp.u(1));
select public.workspace_create_document(pg_temp.d(1), 'workbook', 'Stock sheet', pg_temp.k(9001));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(2), 'editor', pg_temp.k(9002));
select pg_temp.one(1, 1, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(1), 'name', 'Stock'));      -- seq 1
select pg_temp.one(1, 2, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(2), 'name', 'Other'));      -- seq 2
select pg_temp.ok(pg_temp.sseq(1) = 0 and pg_temp.sseq(2) = 0, 'a new sheet has never had its structure changed');

-- ═════ 1. nothing changes before the first structure change ═════
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 10, 1, 0, '[{"r":1,"c":1,"value":5},{"r":2,"c":1,"formula":"=A1+1"}]'::jsonb)) = 'applied',
  'before any structure change a formula is written as before, even from base 0');

-- ═════ 2. an insert and its rewritten formulas in the SAME batch ═════
-- (the sender works out the rewrite from its copy at seq 3, so the rewrite carries the same base 3)
select pg_temp.ok(pg_temp.head(1) = 3, 'the workbook is at seq 3');
select public.workspace_apply_ops(pg_temp.d(1), jsonb_build_array(
  pg_temp.opn(11, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'base_seq', 3, 'ids', jsonb_build_array(1000))),
  pg_temp.opn(12, 'set_cells', jsonb_build_object('sheet_id', pg_temp.sh(1), 'base_seq', 3, 'cells', jsonb_build_array(jsonb_build_object('r', 2, 'c', 1, 'formula', '=A1+1'))))
)) as r \gset
select pg_temp.ok(pg_temp.status_of(:'r'::jsonb, 0) = 'applied' and pg_temp.status_of(:'r'::jsonb, 1) = 'applied',
  'the insert and the rewrite of the formulas in the same batch are both accepted');
select pg_temp.ok(pg_temp.sseq(1) = 4, 'the sheet remembers the seq of the structure change (4)');
select pg_temp.ok(pg_temp.sseq(2) = 0, 'another sheet of the workbook is not affected');
select pg_temp.ok((pg_temp.order_of(1, 'rows'))[1:3] = array[1, 1000, 2], 'the row went in after row 1');

-- ═════ 3. a formula from an OLDER copy is refused ═════
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.setc(1, 20, 1, 3, '[{"r":5,"c":1,"formula":"=A1+A2"}]'::jsonb) as r \gset
select pg_temp.ok(pg_temp.status_of(:'r'::jsonb) = 'conflict' and (:'r'::jsonb -> 'conflicts' -> 0 ->> 'kind') = 'structure'
  and (:'r'::jsonb ->> 'applied_cells') = '0', 'a formula written from a copy older than the structure change is a structure conflict');
select pg_temp.ok(pg_temp.cell(1, 1, 5, 1) is null or (pg_temp.cell(1, 1, 5, 1) ->> 'formula') is null, 'and it was not written');
select pg_temp.ok(pg_temp.kinds(1) = 'structure', 'and the conflict is recorded with the kind structure');
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 21, 1, 3, '[{"r":5,"c":1,"value":7}]'::jsonb)) = 'applied', 'a plain value from the same old copy is accepted (it does not depend on positions)');
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 22, 1, 3, '[{"r":6,"c":3,"value":null}]'::jsonb)) = 'applied', 'and so is clearing a cell');
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 23, 1, 4, '[{"r":6,"c":1,"formula":"=A1+A2"}]'::jsonb)) = 'applied',
  'a formula written from a copy that is exactly at the structure change is accepted');
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 24, 1, pg_temp.head(1), '[{"r":7,"c":1,"formula":"=A1+A2"}]'::jsonb)) = 'applied', 'and from a newer copy');
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 25, 2, 0, '[{"r":1,"c":1,"formula":"=A2"}]'::jsonb)) = 'applied', 'a formula on a sheet whose structure never changed is accepted from any base');

-- a mixed set_cells: the formula cell is refused, the value cell is written
select pg_temp.setc(1, 26, 1, 3, '[{"r":8,"c":1,"formula":"=A1"},{"r":8,"c":2,"value":3}]'::jsonb) as r \gset
select pg_temp.ok(pg_temp.status_of(:'r'::jsonb) = 'conflict' and (:'r'::jsonb ->> 'applied_cells') = '1' and (pg_temp.cell(1, 1, 8, 2) ->> 'value') = '3'
  and (pg_temp.cell(1, 1, 8, 1) is null or (pg_temp.cell(1, 1, 8, 1) ->> 'formula') is null), 'in a mixed write only the formula cell is refused');

-- the same answer when the operation is sent again (idempotent, same operation id)
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 20, 1, 3, '[{"r":5,"c":1,"formula":"=A1+A2"}]'::jsonb)) = 'duplicate', 'sending the refused write again returns the first answer and changes nothing');

-- ═════ 4. a structure operation from an older copy is refused ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.one(1, 30, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 2, 'base_seq', 3, 'ids', jsonb_build_array(1001))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'conflict' and (:'r'::jsonb -> 'conflicts' -> 0 ->> 'kind') = 'structure', 'an insert worked out from an older copy is a structure conflict');
select pg_temp.ok(not (1001 = any (pg_temp.order_of(1, 'rows'))) and pg_temp.sseq(1) = 4, 'and changed nothing');
select pg_temp.one(1, 31, 'delete_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'base_seq', 3, 'ids', jsonb_build_array(1000))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'conflict' and 1000 = any (pg_temp.order_of(1, 'rows')), 'and so is a delete');
-- a stale insert followed by its rewrite: neither goes through
select public.workspace_apply_ops(pg_temp.d(1), jsonb_build_array(
  pg_temp.opn(32, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 2, 'base_seq', 3, 'ids', jsonb_build_array(1002))),
  pg_temp.opn(33, 'set_cells', jsonb_build_object('sheet_id', pg_temp.sh(1), 'base_seq', 3, 'cells', jsonb_build_array(jsonb_build_object('r', 9, 'c', 1, 'formula', '=A1'))))
)) as r \gset
select pg_temp.ok(pg_temp.status_of(:'r'::jsonb, 0) = 'conflict' and pg_temp.status_of(:'r'::jsonb, 1) = 'conflict' and not (1002 = any (pg_temp.order_of(1, 'rows'))),
  'a stale insert and its rewrite in one batch are both refused (the exemption is only for a change made in the same batch)');

-- ═════ 5. an operation without base_seq still works (older callers) and moves the marker ═════
select pg_temp.ok((pg_temp.one(1, 40, 'insert_cols', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'ids', jsonb_build_array(1000))) ->> 'status') = 'applied', 'an insert without base_seq is accepted');
select pg_temp.ok(pg_temp.sseq(1) = pg_temp.head(1), 'and the marker moves to its seq');
select pg_temp.ok((pg_temp.one(1, 41, 'delete_cols', jsonb_build_object('sheet_id', pg_temp.sh(1), 'base_seq', pg_temp.head(1), 'ids', jsonb_build_array(1000))) ->> 'status') = 'applied'
  and pg_temp.sseq(1) = pg_temp.head(1), 'a delete from an up-to-date copy is accepted and moves the marker');
select pg_temp.ok((pg_temp.one(1, 42, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1000, 'base_seq', pg_temp.head(1), 'ids', jsonb_build_array(1003))) ->> 'status') = 'applied',
  'an insert from an up-to-date copy is accepted');

-- ═════ 6. restoring a restore point ═════
select public.workspace_snapshot_create(pg_temp.d(1), 'before', pg_temp.k(9100)) ->> 'snapshot_id' as snap \gset
select pg_temp.one(1, 50, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'base_seq', pg_temp.head(1), 'ids', jsonb_build_array(1004)));
select public.workspace_sheet_restore(pg_temp.d(1), :'snap'::uuid, pg_temp.k(9101)) ->> 'seq' as rseq \gset
select pg_temp.ok(pg_temp.sseq(1) = :'rseq'::bigint and pg_temp.head(1) = :'rseq'::bigint, 'a restore sets the marker to the restore''s seq');
select pg_temp.ok(pg_temp.sseq(2) = :'rseq'::bigint, 'on every sheet the restore rewrote');
select pg_temp.ok(not (1004 = any (pg_temp.order_of(1, 'rows'))), 'and the old order is back');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 60, 1, :'rseq'::bigint - 1, '[{"r":50,"c":3,"formula":"=A1"}]'::jsonb)) = 'conflict',
  'a formula from a copy older than the restore is refused, even into a cell that was empty');
select pg_temp.ok(pg_temp.status_of(pg_temp.setc(1, 61, 1, :'rseq'::bigint, '[{"r":50,"c":3,"formula":"=A1"}]'::jsonb)) = 'applied', 'and accepted from a copy at the restore');

-- ═════ 7. the functions keep their privileges and a pinned search_path ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_apply_one(pg_temp.d(1), 99, pg_temp.u(1), pg_temp.s(1), 'add_sheet', '{}'::jsonb)$$, 'a signed-in person cannot call the internal helper', 'permission denied');
reset role;
select pg_temp.ok(not has_function_privilege('anon', 'public.workspace_apply_one(uuid,bigint,uuid,uuid,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.workspace_apply_one(uuid,bigint,uuid,uuid,text,jsonb)', 'execute'), 'workspace_apply_one is still not executable by anon or signed-in people');
select pg_temp.ok(not has_function_privilege('anon', 'public.workspace_sheet_restore(uuid,uuid,uuid)', 'execute') and has_function_privilege('authenticated', 'public.workspace_sheet_restore(uuid,uuid,uuid)', 'execute'),
  'workspace_sheet_restore keeps its privileges');
select pg_temp.ok((select bool_and(coalesce(array_to_string(proconfig, ',') like '%search_path%', false)) from pg_proc where proname in ('workspace_apply_one', 'workspace_sheet_restore') and pronamespace = 'public'::regnamespace),
  'both functions have a pinned search_path');
rollback;

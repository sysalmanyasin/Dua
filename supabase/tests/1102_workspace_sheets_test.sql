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

-- people: 1 Alice (use+create) · 2 Bob (use) · 3 Carol (use) · 4 Dave (use, not shared) · 5 Erin (nothing) · 10 owner/admin
insert into auth.users(id, email) select pg_temp.u(n), n || '@t' from generate_series(1, 10) n;
select public.bootstrap_first_admin(pg_temp.u(10), 'owner', 'Test Owner');
insert into public.staff(id, full_name) values
 (pg_temp.s(1), 'Alice Author'), (pg_temp.s(2), 'Bob Editor'), (pg_temp.s(3), 'Carol Viewer'), (pg_temp.s(4), 'Dave Outsider'), (pg_temp.s(5), 'Erin NoAccess');
insert into public.profiles(user_id, staff_id, username, role_template) select pg_temp.u(n), pg_temp.s(n), 'user' || n, 'junior' from generate_series(1, 5) n;
insert into public.user_permissions(user_id, perm_key, effect) values
 (pg_temp.u(1), 'workspace.use', 'grant'), (pg_temp.u(1), 'workspace.create', 'grant'),
 (pg_temp.u(2), 'workspace.use', 'grant'), (pg_temp.u(3), 'workspace.use', 'grant'), (pg_temp.u(4), 'workspace.use', 'grant');

select pg_temp.as_user(pg_temp.u(1));
select public.workspace_create_document(pg_temp.d(1), 'workbook', 'Stock sheet', pg_temp.k(9001));
select public.workspace_create_document(pg_temp.d(2), 'note', 'A note', pg_temp.k(9002));
select public.workspace_create_document(pg_temp.d(3), 'workbook', 'Other workbook', pg_temp.k(9003));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(2), 'editor', pg_temp.k(9004));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(3), 'viewer', pg_temp.k(9005));

-- ═════ 1. opening ═════
select pg_temp.ok((public.workspace_workbook_open(pg_temp.d(1)) ->> 'head_version') = '0' and public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' = '[]'::jsonb
  and (public.workspace_workbook_open(pg_temp.d(1)) ->> 'role') = 'owner', 'a new workbook opens empty and shows the role');
select pg_temp.fails($$select public.workspace_workbook_open(pg_temp.d(2))$$, 'a note is not opened as a workbook', 'not a workbook');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((public.workspace_workbook_open(pg_temp.d(1)) ->> 'role') = 'viewer', 'a viewer can open the workbook');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select public.workspace_workbook_open(pg_temp.d(1))$$, 'someone it is not shared with cannot open it', '42501');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.fails($$select public.workspace_workbook_open(pg_temp.d(1))$$, 'someone without workspace.use cannot open it', '42501');
select pg_temp.as_user(pg_temp.u(10), 'aal2');
select pg_temp.fails($$select public.workspace_workbook_open(pg_temp.d(1))$$, 'the pharmacy owner''s admin account has no override', '42501');

-- ═════ 2. sheets ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((pg_temp.one(1, 100, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(1), 'name', 'Sheet 1')) ->> 'status') = 'applied', 'add a sheet');
select pg_temp.ok(pg_temp.head(1) = 1, 'the workbook is now at seq 1');
select pg_temp.ok(jsonb_array_length(public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets') = 1
  and (public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 0 ->> 'name') = 'Sheet 1'
  and jsonb_array_length(public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 0 -> 'row_order') = 100
  and jsonb_array_length(public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 0 -> 'col_order') = 26, 'a new sheet starts with 100 rows and 26 columns');
select pg_temp.ok((pg_temp.one(1, 100, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(1), 'name', 'Sheet 1')) ->> 'status') = 'duplicate', 'sending the same operation again changes nothing [answer]');
select pg_temp.ok(pg_temp.head(1) = 1 and (select count(*) from public.workspace_operations where document_id = pg_temp.d(1)) = 1, 'sending the same operation again changes nothing [state]');
select pg_temp.ok((pg_temp.one(1, 101, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(9), 'name', 'SHEET 1')) ->> 'status') = 'rejected', 'a sheet name already used (any case) is rejected, and a retry gets the same answer [answer]');
select pg_temp.ok((pg_temp.one(1, 101, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(9), 'name', 'SHEET 1')) ->> 'original_status') = 'rejected', 'a sheet name already used (any case) is rejected, and a retry gets the same answer [state]');
select pg_temp.ok((pg_temp.one(1, 102, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(9), 'name', '   ')) ->> 'status') = 'rejected', 'a blank sheet name is rejected');
select pg_temp.ok((pg_temp.one(1, 103, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(9), 'name', repeat('x', 32))) ->> 'status') = 'rejected', 'a 32-character sheet name is rejected');
select pg_temp.ok((pg_temp.one(1, 104, 'add_sheet', jsonb_build_object('sheet_id', 'not-a-uuid', 'name', 'X')) ->> 'status') = 'rejected', 'a bad sheet id is rejected');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((pg_temp.one(1, 105, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(2), 'name', 'Sheet 2')) ->> 'status') = 'applied', 'an editor can add a sheet');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((pg_temp.one(3, 106, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(3), 'name', 'Other')) ->> 'status') = 'applied', 'a sheet in another workbook');
select pg_temp.ok((pg_temp.one(3, 107, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(1), 'name', 'Steal')) ->> 'status') = 'rejected', 'a sheet id already used anywhere is rejected');

-- the envelope is checked before anything is written
select pg_temp.fails($$select public.workspace_apply_ops(pg_temp.d(1), '[]'::jsonb)$$, 'an empty batch is refused', 'send 1 to 200');
select pg_temp.fails($$select public.workspace_apply_ops(pg_temp.d(1), '{}'::jsonb)$$, 'a batch that is not a list is refused', 'send 1 to 200');
select pg_temp.fails($$select public.workspace_apply_ops(pg_temp.d(1), (select jsonb_agg(pg_temp.opn(2000 + g, 'resize', '{}'::jsonb)) from generate_series(1, 201) g))$$, 'more than 200 operations are refused', 'send 1 to 200');
select pg_temp.fails($$select public.workspace_apply_ops(pg_temp.d(1), jsonb_build_array(pg_temp.opn(110, 'resize', '{}'::jsonb), jsonb_build_object('operation_id', pg_temp.k(111), 'operation_type', 'launch_rocket', 'payload', '{}'::jsonb)))$$, 'an unknown operation type refuses the whole batch', 'known operation_type');
select pg_temp.fails($$select public.workspace_apply_ops(pg_temp.d(1), jsonb_build_array(jsonb_build_object('operation_id', 'nope', 'operation_type', 'resize', 'payload', '{}'::jsonb)))$$, 'a bad operation id is refused', 'operation_id');
select pg_temp.ok(not exists (select 1 from public.workspace_operations where op_id = pg_temp.k(110)), 'and nothing from that batch was written');

-- who may write
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select pg_temp.one(1, 120, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(8), 'name', 'Viewer sheet'))$$, 'a viewer cannot apply operations', '42501');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select pg_temp.one(1, 121, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(8), 'name', 'Outsider'))$$, 'someone it is not shared with cannot apply operations', '42501');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.fails($$select pg_temp.one(1, 122, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(8), 'name', 'Nobody'))$$, 'someone without workspace.use cannot apply operations', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select pg_temp.one(2, 123, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(8), 'name', 'In a note'))$$, 'a note cannot take sheet operations', 'not a workbook');

-- rename, reorder, delete
select pg_temp.ok((pg_temp.one(1, 130, 'rename_sheet', jsonb_build_object('sheet_id', pg_temp.sh(2), 'name', '  Counts ')) ->> 'status') = 'applied', 'rename a sheet (trimmed) [answer]');
select pg_temp.ok((select name from public.workspace_sheets where id = pg_temp.sh(2)) = 'Counts', 'rename a sheet (trimmed) [state]');
select pg_temp.ok((pg_temp.one(1, 131, 'rename_sheet', jsonb_build_object('sheet_id', pg_temp.sh(2), 'name', 'sheet 1')) ->> 'status') = 'rejected', 'a rename onto another sheet''s name is rejected');
select pg_temp.ok((pg_temp.one(1, 132, 'rename_sheet', jsonb_build_object('sheet_id', pg_temp.sh(77), 'name', 'Ghost')) ->> 'status') = 'rejected', 'renaming a sheet that does not exist is rejected');
select pg_temp.ok((pg_temp.one(1, 133, 'reorder_sheets', jsonb_build_object('order', jsonb_build_array(pg_temp.sh(1)))) ->> 'status') = 'rejected', 'a reorder that leaves a sheet out is rejected');
select pg_temp.ok((pg_temp.one(1, 134, 'reorder_sheets', jsonb_build_object('order', jsonb_build_array(pg_temp.sh(1), pg_temp.sh(1)))) ->> 'status') = 'rejected', 'a reorder that repeats a sheet is rejected');
select pg_temp.ok((pg_temp.one(1, 135, 'reorder_sheets', jsonb_build_object('order', jsonb_build_array(pg_temp.sh(2), pg_temp.sh(1)))) ->> 'status') = 'applied', 'a valid reorder puts Counts first [answer]');
select pg_temp.ok((public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 0 ->> 'name') = 'Counts', 'a valid reorder puts Counts first [state]');

-- ═════ 3. styles ═════
select pg_temp.ok((pg_temp.one(1, 140, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(
  jsonb_build_object('style_id', 1, 'style', '{"weight":"bold","bg":"#FFEEAA","color":"#112233","size":14,"halign":"right","valign":"middle","borders":{"top":"thin","bottom":"thick"},"numfmt":{"type":"currency","currency":"PKR","decimals":2}}'::jsonb),
  jsonb_build_object('style_id', 2, 'style', '{"numfmt":{"type":"date","pattern":"dd/mm/yyyy"}}'::jsonb)))) ->> 'status') = 'applied', 'define two styles');
select pg_temp.ok((select count(*) from public.workspace_sheet_styles where sheet_id = pg_temp.sh(1)) = 2, 'both styles are stored');
select pg_temp.ok((pg_temp.one(1, 141, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"font":"Comic"}'::jsonb)))) ->> 'status') = 'rejected', 'an unknown style key is rejected');
select pg_temp.ok((pg_temp.one(1, 142, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"size":7}'::jsonb)))) ->> 'status') = 'rejected', 'a font size under 8 is rejected');
select pg_temp.ok((pg_temp.one(1, 143, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"size":73}'::jsonb)))) ->> 'status') = 'rejected', 'a font size over 72 is rejected');
select pg_temp.ok((pg_temp.one(1, 144, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"color":"red"}'::jsonb)))) ->> 'status') = 'rejected', 'a colour that is not #rrggbb is rejected');
select pg_temp.ok((pg_temp.one(1, 145, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"numfmt":{"type":"x"}}'::jsonb)))) ->> 'status') = 'rejected', 'an unknown number format is rejected');
select pg_temp.ok((pg_temp.one(1, 146, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"numfmt":{"type":"number","decimals":11}}'::jsonb)))) ->> 'status') = 'rejected', 'more than 10 decimals is rejected');
select pg_temp.ok((pg_temp.one(1, 147, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 3, 'style', '{"borders":{"top":"huge"}}'::jsonb)))) ->> 'status') = 'rejected', 'an unknown border is rejected');
select pg_temp.ok((pg_temp.one(1, 148, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 0, 'style', '{}'::jsonb)))) ->> 'status') = 'rejected', 'style id 0 is rejected');
select pg_temp.ok((pg_temp.one(1, 149, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', '[]'::jsonb)) ->> 'status') = 'rejected', 'an empty style list is rejected');
select pg_temp.ok((select count(*) from public.workspace_sheet_styles where sheet_id = pg_temp.sh(1)) = 2, 'nothing invalid was stored');

-- ═════ 4. cells ═════
select pg_temp.ok((pg_temp.setc(1, 200, 1, pg_temp.head(1), '[{"r":1,"c":1,"value":10},{"r":1,"c":2,"value":"Panadol"},{"r":1,"c":3,"value":true},{"r":2,"c":1,"formula":"=SUM(A1:A1)"},{"r":2,"c":2,"value":1.5,"style_id":1}]'::jsonb) ->> 'applied_cells') = '5', 'write five cells of different kinds');
select pg_temp.ok((select count(*) from public.workspace_load_sheet(pg_temp.sh(1))) = 5
  and (select value from public.workspace_load_sheet(pg_temp.sh(1)) where row_id = 1 and col_id = 2) = '"Panadol"'::jsonb
  and (select formula from public.workspace_load_sheet(pg_temp.sh(1)) where row_id = 2 and col_id = 1) = '=SUM(A1:A1)'
  and (select style_id from public.workspace_load_sheet(pg_temp.sh(1)) where row_id = 2 and col_id = 2) = 1, 'load_sheet returns them, in order');
select pg_temp.ok((select array_agg(row_id * 100 + col_id) from public.workspace_load_sheet(pg_temp.sh(1))) = array[101, 102, 103, 201, 202], 'sorted by row then column');
select pg_temp.ok((select count(*) from public.workspace_load_sheet(pg_temp.sh(1), null, null, 2)) = 2
  and (select count(*) from public.workspace_load_sheet(pg_temp.sh(1), 1, 3, 10)) = 2, 'paging by (row, column) works');
select pg_temp.ok((pg_temp.cell(1, 1, 1, 1) ->> 'last_seq')::bigint = pg_temp.head(1), 'cells carry the seq of the operation that wrote them');
-- clearing keeps a marker row
select pg_temp.ok((pg_temp.setc(1, 201, 1, pg_temp.head(1), '[{"r":1,"c":3}]'::jsonb) ->> 'applied_cells') = '1', 'clearing a cell removes it from view [answer]');
select pg_temp.ok((select count(*) from public.workspace_load_sheet(pg_temp.sh(1))) = 4, 'clearing a cell removes it from view [state]');
select pg_temp.ok(pg_temp.cell(1, 1, 1, 3) is not null and (pg_temp.cell(1, 1, 1, 3) ->> 'value') is null, 'but an empty marker row stays so stale edits are recognised');
-- invalid cells: whole operation rejected, nothing written
select pg_temp.ok((pg_temp.setc(1, 210, 1, pg_temp.head(1), '[{"r":5,"c":1,"value":1,"formula":"=1"}]'::jsonb) ->> 'status') = 'rejected', 'a value and a formula together are rejected');
select pg_temp.ok((pg_temp.setc(1, 211, 1, pg_temp.head(1), '[{"r":5,"c":1,"formula":"1+1"}]'::jsonb) ->> 'status') = 'rejected', 'a formula without = is rejected');
select pg_temp.ok((pg_temp.setc(1, 212, 1, pg_temp.head(1), '[{"r":5,"c":1,"value":{"a":1}}]'::jsonb) ->> 'status') = 'rejected', 'an object value is rejected');
select pg_temp.ok((pg_temp.setc(1, 213, 1, pg_temp.head(1), '[{"r":5,"c":1,"value":[1,2]}]'::jsonb) ->> 'status') = 'rejected', 'a list value is rejected');
select pg_temp.ok((pg_temp.setc(1, 214, 1, pg_temp.head(1), jsonb_build_array(jsonb_build_object('r', 5, 'c', 1, 'value', repeat('x', 32768)))) ->> 'status') = 'rejected', 'text over 32,767 characters is rejected');
select pg_temp.ok((pg_temp.setc(1, 215, 1, pg_temp.head(1), jsonb_build_array(jsonb_build_object('r', 5, 'c', 1, 'value', repeat('x', 32767)))) ->> 'status') = 'applied', 'text of exactly 32,767 characters is accepted');
select pg_temp.ok((pg_temp.setc(1, 216, 1, pg_temp.head(1), jsonb_build_array(jsonb_build_object('r', 5, 'c', 2, 'formula', '=' || repeat('1', 1000)))) ->> 'status') = 'rejected', 'a formula over 1,000 characters is rejected');
select pg_temp.ok((pg_temp.setc(1, 217, 1, pg_temp.head(1), '[{"r":0,"c":1,"value":1}]'::jsonb) ->> 'status') = 'rejected', 'row id 0 is rejected');
select pg_temp.ok((pg_temp.setc(1, 218, 1, pg_temp.head(1), '[{"r":1.5,"c":1,"value":1}]'::jsonb) ->> 'status') = 'rejected', 'a fractional row id is rejected');
select pg_temp.ok((pg_temp.one(1, 219, 'set_cells', jsonb_build_object('sheet_id', pg_temp.sh(1), 'cells', '[{"r":5,"c":1,"value":1}]'::jsonb)) ->> 'status') = 'rejected', 'a cell without a base_seq is rejected');
select pg_temp.ok((pg_temp.setc(1, 220, 1, pg_temp.head(1), '[{"r":5,"c":1,"value":1,"style_id":99}]'::jsonb) ->> 'status') = 'rejected', 'a style that does not exist is rejected');
select pg_temp.ok((pg_temp.setc(1, 221, 1, pg_temp.head(1), '[]'::jsonb) ->> 'status') = 'rejected', 'an empty cell list is rejected');
select pg_temp.ok((pg_temp.setc(1, 222, 77, pg_temp.head(1), '[{"r":1,"c":1,"value":1}]'::jsonb) ->> 'status') = 'rejected', 'cells for a sheet that does not exist are rejected');
select pg_temp.ok((pg_temp.setc(1, 223, 1, pg_temp.head(1), '[{"r":6,"c":1,"value":1},{"r":6,"c":2,"value":{"bad":1}}]'::jsonb) ->> 'status') = 'rejected', 'one bad cell undoes the whole operation: nothing from it is kept [answer]');
select pg_temp.ok(pg_temp.cell(1, 1, 6, 1) is null, 'one bad cell undoes the whole operation: nothing from it is kept [state]');
select pg_temp.ok((pg_temp.cell(1, 1, 5, 1) ->> 'value') = repeat('x', 32767), 'the only cell write kept from those attempts is the valid long text');
-- cells whose row or column no longer exists
select pg_temp.ok((pg_temp.setc(1, 224, 1, pg_temp.head(1), '[{"r":99999,"c":1,"value":1}]'::jsonb) ->> 'status') = 'conflict', 'an edit to a row that is not there is a conflict and is kept [answer]');
select pg_temp.ok((select count(*) from public.workspace_conflicts where kind = 'target_deleted') = 1, 'an edit to a row that is not there is a conflict and is kept [state]');
select pg_temp.ok((select local_state ->> 'value' from public.workspace_conflicts where kind = 'target_deleted') = '1', 'the edit that could not be applied is stored');

-- ═════ 5. conflicts ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.setc(1, 300, 1, pg_temp.head(1), '[{"r":10,"c":1,"value":100}]'::jsonb);
select pg_temp.ok((select (pg_temp.cell(1, 1, 10, 1) ->> 'last_seq')::bigint) = pg_temp.head(1), 'Alice wrote A10 at the newest seq');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((pg_temp.setc(1, 301, 1, pg_temp.head(1) - 1, '[{"r":10,"c":1,"value":200}]'::jsonb) ->> 'status') = 'conflict', 'Bob edits A10 from a stale view: conflict');
select pg_temp.ok((pg_temp.cell(1, 1, 10, 1) ->> 'value') = '100', 'Alice''s value is untouched');
select pg_temp.ok((select count(*) from public.workspace_conflicts where kind = 'cell') = 1
  and (select server_state ->> 'value' from public.workspace_conflicts where kind = 'cell') = '100'
  and (select local_state ->> 'value' from public.workspace_conflicts where kind = 'cell') = '200', 'the conflict keeps both values');
select pg_temp.ok((pg_temp.setc(1, 302, 1, pg_temp.head(1) - 5, '[{"r":10,"c":1,"value":100}]'::jsonb) ->> 'status') = 'applied', 'the same value written from a stale view is not a conflict');
select pg_temp.ok((pg_temp.setc(1, 303, 1, pg_temp.head(1) - 5, '[{"r":11,"c":1,"value":7}]'::jsonb) ->> 'status') = 'applied', 'a different cell from a stale view is not a conflict');
select pg_temp.ok((pg_temp.setc(1, 304, 1, pg_temp.head(1), '[{"r":10,"c":1,"value":300}]'::jsonb) ->> 'status') = 'applied', 'from an up-to-date view it simply applies');
-- a batch with one conflicting and one fine cell
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.setc(1, 305, 1, pg_temp.head(1), '[{"r":12,"c":1,"value":1}]'::jsonb);
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((pg_temp.setc(1, 306, 1, pg_temp.head(1) - 1, '[{"r":12,"c":1,"value":2},{"r":13,"c":1,"value":3}]'::jsonb) ->> 'applied_cells') = '1', 'one cell applied, one conflicted, and a retry is answered from the log [answer]');
select pg_temp.ok((pg_temp.setc(1, 306, 1, pg_temp.head(1), '[{"r":12,"c":1,"value":2},{"r":13,"c":1,"value":3}]'::jsonb) ->> 'status') = 'duplicate', 'one cell applied, one conflicted, and a retry is answered from the log [state]');
select pg_temp.ok((pg_temp.cell(1, 1, 12, 1) ->> 'value') = '1' and (pg_temp.cell(1, 1, 13, 1) ->> 'value') = '3', 'the conflicting cell kept its value and the other was written');
-- who sees conflicts
select pg_temp.ok((select count(*) from public.workspace_conflicts where kind = 'cell') = 2, 'Bob sees his own conflicts');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select count(*) from public.workspace_conflicts where kind in ('cell', 'target_deleted')) >= 3, 'the owner sees every conflict on the workbook');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_conflicts) = 0, 'a viewer sees none');

-- ═════ 6. structure ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((pg_temp.one(1, 400, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', jsonb_build_array(1000, 1001))) ->> 'status') = 'applied', 'insert two rows after row 3 [answer]');
select pg_temp.ok((pg_temp.order_of(1, 'rows'))[1:6] = array[1, 2, 3, 1000, 1001, 4], 'insert two rows after row 3 [state]');
select pg_temp.ok((pg_temp.one(1, 401, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', null, 'ids', jsonb_build_array(1002))) ->> 'status') = 'applied', 'a null anchor inserts at the top [answer]');
select pg_temp.ok((pg_temp.order_of(1, 'rows'))[1] = 1002, 'a null anchor inserts at the top [state]');
select pg_temp.ok((pg_temp.one(1, 402, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 100, 'ids', jsonb_build_array(1003))) ->> 'status') = 'applied', 'inserting after the last row appends [answer]');
select pg_temp.ok((pg_temp.order_of(1, 'rows'))[cardinality(pg_temp.order_of(1, 'rows'))] = 1003, 'inserting after the last row appends [state]');
select pg_temp.ok((pg_temp.one(1, 403, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', jsonb_build_array(500))) ->> 'status') = 'rejected', 'new ids below 1000 are rejected');
select pg_temp.ok((pg_temp.one(1, 404, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', jsonb_build_array(2000, 2000))) ->> 'status') = 'rejected', 'repeated ids are rejected');
select pg_temp.ok((pg_temp.one(1, 405, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', jsonb_build_array(1000))) ->> 'status') = 'rejected', 'an id already in the sheet is rejected');
select pg_temp.ok((pg_temp.one(1, 406, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', '[]'::jsonb)) ->> 'status') = 'rejected', 'an empty id list is rejected');
select pg_temp.ok((pg_temp.one(1, 407, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', jsonb_build_array('x'))) ->> 'status') = 'rejected', 'a non-numeric id is rejected');
select pg_temp.ok((pg_temp.one(1, 408, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 31337, 'ids', jsonb_build_array(2001))) ->> 'status') = 'conflict', 'an anchor that is gone is a conflict and nothing changes [answer]');
select pg_temp.ok((select count(*) from public.workspace_conflicts where kind = 'structure') = 1 and not (2001 = any (pg_temp.order_of(1, 'rows'))), 'an anchor that is gone is a conflict and nothing changes [state]');
-- edit a new row, delete it, and its id cannot come back
select pg_temp.setc(1, 410, 1, pg_temp.head(1), '[{"r":1000,"c":1,"value":"new row"}]'::jsonb);
select pg_temp.ok((pg_temp.cell(1, 1, 1000, 1) ->> 'value') = 'new row', 'a cell in a new row can be written');
select pg_temp.ok((pg_temp.one(1, 411, 'delete_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'ids', jsonb_build_array(1000))) ->> 'status') = 'applied', 'delete the row [answer]');
select pg_temp.ok(not (1000 = any (pg_temp.order_of(1, 'rows'))), 'delete the row [state]');
select pg_temp.ok(pg_temp.cell(1, 1, 1000, 1) is not null and (pg_temp.cell(1, 1, 1000, 1) ->> 'value') is null
  and (select count(*) from public.workspace_load_sheet(pg_temp.sh(1)) where row_id = 1000) = 0, 'its cells are blanked and no longer sent');
select pg_temp.ok((pg_temp.one(1, 412, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 3, 'ids', jsonb_build_array(1000))) ->> 'status') = 'rejected', 'a deleted row''s id is never reused');
select pg_temp.ok((pg_temp.setc(1, 413, 1, pg_temp.head(1) - 1, '[{"r":1000,"c":1,"value":"late"}]'::jsonb) ->> 'status') = 'conflict', 'a late edit to the deleted row is a conflict');
select pg_temp.ok((pg_temp.one(1, 414, 'delete_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'ids', jsonb_build_array(1000, 424242))) ->> 'status') = 'applied', 'deleting something already gone is harmless');
select pg_temp.ok((pg_temp.one(1, 415, 'delete_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'ids', (select to_jsonb(row_order) from public.workspace_sheets where id = pg_temp.sh(1)))) ->> 'status') = 'rejected', 'a sheet cannot lose all its rows [answer]');
select pg_temp.ok(cardinality(pg_temp.order_of(1, 'rows')) > 1, 'a sheet cannot lose all its rows [state]');
-- columns
select pg_temp.ok((pg_temp.one(1, 420, 'insert_cols', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 2, 'ids', jsonb_build_array(1000))) ->> 'status') = 'applied', 'insert a column after column 2 [answer]');
select pg_temp.ok((pg_temp.order_of(1, 'cols'))[1:4] = array[1, 2, 1000, 3], 'insert a column after column 2 [state]');
select pg_temp.setc(1, 421, 1, pg_temp.head(1), '[{"r":1,"c":1000,"value":"c"}]'::jsonb);
select pg_temp.ok((pg_temp.one(1, 422, 'delete_cols', jsonb_build_object('sheet_id', pg_temp.sh(1), 'ids', jsonb_build_array(1000))) ->> 'status') = 'applied', 'deleting a column blanks its cells [answer]');
select pg_temp.ok((pg_temp.cell(1, 1, 1, 1000) ->> 'value') is null, 'deleting a column blanks its cells [state]');
select pg_temp.ok((pg_temp.one(1, 423, 'insert_cols', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 2, 'ids', jsonb_build_array(1000))) ->> 'status') = 'rejected', 'a deleted column''s id is never reused');
-- limits
reset role;
update public.workspace_sheets set row_order = (select array_agg(g) from generate_series(1, 9999) g) where id = pg_temp.sh(1);
update public.workspace_sheets set col_order = (select array_agg(g) from generate_series(1, 100) g) where id = pg_temp.sh(1);
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((pg_temp.one(1, 430, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'ids', jsonb_build_array(20000, 20001))) ->> 'status') = 'rejected', 'more than 10,000 rows is rejected');
select pg_temp.ok((pg_temp.one(1, 431, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'ids', jsonb_build_array(20000))) ->> 'status') = 'applied', 'exactly 10,000 rows is accepted');
select pg_temp.ok((pg_temp.one(1, 432, 'insert_cols', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'ids', jsonb_build_array(20000))) ->> 'status') = 'rejected', 'more than 100 columns is rejected');
reset role;
update public.workspace_sheets set row_order = (select array_agg(g) from generate_series(1, 100) g), col_order = (select array_agg(g) from generate_series(1, 26) g) where id = pg_temp.sh(1);
select pg_temp.as_user(pg_temp.u(1));

-- ═════ 7. sizes ═════
select pg_temp.ok((pg_temp.one(1, 500, 'resize', jsonb_build_object('sheet_id', pg_temp.sh(1), 'rows', '{"1":40}'::jsonb, 'cols', '{"2":120}'::jsonb)) ->> 'status') = 'applied', 'set a row height and a column width [answer]');
select pg_temp.ok((public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 1 -> 'row_sizes' ->> '1') = '40'
  and (public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 1 -> 'col_sizes' ->> '2') = '120', 'set a row height and a column width [state]');
select pg_temp.ok((pg_temp.one(1, 501, 'resize', jsonb_build_object('sheet_id', pg_temp.sh(1), 'rows', '{"1":null}'::jsonb)) ->> 'status') = 'applied', 'null resets a size [answer]');
select pg_temp.ok((public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 1 -> 'row_sizes') = '{}'::jsonb, 'null resets a size [state]');
select pg_temp.ok((pg_temp.one(1, 502, 'resize', jsonb_build_object('sheet_id', pg_temp.sh(1), 'rows', '{"1":5}'::jsonb)) ->> 'status') = 'rejected', 'a size under 10 is rejected');
select pg_temp.ok((pg_temp.one(1, 503, 'resize', jsonb_build_object('sheet_id', pg_temp.sh(1), 'rows', '{"1":2001}'::jsonb)) ->> 'status') = 'rejected', 'a size over 2000 is rejected');
select pg_temp.ok((pg_temp.one(1, 504, 'resize', jsonb_build_object('sheet_id', pg_temp.sh(1), 'rows', '{"abc":40}'::jsonb)) ->> 'status') = 'rejected', 'a size keyed by a non-id is rejected');
select pg_temp.ok((pg_temp.one(1, 505, 'resize', jsonb_build_object('sheet_id', pg_temp.sh(1), 'rows', '{"777777":40}'::jsonb)) ->> 'status') = 'applied', 'a size for a row that does not exist is ignored [answer]');
select pg_temp.ok((public.workspace_workbook_open(pg_temp.d(1)) -> 'sheets' -> 1 -> 'row_sizes') = '{}'::jsonb, 'a size for a row that does not exist is ignored [state]');

-- ═════ 8. pulling changes ═════
select pg_temp.ok((select count(*) from public.workspace_pull(pg_temp.d(1), 0)) > 5
  and (select min(seq) from public.workspace_pull(pg_temp.d(1), 0)) = 1, 'pull from 0 starts at the first operation');
select pg_temp.ok(not exists (select 1 from public.workspace_pull(pg_temp.d(1), 0) where op_id = pg_temp.k(101))
  and not exists (select 1 from public.workspace_pull(pg_temp.d(1), 0) where op_id = pg_temp.k(301)), 'rejected operations and operations that were wholly refused are not pulled');
select pg_temp.ok(exists (select 1 from public.workspace_pull(pg_temp.d(1), 0) where op_id = pg_temp.k(306)
  and jsonb_array_length(payload -> 'cells') = 1 and (payload -> 'cells' -> 0 ->> 'r') = '13'), 'a partly applied operation is pulled with only the cells that were written');
select pg_temp.ok((select array_agg(seq) from public.workspace_pull(pg_temp.d(1), 0)) = (select array_agg(seq order by seq) from public.workspace_pull(pg_temp.d(1), 0)), 'pull is in order');
select pg_temp.ok((select count(*) from public.workspace_pull(pg_temp.d(1), 0, 3)) = 3
  and (select count(*) from public.workspace_pull(pg_temp.d(1), pg_temp.head(1))) = 0, 'pull honours the limit and returns nothing past the head');
select pg_temp.ok(exists (select 1 from public.workspace_pull(pg_temp.d(1), 0) where author = 'Bob Editor') and exists (select 1 from public.workspace_pull(pg_temp.d(1), 0) where author = 'Alice Author'), 'operations name their author');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_pull(pg_temp.d(1), 0)) > 5, 'a viewer can pull');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select * from public.workspace_pull(pg_temp.d(1), 0)$$, 'someone it is not shared with cannot pull', '42501');

-- ═════ 9. restore points ═════
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((public.workspace_snapshot_create(pg_temp.d(1), '  before the audit ', pg_temp.k(900)) ->> 'seq')::bigint = pg_temp.head(1), 'an editor makes a restore point at the current seq');
select pg_temp.ok((public.workspace_snapshot_create(pg_temp.d(1), 'x', pg_temp.k(900)) ->> 'snapshot_id') = (public.workspace_snapshot_create(pg_temp.d(1), 'before the audit', pg_temp.k(900)) ->> 'snapshot_id'), 'a retried request is answered, not repeated');
select pg_temp.ok((public.workspace_snapshot_create(pg_temp.d(1), 'again', pg_temp.k(901)) ->> 'snapshot_id') = (public.workspace_snapshot_create(pg_temp.d(1), 'again', pg_temp.k(900)) ->> 'snapshot_id'), 'a second request at the same seq reuses that restore point');
select pg_temp.fails($$select public.workspace_snapshot_create(pg_temp.d(1), repeat('x', 101), pg_temp.k(902))$$, 'a label over 100 characters is refused', 'label');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select public.workspace_snapshot_create(pg_temp.d(1), 'viewer', pg_temp.k(903))$$, 'a viewer cannot make restore points', '42501');
select pg_temp.ok((select count(*) from public.workspace_snapshot_list(pg_temp.d(1))) = 1 and (select label from public.workspace_snapshot_list(pg_temp.d(1))) = 'before the audit'
  and (select author from public.workspace_snapshot_list(pg_temp.d(1))) = 'Bob Editor', 'a viewer can list them while history is shared');
select pg_temp.fails($$select * from public.workspace_snapshot_list(pg_temp.d(4))$$, 'listing for a document that does not exist is refused', '42501');
select pg_temp.as_user(pg_temp.u(1));
select public.workspace_document_set_history_visible(pg_temp.d(1), false, pg_temp.k(904));
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select * from public.workspace_snapshot_list(pg_temp.d(1))$$, 'a viewer cannot list them once the owner hides history', 'history is not shared');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((select count(*) from public.workspace_snapshot_list(pg_temp.d(1))) = 1, 'an editor still can');
select pg_temp.as_user(pg_temp.u(1));
select public.workspace_document_set_history_visible(pg_temp.d(1), true, pg_temp.k(905));

-- restore: change a lot, then go back
reset role;
create temp table snap_before as select public.workspace_build_snapshot(pg_temp.d(1)) as s;
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select id from public.workspace_snapshot_list(pg_temp.d(1)) limit 1) is not null, 'the restore point can be found');
select pg_temp.setc(1, 600, 1, pg_temp.head(1), '[{"r":1,"c":1,"value":"changed"},{"r":1,"c":2,"value":"changed too"}]'::jsonb);
select pg_temp.one(1, 601, 'rename_sheet', jsonb_build_object('sheet_id', pg_temp.sh(1), 'name', 'Renamed'));
select pg_temp.one(1, 602, 'delete_sheet', jsonb_build_object('sheet_id', pg_temp.sh(2)));
select pg_temp.one(1, 603, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(5), 'name', 'Added later'));
select pg_temp.one(1, 604, 'insert_rows', jsonb_build_object('sheet_id', pg_temp.sh(1), 'after', 1, 'ids', jsonb_build_array(3000)));
select pg_temp.one(1, 605, 'set_styles', jsonb_build_object('sheet_id', pg_temp.sh(1), 'styles', jsonb_build_array(jsonb_build_object('style_id', 9, 'style', '{"weight":"bold"}'::jsonb))));
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_sheet_restore(pg_temp.d(1), (select id from public.workspace_snapshot_list(pg_temp.d(1)) limit 1), pg_temp.k(910))$$, 'an editor cannot restore', '42501');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select public.workspace_sheet_restore(pg_temp.d(1), (select id from public.workspace_snapshot_list(pg_temp.d(1)) limit 1), pg_temp.k(911))$$, 'a viewer cannot restore', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_sheet_restore(pg_temp.d(1), pg_temp.k(8888), pg_temp.k(912))$$, 'a restore point that does not exist is refused', 'no such restore point');
select pg_temp.ok((public.workspace_sheet_restore(pg_temp.d(1), (select id from public.workspace_snapshot_list(pg_temp.d(1)) where kind = 'manual' limit 1), pg_temp.k(913)) ->> 'status') = 'restored', 'the owner restores');
select pg_temp.ok((public.workspace_sheet_restore(pg_temp.d(1), (select id from public.workspace_snapshot_list(pg_temp.d(1)) where kind = 'manual' limit 1), pg_temp.k(913)) ->> 'status') = 'restored'
  and (select count(*) from public.workspace_operations where document_id = pg_temp.d(1) and op_type = 'restore_snapshot') = 1, 'a retried restore does not restore twice');
reset role;
select pg_temp.ok((select public.workspace_build_snapshot(pg_temp.d(1))) = (select s from snap_before), 'the workbook is exactly as it was at the restore point: sheets, names, order, sizes, styles and cells');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((pg_temp.cell(1, 1, 1, 1) ->> 'last_seq')::bigint = pg_temp.head(1), 'restored cells carry the new seq');
select pg_temp.ok((select count(*) from public.workspace_snapshot_list(pg_temp.d(1)) where kind = 'pre_restore') = 1, 'a restore point of the state before the restore was kept');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((pg_temp.setc(1, 620, 1, pg_temp.head(1) - 3, '[{"r":1,"c":1,"value":"stale edit"}]'::jsonb) ->> 'status') = 'conflict', 'an edit made before the restore, from an old view, becomes a conflict');
select pg_temp.as_user(pg_temp.u(1));
reset role;
select pg_temp.ok((select count(*) from public.activity_log where action = 'workspace.restore' and entity_id = pg_temp.d(1)::text) = 1, 'the restore is logged');
select pg_temp.as_user(pg_temp.u(1));
-- archived
select pg_temp.ok((public.workspace_document_state(pg_temp.d(3), 'archive', pg_temp.k(930)) ->> 'archived') = 'true', 'archive the other workbook');
select pg_temp.fails($$select pg_temp.one(3, 931, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(7), 'name', 'Late'))$$, 'an archived workbook takes no operations', 'archived');
select pg_temp.fails($$select public.workspace_snapshot_create(pg_temp.d(3), 'x', pg_temp.k(932))$$, 'or restore points', 'archived');
select pg_temp.fails($$select public.workspace_sheet_restore(pg_temp.d(3), pg_temp.k(1), pg_temp.k(933))$$, 'or restores', 'archived');
select public.workspace_document_state(pg_temp.d(3), 'unarchive', pg_temp.k(934));

-- ═════ 10. limits that need many rows ═════
select pg_temp.ok((select count(*) from public.workspace_sheets where document_id = pg_temp.d(1) and deleted_at is null) = 2, 'the restore put back both original sheets');
do $$ begin
  for i in 1..18 loop
    perform pg_temp.one(1, 1000 + i, 'add_sheet', jsonb_build_object('sheet_id', ('b0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'name', 'Extra ' || i));
  end loop;
end $$;
select pg_temp.ok((select count(*) from public.workspace_sheets where document_id = pg_temp.d(1) and deleted_at is null) = 20, 'a workbook can hold 20 sheets');
select pg_temp.ok((pg_temp.one(1, 1100, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(6), 'name', 'One too many')) ->> 'status') = 'rejected', 'but not 21');
select pg_temp.ok((pg_temp.one(1, 1101, 'delete_sheet', jsonb_build_object('sheet_id', ('b0000000-0000-0000-0000-' || lpad('1', 12, '0'))::uuid)) ->> 'status') = 'applied', 'deleting a sheet works [answer]');
select pg_temp.ok((select count(*) from public.workspace_load_sheet(pg_temp.sh(1))) > 0, 'deleting a sheet works [state]');
select pg_temp.fails($$select * from public.workspace_load_sheet('b0000000-0000-0000-0000-000000000001')$$, 'a deleted sheet cannot be loaded', '42501');
do $$ declare s uuid; begin
  for s in select id from public.workspace_sheets where document_id = pg_temp.d(1) and deleted_at is null and id <> pg_temp.sh(1) loop
    perform pg_temp.one(1, 1200 + (random() * 1000000)::int, 'delete_sheet', jsonb_build_object('sheet_id', s));
  end loop;
end $$;
select pg_temp.ok((select count(*) from public.workspace_sheets where document_id = pg_temp.d(1) and deleted_at is null) = 1, 'down to one sheet');
select pg_temp.ok((pg_temp.one(1, 1300, 'delete_sheet', jsonb_build_object('sheet_id', pg_temp.sh(1))) ->> 'status') = 'rejected', 'the last sheet cannot be deleted');

-- 50,000 filled cells
reset role;
insert into public.workspace_cells (sheet_id, row_id, col_id, value, last_seq) select pg_temp.sh(1), 1 + (g / 26), 1 + (g % 26), to_jsonb(g), 1 from generate_series(3000, 3000 + 49990) g on conflict do nothing;
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select count(*) from public.workspace_cells c join public.workspace_sheets s on s.id = c.sheet_id where s.document_id = pg_temp.d(1) and c.value is not null) > 49000, 'the workbook is now close to 50,000 filled cells');
select pg_temp.ok((pg_temp.setc(1, 1400, 1, pg_temp.head(1), (select jsonb_agg(jsonb_build_object('r', 90, 'c', g, 'value', g)) from generate_series(1, 26) g)) ->> 'status') = 'rejected', 'going over 50,000 filled cells is rejected and undone [answer]');
select pg_temp.ok((select count(*) from public.workspace_cells where sheet_id = pg_temp.sh(1) and row_id = 90) = 0, 'going over 50,000 filled cells is rejected and undone [state]');

-- ═════ 11. automatic restore points ═════
reset role;
update public.workspace_documents set head_version = 1999 where id = pg_temp.d(3);
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((pg_temp.one(3, 1500, 'add_sheet', jsonb_build_object('sheet_id', pg_temp.sh(4), 'name', 'Tick')) ->> 'seq')::int = 2000, 'the 2,000th operation');
select pg_temp.ok((select count(*) from public.workspace_snapshot_list(pg_temp.d(3)) where kind = 'checkpoint' and seq = 2000) = 1, 'crossing every 200th operation takes an automatic restore point');

-- ═════ 12. nothing can be written directly; logs cannot change ═════
select pg_temp.fails($$insert into public.workspace_sheets(id, document_id, name, position, row_order, col_order) values (gen_random_uuid(), pg_temp.d(1), 'Direct', 0, array[1], array[1])$$, 'direct insert of a sheet is refused', '42501');
select pg_temp.fails($$update public.workspace_sheets set name = 'Hacked'$$, 'direct update of a sheet is refused', '42501');
select pg_temp.fails($$insert into public.workspace_cells(sheet_id, row_id, col_id, value, last_seq) values (pg_temp.sh(1), 1, 1, '1', 1)$$, 'direct insert of a cell is refused', '42501');
select pg_temp.fails($$update public.workspace_cells set value = '9'$$, 'direct update of a cell is refused', '42501');
select pg_temp.fails($$delete from public.workspace_cells$$, 'direct delete of cells is refused', '42501');
select pg_temp.fails($$insert into public.workspace_sheet_styles(sheet_id, style_id, style) values (pg_temp.sh(1), 50, '{}')$$, 'direct insert of a style is refused', '42501');
select pg_temp.fails($$insert into public.workspace_operations(document_id, seq, op_id, op_type, payload, status) values (pg_temp.d(1), 99999, gen_random_uuid(), 'resize', '{}', 'applied')$$, 'direct insert into the log is refused', '42501');
select pg_temp.fails($$select * from public.workspace_sheet_revisions$$, 'restore points are not readable directly', '42501');
select pg_temp.fails($$delete from public.workspace_sheet_revisions$$, 'restore points cannot be deleted directly', '42501');
reset role;
select pg_temp.fails($$update public.workspace_operations set status = 'rejected'$$, 'even the database owner cannot edit the log', 'append-only');
select pg_temp.fails($$delete from public.workspace_operations$$, 'or remove from it', 'append-only');
select pg_temp.fails($$update public.workspace_sheet_revisions set label = 'x'$$, 'or change a restore point', 'append-only');
select pg_temp.fails($$delete from public.workspace_sheet_revisions$$, 'or delete one', 'append-only');
select pg_temp.fails($$insert into public.workspace_cells(sheet_id, row_id, col_id, value, formula, last_seq) values (pg_temp.sh(1), 1, 1, '1', '=1', 1)$$, 'the table itself refuses a value and a formula together', 'check');
set local role anon;
select pg_temp.fails($$select * from public.workspace_cells$$, 'anon cannot read cells', '42501');
select pg_temp.fails($$select * from public.workspace_operations$$, 'anon cannot read the log', '42501');
reset role;

-- ═════ 13. documents are isolated ═════
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((select count(*) from public.workspace_cells where sheet_id = pg_temp.sh(3)) = 0 and (select count(*) from public.workspace_sheets where document_id = pg_temp.d(3)) = 0, 'Bob sees nothing of the workbook not shared with him');
select pg_temp.fails($$select * from public.workspace_load_sheet(pg_temp.sh(3))$$, 'and cannot load its sheet', '42501');
select pg_temp.fails($$select * from public.workspace_pull(pg_temp.d(3), 0)$$, 'or pull its changes', '42501');
select pg_temp.fails($$select pg_temp.one(3, 1600, 'resize', '{}'::jsonb)$$, 'or write to it', '42501');
select pg_temp.fails($$select public.workspace_workbook_open(pg_temp.d(3))$$, 'or open it', '42501');
select pg_temp.ok((select count(*) from public.workspace_operations where document_id = pg_temp.d(3)) = 0, 'the log of another document is invisible');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_cells where sheet_id = pg_temp.sh(1)) > 0
  and not exists (select 1 from public.workspace_cells where sheet_id = pg_temp.sh(1) and value is null and formula is null and style_id is null), 'a viewer reads cells but never sees the empty marker rows');

-- ═════ 14. hygiene ═════
reset role;
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%' and has_function_privilege('anon', p.oid, 'execute')) = 0, 'anon can execute no Workspace function (guards included)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%'
    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')) = 0, 'every Workspace function now pins its search_path, the trigger guards too');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_apply_one', 'workspace_build_snapshot', 'workspace_store_snapshot', 'workspace_style_valid', 'workspace_json_int',
    'workspace_uuid_or_null', 'workspace_append_only') and has_function_privilege('authenticated', p.oid, 'execute')) = 0, 'internal sheet helpers are not callable from the browser');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_apply_ops', 'workspace_workbook_open', 'workspace_load_sheet', 'workspace_pull', 'workspace_snapshot_create',
    'workspace_snapshot_list', 'workspace_sheet_restore') and has_function_privilege('authenticated', p.oid, 'execute')) = 7, 'the seven public sheet functions are callable by signed-in users');
select pg_temp.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'workspace\_%' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'row level security is on for every Workspace table');
select pg_temp.ok((select count(*) from information_schema.role_table_grants
  where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'authenticated' and privilege_type <> 'SELECT') = 0
  and (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'anon') = 0,
  'signed-in users hold SELECT only and anon holds nothing on Workspace tables');
select pg_temp.ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'workspace_sheet_revisions' and grantee = 'authenticated'), 'signed-in users have no direct access to restore points');
rollback;

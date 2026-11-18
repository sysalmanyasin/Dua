-- Tests for 1100_workspace_core. All people and documents here are invented.
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
-- short names: u(n) login, s(n) staff, d(n) document, k(n) idempotency key
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql as $$ select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.d(n int) returns uuid language sql as $$ select ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql as $$ select ('90000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- people: 10 owner/admin · 1 Alice (use+create) · 2 Bob (use) · 3 Carol (use) · 4 Dave (use) · 5 Erin (nothing)
--         6 Frank (use; disabled later) · 7 Grace (use; expired later) · 8 Heidi (use; removed later) · 9 Ivan (use+create)
insert into auth.users(id, email) select pg_temp.u(n), n || '@t' from generate_series(1, 10) n;
select public.bootstrap_first_admin(pg_temp.u(10), 'owner', 'Test Owner');
insert into public.staff(id, full_name) values
 (pg_temp.s(1), 'Alice Author'), (pg_temp.s(2), 'Bob Editor'), (pg_temp.s(3), 'Carol Viewer'), (pg_temp.s(4), 'Dave Outsider'),
 (pg_temp.s(5), 'Erin NoAccess'), (pg_temp.s(6), 'Frank Disabled'), (pg_temp.s(7), 'Grace Expired'), (pg_temp.s(8), 'Heidi Revoked'),
 (pg_temp.s(9), 'Ivan Newowner'), (pg_temp.s(20), 'No Login Person');
insert into public.profiles(user_id, staff_id, username, role_template)
  select pg_temp.u(n), pg_temp.s(n), 'user' || n, 'junior' from generate_series(1, 9) n;
insert into public.user_permissions(user_id, perm_key, effect) values
 (pg_temp.u(1), 'workspace.use', 'grant'), (pg_temp.u(1), 'workspace.create', 'grant'),
 (pg_temp.u(2), 'workspace.use', 'grant'), (pg_temp.u(3), 'workspace.use', 'grant'), (pg_temp.u(4), 'workspace.use', 'grant'),
 (pg_temp.u(6), 'workspace.use', 'grant'), (pg_temp.u(7), 'workspace.use', 'grant'), (pg_temp.u(8), 'workspace.use', 'grant'),
 (pg_temp.u(9), 'workspace.use', 'grant'), (pg_temp.u(9), 'workspace.create', 'grant');

-- ═════ 1. permissions exist and no role preset carries them ═════
select pg_temp.ok((select count(*) from public.permissions where key in ('workspace.use', 'workspace.create')) = 2, 'both permissions are seeded');
select pg_temp.ok((select count(*) from public.role_permissions where perm_key like 'workspace.%') = 0, 'no role preset carries a Workspace permission');

-- ═════ 2. creating documents ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok(public.workspace_create_document(pg_temp.d(1), 'note', 'Pharmacy rota', pg_temp.k(1)) ->> 'id' = pg_temp.d(1)::text, 'Alice creates a note');
select pg_temp.ok(public.workspace_create_document(pg_temp.d(1), 'note', 'Pharmacy rota', pg_temp.k(1)) ->> 'id' = pg_temp.d(1)::text, 'same key again returns the same document');
select pg_temp.ok(public.workspace_create_document(pg_temp.d(1), 'note', 'Pharmacy rota', pg_temp.k(2)) ->> 'id' = pg_temp.d(1)::text, 'same document id with a new key does not duplicate');
select pg_temp.ok((select count(*) from public.workspace_documents) = 1, 'exactly one document exists after retries');
select public.workspace_create_document(pg_temp.d(2), 'workbook', 'Stock count sheet', pg_temp.k(3));
select public.workspace_create_document(pg_temp.d(3), 'note', 'Private ideas', pg_temp.k(4));
select public.workspace_create_document(pg_temp.d(4), 'note', '50% off list', pg_temp.k(5));
select pg_temp.ok((select owner_staff_id from public.workspace_documents where id = pg_temp.d(1)) = pg_temp.s(1), 'the creator is the owner');
select pg_temp.fails($$select public.workspace_create_document(null, 'sheet', 'x', pg_temp.k(6))$$, 'unknown kind is refused', 'unknown kind');
select pg_temp.fails($$select public.workspace_create_document(null, 'note', '   ', pg_temp.k(7))$$, 'blank title is refused', 'title');
select pg_temp.fails($$select public.workspace_create_document(null, 'note', repeat('x', 201), pg_temp.k(8))$$, 'over-long title is refused', 'title');
select pg_temp.fails($$select public.workspace_create_document(null, 'note', 'x', null)$$, 'a missing key is refused', 'idempotency key');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_create_document(null, 'note', 'Bob note', pg_temp.k(9))$$, 'use without create cannot create', '42501');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.fails($$select public.workspace_create_document(null, 'note', 'Erin note', pg_temp.k(10))$$, 'no permission cannot create', '42501');
select pg_temp.as_user(pg_temp.u(9));
select pg_temp.fails($$select public.workspace_create_document(null, 'note', 'Stolen key', pg_temp.k(1))$$, 'another person cannot reuse a key', '42501');
select pg_temp.fails($$select public.workspace_create_document(pg_temp.d(1), 'note', 'Hijack', pg_temp.k(11))$$, 'another person cannot claim an existing document id', '42501');
reset role;
set local role anon;
select pg_temp.fails($$select public.workspace_create_document(null, 'note', 'anon', pg_temp.k(12))$$, 'anon cannot call the create function', '42501');
reset role;

-- ═════ 3. nothing can be written directly ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$insert into public.workspace_documents(kind, title, owner_staff_id) values ('note', 'direct', pg_temp.s(1))$$, 'direct insert of a document is refused', '42501');
select pg_temp.fails($$update public.workspace_documents set title = 'changed' where id = pg_temp.d(1)$$, 'direct update of a document is refused', '42501');
select pg_temp.fails($$delete from public.workspace_documents where id = pg_temp.d(1)$$, 'direct delete of a document is refused', '42501');
select pg_temp.fails($$insert into public.workspace_members(document_id, staff_id, role) values (pg_temp.d(1), pg_temp.s(2), 'editor')$$, 'direct insert of a member is refused', '42501');
select pg_temp.fails($$update public.workspace_members set role = 'editor'$$, 'direct update of a member is refused', '42501');
select pg_temp.fails($$insert into public.workspace_folders(staff_id, name) values (pg_temp.s(1), 'direct')$$, 'direct insert of a folder is refused', '42501');
select pg_temp.fails($$insert into public.workspace_user_state(staff_id, document_id) values (pg_temp.s(1), pg_temp.d(1))$$, 'direct insert of personal state is refused', '42501');
select pg_temp.fails($$select * from public.workspace_save_keys$$, 'idempotency keys are not readable', '42501');
reset role;
set local role anon;
select pg_temp.fails($$select * from public.workspace_documents$$, 'anon cannot read documents', '42501');
reset role;

-- ═════ 4. roles, sharing, no admin override ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) = 'owner', 'Alice is owner of her document');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) is null and (select count(*) from public.workspace_documents) = 0, 'before sharing Bob sees nothing');
select pg_temp.as_user(pg_temp.u(10), 'aal2');
select pg_temp.ok((select count(*) from public.workspace_documents) = 0 and public.workspace_role(pg_temp.d(1)) is null,
  'the pharmacy owner (admin at aal2) sees no one else''s documents: no override');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(10), 'viewer', pg_temp.k(13))$$, 'admin cannot share a document that is not theirs', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok(public.workspace_member_set(pg_temp.d(1), pg_temp.s(2), 'editor', pg_temp.k(14)) ->> 'role' = 'editor', 'Alice shares with Bob as editor');
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(3), 'viewer', pg_temp.k(15));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(6), 'viewer', pg_temp.k(16));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(7), 'viewer', pg_temp.k(17));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(8), 'viewer', pg_temp.k(18));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(4), 'viewer', pg_temp.k(19));
select public.workspace_member_set(pg_temp.d(2), pg_temp.s(2), 'editor', pg_temp.k(20));
select public.workspace_member_set(pg_temp.d(2), pg_temp.s(3), 'viewer', pg_temp.k(21));
select pg_temp.ok(public.workspace_member_set(pg_temp.d(1), pg_temp.s(2), 'editor', pg_temp.k(14)) ->> 'role' = 'editor', 'a repeated share key is answered, not applied twice');
select pg_temp.ok(public.workspace_member_set(pg_temp.d(1), pg_temp.s(3), 'editor', pg_temp.k(22)) ->> 'role' = 'editor', 'the owner can change a role');
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(3), 'viewer', pg_temp.k(23));
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(5), 'viewer', pg_temp.k(24))$$, 'cannot share with someone who lacks workspace.use', 'cannot use Workspace');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(20), 'viewer', pg_temp.k(25))$$, 'cannot share with staff who have no login', 'cannot use Workspace');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(1), 'viewer', pg_temp.k(26))$$, 'the owner cannot be added as a member', 'owner is not a member');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(2), 'owner', pg_temp.k(27))$$, 'role must be editor or viewer', 'role must be');
select pg_temp.ok((select count(*) from public.workspace_members where document_id = pg_temp.d(1)) = 6, 'members are listed for the owner');

select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) = 'editor' and public.workspace_can_write(pg_temp.d(1)), 'Bob is editor and may write');
select pg_temp.ok((select count(*) from public.workspace_documents) = 2, 'Bob sees only the two documents shared with him');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(4), 'editor', pg_temp.k(28))$$, 'an editor cannot share', '42501');
select pg_temp.fails($$select public.workspace_member_remove(pg_temp.d(1), pg_temp.s(3), pg_temp.k(29))$$, 'an editor cannot remove a member', '42501');
select pg_temp.fails($$select public.workspace_transfer_ownership(pg_temp.d(1), pg_temp.s(9), pg_temp.k(30))$$, 'an editor cannot transfer ownership', '42501');
select pg_temp.fails($$select public.workspace_document_state(pg_temp.d(1), 'delete', pg_temp.k(31))$$, 'an editor cannot delete', '42501');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) = 'viewer' and public.workspace_can_read(pg_temp.d(1)) and not public.workspace_can_write(pg_temp.d(1)), 'Carol is a viewer: reads, cannot write');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(4), 'editor', pg_temp.k(32))$$, 'a viewer cannot share', '42501');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.ok(public.workspace_role(pg_temp.d(2)) is null and (select count(*) from public.workspace_documents where id = pg_temp.d(2)) = 0, 'Dave cannot see the document he was not given');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) is null and (select count(*) from public.workspace_documents) = 0, 'someone without workspace.use sees nothing');
select pg_temp.fails($$select * from public.workspace_list_documents()$$, 'someone without workspace.use cannot list', '42501');

-- cross-document isolation
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok(public.workspace_role(pg_temp.d(3)) is null and not public.workspace_can_read(pg_temp.d(3)), 'Bob has no role on Alice''s private note');
select pg_temp.ok((select count(*) from public.workspace_members where document_id = pg_temp.d(3)) = 0, 'members of an unshared document are invisible');

-- disabled, expired, denied, removed
reset role;
update public.profiles set disabled_at = now() where user_id = pg_temp.u(6);
update public.profiles set expires_at = now() - interval '1 day' where user_id = pg_temp.u(7);
update public.user_permissions set effect = 'deny' where user_id = pg_temp.u(4) and perm_key = 'workspace.use';
select pg_temp.as_user(pg_temp.u(6));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) is null and (select count(*) from public.workspace_documents) = 0, 'a disabled account loses access at once');
select pg_temp.fails($$select * from public.workspace_list_documents()$$, 'a disabled account cannot list', '42501');
select pg_temp.as_user(pg_temp.u(7));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) is null and (select count(*) from public.workspace_documents) = 0, 'an expired account loses access at once');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) is null and (select count(*) from public.workspace_documents) = 0, 'a denied workspace.use hides documents even for a member');
select pg_temp.as_user(pg_temp.u(8));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) = 'viewer', 'Heidi can still read before removal');
select public.workspace_state_set(pg_temp.d(1), null, true, true, true);
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok(public.workspace_member_remove(pg_temp.d(1), pg_temp.s(8), pg_temp.k(33)) ->> 'removed' = 'true', 'Alice removes Heidi');
select pg_temp.ok(public.workspace_member_remove(pg_temp.d(1), pg_temp.s(8), pg_temp.k(34)) ->> 'removed' = 'false', 'removing someone who is not a member is harmless');
select pg_temp.as_user(pg_temp.u(8));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) is null and (select count(*) from public.workspace_documents) = 0, 'after removal Heidi sees nothing');
reset role;
select pg_temp.ok((select count(*) from public.workspace_user_state where staff_id = pg_temp.s(8)) = 0, 'removal also clears Heidi''s personal state for that document');
select pg_temp.ok((select count(*) from public.activity_log where action = 'workspace.share' and entity_id = pg_temp.d(1)::text) >= 5
  and (select count(*) from public.activity_log where action = 'workspace.unshare' and entity_id = pg_temp.d(1)::text) = 1, 'sharing and unsharing are logged');

-- member cap
reset role;
insert into public.staff(id, full_name) select pg_temp.s(100 + n), 'Cap person ' || n from generate_series(1, 51) n;
insert into public.workspace_members(document_id, staff_id, role) select pg_temp.d(4), pg_temp.s(100 + n), 'viewer' from generate_series(1, 50) n;
select pg_temp.fails($$insert into public.workspace_members(document_id, staff_id, role) values (pg_temp.d(4), pg_temp.s(151), 'viewer')$$, 'a 51st member is refused', 'at most 50');

-- ═════ 5. listing ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select count(*) from public.workspace_list_documents('mine')) = 4, 'Alice lists her four documents');
select pg_temp.ok((select count(*) from public.workspace_list_documents('shared')) = 0, 'Alice has nothing shared with her');
select pg_temp.ok((select count(*) from public.workspace_list_documents('all', 'ROTA')) = 1, 'search finds a title, ignoring case');
select pg_temp.ok((select count(*) from public.workspace_list_documents('all', '%')) = 1, 'a % in the search box is a plain character');
select pg_temp.ok((select count(*) from public.workspace_list_documents('all', '_')) = 0, 'a _ in the search box is a plain character');
select pg_temp.ok((select count(*) from public.workspace_list_documents('all', 'zzz')) = 0, 'search with no match returns nothing');
select pg_temp.ok((select count(*) from public.workspace_list_documents('all', null, null, null, 2)) = 2, 'the limit is honoured');
select pg_temp.ok((select count(distinct id) from (
    select id from public.workspace_list_documents('all', null, null, null, 2)
    union all
    select id from public.workspace_list_documents('all', null,
      (select updated_at from public.workspace_list_documents('all', null, null, null, 2) offset 1 limit 1),
      (select id from public.workspace_list_documents('all', null, null, null, 2) offset 1 limit 1), 2)) p) = 4, 'paging by cursor walks all four documents without repeats');
select pg_temp.fails($$select * from public.workspace_list_documents('everything')$$, 'an unknown scope is refused', 'unknown scope');
select pg_temp.ok(pg_get_function_result('public.workspace_list_documents(text,text,timestamptz,uuid,int)'::regprocedure) not like '%phone%'
  and pg_get_function_result('public.workspace_list_documents(text,text,timestamptz,uuid,int)'::regprocedure) like '%owner_name%', 'the list returns an owner name and no contact details');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_list_documents('shared')) = 2 and (select count(*) from public.workspace_list_documents('mine')) = 0, 'Carol sees two shared documents and none of her own');
select pg_temp.ok((select my_role from public.workspace_list_documents('shared') where id = pg_temp.d(1)) = 'viewer'
  and (select owner_name from public.workspace_list_documents('shared') where id = pg_temp.d(1)) = 'Alice Author', 'role and owner name are shown');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((select count(*) from public.workspace_list_documents('trash')) = 0, 'Bob has an empty trash');

-- share candidates
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select count(*) from public.workspace_share_candidates()) = (select count(*) from public.workspace_share_candidates())
  and not exists (select 1 from public.workspace_share_candidates() where full_name in
    ('Erin NoAccess', 'Frank Disabled', 'Grace Expired', 'Dave Outsider', 'No Login Person', 'Alice Author')),
  'candidates exclude no-access, disabled, expired, denied, login-less people and the caller');
select pg_temp.ok(exists (select 1 from public.workspace_share_candidates('bob') where full_name = 'Bob Editor'), 'candidates can be searched by name');
select pg_temp.ok(pg_get_function_result('public.workspace_share_candidates(text)'::regprocedure) = 'TABLE(staff_id uuid, full_name text)', 'candidates return only an id and a name');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select * from public.workspace_share_candidates()$$, 'someone without workspace.create gets no candidate list', '42501');

-- ═════ 6. archive, delete, restore ═════
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_document_state(pg_temp.d(2), 'archive', pg_temp.k(40))$$, 'an editor cannot archive', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_document_state(pg_temp.d(2), 'explode', pg_temp.k(41))$$, 'an unknown action is refused', 'unknown action');
select pg_temp.ok((public.workspace_document_state(pg_temp.d(2), 'archive', pg_temp.k(42)) ->> 'archived') = 'true', 'the owner archives');
select pg_temp.ok(public.workspace_can_read(pg_temp.d(2)) and not public.workspace_can_write(pg_temp.d(2)), 'an archived document is read-only even for its owner');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok(public.workspace_can_read(pg_temp.d(2)) and not public.workspace_can_write(pg_temp.d(2)), 'an archived document is read-only for the editor');
select pg_temp.ok((select count(*) from public.workspace_list_documents('archived')) = 1 and (select count(*) from public.workspace_list_documents('all')) = 1, 'archived documents leave the main list');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_document_state(pg_temp.d(2), 'unarchive', pg_temp.k(43)) ->> 'archived') = 'false', 'the owner unarchives');
select pg_temp.ok(public.workspace_can_write(pg_temp.d(2)), 'unarchive makes it editable again');
select pg_temp.ok((public.workspace_document_state(pg_temp.d(2), 'delete', pg_temp.k(44)) ->> 'deleted') = 'true', 'the owner deletes');
select pg_temp.ok(public.workspace_role(pg_temp.d(2)) is null and (select count(*) from public.workspace_documents where id = pg_temp.d(2)) = 0, 'a deleted document is invisible, even to its owner, through normal reads');
select pg_temp.ok((select count(*) from public.workspace_list_documents('trash')) = 1, 'the owner finds it in the trash');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_list_documents('shared')) = 1 and (select count(*) from public.workspace_list_documents('trash')) = 0, 'members no longer see it and have no trash');
select pg_temp.fails($$select public.workspace_document_state(pg_temp.d(2), 'undelete', pg_temp.k(45))$$, 'a member cannot undelete', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_document_state(pg_temp.d(2), 'undelete', pg_temp.k(46)) ->> 'deleted') = 'false', 'the owner restores it from the trash');
select pg_temp.ok(public.workspace_role(pg_temp.d(2)) = 'owner', 'a restored document is the owner''s again');
reset role;
select pg_temp.fails($$delete from public.workspace_documents where id = pg_temp.d(2)$$, 'even the database owner cannot remove a document row', 'never removed');
select pg_temp.fails($$update public.workspace_documents set kind = 'note' where id = pg_temp.d(2)$$, 'a document''s kind cannot change', 'identity');
select pg_temp.ok((select count(*) from public.activity_log where action in ('workspace.archive', 'workspace.delete', 'workspace.undelete', 'workspace.unarchive')) = 4, 'state changes are logged');

-- ═════ 7. ownership transfer ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_transfer_ownership(pg_temp.d(1), pg_temp.s(2), pg_temp.k(50))$$, 'new owner must hold workspace.create', 'cannot own');
select pg_temp.fails($$select public.workspace_transfer_ownership(pg_temp.d(1), pg_temp.s(1), pg_temp.k(51))$$, 'cannot transfer to yourself', 'someone else');
select pg_temp.fails($$select public.workspace_transfer_ownership(pg_temp.d(1), pg_temp.s(5), pg_temp.k(52))$$, 'cannot transfer to someone without access', 'cannot own');
select pg_temp.ok(public.workspace_transfer_ownership(pg_temp.d(1), pg_temp.s(9), pg_temp.k(53)) ->> 'owner_staff_id' = pg_temp.s(9)::text, 'Alice transfers to Ivan');
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) = 'editor', 'the former owner stays on as an editor');
select pg_temp.fails($$select public.workspace_member_set(pg_temp.d(1), pg_temp.s(4), 'viewer', pg_temp.k(54))$$, 'the former owner can no longer share', '42501');
select pg_temp.fails($$select public.workspace_document_state(pg_temp.d(1), 'delete', pg_temp.k(55))$$, 'the former owner can no longer delete', '42501');
select pg_temp.as_user(pg_temp.u(9));
select pg_temp.ok(public.workspace_role(pg_temp.d(1)) = 'owner', 'Ivan is now the owner');
select pg_temp.ok(public.workspace_member_set(pg_temp.d(1), pg_temp.s(8), 'viewer', pg_temp.k(56)) ->> 'role' = 'viewer', 'the new owner can share');
reset role;
insert into public.user_permissions(user_id, perm_key, effect) values (pg_temp.u(2), 'workspace.create', 'grant');
select pg_temp.as_user(pg_temp.u(9));
select pg_temp.ok(public.workspace_transfer_ownership(pg_temp.d(1), pg_temp.s(2), pg_temp.k(57)) ->> 'owner_staff_id' = pg_temp.s(2)::text, 'ownership can pass to an existing member');
reset role;
select pg_temp.ok((select count(*) from public.workspace_members where document_id = pg_temp.d(1) and staff_id = pg_temp.s(2)) = 0
  and (select count(*) from public.workspace_members where document_id = pg_temp.d(1) and staff_id = pg_temp.s(9)) = 1, 'the new owner is no longer listed as a member and the old one is');
select pg_temp.ok((select count(*) from public.activity_log where action = 'workspace.transfer') = 2, 'transfers are logged');

-- ═════ 8. personal folders and flags ═════
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok(public.workspace_folder_save(pg_temp.d(50), null, 'Rotas', pg_temp.k(60)) ->> 'name' = 'Rotas', 'Carol creates a folder');
select pg_temp.fails($$select public.workspace_folder_save(null, null, 'rotas', pg_temp.k(61))$$, 'a duplicate name (any case) is refused', 'duplicate');
select pg_temp.ok(public.workspace_folder_save(pg_temp.d(50), null, 'Rotas 2026', pg_temp.k(62)) ->> 'name' = 'Rotas 2026', 'the same folder can be renamed');
select public.workspace_folder_save(pg_temp.d(51), pg_temp.d(50), 'L2', pg_temp.k(63));
select public.workspace_folder_save(pg_temp.d(52), pg_temp.d(51), 'L3', pg_temp.k(64));
select public.workspace_folder_save(pg_temp.d(53), pg_temp.d(52), 'L4', pg_temp.k(65));
select public.workspace_folder_save(pg_temp.d(54), pg_temp.d(53), 'L5', pg_temp.k(66));
select pg_temp.fails($$select public.workspace_folder_save(pg_temp.d(55), pg_temp.d(54), 'L6', pg_temp.k(67))$$, 'a sixth level is refused', 'at most 5');
select pg_temp.fails($$select public.workspace_folder_save(pg_temp.d(50), pg_temp.d(50), 'Rotas 2026', pg_temp.k(68))$$, 'a folder cannot go inside itself', 'inside itself');
select pg_temp.fails($$select public.workspace_folder_save(pg_temp.d(50), pg_temp.d(54), 'Rotas 2026', pg_temp.k(69))$$, 'a folder cannot go inside its own child', 'inside itself');
select pg_temp.as_user(pg_temp.u(4));
reset role;
update public.user_permissions set effect = 'grant' where user_id = pg_temp.u(4) and perm_key = 'workspace.use';
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.ok((select count(*) from public.workspace_folders) = 0, 'Dave cannot see Carol''s folders');
select pg_temp.fails($$select public.workspace_folder_save(null, pg_temp.d(50), 'Sneaky', pg_temp.k(70))$$, 'a folder cannot be put under someone else''s folder', 'parent folder not found');
select pg_temp.fails($$select public.workspace_folder_save(pg_temp.d(50), null, 'Taken over', pg_temp.k(71))$$, 'someone else''s folder cannot be changed', '42501');
select pg_temp.fails($$select public.workspace_folder_remove(pg_temp.d(50), pg_temp.k(72))$$, 'someone else''s folder cannot be removed', '42501');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok(public.workspace_state_set(pg_temp.d(1), pg_temp.d(54), true, true, true) ->> 'offline_pinned' = 'true', 'Carol files, pins and marks a document for offline use');
select pg_temp.fails($$select public.workspace_state_set(pg_temp.d(3), null, true, false)$$, 'state cannot be set on a document she cannot read', '42501');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_state_set(pg_temp.d(1), pg_temp.d(54), false, false)$$, 'someone else''s folder cannot be used', '42501');
select pg_temp.ok((select count(*) from public.workspace_user_state) = 0, 'Bob sees none of Carol''s personal state');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_user_state) = 1 and (select last_opened_at from public.workspace_user_state) is not null, 'Carol sees her own state');
select pg_temp.fails($$select public.workspace_folder_remove(pg_temp.d(53), pg_temp.k(73))$$, 'a folder with sub-folders cannot be removed', 'not empty');
select pg_temp.ok(public.workspace_folder_remove(pg_temp.d(54), pg_temp.k(74)) ->> 'removed' = 'true', 'an empty folder can be removed');
reset role;
select pg_temp.ok((select folder_id from public.workspace_user_state where staff_id = pg_temp.s(3)) is null, 'documents in a removed folder become unfiled');

-- ═════ 9. rich-text validation ═════
select pg_temp.ok(public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a1"}}]}}'), 'an empty paragraph is a valid note');
select pg_temp.ok(public.workspace_note_valid($j${"v":1,"doc":{"type":"doc","content":[
  {"type":"heading","attrs":{"id":"h1","level":2},"content":[{"type":"text","text":"Title"}]},
  {"type":"paragraph","attrs":{"id":"p1"},"content":[{"type":"text","text":"Hello ","marks":[{"type":"bold"},{"type":"italic"}]},
    {"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://example.com/a?b=c"}}]},{"type":"hard_break"}]},
  {"type":"bullet_list","attrs":{"id":"l1"},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]}]},
  {"type":"task_list","attrs":{"id":"t1"},"content":[{"type":"task_item","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"done","marks":[{"type":"underline"}]}]}]}]}
]}}$j$::jsonb), 'headings, marks, links, lists and tasks are valid');
select pg_temp.ok(not public.workspace_note_valid(null), 'null is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":2,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"}}]}}'), 'an unknown version is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[]}}'), 'an empty document is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"html":"<b>x</b>","doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"}}]}}'), 'extra top-level keys (such as raw html) are refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph"}]}}'), 'a top-level block without an id is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"script","attrs":{"id":"a"}}]}}'), 'an unknown node type is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"heading","attrs":{"id":"a","level":4}}]}}'), 'heading level 4 is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a","onclick":"x"}}]}}'), 'unknown attributes are refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a b"}}]}}'), 'a block id with unsafe characters is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"},"content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}}'), 'a javascript: link is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"},"content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"data:text/html,x"}}]}]}]}}'), 'a data: link is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"},"content":[{"type":"text","text":"x","marks":[{"type":"color"}]}]}]}}'), 'an unknown mark is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"},"content":[{"type":"paragraph"}]}]}}'), 'a paragraph inside a paragraph is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"bullet_list","attrs":{"id":"a"},"content":[{"type":"paragraph"}]}]}}'), 'a list may only hold list items');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"bullet_list","attrs":{"id":"a"},"content":[]}]}}'), 'an empty list is refused');
select pg_temp.ok(not public.workspace_note_valid('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"},"content":[{"type":"text","text":""}]}]}}'), 'empty text is refused');
select pg_temp.ok(not public.workspace_note_valid(jsonb_build_object('v', 1, 'doc', jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
  jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('id', 'a'), 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', repeat('x', 40000))),
  'pad', repeat('y', 300000)))))), 'an oversize or padded document is refused');
select pg_temp.ok(not public.workspace_note_valid($j${"v":1,"doc":{"type":"doc","content":[{"type":"bullet_list","attrs":{"id":"a"},"content":[{"type":"list_item","content":[
  {"type":"bullet_list","content":[{"type":"list_item","content":[{"type":"bullet_list","content":[{"type":"list_item","content":[{"type":"bullet_list","content":[{"type":"list_item","content":[
  {"type":"paragraph"}]}]}]}]}]}]}]}]}]}}$j$::jsonb), 'nesting deeper than 8 levels is refused');

-- ═════ 10. hygiene ═════
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%' and has_function_privilege('anon', p.oid, 'execute')) = 0, 'anon can execute no Workspace function');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%' and p.proname not like '%\_guard'
    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')) = 0, 'every Workspace function pins its search_path');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_staff_eligible', 'workspace_idem_get', 'workspace_idem_put', 'workspace_note_valid', 'workspace_note_node_ok')
    and has_function_privilege('authenticated', p.oid, 'execute')) = 0, 'internal helpers are not callable from the browser');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_create_document', 'workspace_list_documents', 'workspace_member_set', 'workspace_transfer_ownership')
    and has_function_privilege('authenticated', p.oid, 'execute')) = 4, 'the public functions are callable by signed-in users');
select pg_temp.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'workspace\_%' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'row level security is on for every Workspace table');
select pg_temp.ok((select count(*) from information_schema.role_table_grants
  where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'authenticated' and privilege_type <> 'SELECT') = 0
  and (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'anon') = 0,
  'signed-in users hold SELECT only and anon holds nothing on Workspace tables');
select pg_temp.ok(exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'mgmt_staff_notes')
  and not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid where c.contype = 'f' and t.relname like 'workspace\_%' and c.confrelid::regclass::text like '%mgmt%'),
  'Workspace has no link to Manager notes');
rollback;

-- Tests for 1101_workspace_notes. All people, notes and text are invented.
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
-- a one-paragraph note
create function pg_temp.doc(txt text, bid text default 'b1') returns jsonb language sql as $$
  select jsonb_build_object('v', 1, 'doc', jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('id', bid),
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', txt)))))) $$;

-- people: 1 Alice (use+create) · 2 Bob (use) · 3 Carol (use) · 4 Dave (use, never shared) · 5 Erin (nothing) · 10 owner/admin
insert into auth.users(id, email) select pg_temp.u(n), n || '@t' from generate_series(1, 10) n;
select public.bootstrap_first_admin(pg_temp.u(10), 'owner', 'Test Owner');
insert into public.staff(id, full_name) values
 (pg_temp.s(1), 'Alice Author'), (pg_temp.s(2), 'Bob Editor'), (pg_temp.s(3), 'Carol Viewer'),
 (pg_temp.s(4), 'Dave Outsider'), (pg_temp.s(5), 'Erin NoAccess');
insert into public.profiles(user_id, staff_id, username, role_template)
  select pg_temp.u(n), pg_temp.s(n), 'user' || n, 'junior' from generate_series(1, 5) n;
insert into public.user_permissions(user_id, perm_key, effect) values
 (pg_temp.u(1), 'workspace.use', 'grant'), (pg_temp.u(1), 'workspace.create', 'grant'),
 (pg_temp.u(2), 'workspace.use', 'grant'), (pg_temp.u(3), 'workspace.use', 'grant'), (pg_temp.u(4), 'workspace.use', 'grant');

select pg_temp.as_user(pg_temp.u(1));
select public.workspace_create_document(pg_temp.d(1), 'note', 'Pharmacy rota', pg_temp.k(900));
select public.workspace_create_document(pg_temp.d(2), 'workbook', 'Stock sheet', pg_temp.k(901));
select public.workspace_create_document(pg_temp.d(3), 'note', 'Shop ideas', pg_temp.k(902));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(2), 'editor', pg_temp.k(903));
select public.workspace_member_set(pg_temp.d(1), pg_temp.s(3), 'viewer', pg_temp.k(904));
select public.workspace_member_set(pg_temp.d(3), pg_temp.s(3), 'viewer', pg_temp.k(905));

-- ═════ 1. opening ═════
select pg_temp.ok((public.workspace_note_open(pg_temp.d(1)) ->> 'head_version') = '0' and public.workspace_note_open(pg_temp.d(1)) -> 'content' = 'null'::jsonb
  and (public.workspace_note_open(pg_temp.d(1)) ->> 'role') = 'owner', 'an unsaved note opens empty and shows the caller''s role');
select pg_temp.fails($$select public.workspace_note_open(pg_temp.d(2))$$, 'a workbook is not opened as a note', 'not a note');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((public.workspace_note_open(pg_temp.d(1)) ->> 'role') = 'viewer', 'a viewer can open the note');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select public.workspace_note_open(pg_temp.d(1))$$, 'someone it is not shared with cannot open it', '42501');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.fails($$select public.workspace_note_open(pg_temp.d(1))$$, 'someone without workspace.use cannot open it', '42501');

-- ═════ 2. saving, retries, autosave in place ═════
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 0, pg_temp.doc('Hello'), pg_temp.k(1)) ->> 'version') = '1', 'the first save creates version 1');
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 0, pg_temp.doc('Hello'), pg_temp.k(1)) ->> 'version') = '1', 'a retried save is answered, not repeated');
select pg_temp.ok((select count(*) from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 1
  and (select kind from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 'create', 'one revision of kind create exists');
select pg_temp.ok((select head_version from public.workspace_documents where id = pg_temp.d(1)) = 1, 'the document points at version 1');
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 1, pg_temp.doc('Hello world'), pg_temp.k(2)) ->> 'in_place') = 'true', 'a quick follow-up save updates the open revision in place');
select pg_temp.ok((select count(*) from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 1
  and (select plain_text from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 'Hello world', 'still one revision, with the new text');
select pg_temp.ok((public.workspace_note_open(pg_temp.d(1)) -> 'content' -> 'doc' -> 'content' -> 0 -> 'content' -> 0 ->> 'text') = 'Hello world', 'opening returns the newest text');
reset role;
update public.workspace_note_revisions set saved_at = now() - interval '10 minutes' where document_id = pg_temp.d(1) and version = 1;
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 1, pg_temp.doc('Hello again'), pg_temp.k(3)) ->> 'version') = '2', 'after five minutes a save starts a new version');
select pg_temp.ok((select sealed from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 1), 'the older version is sealed');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 2, pg_temp.doc('Bob edit'), pg_temp.k(4)) ->> 'version') = '3', 'a different author always gets a new version');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select sealed from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 2), 'Alice''s version is sealed when Bob saves');

-- ═════ 3. conflicts: nothing is overwritten ═════
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 2, pg_temp.doc('Alice stale'), pg_temp.k(5)) ->> 'status') = 'conflict', 'saving from an old version is reported as a conflict');
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 2, pg_temp.doc('Alice stale'), pg_temp.k(5)) ->> 'status') = 'conflict', 'a retried conflicting save gives the same answer');
select pg_temp.ok((select count(*) from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 3
  and (select plain_text from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 3) = 'Bob edit', 'the newer text is untouched and no version was added');
select pg_temp.ok((select count(*) from public.workspace_conflicts where document_id = pg_temp.d(1)) = 1
  and (select local_state -> 'doc' -> 'content' -> 0 -> 'content' -> 0 ->> 'text' from public.workspace_conflicts where document_id = pg_temp.d(1)) = 'Alice stale', 'the losing text is kept in the conflict');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 2, pg_temp.doc('Bob stale'), pg_temp.k(6)) ->> 'status') = 'conflict', 'Bob can conflict too');
select pg_temp.ok((select count(*) from public.workspace_conflicts) = 1, 'Bob sees only his own conflict');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((select count(*) from public.workspace_conflicts where document_id = pg_temp.d(1)) = 2, 'the owner sees every conflict on the document');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_conflicts) = 0, 'a viewer sees no conflicts');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 3, pg_temp.doc('Merged text'), pg_temp.k(7), false,
  (select id from public.workspace_conflicts where actor_staff_id = pg_temp.s(1)), 'merged') ->> 'version') = '4', 'saving the merged text resolves the conflict and makes version 4');
select pg_temp.ok((select kind from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 4) = 'merge'
  and (select status from public.workspace_conflicts where actor_staff_id = pg_temp.s(1)) = 'merged', 'the revision is a merge and the conflict is marked merged');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Again'), pg_temp.k(8), false, (select id from public.workspace_conflicts where actor_staff_id = pg_temp.s(1)), 'merged')$$, 'a resolved conflict cannot be resolved twice', 'conflict not found');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Again'), pg_temp.k(8), false, pg_temp.k(999), 'merged')$$, 'an unknown conflict id is refused', 'conflict not found');
select pg_temp.ok((public.workspace_conflict_resolve((select id from public.workspace_conflicts where actor_staff_id = pg_temp.s(2)), 'kept_server', pg_temp.k(10)) ->> 'status') = 'kept_server', 'the owner can resolve Bob''s conflict by keeping the server text');
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 3, pg_temp.doc('Alice stale again'), pg_temp.k(9)) ->> 'status') = 'conflict', 'a new conflict for Alice');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_conflict_resolve((select id from public.workspace_conflicts where status = 'open' limit 1), 'dismissed', pg_temp.k(11))$$, 'Bob cannot resolve Alice''s conflict', 'not allowed');
select pg_temp.fails($$select public.workspace_conflict_resolve(pg_temp.k(998), 'dismissed', pg_temp.k(12))$$, 'an unknown conflict is refused', 'not allowed');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_conflict_resolve((select id from public.workspace_conflicts where status = 'open' limit 1), 'keep_all', pg_temp.k(13))$$, 'an unknown choice is refused', 'choice must be');
select pg_temp.ok((public.workspace_conflict_resolve((select id from public.workspace_conflicts where status = 'open' limit 1), 'dismissed', pg_temp.k(14)) ->> 'status') = 'dismissed', 'Alice dismisses her own conflict');
select pg_temp.fails($$select public.workspace_conflict_resolve((select id from public.workspace_conflicts where status = 'dismissed' limit 1), 'dismissed', pg_temp.k(15))$$, 'a resolved conflict cannot be resolved again', 'already resolved');

-- ═════ 4. who may save, and bad input ═════
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Viewer edit'), pg_temp.k(20))$$, 'a viewer cannot save', '42501');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Outsider'), pg_temp.k(21))$$, 'someone it is not shared with cannot save', '42501');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Nobody'), pg_temp.k(22))$$, 'someone without workspace.use cannot save', '42501');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Stolen key'), pg_temp.k(1))$$, 'another person cannot reuse a save key', '42501');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, '{"v":1,"doc":{"type":"doc","content":[{"type":"script","attrs":{"id":"x"}}]}}'::jsonb, pg_temp.k(23))$$, 'invalid note content is refused', 'not valid');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 99, pg_temp.doc('Future'), pg_temp.k(24))$$, 'a base version from the future is refused', 'unknown base version');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), -1, pg_temp.doc('Past'), pg_temp.k(25))$$, 'a negative base version is refused', 'unknown base version');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('x'), null)$$, 'a missing key is refused', 'idempotency key');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(2), 0, pg_temp.doc('Not a note'), pg_temp.k(27))$$, 'a workbook cannot be saved as a note', 'not a note');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('x'), pg_temp.k(28), false, pg_temp.k(997), 'dismissed')$$, 'only kept_local or merged resolve by saving', 'resolution must be');
-- an explicit "save version" seals; the next save can never reuse a sealed revision
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 4, pg_temp.doc('Release 1'), pg_temp.k(30), true) ->> 'version') = '5', 'save version makes version 5');
select pg_temp.ok((select sealed from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 5), 'and seals it');
select pg_temp.ok((public.workspace_note_save(pg_temp.d(1), 5, pg_temp.doc('After release'), pg_temp.k(31)) ->> 'version') = '6', 'the next save is a new version');

-- ═════ 5. restore: a new revision, history intact ═════
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_note_restore(pg_temp.d(1), 1, pg_temp.k(40))$$, 'an editor cannot restore', '42501');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select public.workspace_note_restore(pg_temp.d(1), 1, pg_temp.k(41))$$, 'a viewer cannot restore', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_note_restore(pg_temp.d(1), 6, pg_temp.k(42))$$, 'the current version cannot be restored onto itself', 'already the current');
select pg_temp.fails($$select public.workspace_note_restore(pg_temp.d(1), 77, pg_temp.k(43))$$, 'a missing version cannot be restored', 'no such version');
select pg_temp.ok((public.workspace_note_restore(pg_temp.d(1), 1, pg_temp.k(44)) ->> 'version') = '7', 'the owner restores version 1 as a new version 7');
select pg_temp.ok((public.workspace_note_restore(pg_temp.d(1), 1, pg_temp.k(44)) ->> 'version') = '7', 'a retried restore does not restore twice');
select pg_temp.ok((select count(*) from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 7, 'all seven versions are still there');
select pg_temp.ok((select kind from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 7) = 'restore'
  and (select restored_from from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 7) = 1
  and (select plain_text from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 7) = 'Hello world'
  and (select sealed from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 7), 'version 7 is a sealed restore of version 1 with its text');
select pg_temp.ok((select head_version from public.workspace_documents where id = pg_temp.d(1)) = 7, 'the document now points at version 7');
reset role;
select pg_temp.ok((select count(*) from public.activity_log where action = 'workspace.restore' and entity_id = pg_temp.d(1)::text) = 1, 'the restore is logged');
select pg_temp.as_user(pg_temp.u(1));

-- ═════ 6. history and who may see it ═════
select pg_temp.ok((select count(*) from public.workspace_note_history(pg_temp.d(1))) = 7
  and (select count(*) from public.workspace_note_history(pg_temp.d(1)) where is_head) = 1
  and (select version from public.workspace_note_history(pg_temp.d(1)) limit 1) = 7, 'the owner sees seven versions, newest first, one head');
select pg_temp.ok((select author from public.workspace_note_history(pg_temp.d(1)) where version = 3) = 'Bob Editor'
  and (select author from public.workspace_note_history(pg_temp.d(1)) where version = 2) = 'Alice Author', 'authors are named');
select pg_temp.ok((select count(*) from public.workspace_note_history(pg_temp.d(1), 4)) = 3, 'history pages with a before cursor');
select pg_temp.ok((select count(*) from public.workspace_note_history(pg_temp.d(1), null, 2)) = 2, 'history honours the limit');
select pg_temp.ok(pg_get_function_result('public.workspace_note_history(uuid,bigint,int)'::regprocedure) not like '%content%', 'the history list carries no note text');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_note_history(pg_temp.d(1))) = 7, 'a viewer sees history while the owner allows it');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_document_set_history_visible(pg_temp.d(1), false, pg_temp.k(50))$$, 'an editor cannot change history visibility', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_document_set_history_visible(pg_temp.d(1), false, pg_temp.k(51)) ->> 'history_visible_to_viewers') = 'false', 'the owner hides history from viewers');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.fails($$select * from public.workspace_note_history(pg_temp.d(1))$$, 'a viewer can no longer list history', 'history is not shared');
select pg_temp.ok((select count(*) from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 1
  and (select version from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 7, 'a viewer can still read the newest version, and only that');
select pg_temp.ok((public.workspace_note_open(pg_temp.d(1)) ->> 'head_version') = '7', 'and open the note');
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.ok((select count(*) from public.workspace_note_revisions where document_id = pg_temp.d(1)) = 7, 'an editor still reads every version');
select pg_temp.as_user(pg_temp.u(1));
select public.workspace_document_set_history_visible(pg_temp.d(1), true, pg_temp.k(52));
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select * from public.workspace_note_history(pg_temp.d(1))$$, 'someone it is not shared with sees no history', '42501');

-- ═════ 7. rename ═════
select pg_temp.as_user(pg_temp.u(2));
select pg_temp.fails($$select public.workspace_document_rename(pg_temp.d(1), 'Bob rename', pg_temp.k(60))$$, 'an editor cannot rename', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.fails($$select public.workspace_document_rename(pg_temp.d(1), '   ', pg_temp.k(61))$$, 'a blank title is refused', 'title');
select pg_temp.fails($$select public.workspace_document_rename(pg_temp.d(1), repeat('x', 201), pg_temp.k(62))$$, 'an over-long title is refused', 'title');
select pg_temp.ok((public.workspace_document_rename(pg_temp.d(1), '  Pharmacy rota v2 ', pg_temp.k(63)) ->> 'title') = 'Pharmacy rota v2', 'the owner renames (trimmed)');
select pg_temp.ok((select title from public.workspace_documents where id = pg_temp.d(1)) = 'Pharmacy rota v2', 'the title changed');

-- ═════ 7b. member list ═════
select pg_temp.ok((select count(*) from public.workspace_member_list(pg_temp.d(1))) = 3
  and (select full_name from public.workspace_member_list(pg_temp.d(1)) limit 1) = 'Alice Author'
  and (select role from public.workspace_member_list(pg_temp.d(1)) limit 1) = 'owner', 'the member list starts with the owner and names everyone');
select pg_temp.ok(pg_get_function_result('public.workspace_member_list(uuid)'::regprocedure) = 'TABLE(staff_id uuid, full_name text, role text, added_at timestamp with time zone)', 'the member list returns names and roles only');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_member_list(pg_temp.d(1))) = 3, 'a viewer can see who else has access');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.fails($$select * from public.workspace_member_list(pg_temp.d(1))$$, 'someone it is not shared with cannot list the members', '42501');
select pg_temp.as_user(pg_temp.u(1));

-- ═════ 8. search ═════
select pg_temp.ok((select count(*) from public.workspace_search_notes('world')) = 1, 'search finds text in the newest version');
select pg_temp.ok((select count(*) from public.workspace_search_notes('ROTA')) = 1, 'search finds a title, ignoring case');
select pg_temp.ok((select count(*) from public.workspace_search_notes('Merged')) = 0, 'older versions are not searched');
select pg_temp.ok((select count(*) from public.workspace_search_notes('%%')) = 0, 'a % in the search is a plain character');
select pg_temp.fails($$select * from public.workspace_search_notes('a')$$, 'a one-letter search is refused', 'at least 2');
select public.workspace_note_save(pg_temp.d(3), 0, pg_temp.doc('Order zebra stickers'), pg_temp.k(70));
select pg_temp.ok((select count(*) from public.workspace_search_notes('zebra')) = 1, 'a second note is found');
select pg_temp.ok((select excerpt from public.workspace_search_notes('zebra')) = 'Order zebra stickers' and (select my_role from public.workspace_search_notes('zebra')) = 'owner', 'the excerpt and role are returned');
select pg_temp.as_user(pg_temp.u(3));
select pg_temp.ok((select count(*) from public.workspace_search_notes('zebra')) = 1 and (select my_role from public.workspace_search_notes('zebra')) = 'viewer', 'a viewer finds what is shared with them');
select pg_temp.as_user(pg_temp.u(4));
select pg_temp.ok((select count(*) from public.workspace_search_notes('zebra')) = 0 and (select count(*) from public.workspace_search_notes('world')) = 0, 'someone it is not shared with finds nothing');
select pg_temp.as_user(pg_temp.u(10), 'aal2');
select pg_temp.ok((select count(*) from public.workspace_search_notes('world')) = 0, 'the pharmacy owner''s admin account finds nothing that is not shared with it');
select pg_temp.fails($$select public.workspace_note_open(pg_temp.d(1))$$, 'and cannot open it either: no admin override', '42501');
select pg_temp.as_user(pg_temp.u(5));
select pg_temp.fails($$select * from public.workspace_search_notes('world')$$, 'someone without workspace.use cannot search', '42501');
select pg_temp.as_user(pg_temp.u(1));
select pg_temp.ok((public.workspace_document_state(pg_temp.d(3), 'archive', pg_temp.k(71)) ->> 'archived') = 'true', 'Alice archives the second note');
select pg_temp.ok((select count(*) from public.workspace_search_notes('zebra')) = 0, 'archived notes leave the search');
select pg_temp.fails($$select public.workspace_note_save(pg_temp.d(3), 1, pg_temp.doc('Edit archived'), pg_temp.k(72))$$, 'an archived note cannot be saved', 'archived');
select pg_temp.fails($$select public.workspace_note_restore(pg_temp.d(3), 1, pg_temp.k(73))$$, 'an archived note cannot be restored', 'archived');
select pg_temp.ok((public.workspace_note_open(pg_temp.d(3)) ->> 'archived') = 'true', 'but it can still be opened');

-- ═════ 9. nothing can be written directly; sealed rows are fixed ═════
select pg_temp.fails($$insert into public.workspace_note_revisions(document_id, version, content, kind, base_version, op_id) values (pg_temp.d(1), 99, pg_temp.doc('x'), 'edit', 0, pg_temp.k(80))$$, 'direct insert of a revision is refused', '42501');
select pg_temp.fails($$update public.workspace_note_revisions set content = pg_temp.doc('tampered') where document_id = pg_temp.d(1)$$, 'direct update of a revision is refused', '42501');
select pg_temp.fails($$delete from public.workspace_note_revisions where document_id = pg_temp.d(1)$$, 'direct delete of a revision is refused', '42501');
select pg_temp.fails($$insert into public.workspace_conflicts(document_id, op_id, actor_staff_id, kind) values (pg_temp.d(1), pg_temp.k(81), pg_temp.s(1), 'note')$$, 'direct insert of a conflict is refused', '42501');
select pg_temp.fails($$update public.workspace_conflicts set status = 'dismissed'$$, 'direct update of a conflict is refused', '42501');
select public.workspace_note_save(pg_temp.d(1), 7, pg_temp.doc('Open revision'), pg_temp.k(82));
reset role;
select pg_temp.fails($$update public.workspace_note_revisions set content = pg_temp.doc('tampered') where document_id = pg_temp.d(1) and version = 1$$, 'even the database owner cannot change a sealed revision', 'sealed');
select pg_temp.fails($$update public.workspace_note_revisions set kind = 'restore' where document_id = pg_temp.d(1) and version = 8$$, 'an open revision''s kind cannot change', 'only the content');
select pg_temp.fails($$delete from public.workspace_note_revisions where document_id = pg_temp.d(1) and version = 8$$, 'a revision cannot be deleted', 'never removed');
select pg_temp.fails($$insert into public.workspace_note_revisions(document_id, version, content, kind, base_version, op_id) values (pg_temp.d(1), 99, '{"v":1,"doc":{"type":"doc","content":[{"type":"x"}]}}'::jsonb, 'edit', 0, pg_temp.k(83))$$, 'the database itself rejects invalid note content', 'check');
set local role anon;
select pg_temp.fails($$select * from public.workspace_note_revisions$$, 'anon cannot read revisions', '42501');
select pg_temp.fails($$select * from public.workspace_conflicts$$, 'anon cannot read conflicts', '42501');
reset role;

-- ═════ 10. plain text extraction ═════
select pg_temp.ok(public.workspace_note_plain_text($j${"v":1,"doc":{"type":"doc","content":[
  {"type":"heading","attrs":{"id":"h","level":1},"content":[{"type":"text","text":"Title"}]},
  {"type":"paragraph","attrs":{"id":"p"},"content":[{"type":"text","text":"one "},{"type":"text","text":"two","marks":[{"type":"bold"}]},{"type":"hard_break"},{"type":"text","text":"three"}]},
  {"type":"bullet_list","attrs":{"id":"l"},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"item"}]}]}]}
]}}$j$::jsonb) = E'Title\none two\nthree\nitem', 'text is extracted with line breaks between blocks');
select pg_temp.ok(length(public.workspace_note_plain_text(pg_temp.doc(repeat('x', 40000)))) = 20000, 'extracted text is capped at 20,000 characters');

-- ═════ 11. hygiene ═════
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%' and has_function_privilege('anon', p.oid, 'execute')) = 0, 'anon can execute no Workspace function');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%'
    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')) = 0, 'every Workspace function pins its search_path');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_note_plain_text', 'workspace_note_node_text', 'workspace_note_revisions_guard')
    and has_function_privilege('authenticated', p.oid, 'execute')) = 0, 'internal note helpers are not callable from the browser');
select pg_temp.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'workspace\_%' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'row level security is on for every Workspace table');
select pg_temp.ok((select count(*) from information_schema.role_table_grants
  where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'authenticated' and privilege_type <> 'SELECT') = 0
  and (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'workspace\_%' and grantee = 'anon') = 0,
  'signed-in users hold SELECT only and anon holds nothing on Workspace tables');
rollback;

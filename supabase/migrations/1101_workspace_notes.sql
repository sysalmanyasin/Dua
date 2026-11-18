-- 1101_workspace_notes.sql — Dua Workspace, step 2: note revisions, save / restore, history, search, conflict store.
-- Follows 1100_workspace_core.sql. Same rules: RLS everywhere, no write grants, every write is a function below that
-- re-checks the caller through workspace_role(), idempotency key on every write, nothing is ever silently overwritten.
--
-- How saving works (the design in docs/modules/workspace.md):
--  * A note's content is a restricted JSON tree (workspace_note_valid, from 1100). Each save names the version the editor
--    started from (p_base_version). If that is still the newest version, the save is applied. If someone else saved
--    meanwhile, NOTHING is overwritten: the editor's text is stored as an open conflict and the caller is told.
--  * Autosave does not create thousands of revisions: the same author's own newest revision stays open ("unsealed") and is
--    updated in place for up to 5 minutes. It is sealed (immutable forever) when someone else saves, when 5 minutes have
--    passed, on restore, or on an explicit "save version". Sealed revisions can never change or be removed.
--  * Restoring an old version writes a NEW revision with that content. History is never erased.

-- ───────── plain text of a note (for search and excerpts; computed by the server, never trusted from the browser) ─────────
create function public.workspace_note_node_text(n jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare c jsonb; out text := ''; piece text;
begin
  if n ->> 'type' = 'text' then return coalesce(n ->> 'text', ''); end if;
  if n ->> 'type' = 'hard_break' then return E'\n'; end if;
  if jsonb_typeof(n -> 'content') = 'array' then
    for c in select value from jsonb_array_elements(n -> 'content') loop
      piece := public.workspace_note_node_text(c);
      if out <> '' and (c ->> 'type') not in ('text', 'hard_break') then out := out || E'\n'; end if;
      out := out || piece;
    end loop;
  end if;
  return out;
end $$;

create function public.workspace_note_plain_text(p jsonb) returns text
language sql immutable set search_path = public as $$
  select left(public.workspace_note_node_text(p -> 'doc'), 20000)
$$;

-- ───────── tables ─────────
create table public.workspace_note_revisions (
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  version bigint not null check (version >= 1),
  content jsonb not null check (public.workspace_note_valid(content)),
  plain_text text not null default '' check (length(plain_text) <= 20000),
  kind text not null check (kind in ('create', 'edit', 'restore', 'merge')),
  restored_from bigint,
  base_version bigint not null check (base_version >= 0),
  op_id uuid not null,
  sealed boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  saved_at timestamptz not null default now(),
  primary key (document_id, version)
);
create index workspace_note_revisions_text on public.workspace_note_revisions using gin (to_tsvector('simple', plain_text));
alter table public.workspace_note_revisions enable row level security;

-- Conflicts: the editor's text that lost the race, kept until someone resolves it. Sheets use the same table later (1103).
create table public.workspace_conflicts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  op_id uuid not null,
  actor_staff_id uuid not null references public.staff(id) on delete restrict,
  kind text not null check (kind in ('cell', 'note', 'target_deleted', 'structure')),
  target jsonb not null default '{}'::jsonb,
  server_state jsonb,
  local_state jsonb check (local_state is null or octet_length(local_state::text) <= 300000),
  status text not null default 'open' check (status in ('open', 'kept_local', 'kept_server', 'merged', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz
);
create index workspace_conflicts_doc on public.workspace_conflicts (document_id, status);
alter table public.workspace_conflicts enable row level security;

create function public.workspace_note_revisions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'revisions are never removed'; end if;
  if old.sealed then raise exception 'a sealed revision cannot change'; end if;
  if new.document_id <> old.document_id or new.version <> old.version or new.kind <> old.kind
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at
     or new.restored_from is distinct from old.restored_from or new.base_version <> old.base_version then
    raise exception 'only the content, the sealed flag and the save time of an open revision can change';
  end if;
  return new;
end $$;
create trigger workspace_note_revisions_guard before update or delete on public.workspace_note_revisions
  for each row execute function public.workspace_note_revisions_guard();

-- ───────── reading ─────────
-- Owners and editors read every revision. A viewer reads the newest revision always, and older ones only while the owner
-- allows viewers to see history.
create function public.workspace_can_read_revision(p_doc uuid, p_version bigint) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text; d record;
begin
  r := public.workspace_role(p_doc);
  if r is null then return false; end if;
  if r <> 'viewer' then return true; end if;
  select head_version, history_visible_to_viewers into d from public.workspace_documents where id = p_doc;
  return d.history_visible_to_viewers or p_version = d.head_version;
end $$;

create policy workspace_note_revisions_read on public.workspace_note_revisions for select to authenticated
  using ((select public.workspace_can_read_revision(document_id, version)));
create policy workspace_conflicts_read on public.workspace_conflicts for select to authenticated
  using ((select public.workspace_can_read(document_id))
         and (actor_staff_id = (select public.workspace_my_staff_id()) or (select public.workspace_is_owner(document_id))));

revoke all on public.workspace_note_revisions, public.workspace_conflicts from anon, authenticated;
grant select on public.workspace_note_revisions, public.workspace_conflicts to authenticated;
grant all on public.workspace_note_revisions, public.workspace_conflicts to service_role;

-- Opens a note: its details, the caller's role and the newest content (null while nothing has been saved yet).
create function public.workspace_note_open(p_doc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.workspace_documents; r text; rev public.workspace_note_revisions;
begin
  r := public.workspace_role(p_doc);
  if r is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc;
  if d.kind <> 'note' then raise exception 'not a note'; end if;
  if d.head_version > 0 then
    select * into rev from public.workspace_note_revisions where document_id = p_doc and version = d.head_version;
  end if;
  return jsonb_build_object('id', d.id, 'title', d.title, 'role', r, 'archived', d.archived_at is not null,
    'head_version', d.head_version, 'content', case when d.head_version > 0 then rev.content end,
    'sealed', coalesce(rev.sealed, false), 'updated_at', d.updated_at,
    'history_visible_to_viewers', d.history_visible_to_viewers);
end $$;

-- ───────── saving ─────────
create function public.workspace_note_save(p_doc uuid, p_base_version bigint, p_content jsonb, p_op_id uuid,
  p_seal boolean default false, p_resolves uuid default null, p_resolution text default 'merged') returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; r text; d public.workspace_documents; me uuid; head public.workspace_note_revisions;
  cf public.workspace_conflicts; new_ver bigint; txt text; res jsonb; cid uuid; k text; in_place boolean := false;
begin
  cached := public.workspace_idem_get(p_op_id, 'note_save');
  if cached is not null then return cached; end if;
  r := public.workspace_role(p_doc);
  if r is null or r not in ('owner', 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc for update;
  if d.kind <> 'note' then raise exception 'not a note'; end if;
  if d.archived_at is not null then raise exception 'the document is archived'; end if;
  if p_base_version is null or p_base_version < 0 or p_base_version > d.head_version then raise exception 'unknown base version'; end if;
  if not public.workspace_note_valid(p_content) then raise exception 'note content is not valid'; end if;
  me := public.workspace_my_staff_id();

  if p_resolves is not null then
    if p_resolution not in ('kept_local', 'merged') then raise exception 'resolution must be kept_local or merged'; end if;
    select * into cf from public.workspace_conflicts where id = p_resolves and document_id = p_doc and status = 'open';
    if not found or not (cf.actor_staff_id = me or r = 'owner') then raise exception 'conflict not found'; end if;
  end if;

  if p_base_version <> d.head_version then
    -- Someone saved since this editor started: keep their text as a conflict, change nothing else.
    insert into public.workspace_conflicts (document_id, op_id, actor_staff_id, kind, target, server_state, local_state)
      values (p_doc, p_op_id, me, 'note',
              jsonb_build_object('base_version', p_base_version, 'head_version', d.head_version),
              jsonb_build_object('version', d.head_version), p_content)
      returning id into cid;
    res := jsonb_build_object('status', 'conflict', 'conflict_id', cid, 'head_version', d.head_version, 'base_version', p_base_version);
    perform public.workspace_idem_put(p_op_id, 'note_save', res);
    return res;
  end if;

  txt := public.workspace_note_plain_text(p_content);
  if d.head_version > 0 then
    select * into head from public.workspace_note_revisions where document_id = p_doc and version = d.head_version;
    in_place := p_resolves is null and not head.sealed and head.created_by = auth.uid()
                and head.kind in ('create', 'edit') and head.saved_at > now() - interval '5 minutes';
  end if;

  if in_place then
    update public.workspace_note_revisions set content = p_content, plain_text = txt, saved_at = now(),
      op_id = p_op_id, sealed = coalesce(p_seal, false)
      where document_id = p_doc and version = head.version;
    new_ver := head.version;
  else
    if d.head_version >= 5000 then raise exception 'this note has too many saved versions'; end if;
    if d.head_version > 0 then
      update public.workspace_note_revisions set sealed = true where document_id = p_doc and version = d.head_version and not sealed;
    end if;
    new_ver := d.head_version + 1;
    k := case when p_resolves is not null and p_resolution = 'merged' then 'merge'
              when d.head_version = 0 then 'create' else 'edit' end;
    insert into public.workspace_note_revisions (document_id, version, content, plain_text, kind, base_version, op_id, sealed, created_by)
      values (p_doc, new_ver, p_content, txt, k, p_base_version, p_op_id, coalesce(p_seal, false), auth.uid());
  end if;

  update public.workspace_documents set head_version = new_ver, updated_at = now(), updated_by = auth.uid() where id = p_doc;
  if p_resolves is not null then
    update public.workspace_conflicts set status = p_resolution, resolved_by = auth.uid(), resolved_at = now() where id = p_resolves;
  end if;
  res := jsonb_build_object('status', 'saved', 'version', new_ver, 'head_version', new_ver, 'in_place', in_place);
  perform public.workspace_idem_put(p_op_id, 'note_save', res);
  return res;
end $$;

-- Owner only. Writes a new revision with an old version's content; nothing is erased.
create function public.workspace_note_restore(p_doc uuid, p_version bigint, p_op_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; d public.workspace_documents; old public.workspace_note_revisions; new_ver bigint; res jsonb;
begin
  cached := public.workspace_idem_get(p_op_id, 'note_restore');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc for update;
  if d.kind <> 'note' then raise exception 'not a note'; end if;
  if d.archived_at is not null then raise exception 'the document is archived'; end if;
  select * into old from public.workspace_note_revisions where document_id = p_doc and version = p_version;
  if not found then raise exception 'no such version'; end if;
  if p_version = d.head_version then raise exception 'that version is already the current one'; end if;
  if d.head_version >= 5000 then raise exception 'this note has too many saved versions'; end if;
  update public.workspace_note_revisions set sealed = true where document_id = p_doc and version = d.head_version and not sealed;
  new_ver := d.head_version + 1;
  insert into public.workspace_note_revisions (document_id, version, content, plain_text, kind, restored_from, base_version, op_id, sealed, created_by)
    values (p_doc, new_ver, old.content, old.plain_text, 'restore', p_version, d.head_version, p_op_id, true, auth.uid());
  update public.workspace_documents set head_version = new_ver, updated_at = now(), updated_by = auth.uid() where id = p_doc;
  perform public.log_activity('workspace.restore', 'workspace_document', p_doc::text,
    jsonb_build_object('version', d.head_version), jsonb_build_object('version', new_ver, 'restored_from', p_version), null);
  res := jsonb_build_object('status', 'restored', 'version', new_ver, 'restored_from', p_version);
  perform public.workspace_idem_put(p_op_id, 'note_restore', res);
  return res;
end $$;

-- Revision list without the text. Viewers only while the owner allows it.
create function public.workspace_note_history(p_doc uuid, p_before bigint default null, p_limit int default 50)
returns table (version bigint, kind text, restored_from bigint, author text, created_at timestamptz,
               saved_at timestamptz, sealed boolean, chars int, is_head boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare r text; d public.workspace_documents;
begin
  r := public.workspace_role(p_doc);
  if r is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc;
  if d.kind <> 'note' then raise exception 'not a note'; end if;
  if r = 'viewer' and not d.history_visible_to_viewers then raise exception 'history is not shared' using errcode = '42501'; end if;
  return query
    select v.version, v.kind, v.restored_from, s.full_name, v.created_at, v.saved_at, v.sealed,
           length(v.plain_text), v.version = d.head_version
    from public.workspace_note_revisions v
    left join public.profiles pr on pr.user_id = v.created_by
    left join public.staff s on s.id = pr.staff_id
    where v.document_id = p_doc and (p_before is null or v.version < p_before)
    order by v.version desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ───────── owner-only metadata ─────────
create function public.workspace_document_rename(p_doc uuid, p_title text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'rename');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200 then raise exception 'title must be 1 to 200 characters'; end if;
  update public.workspace_documents set title = trim(p_title), updated_by = auth.uid() where id = p_doc;
  res := jsonb_build_object('id', p_doc, 'title', trim(p_title));
  perform public.workspace_idem_put(p_key, 'rename', res);
  return res;
end $$;

create function public.workspace_document_set_history_visible(p_doc uuid, p_visible boolean, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'history_visible');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_visible is null then raise exception 'choose yes or no'; end if;
  update public.workspace_documents set history_visible_to_viewers = p_visible, updated_by = auth.uid() where id = p_doc;
  res := jsonb_build_object('id', p_doc, 'history_visible_to_viewers', p_visible);
  perform public.workspace_idem_put(p_key, 'history_visible', res);
  return res;
end $$;

-- Resolves a conflict without saving anything (keep what is on the server, or dismiss). Keeping or merging the editor's
-- own text is done by saving it: workspace_note_save(..., p_resolves => conflict id).
create function public.workspace_conflict_resolve(p_id uuid, p_choice text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; cf public.workspace_conflicts; me uuid; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'conflict_resolve');
  if cached is not null then return cached; end if;
  if p_choice not in ('kept_server', 'dismissed') then raise exception 'choice must be kept_server or dismissed'; end if;
  select * into cf from public.workspace_conflicts where id = p_id;
  if not found or public.workspace_role(cf.document_id) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.workspace_my_staff_id();
  if not (cf.actor_staff_id = me or public.workspace_is_owner(cf.document_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if cf.status <> 'open' then raise exception 'conflict already resolved'; end if;
  update public.workspace_conflicts set status = p_choice, resolved_by = auth.uid(), resolved_at = now() where id = p_id;
  res := jsonb_build_object('id', p_id, 'status', p_choice);
  perform public.workspace_idem_put(p_key, 'conflict_resolve', res);
  return res;
end $$;

-- ───────── who has access (names come from here: the browser cannot read the staff table) ─────────
-- The owner first, then members by name. Anyone who can open the document sees who else has access.
create function public.workspace_member_list(p_doc uuid)
returns table (staff_id uuid, full_name text, role text, added_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.workspace_role(p_doc) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select s.id, s.full_name, 'owner'::text, d.created_at
    from public.workspace_documents d join public.staff s on s.id = d.owner_staff_id
    where d.id = p_doc
    union all
    (select s.id, s.full_name, m.role, m.added_at
     from public.workspace_members m join public.staff s on s.id = m.staff_id
     where m.document_id = p_doc
     order by s.full_name, s.id);
end $$;

-- ───────── search (titles and note text; only documents the caller can open) ─────────
create function public.workspace_search_notes(p_query text, p_limit int default 20)
returns table (document_id uuid, title text, my_role text, excerpt text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid; q text; esc text;
begin
  if not public.has_perm('workspace.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.workspace_my_staff_id();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  q := trim(coalesce(p_query, ''));
  if length(q) < 2 then raise exception 'type at least 2 characters'; end if;
  esc := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select d.id, d.title, case when d.owner_staff_id = me then 'owner' else m.role end,
           left(coalesce(r.plain_text, ''), 160), d.updated_at
    from public.workspace_documents d
    left join public.workspace_members m on m.document_id = d.id and m.staff_id = me
    left join public.workspace_note_revisions r on r.document_id = d.id and r.version = d.head_version
    where d.kind = 'note' and d.deleted_at is null and d.archived_at is null
      and (d.owner_staff_id = me or m.staff_id is not null)
      and (d.title ilike '%' || esc || '%' escape '\'
           or to_tsvector('simple', coalesce(r.plain_text, '')) @@ plainto_tsquery('simple', q))
    order by d.updated_at desc, d.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- ───────── grants ─────────
revoke all on function
  public.workspace_note_node_text(jsonb), public.workspace_note_plain_text(jsonb),
  public.workspace_can_read_revision(uuid, bigint), public.workspace_note_open(uuid),
  public.workspace_note_save(uuid, bigint, jsonb, uuid, boolean, uuid, text),
  public.workspace_note_restore(uuid, bigint, uuid), public.workspace_note_history(uuid, bigint, int),
  public.workspace_document_rename(uuid, text, uuid), public.workspace_document_set_history_visible(uuid, boolean, uuid),
  public.workspace_conflict_resolve(uuid, text, uuid), public.workspace_search_notes(text, int),
  public.workspace_member_list(uuid), public.workspace_note_revisions_guard()
  from public, anon, authenticated;

grant execute on function
  public.workspace_can_read_revision(uuid, bigint), public.workspace_note_open(uuid),
  public.workspace_note_save(uuid, bigint, jsonb, uuid, boolean, uuid, text),
  public.workspace_note_restore(uuid, bigint, uuid), public.workspace_note_history(uuid, bigint, int),
  public.workspace_document_rename(uuid, text, uuid), public.workspace_document_set_history_visible(uuid, boolean, uuid),
  public.workspace_conflict_resolve(uuid, text, uuid), public.workspace_search_notes(text, int),
  public.workspace_member_list(uuid)
  to authenticated;

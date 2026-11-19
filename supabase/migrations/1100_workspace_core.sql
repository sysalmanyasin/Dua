-- 1100_workspace_core.sql — Dua Workspace, step 1: permissions, documents, sharing, personal folders.
-- Range 1100–1199 belongs to Workspace (docs/MODULES.md §5.1). Design: docs/modules/workspace.md.
--
-- What this step does NOT contain (later steps): note revisions (1101), sheets / cells / operations (1102),
-- conflicts + Realtime (1103), attachments + Storage (1104).
--
-- Rules this file follows (MODULES.md §2, §5): RLS on every table; no insert/update/delete grant anywhere — every write is
-- one of the functions below; each function re-checks has_perm and the caller's role on the document; one decision function
-- (workspace_role) is the only place that says who may open a document. There is NO admin override: an admin sees a
-- document only when it is shared with them. Workspace never touches Manager notes (mgmt_staff_notes).

-- ───────── permissions (no role preset receives them; the owner grants them per person) ─────────
insert into public.permissions (key, description) values
  ('workspace.use', 'Open Dua Workspace and work on notes and sheets shared with you'),
  ('workspace.create', 'Create new Workspace notes and workbooks and share them');

-- ───────── tables ─────────
create table public.workspace_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('note', 'workbook')),
  title text not null check (length(trim(title)) between 1 and 200),
  owner_staff_id uuid not null references public.staff(id) on delete restrict,
  head_version bigint not null default 0,
  history_visible_to_viewers boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  archived_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id)
);
create index workspace_documents_owner on public.workspace_documents (owner_staff_id, updated_at desc);
create index workspace_documents_recent on public.workspace_documents (updated_at desc) where deleted_at is null;
alter table public.workspace_documents enable row level security;

-- The owner is NOT a row here: the owner is workspace_documents.owner_staff_id.
create table public.workspace_members (
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  role text not null check (role in ('editor', 'viewer')),
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (document_id, staff_id)
);
create index workspace_members_staff on public.workspace_members (staff_id);
alter table public.workspace_members enable row level security;

-- Personal organisation: each person arranges their own folders; shared documents never fight over one tree.
create table public.workspace_folders (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  parent_id uuid references public.workspace_folders(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index workspace_folders_name
  on public.workspace_folders (staff_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
alter table public.workspace_folders enable row level security;

create table public.workspace_user_state (
  staff_id uuid not null references public.staff(id) on delete restrict,
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  folder_id uuid references public.workspace_folders(id) on delete set null,
  pinned boolean not null default false,
  offline_pinned boolean not null default false,
  last_opened_at timestamptz,
  primary key (staff_id, document_id)
);
alter table public.workspace_user_state enable row level security;

-- Answers a retried save from here (same idea as mgmt_save_keys). No policy: service role only.
create table public.workspace_save_keys (
  key uuid primary key,
  user_id uuid not null,
  action text not null,
  result jsonb not null,
  at timestamptz not null default now()
);
alter table public.workspace_save_keys enable row level security;

-- ───────── guards ─────────
create function public.workspace_documents_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'documents are archived or marked deleted, never removed';
  end if;
  if new.id is distinct from old.id or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'a document''s identity cannot change';
  end if;
  if new.head_version < old.head_version then raise exception 'a document''s version cannot go backwards'; end if;
  if new.head_version is distinct from old.head_version or new.title is distinct from old.title then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger workspace_documents_guard before update or delete on public.workspace_documents
  for each row execute function public.workspace_documents_guard();

create function public.workspace_members_guard() returns trigger language plpgsql as $$
declare o uuid;
begin
  if tg_op = 'UPDATE' and (new.document_id is distinct from old.document_id or new.staff_id is distinct from old.staff_id) then
    raise exception 'only the role of a member can change';
  end if;
  select owner_staff_id into o from public.workspace_documents where id = new.document_id;
  if o = new.staff_id then raise exception 'the owner is not a member'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.workspace_members where document_id = new.document_id) >= 50 then
    raise exception 'a document can be shared with at most 50 people';
  end if;
  return new;
end $$;
create trigger workspace_members_guard before insert or update on public.workspace_members
  for each row execute function public.workspace_members_guard();

create function public.workspace_folders_guard() returns trigger language plpgsql as $$
declare cur uuid; nxt uuid; depth int := 1;
begin
  if tg_op = 'UPDATE' and new.staff_id is distinct from old.staff_id then raise exception 'a folder cannot change hands'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.workspace_folders where staff_id = new.staff_id) >= 500 then
    raise exception 'too many folders';
  end if;
  cur := new.parent_id;
  while cur is not null loop
    depth := depth + 1;
    if cur = new.id then raise exception 'a folder cannot be placed inside itself'; end if;
    if depth > 5 then raise exception 'folders can be nested at most 5 deep'; end if;
    select f.parent_id into nxt from public.workspace_folders f where f.id = cur and f.staff_id = new.staff_id;
    if not found then raise exception 'parent folder not found'; end if;
    cur := nxt;
  end loop;
  return new;
end $$;
create trigger workspace_folders_guard before insert or update on public.workspace_folders
  for each row execute function public.workspace_folders_guard();

-- ───────── who may do what: the single decision point ─────────
-- The caller's own staff row. Null for a disabled / expired / unmapped login.
create function public.workspace_my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select pr.staff_id from public.profiles pr
  where pr.user_id = auth.uid() and pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now())
$$;

-- 'owner' | 'editor' | 'viewer' | null. Null unless the caller holds workspace.use (so a disabled, expired or
-- not-yet-MFA admin account gets nothing), the document exists and is not deleted, and the caller is its owner or a member.
create function public.workspace_role(p_doc uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare me uuid; d record; r text;
begin
  if p_doc is null or not public.has_perm('workspace.use') then return null; end if;
  me := public.workspace_my_staff_id();
  if me is null then return null; end if;
  select owner_staff_id, deleted_at into d from public.workspace_documents where id = p_doc;
  if not found or d.deleted_at is not null then return null; end if;
  if d.owner_staff_id = me then return 'owner'; end if;
  select m.role into r from public.workspace_members m where m.document_id = p_doc and m.staff_id = me;
  return r;
end $$;

create function public.workspace_can_read(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.workspace_role(p_doc) is not null
$$;

-- Editing is possible for owner and editor, and never on an archived document.
create function public.workspace_can_write(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.workspace_role(p_doc) in ('owner', 'editor'), false)
     and exists (select 1 from public.workspace_documents where id = p_doc and archived_at is null)
$$;

create function public.workspace_is_owner(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.workspace_role(p_doc) = 'owner', false)
$$;

-- Internal: does ANOTHER person's login hold a permission? (has_perm only answers for the caller.) Mirrors has_perm; an
-- admin counts as eligible because their MFA level cannot be known from here. Never callable from the browser.
create function public.workspace_staff_eligible(p_staff uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
    where pr.staff_id = p_staff and pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now())
      and (pr.role_template = 'admin'
        or ((exists (select 1 from public.role_permissions rp where rp.role = pr.role_template and rp.perm_key = p_key)
             or exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = p_key and up.effect = 'grant'))
            and not exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = p_key and up.effect = 'deny')))
  )
$$;

-- Internal idempotency helpers (Workspace functions only).
create function public.workspace_idem_get(p_key uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.workspace_save_keys;
begin
  if p_key is null then raise exception 'idempotency key required'; end if;
  select * into c from public.workspace_save_keys where key = p_key;
  if not found then return null; end if;
  if c.user_id is distinct from auth.uid() or c.action <> p_action then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return c.result;
end $$;

create function public.workspace_idem_put(p_key uuid, p_action text, p_result jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.workspace_save_keys (key, user_id, action, result) values (p_key, auth.uid(), p_action, p_result)
$$;

-- ───────── rich-text document validation (used now by tests, later by a CHECK on note revisions) ─────────
-- Format: {"v":1,"doc":{"type":"doc","content":[ block, ... ]}}. Only the nodes and marks below exist; nothing else is
-- ever stored. Every top-level block carries attrs.id. Links may only be http, https, mailto or tel.
create function public.workspace_note_node_ok(n jsonb, parent text, depth int) returns boolean
language plpgsql immutable set search_path = public as $$
declare t text; k text; c jsonb; a jsonb; mk jsonb; allowed text[]; cnt int;
begin
  if depth > 8 or jsonb_typeof(n) is distinct from 'object' or jsonb_typeof(n -> 'type') is distinct from 'string' then
    return false;
  end if;
  for k in select jsonb_object_keys(n) loop
    if k not in ('type', 'content', 'text', 'marks', 'attrs') then return false; end if;
  end loop;
  t := n ->> 'type';
  allowed := case parent
    when 'doc' then array['paragraph', 'heading', 'bullet_list', 'ordered_list', 'task_list']
    when 'bullet_list' then array['list_item']
    when 'ordered_list' then array['list_item']
    when 'task_list' then array['task_item']
    when 'list_item' then array['paragraph', 'bullet_list', 'ordered_list', 'task_list']
    when 'task_item' then array['paragraph', 'bullet_list', 'ordered_list', 'task_list']
    when 'paragraph' then array['text', 'hard_break']
    when 'heading' then array['text', 'hard_break']
    else array[]::text[] end;
  if not (t = any (allowed)) then return false; end if;

  if t = 'text' then
    if n -> 'content' is not null or n -> 'attrs' is not null then return false; end if;
    if jsonb_typeof(n -> 'text') is distinct from 'string' or length(n ->> 'text') not between 1 and 50000 then return false; end if;
    if n -> 'marks' is not null then
      if jsonb_typeof(n -> 'marks') is distinct from 'array' or jsonb_array_length(n -> 'marks') > 4 then return false; end if;
      for mk in select value from jsonb_array_elements(n -> 'marks') loop
        if jsonb_typeof(mk) is distinct from 'object' or jsonb_typeof(mk -> 'type') is distinct from 'string' then return false; end if;
        for k in select jsonb_object_keys(mk) loop
          if k not in ('type', 'attrs') then return false; end if;
        end loop;
        if mk ->> 'type' in ('bold', 'italic', 'underline') then
          if mk -> 'attrs' is not null then return false; end if;
        elsif mk ->> 'type' = 'link' then
          a := mk -> 'attrs';
          if jsonb_typeof(a) is distinct from 'object' or (select count(*) from jsonb_object_keys(a)) <> 1
             or jsonb_typeof(a -> 'href') is distinct from 'string' or length(a ->> 'href') > 2000
             or (a ->> 'href') !~* '^(https?://|mailto:|tel:)[^[:space:][:cntrl:]]+$' then
            return false;
          end if;
        else
          return false;
        end if;
      end loop;
    end if;
    return true;
  end if;

  if t = 'hard_break' then
    return n -> 'content' is null and n -> 'text' is null and n -> 'marks' is null and n -> 'attrs' is null;
  end if;

  -- block and container nodes
  if n -> 'text' is not null or n -> 'marks' is not null then return false; end if;
  a := n -> 'attrs';
  if parent = 'doc' and a is null then return false; end if;
  if a is not null then
    if jsonb_typeof(a) is distinct from 'object' then return false; end if;
    for k in select jsonb_object_keys(a) loop
      if not (k = 'id' or (k = 'level' and t = 'heading') or (k = 'checked' and t = 'task_item')) then return false; end if;
    end loop;
    if a -> 'id' is not null and (jsonb_typeof(a -> 'id') is distinct from 'string' or (a ->> 'id') !~ '^[A-Za-z0-9_-]{1,32}$') then return false; end if;
    if parent = 'doc' and a -> 'id' is null then return false; end if;
    if a -> 'checked' is not null and jsonb_typeof(a -> 'checked') is distinct from 'boolean' then return false; end if;
  end if;
  if t = 'heading' and (a is null or jsonb_typeof(a -> 'level') is distinct from 'number' or (a ->> 'level') not in ('1', '2', '3')) then
    return false;
  end if;

  if n -> 'content' is not null then
    if jsonb_typeof(n -> 'content') is distinct from 'array' then return false; end if;
    cnt := jsonb_array_length(n -> 'content');
  else
    cnt := 0;
  end if;
  if t in ('bullet_list', 'ordered_list', 'task_list', 'list_item', 'task_item') and cnt < 1 then return false; end if;
  if cnt > 0 then
    for c in select value from jsonb_array_elements(n -> 'content') loop
      if not public.workspace_note_node_ok(c, t, depth + 1) then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create function public.workspace_note_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare d jsonb; c jsonb; k text;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or p ->> 'v' is distinct from '1' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('v', 'doc') then return false; end if;
  end loop;
  if octet_length(p::text) > 262144 then return false; end if;
  d := p -> 'doc';
  if jsonb_typeof(d) is distinct from 'object' or d ->> 'type' is distinct from 'doc'
     or jsonb_typeof(d -> 'content') is distinct from 'array' then
    return false;
  end if;
  for k in select jsonb_object_keys(d) loop
    if k not in ('type', 'content') then return false; end if;
  end loop;
  if jsonb_array_length(d -> 'content') not between 1 and 5000 then return false; end if;
  for c in select value from jsonb_array_elements(d -> 'content') loop
    if not public.workspace_note_node_ok(c, 'doc', 1) then return false; end if;
  end loop;
  return true;
end $$;

-- ───────── read policies (wrapped form: checked once per query, not once per row) ─────────
create policy workspace_documents_read on public.workspace_documents for select to authenticated
  using ((select public.workspace_can_read(id)));
create policy workspace_members_read on public.workspace_members for select to authenticated
  using ((select public.workspace_can_read(document_id)));
create policy workspace_folders_read on public.workspace_folders for select to authenticated
  using ((select public.has_perm('workspace.use')) and staff_id = (select public.workspace_my_staff_id()));
create policy workspace_user_state_read on public.workspace_user_state for select to authenticated
  using ((select public.has_perm('workspace.use')) and staff_id = (select public.workspace_my_staff_id()));

revoke all on public.workspace_documents, public.workspace_members, public.workspace_folders,
  public.workspace_user_state, public.workspace_save_keys from anon, authenticated;
grant select on public.workspace_documents, public.workspace_members, public.workspace_folders,
  public.workspace_user_state to authenticated;
-- no insert / update / delete policy and no write grant: every write is one of the functions below

-- ───────── documents ─────────
create function public.workspace_create_document(p_id uuid, p_kind text, p_title text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; me uuid; did uuid; ex public.workspace_documents; res jsonb;
begin
  if not (public.has_perm('workspace.use') and public.has_perm('workspace.create')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  cached := public.workspace_idem_get(p_key, 'create_document');
  if cached is not null then return cached; end if;
  me := public.workspace_my_staff_id();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('note', 'workbook') then raise exception 'unknown kind'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 200 then raise exception 'title must be 1 to 200 characters'; end if;
  did := coalesce(p_id, gen_random_uuid());
  select * into ex from public.workspace_documents where id = did;
  if found then
    -- a retry that lost its key: same owner and same kind is the same document
    if ex.owner_staff_id <> me or ex.kind <> p_kind or ex.deleted_at is not null then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  else
    insert into public.workspace_documents (id, kind, title, owner_staff_id, created_by, updated_by)
    values (did, p_kind, trim(p_title), me, auth.uid(), auth.uid());
  end if;
  select jsonb_build_object('id', d.id, 'kind', d.kind, 'title', d.title, 'head_version', d.head_version)
    into res from public.workspace_documents d where d.id = did;
  perform public.workspace_idem_put(p_key, 'create_document', res);
  return res;
end $$;

create function public.workspace_list_documents(p_scope text default 'all', p_query text default null,
  p_after_updated timestamptz default null, p_after_id uuid default null, p_limit int default 50)
returns table (id uuid, kind text, title text, my_role text, owner_name text, updated_at timestamptz,
               archived_at timestamptz, deleted_at timestamptz, head_version bigint, member_count int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid; esc text; lim int;
begin
  if not public.has_perm('workspace.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.workspace_my_staff_id();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_scope not in ('all', 'mine', 'shared', 'archived', 'trash') then raise exception 'unknown scope'; end if;
  lim := least(greatest(coalesce(p_limit, 50), 1), 100);
  esc := case when p_query is null or length(trim(p_query)) = 0 then null
              else replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') end;
  return query
    select d.id, d.kind, d.title,
           case when d.owner_staff_id = me then 'owner' else m.role end,
           s.full_name, d.updated_at, d.archived_at, d.deleted_at, d.head_version,
           (select count(*)::int from public.workspace_members x where x.document_id = d.id)
    from public.workspace_documents d
    join public.staff s on s.id = d.owner_staff_id
    left join public.workspace_members m on m.document_id = d.id and m.staff_id = me
    where (d.owner_staff_id = me or m.staff_id is not null)
      and case p_scope
            when 'mine' then d.owner_staff_id = me and d.deleted_at is null and d.archived_at is null
            when 'shared' then d.owner_staff_id <> me and d.deleted_at is null and d.archived_at is null
            when 'archived' then d.archived_at is not null and d.deleted_at is null
            when 'trash' then d.deleted_at is not null and d.owner_staff_id = me
            else d.deleted_at is null and d.archived_at is null end
      and (esc is null or d.title ilike '%' || esc || '%' escape '\')
      and (p_after_updated is null or (d.updated_at, d.id) < (p_after_updated, coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by d.updated_at desc, d.id desc
    limit lim;
end $$;

-- Owner only. p_action: archive | unarchive | delete | undelete. Delete is a soft delete (nothing is removed here).
create function public.workspace_document_state(p_doc uuid, p_action text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; me uuid; d public.workspace_documents; res jsonb;
begin
  if not public.has_perm('workspace.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.workspace_idem_get(p_key, 'document_state');
  if cached is not null then return cached; end if;
  me := public.workspace_my_staff_id();
  select * into d from public.workspace_documents where id = p_doc for update;
  if me is null or not found or d.owner_staff_id <> me then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action = 'archive' then
    if d.deleted_at is not null then raise exception 'document is deleted'; end if;
    update public.workspace_documents set archived_at = coalesce(archived_at, now()), updated_by = auth.uid() where id = p_doc;
  elsif p_action = 'unarchive' then
    if d.deleted_at is not null then raise exception 'document is deleted'; end if;
    update public.workspace_documents set archived_at = null, updated_by = auth.uid() where id = p_doc;
  elsif p_action = 'delete' then
    update public.workspace_documents set deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(), updated_by = auth.uid() where id = p_doc;
  elsif p_action = 'undelete' then
    update public.workspace_documents set deleted_at = null, deleted_by = null, updated_by = auth.uid() where id = p_doc;
  else
    raise exception 'unknown action';
  end if;
  perform public.log_activity('workspace.' || p_action, 'workspace_document', p_doc::text,
    jsonb_build_object('archived', d.archived_at is not null, 'deleted', d.deleted_at is not null), null, null);
  select jsonb_build_object('id', x.id, 'archived', x.archived_at is not null, 'deleted', x.deleted_at is not null)
    into res from public.workspace_documents x where x.id = p_doc;
  perform public.workspace_idem_put(p_key, 'document_state', res);
  return res;
end $$;

-- ───────── sharing (owner only) ─────────
create function public.workspace_share_candidates(p_query text default null)
returns table (staff_id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid; esc text;
begin
  if not (public.has_perm('workspace.use') and public.has_perm('workspace.create')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  me := public.workspace_my_staff_id();
  esc := case when p_query is null or length(trim(p_query)) = 0 then null
              else replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') end;
  return query
    select s.id, s.full_name from public.staff s
    where s.active and s.id is distinct from me
      and public.workspace_staff_eligible(s.id, 'workspace.use')
      and (esc is null or s.full_name ilike '%' || esc || '%' escape '\')
    order by s.full_name, s.id
    limit 50;
end $$;

create function public.workspace_member_set(p_doc uuid, p_staff uuid, p_role text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; old_role text; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'member_set');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role not in ('editor', 'viewer') then raise exception 'role must be editor or viewer'; end if;
  if p_staff is null or not public.workspace_staff_eligible(p_staff, 'workspace.use') then
    raise exception 'that person cannot use Workspace';
  end if;
  select role into old_role from public.workspace_members where document_id = p_doc and staff_id = p_staff;
  insert into public.workspace_members (document_id, staff_id, role, added_by) values (p_doc, p_staff, p_role, auth.uid())
    on conflict (document_id, staff_id) do update set role = excluded.role;
  perform public.log_activity('workspace.share', 'workspace_document', p_doc::text,
    case when old_role is null then null else jsonb_build_object('staff_id', p_staff, 'role', old_role) end,
    jsonb_build_object('staff_id', p_staff, 'role', p_role), null);
  res := jsonb_build_object('document_id', p_doc, 'staff_id', p_staff, 'role', p_role);
  perform public.workspace_idem_put(p_key, 'member_set', res);
  return res;
end $$;

create function public.workspace_member_remove(p_doc uuid, p_staff uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; old_role text; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'member_remove');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.workspace_members where document_id = p_doc and staff_id = p_staff returning role into old_role;
  if old_role is not null then
    perform public.log_activity('workspace.unshare', 'workspace_document', p_doc::text,
      jsonb_build_object('staff_id', p_staff, 'role', old_role), null, null);
  end if;
  -- the removed person's private organisation of this document goes with their access
  delete from public.workspace_user_state where document_id = p_doc and staff_id = p_staff;
  res := jsonb_build_object('document_id', p_doc, 'staff_id', p_staff, 'removed', old_role is not null);
  perform public.workspace_idem_put(p_key, 'member_remove', res);
  return res;
end $$;

-- The new owner must be able to use Workspace and create documents. The old owner stays on as an editor.
create function public.workspace_transfer_ownership(p_doc uuid, p_new_owner uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; me uuid; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'transfer');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.workspace_my_staff_id();
  if p_new_owner is null or p_new_owner = me then raise exception 'choose someone else as the new owner'; end if;
  if not (public.workspace_staff_eligible(p_new_owner, 'workspace.use') and public.workspace_staff_eligible(p_new_owner, 'workspace.create')) then
    raise exception 'that person cannot own Workspace documents';
  end if;
  delete from public.workspace_members where document_id = p_doc and staff_id = p_new_owner;
  update public.workspace_documents set owner_staff_id = p_new_owner, updated_by = auth.uid() where id = p_doc;
  insert into public.workspace_members (document_id, staff_id, role, added_by) values (p_doc, me, 'editor', auth.uid());
  perform public.log_activity('workspace.transfer', 'workspace_document', p_doc::text,
    jsonb_build_object('owner_staff_id', me), jsonb_build_object('owner_staff_id', p_new_owner), null);
  res := jsonb_build_object('document_id', p_doc, 'owner_staff_id', p_new_owner);
  perform public.workspace_idem_put(p_key, 'transfer', res);
  return res;
end $$;

-- ───────── personal organisation (each person's own folders and flags) ─────────
create function public.workspace_folder_save(p_id uuid, p_parent uuid, p_name text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; me uuid; fid uuid; res jsonb; ex public.workspace_folders;
begin
  if not public.has_perm('workspace.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.workspace_idem_get(p_key, 'folder_save');
  if cached is not null then return cached; end if;
  me := public.workspace_my_staff_id();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'name must be 1 to 80 characters'; end if;
  fid := coalesce(p_id, gen_random_uuid());
  select * into ex from public.workspace_folders where id = fid;
  if found then
    if ex.staff_id <> me then raise exception 'not allowed' using errcode = '42501'; end if;
    update public.workspace_folders set name = trim(p_name), parent_id = p_parent where id = fid;
  else
    insert into public.workspace_folders (id, staff_id, parent_id, name) values (fid, me, p_parent, trim(p_name));
  end if;
  select jsonb_build_object('id', f.id, 'parent_id', f.parent_id, 'name', f.name) into res from public.workspace_folders f where f.id = fid;
  perform public.workspace_idem_put(p_key, 'folder_save', res);
  return res;
end $$;

create function public.workspace_folder_remove(p_id uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; me uuid; res jsonb;
begin
  if not public.has_perm('workspace.use') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.workspace_idem_get(p_key, 'folder_remove');
  if cached is not null then return cached; end if;
  me := public.workspace_my_staff_id();
  if me is null or not exists (select 1 from public.workspace_folders where id = p_id and staff_id = me) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspace_folders where parent_id = p_id) then raise exception 'the folder is not empty'; end if;
  delete from public.workspace_folders where id = p_id;   -- documents in it simply become unfiled (on delete set null)
  res := jsonb_build_object('id', p_id, 'removed', true);
  perform public.workspace_idem_put(p_key, 'folder_remove', res);
  return res;
end $$;

-- Sets the caller's own flags for one document. Naturally repeatable, so it needs no idempotency key.
create function public.workspace_state_set(p_doc uuid, p_folder uuid, p_pinned boolean, p_offline boolean,
  p_opened boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  if not public.workspace_can_read(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  me := public.workspace_my_staff_id();
  if p_folder is not null and not exists (select 1 from public.workspace_folders where id = p_folder and staff_id = me) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.workspace_user_state (staff_id, document_id, folder_id, pinned, offline_pinned, last_opened_at)
    values (me, p_doc, p_folder, coalesce(p_pinned, false), coalesce(p_offline, false), case when p_opened then now() end)
    on conflict (staff_id, document_id) do update set folder_id = excluded.folder_id, pinned = excluded.pinned,
      offline_pinned = excluded.offline_pinned,
      last_opened_at = case when p_opened then now() else public.workspace_user_state.last_opened_at end;
  return jsonb_build_object('document_id', p_doc, 'folder_id', p_folder, 'pinned', coalesce(p_pinned, false),
                            'offline_pinned', coalesce(p_offline, false));
end $$;

-- ───────── grants ─────────
grant all on public.workspace_documents, public.workspace_members, public.workspace_folders,
  public.workspace_user_state, public.workspace_save_keys to service_role;

revoke all on function
  public.workspace_my_staff_id(), public.workspace_role(uuid), public.workspace_can_read(uuid),
  public.workspace_can_write(uuid), public.workspace_is_owner(uuid),
  public.workspace_staff_eligible(uuid, text), public.workspace_idem_get(uuid, text),
  public.workspace_idem_put(uuid, text, jsonb), public.workspace_note_node_ok(jsonb, text, int),
  public.workspace_note_valid(jsonb),
  public.workspace_create_document(uuid, text, text, uuid),
  public.workspace_list_documents(text, text, timestamptz, uuid, int),
  public.workspace_document_state(uuid, text, uuid), public.workspace_share_candidates(text),
  public.workspace_member_set(uuid, uuid, text, uuid), public.workspace_member_remove(uuid, uuid, uuid),
  public.workspace_transfer_ownership(uuid, uuid, uuid),
  public.workspace_folder_save(uuid, uuid, text, uuid), public.workspace_folder_remove(uuid, uuid),
  public.workspace_state_set(uuid, uuid, boolean, boolean, boolean),
  public.workspace_documents_guard(), public.workspace_members_guard(), public.workspace_folders_guard()
  from public, anon, authenticated;

-- The browser may call the decision helpers (they only ever reveal the caller's own role; policies need them) and the
-- public functions. The idempotency, eligibility and note-validation helpers stay internal (the server calls them).
grant execute on function
  public.workspace_my_staff_id(), public.workspace_role(uuid), public.workspace_can_read(uuid),
  public.workspace_can_write(uuid), public.workspace_is_owner(uuid),
  public.workspace_create_document(uuid, text, text, uuid),
  public.workspace_list_documents(text, text, timestamptz, uuid, int),
  public.workspace_document_state(uuid, text, uuid), public.workspace_share_candidates(text),
  public.workspace_member_set(uuid, uuid, text, uuid), public.workspace_member_remove(uuid, uuid, uuid),
  public.workspace_transfer_ownership(uuid, uuid, uuid),
  public.workspace_folder_save(uuid, uuid, text, uuid), public.workspace_folder_remove(uuid, uuid),
  public.workspace_state_set(uuid, uuid, boolean, boolean, boolean)
  to authenticated;
grant execute on function public.workspace_role(uuid), public.workspace_can_read(uuid) to service_role;

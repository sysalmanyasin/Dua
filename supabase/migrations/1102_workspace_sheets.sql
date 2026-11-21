-- 1102_workspace_sheets.sql — Dua Workspace, step 3: workbooks. Sheets, cells, styles, the operation log and snapshots.
-- Follows 1100 (core) and 1101 (notes). Same rules: RLS everywhere, no write grants, every write is a function below that
-- re-checks the caller through workspace_role(), nothing is ever silently overwritten. Design: docs/modules/workspace.design.md.
--
-- The model:
--  * A workbook is a workspace_documents row with kind = 'workbook'. Its head_version is the sequence number (seq) of the
--    newest operation.
--  * Cells are keyed by (sheet, row_id, col_id). Row and column ids are stable numbers chosen by the client (never positions),
--    so an edit made offline to row 17 stays valid when someone inserts a row above it. The visible order of rows and columns
--    is an array on the sheet. Ids 1..999 are reserved for the grid a new sheet starts with (100 rows, 26 columns); ids the
--    client creates are 1000 or more and are never reused.
--  * Every change arrives as an operation (workspace_apply_ops). Operations are numbered, stored in an append-only log, and
--    answered again from the log if the same operation id is sent twice. A cell edit names the seq the editor last saw
--    (base_seq); if the cell was changed after that by someone else, with different content, nothing is written and the
--    edit is kept as a conflict. Edits to different cells never conflict.
--  * Snapshots (restore points) are taken automatically every 200 operations and on request; restoring writes a NEW state
--    and a log entry, so history is never erased.
-- Formulas are text; the server never calculates or stores results.

-- Pin the search_path of the trigger guards from 1100 and 1101 (Supabase advisor follow-up). They only use schema-qualified names.
alter function public.workspace_documents_guard() set search_path = public;
alter function public.workspace_members_guard() set search_path = public;
alter function public.workspace_folders_guard() set search_path = public;
alter function public.workspace_note_revisions_guard() set search_path = public;

-- ───────── small validators ─────────
-- An integer inside a JSON value, or null if it is missing, not a number, or not a whole number.
create function public.workspace_json_int(p jsonb) returns bigint
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,18}$' then (p #>> '{}')::bigint end
$$;

create function public.workspace_uuid_or_null(p text) returns uuid
language sql immutable set search_path = public as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

-- A cell style: only these keys, only these values. Stored once per sheet and referenced by id.
create function public.workspace_style_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare k text; b jsonb; side text; nf jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 500 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('weight', 'size', 'color', 'bg', 'borders', 'halign', 'valign', 'numfmt') then return false; end if;
  end loop;
  if p -> 'weight' is not null and (p ->> 'weight') not in ('normal', 'bold') then return false; end if;
  if p -> 'size' is not null and not (public.workspace_json_int(p -> 'size') between 8 and 72) then return false; end if;
  if p -> 'color' is not null and (jsonb_typeof(p -> 'color') is distinct from 'string' or (p ->> 'color') !~ '^#[0-9a-fA-F]{6}$') then return false; end if;
  if p -> 'bg' is not null and (jsonb_typeof(p -> 'bg') is distinct from 'string' or (p ->> 'bg') !~ '^#[0-9a-fA-F]{6}$') then return false; end if;
  if p -> 'halign' is not null and (p ->> 'halign') not in ('left', 'center', 'right') then return false; end if;
  if p -> 'valign' is not null and (p ->> 'valign') not in ('top', 'middle', 'bottom') then return false; end if;
  b := p -> 'borders';
  if b is not null then
    if jsonb_typeof(b) is distinct from 'object' then return false; end if;
    for side in select jsonb_object_keys(b) loop
      if side not in ('top', 'right', 'bottom', 'left') or (b ->> side) not in ('thin', 'medium', 'thick') then return false; end if;
    end loop;
  end if;
  nf := p -> 'numfmt';
  if nf is not null then
    if jsonb_typeof(nf) is distinct from 'object' then return false; end if;
    for k in select jsonb_object_keys(nf) loop
      if k not in ('type', 'decimals', 'currency', 'pattern') then return false; end if;
    end loop;
    if (nf ->> 'type') not in ('general', 'number', 'currency', 'percent', 'date') then return false; end if;
    if nf -> 'decimals' is not null and not (public.workspace_json_int(nf -> 'decimals') between 0 and 10) then return false; end if;
    if nf -> 'currency' is not null and (jsonb_typeof(nf -> 'currency') is distinct from 'string' or (nf ->> 'currency') !~ '^[A-Z]{3}$') then return false; end if;
    if nf -> 'pattern' is not null and (nf ->> 'pattern') not in ('dd/mm/yyyy', 'yyyy-mm-dd', 'dd mmm yyyy') then return false; end if;
  end if;
  return true;
end $$;

-- ───────── tables ─────────
create table public.workspace_sheets (
  id uuid primary key,
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 31),
  position int not null check (position >= 0),
  row_order int[] not null check (cardinality(row_order) between 1 and 10000),
  col_order int[] not null check (cardinality(col_order) between 1 and 100),
  row_sizes jsonb not null default '{}'::jsonb check (jsonb_typeof(row_sizes) = 'object'),
  col_sizes jsonb not null default '{}'::jsonb check (jsonb_typeof(col_sizes) = 'object'),
  frozen_rows int not null default 0 check (frozen_rows between 0 and 100),
  frozen_cols int not null default 0 check (frozen_cols between 0 and 100),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  deleted_at timestamptz
);
create unique index workspace_sheets_name on public.workspace_sheets (document_id, lower(name)) where deleted_at is null;
create index workspace_sheets_doc on public.workspace_sheets (document_id);
alter table public.workspace_sheets enable row level security;

create table public.workspace_sheet_styles (
  sheet_id uuid not null references public.workspace_sheets(id) on delete restrict,
  style_id int not null check (style_id between 1 and 10000),
  style jsonb not null check (public.workspace_style_valid(style)),
  primary key (sheet_id, style_id)
);
alter table public.workspace_sheet_styles enable row level security;

-- A cell that was cleared stays as a row with nothing in it (last_seq kept), so an edit made before the clear can be
-- recognised as stale. Such rows are not counted and are not sent to browsers.
create table public.workspace_cells (
  sheet_id uuid not null references public.workspace_sheets(id) on delete restrict,
  row_id int not null check (row_id >= 1),
  col_id int not null check (col_id >= 1),
  value jsonb check (value is null or jsonb_typeof(value) in ('number', 'string', 'boolean')),
  formula text check (formula is null or (length(formula) between 2 and 1000 and left(formula, 1) = '=')),
  style_id int,
  last_seq bigint not null check (last_seq >= 1),
  updated_by uuid references auth.users(id),
  primary key (sheet_id, row_id, col_id),
  foreign key (sheet_id, style_id) references public.workspace_sheet_styles (sheet_id, style_id) on delete restrict,
  check (not (value is not null and formula is not null)),
  check (value is null or jsonb_typeof(value) <> 'string' or length(value #>> '{}') <= 32767)
);
create index workspace_cells_seq on public.workspace_cells (sheet_id, last_seq);
alter table public.workspace_cells enable row level security;

-- The log. Append-only. status: applied = it changed something (and is what other editors pull); conflict = every part of
-- it was refused because of a conflict; rejected = it was not valid.
create table public.workspace_operations (
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  seq bigint not null check (seq >= 1),
  op_id uuid not null,
  device_id uuid,
  actor_user uuid references auth.users(id),
  op_type text not null check (op_type in ('set_cells', 'set_styles', 'insert_rows', 'delete_rows', 'move_rows', 'insert_cols',
    'delete_cols', 'move_cols', 'resize', 'add_sheet', 'rename_sheet', 'delete_sheet', 'reorder_sheets', 'duplicate_sheet',
    'sort_range', 'restore_snapshot')),
  base_seq bigint not null default 0,
  payload jsonb not null,
  status text not null check (status in ('applied', 'conflict', 'rejected')),
  result jsonb,
  applied_at timestamptz not null default now(),
  primary key (document_id, seq),
  unique (document_id, op_id)
);
alter table public.workspace_operations enable row level security;

-- Restore points. Immutable. Read through workspace_snapshot_list only (the snapshots themselves are large).
create table public.workspace_sheet_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.workspace_documents(id) on delete restrict,
  seq bigint not null check (seq >= 0),
  kind text not null check (kind in ('checkpoint', 'manual', 'pre_restore')),
  label text check (label is null or length(label) <= 100),
  snapshot jsonb not null,
  bytes int not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (document_id, seq, kind)
);
alter table public.workspace_sheet_revisions enable row level security;

create function public.workspace_append_only() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger workspace_operations_append_only before update or delete on public.workspace_operations
  for each row execute function public.workspace_append_only();
create trigger workspace_sheet_revisions_append_only before update or delete on public.workspace_sheet_revisions
  for each row execute function public.workspace_append_only();

-- ───────── reading ─────────
create function public.workspace_can_read_sheet(p_sheet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_sheets s
                 where s.id = p_sheet and s.deleted_at is null and public.workspace_can_read(s.document_id))
$$;

create policy workspace_sheets_read on public.workspace_sheets for select to authenticated
  using (deleted_at is null and (select public.workspace_can_read(document_id)));
create policy workspace_sheet_styles_read on public.workspace_sheet_styles for select to authenticated
  using ((select public.workspace_can_read_sheet(sheet_id)));
create policy workspace_cells_read on public.workspace_cells for select to authenticated
  using ((select public.workspace_can_read_sheet(sheet_id)) and (value is not null or formula is not null or style_id is not null));
create policy workspace_operations_read on public.workspace_operations for select to authenticated
  using ((select public.workspace_can_read(document_id)));

revoke all on public.workspace_sheets, public.workspace_sheet_styles, public.workspace_cells,
  public.workspace_operations, public.workspace_sheet_revisions from anon, authenticated;
grant select on public.workspace_sheets, public.workspace_sheet_styles, public.workspace_cells, public.workspace_operations to authenticated;
grant all on public.workspace_sheets, public.workspace_sheet_styles, public.workspace_cells,
  public.workspace_operations, public.workspace_sheet_revisions to service_role;

-- Opens a workbook: its details, the caller's role, and its sheets with their row and column order. Cells are loaded
-- separately (workspace_load_sheet), a page at a time. Remember head_version: it is the seq this view is current to.
create function public.workspace_workbook_open(p_doc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.workspace_documents; r text;
begin
  r := public.workspace_role(p_doc);
  if r is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc;
  if d.kind <> 'workbook' then raise exception 'not a workbook'; end if;
  return jsonb_build_object('id', d.id, 'title', d.title, 'role', r, 'archived', d.archived_at is not null,
    'head_version', d.head_version, 'history_visible_to_viewers', d.history_visible_to_viewers,
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position,
        'row_order', to_jsonb(s.row_order), 'col_order', to_jsonb(s.col_order), 'row_sizes', s.row_sizes,
        'col_sizes', s.col_sizes, 'frozen_rows', s.frozen_rows, 'frozen_cols', s.frozen_cols) order by s.position, s.created_at)
      from public.workspace_sheets s where s.document_id = p_doc and s.deleted_at is null), '[]'::jsonb));
end $$;

-- The cells of one sheet that hold something, in (row, column) order, a page at a time. Pass the last row and column of
-- the previous page to get the next one.
create function public.workspace_load_sheet(p_sheet uuid, p_after_row int default null, p_after_col int default null, p_limit int default 5000)
returns table (row_id int, col_id int, value jsonb, formula text, style_id int, last_seq bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.workspace_can_read_sheet(p_sheet) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select c.row_id, c.col_id, c.value, c.formula, c.style_id, c.last_seq
    from public.workspace_cells c
    where c.sheet_id = p_sheet and (c.value is not null or c.formula is not null or c.style_id is not null)
      and (p_after_row is null or (c.row_id, c.col_id) > (p_after_row, coalesce(p_after_col, 0)))
    order by c.row_id, c.col_id
    limit least(greatest(coalesce(p_limit, 5000), 1), 10000);
end $$;

-- What changed since seq N: the operations that changed something, oldest first. Apply them in order to a local copy.
create function public.workspace_pull(p_doc uuid, p_since bigint default 0, p_limit int default 200)
returns table (seq bigint, op_id uuid, op_type text, author text, payload jsonb, applied_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.workspace_role(p_doc) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select o.seq, o.op_id, o.op_type, s.full_name, o.payload, o.applied_at
    from public.workspace_operations o
    left join public.profiles pr on pr.user_id = o.actor_user
    left join public.staff s on s.id = pr.staff_id
    where o.document_id = p_doc and o.seq > coalesce(p_since, 0) and o.status = 'applied'
    order by o.seq
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

-- ───────── snapshots ─────────
create function public.workspace_build_snapshot(p_doc uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('v', 1, 'sheets', coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'position', s.position, 'row_order', to_jsonb(s.row_order), 'col_order', to_jsonb(s.col_order),
    'row_sizes', s.row_sizes, 'col_sizes', s.col_sizes, 'frozen_rows', s.frozen_rows, 'frozen_cols', s.frozen_cols,
    'styles', (select coalesce(jsonb_agg(jsonb_build_array(st.style_id, st.style) order by st.style_id), '[]'::jsonb)
               from public.workspace_sheet_styles st where st.sheet_id = s.id),
    'cells', (select coalesce(jsonb_agg(jsonb_build_array(c.row_id, c.col_id, c.value, c.formula, c.style_id) order by c.row_id, c.col_id), '[]'::jsonb)
              from public.workspace_cells c
              where c.sheet_id = s.id and (c.value is not null or c.formula is not null or c.style_id is not null))
  ) order by s.position, s.created_at), '[]'::jsonb))
  from public.workspace_sheets s where s.document_id = p_doc and s.deleted_at is null
$$;

-- Stores a snapshot of the current state at p_seq. Returns its id (the existing one if this seq already has one of this kind).
create function public.workspace_store_snapshot(p_doc uuid, p_seq bigint, p_kind text, p_label text, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare snap jsonb; bytes int; sid uuid;
begin
  select id into sid from public.workspace_sheet_revisions where document_id = p_doc and seq = p_seq and kind = p_kind;
  if found then return sid; end if;
  snap := public.workspace_build_snapshot(p_doc);
  bytes := octet_length(snap::text);
  if bytes > 8000000 then raise exception 'this workbook is too large to take a restore point of'; end if;
  insert into public.workspace_sheet_revisions (document_id, seq, kind, label, snapshot, bytes, created_by)
    values (p_doc, p_seq, p_kind, p_label, snap, bytes, p_user) returning id into sid;
  return sid;
end $$;

-- ───────── applying one operation (internal) ─────────
-- Raises SQLSTATE WS001 for an invalid operation; the caller turns that into a "rejected" answer and the sub-transaction
-- undoes anything the operation had already written. Returns { status, effective, ... }: effective is what is logged and
-- what other editors pull (for set_cells with a conflict, only the cells that were written).
create function public.workspace_apply_one(p_doc uuid, p_seq bigint, p_user uuid, p_staff uuid, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sid uuid; sh public.workspace_sheets; cell jsonb; cr int; cc int; base bigint; base_default bigint; ex public.workspace_cells;
  nv jsonb; nf text; ns int; eff jsonb := '[]'::jsonb; confs jsonb := '[]'::jsonb; n_applied int := 0; cid uuid; total int;
  ids int[]; anchor int; idx int; new_order int[]; item jsonb; nm text; live int; pos int; st jsonb; k text; v jsonb; sizes jsonb;
  names uuid[]; cur uuid[]; kind_cols boolean; maxn int; unit text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'the operation needs a payload object' using errcode = 'WS001'; end if;
  sid := public.workspace_uuid_or_null(p_payload ->> 'sheet_id');

  if p_type = 'add_sheet' then
    if sid is null then raise exception 'sheet_id must be a uuid' using errcode = 'WS001'; end if;
    nm := trim(coalesce(p_payload ->> 'name', ''));
    if jsonb_typeof(p_payload -> 'name') is distinct from 'string' or length(nm) not between 1 and 31 then raise exception 'a sheet name must be 1 to 31 characters' using errcode = 'WS001'; end if;
    if exists (select 1 from public.workspace_sheets where id = sid) then raise exception 'that sheet id is already used' using errcode = 'WS001'; end if;
    select count(*), coalesce(max(position) + 1, 0) into live, pos from public.workspace_sheets where document_id = p_doc and deleted_at is null;
    if live >= 20 then raise exception 'a workbook can have at most 20 sheets' using errcode = 'WS001'; end if;
    if exists (select 1 from public.workspace_sheets where document_id = p_doc and deleted_at is null and lower(name) = lower(nm)) then
      raise exception 'a sheet with that name already exists' using errcode = 'WS001';
    end if;
    insert into public.workspace_sheets (id, document_id, name, position, row_order, col_order, created_by)
      values (sid, p_doc, nm, pos, (select array_agg(g) from generate_series(1, 100) g), (select array_agg(g) from generate_series(1, 26) g), p_user);
    return jsonb_build_object('status', 'applied', 'effective', jsonb_build_object('sheet_id', sid, 'name', nm, 'position', pos));
  end if;

  if p_type = 'reorder_sheets' then
    if jsonb_typeof(p_payload -> 'order') is distinct from 'array' then raise exception 'order must be a list of sheet ids' using errcode = 'WS001'; end if;
    select array_agg(public.workspace_uuid_or_null(e) order by o) into names from jsonb_array_elements_text(p_payload -> 'order') with ordinality t(e, o);
    select array_agg(id order by id) into cur from public.workspace_sheets where document_id = p_doc and deleted_at is null;
    if names is null or array_position(names, null) is not null or (select array_agg(x order by x) from unnest(names) x) is distinct from cur then
      raise exception 'order must list every sheet of the workbook exactly once' using errcode = 'WS001';
    end if;
    update public.workspace_sheets s set position = t.o - 1 from unnest(names) with ordinality t(id, o) where s.id = t.id;
    return jsonb_build_object('status', 'applied', 'effective', jsonb_build_object('order', to_jsonb(names)));
  end if;

  -- everything else addresses an existing sheet of this workbook
  select * into sh from public.workspace_sheets where id = sid and document_id = p_doc and deleted_at is null;
  if not found then raise exception 'sheet not found' using errcode = 'WS001'; end if;

  if p_type = 'rename_sheet' then
    nm := trim(coalesce(p_payload ->> 'name', ''));
    if jsonb_typeof(p_payload -> 'name') is distinct from 'string' or length(nm) not between 1 and 31 then raise exception 'a sheet name must be 1 to 31 characters' using errcode = 'WS001'; end if;
    if exists (select 1 from public.workspace_sheets where document_id = p_doc and deleted_at is null and id <> sid and lower(name) = lower(nm)) then
      raise exception 'a sheet with that name already exists' using errcode = 'WS001';
    end if;
    update public.workspace_sheets set name = nm where id = sid;
    return jsonb_build_object('status', 'applied', 'effective', jsonb_build_object('sheet_id', sid, 'name', nm));
  end if;

  if p_type = 'delete_sheet' then
    select count(*) into live from public.workspace_sheets where document_id = p_doc and deleted_at is null;
    if live <= 1 then raise exception 'a workbook needs at least one sheet' using errcode = 'WS001'; end if;
    update public.workspace_sheets set deleted_at = now() where id = sid;
    return jsonb_build_object('status', 'applied', 'effective', jsonb_build_object('sheet_id', sid));
  end if;

  if p_type = 'set_styles' then
    if jsonb_typeof(p_payload -> 'styles') is distinct from 'array' or jsonb_array_length(p_payload -> 'styles') not between 1 and 200 then
      raise exception 'styles must be a list of 1 to 200 styles' using errcode = 'WS001';
    end if;
    for item in select value from jsonb_array_elements(p_payload -> 'styles') loop
      ns := public.workspace_json_int(item -> 'style_id');
      if ns is null or ns not between 1 and 10000 then raise exception 'a style id must be 1 to 10000' using errcode = 'WS001'; end if;
      if not public.workspace_style_valid(item -> 'style') then raise exception 'a style is not valid' using errcode = 'WS001'; end if;
      insert into public.workspace_sheet_styles (sheet_id, style_id, style) values (sid, ns, item -> 'style')
        on conflict (sheet_id, style_id) do update set style = excluded.style;
    end loop;
    if (select count(*) from public.workspace_sheet_styles where sheet_id = sid) > 500 then raise exception 'a sheet can have at most 500 styles' using errcode = 'WS001'; end if;
    return jsonb_build_object('status', 'applied', 'effective', p_payload);
  end if;

  if p_type = 'set_cells' then
    if jsonb_typeof(p_payload -> 'cells') is distinct from 'array' or jsonb_array_length(p_payload -> 'cells') not between 1 and 5000 then
      raise exception 'cells must be a list of 1 to 5000 cells' using errcode = 'WS001';
    end if;
    base_default := public.workspace_json_int(p_payload -> 'base_seq');
    for cell in select value from jsonb_array_elements(p_payload -> 'cells') loop
      cr := public.workspace_json_int(cell -> 'r');
      cc := public.workspace_json_int(cell -> 'c');
      if cr is null or cc is null or cr < 1 or cc < 1 or cr > 2147483647 or cc > 2147483647 then raise exception 'every cell needs a row id r and a column id c' using errcode = 'WS001'; end if;
      base := coalesce(public.workspace_json_int(cell -> 'base_seq'), base_default);
      if base is null or base < 0 then raise exception 'every cell needs a base_seq (the seq you last saw)' using errcode = 'WS001'; end if;
      nv := case when cell -> 'value' = 'null'::jsonb then null else cell -> 'value' end;
      if nv is not null and jsonb_typeof(nv) not in ('number', 'string', 'boolean') then raise exception 'a cell value must be a number, text or true/false' using errcode = 'WS001'; end if;
      if nv is not null and jsonb_typeof(nv) = 'string' and length(nv #>> '{}') > 32767 then raise exception 'a cell can hold at most 32,767 characters' using errcode = 'WS001'; end if;
      nf := null;
      if cell -> 'formula' is not null and cell -> 'formula' <> 'null'::jsonb then
        if jsonb_typeof(cell -> 'formula') <> 'string' then raise exception 'a formula must be text' using errcode = 'WS001'; end if;
        nf := cell ->> 'formula';
        if left(nf, 1) <> '=' or length(nf) not between 2 and 1000 then raise exception 'a formula starts with = and is at most 1,000 characters' using errcode = 'WS001'; end if;
      end if;
      if nv is not null and nf is not null then raise exception 'a cell holds a value or a formula, not both' using errcode = 'WS001'; end if;
      ns := null;
      if cell -> 'style_id' is not null and cell -> 'style_id' <> 'null'::jsonb then
        ns := public.workspace_json_int(cell -> 'style_id');
        if ns is null or not exists (select 1 from public.workspace_sheet_styles where sheet_id = sid and style_id = ns) then raise exception 'unknown style' using errcode = 'WS001'; end if;
      end if;

      if not (cr = any (sh.row_order) and cc = any (sh.col_order)) then
        insert into public.workspace_conflicts (document_id, op_id, actor_staff_id, kind, target, server_state, local_state)
          values (p_doc, gen_random_uuid(), p_staff, 'target_deleted', jsonb_build_object('sheet_id', sid, 'r', cr, 'c', cc), null,
                  jsonb_build_object('value', nv, 'formula', nf, 'style_id', ns)) returning id into cid;
        confs := confs || jsonb_build_array(jsonb_build_object('conflict_id', cid, 'r', cr, 'c', cc, 'kind', 'target_deleted'));
        continue;
      end if;
      select * into ex from public.workspace_cells where sheet_id = sid and row_id = cr and col_id = cc;
      if found and ex.last_seq > base
         and (ex.value is distinct from nv or ex.formula is distinct from nf or ex.style_id is distinct from ns) then
        insert into public.workspace_conflicts (document_id, op_id, actor_staff_id, kind, target, server_state, local_state)
          values (p_doc, gen_random_uuid(), p_staff, 'cell', jsonb_build_object('sheet_id', sid, 'r', cr, 'c', cc),
                  jsonb_build_object('value', ex.value, 'formula', ex.formula, 'style_id', ex.style_id, 'last_seq', ex.last_seq),
                  jsonb_build_object('value', nv, 'formula', nf, 'style_id', ns)) returning id into cid;
        confs := confs || jsonb_build_array(jsonb_build_object('conflict_id', cid, 'r', cr, 'c', cc, 'kind', 'cell'));
        continue;
      end if;
      insert into public.workspace_cells (sheet_id, row_id, col_id, value, formula, style_id, last_seq, updated_by)
        values (sid, cr, cc, nv, nf, ns, p_seq, p_user)
        on conflict (sheet_id, row_id, col_id) do update
          set value = excluded.value, formula = excluded.formula, style_id = excluded.style_id, last_seq = excluded.last_seq, updated_by = excluded.updated_by;
      eff := eff || jsonb_build_array(jsonb_build_object('r', cr, 'c', cc, 'value', nv, 'formula', nf, 'style_id', ns));
      n_applied := n_applied + 1;
    end loop;
    if n_applied > 0 then
      select count(*) into total from public.workspace_cells c join public.workspace_sheets s on s.id = c.sheet_id
        where s.document_id = p_doc and s.deleted_at is null and (c.value is not null or c.formula is not null or c.style_id is not null);
      if total > 50000 then raise exception 'a workbook can hold at most 50,000 filled cells' using errcode = 'WS001'; end if;
    end if;
    return jsonb_build_object('status', case when jsonb_array_length(confs) > 0 then 'conflict' else 'applied' end,
      'applied_cells', n_applied, 'conflicts', confs, 'effective', jsonb_build_object('sheet_id', sid, 'cells', eff));
  end if;

  if p_type in ('insert_rows', 'delete_rows', 'insert_cols', 'delete_cols') then
    kind_cols := p_type in ('insert_cols', 'delete_cols');
    maxn := case when kind_cols then 100 else 10000 end;
    unit := case when kind_cols then 'columns' else 'rows' end;
    new_order := case when kind_cols then sh.col_order else sh.row_order end;
    if jsonb_typeof(p_payload -> 'ids') is distinct from 'array' or jsonb_array_length(p_payload -> 'ids') not between 1 and 1000 then
      raise exception 'ids must be a list of 1 to 1000 ids' using errcode = 'WS001';
    end if;
    select array_agg(public.workspace_json_int(e)::int order by o) into ids from jsonb_array_elements(p_payload -> 'ids') with ordinality t(e, o);
    if array_position(ids, null) is not null or (select count(distinct x) from unnest(ids) x) <> cardinality(ids) or exists (select 1 from unnest(ids) x where x < 1) then
      raise exception 'ids must be distinct whole numbers' using errcode = 'WS001';
    end if;

    if p_type in ('insert_rows', 'insert_cols') then
      if exists (select 1 from unnest(ids) x where x < 1000) then raise exception 'new ids start at 1000 (1 to 999 belong to the first grid)' using errcode = 'WS001'; end if;
      if exists (select 1 from unnest(ids) x where x = any (new_order)) then raise exception 'one of those ids is already in use' using errcode = 'WS001'; end if;
      if exists (select 1 from public.workspace_cells c where c.sheet_id = sid and ((not kind_cols and c.row_id = any (ids)) or (kind_cols and c.col_id = any (ids)))) then
        raise exception 'one of those ids was used before and cannot be used again' using errcode = 'WS001';
      end if;
      if cardinality(new_order) + cardinality(ids) > maxn then
        raise exception 'that would be more than % %', maxn, unit using errcode = 'WS001';
      end if;
      if p_payload -> 'after' is null or p_payload -> 'after' = 'null'::jsonb then
        idx := 0;
      else
        anchor := public.workspace_json_int(p_payload -> 'after');
        idx := array_position(new_order, anchor);
        if anchor is null or idx is null then
          insert into public.workspace_conflicts (document_id, op_id, actor_staff_id, kind, target, local_state)
            values (p_doc, gen_random_uuid(), p_staff, 'structure', jsonb_build_object('sheet_id', sid, 'op', p_type, 'after', p_payload -> 'after'),
                    jsonb_build_object('ids', to_jsonb(ids))) returning id into cid;
          return jsonb_build_object('status', 'conflict', 'conflicts', jsonb_build_array(jsonb_build_object('conflict_id', cid, 'kind', 'structure')),
            'effective', p_payload);
        end if;
      end if;
      new_order := new_order[1:idx] || ids || new_order[idx + 1:];
    else
      select coalesce(array_agg(x order by o), '{}') into new_order from unnest(new_order) with ordinality t(x, o) where not (x = any (ids));
      if cardinality(new_order) < 1 then raise exception 'a sheet needs at least one % left', rtrim(unit, 's') using errcode = 'WS001'; end if;
      -- The cells are blanked, not removed: the empty row stays as a marker, so the id is never handed out again and a stale
      -- edit to it is still recognised. (Blank cells are invisible to browsers and not counted.)
      if kind_cols then
        update public.workspace_cells set value = null, formula = null, style_id = null, last_seq = p_seq, updated_by = p_user where sheet_id = sid and col_id = any (ids);
      else
        update public.workspace_cells set value = null, formula = null, style_id = null, last_seq = p_seq, updated_by = p_user where sheet_id = sid and row_id = any (ids);
      end if;
    end if;
    if kind_cols then update public.workspace_sheets set col_order = new_order where id = sid;
    else update public.workspace_sheets set row_order = new_order where id = sid; end if;
    return jsonb_build_object('status', 'applied', 'effective', p_payload);
  end if;

  if p_type = 'resize' then
    -- sizes are last-writer-wins (they are layout, not content); ids that no longer exist are ignored
    for k in select unnest(array['rows', 'cols']) loop
      v := p_payload -> k;
      if v is null then continue; end if;
      if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) > 500 then raise exception 'sizes must be an object of at most 500 entries' using errcode = 'WS001'; end if;
      sizes := case when k = 'rows' then sh.row_sizes else sh.col_sizes end;
      for item in select jsonb_build_object('k', e.key, 'v', e.value) from jsonb_each(v) e loop
        if (item ->> 'k') !~ '^[0-9]{1,10}$' then raise exception 'a size is keyed by a row or column id' using errcode = 'WS001'; end if;
        if item -> 'v' = 'null'::jsonb then
          sizes := sizes - (item ->> 'k');
        elsif public.workspace_json_int(item -> 'v') between 10 and 2000 then
          if ((item ->> 'k')::bigint) = any (case when k = 'rows' then sh.row_order else sh.col_order end) then
            sizes := sizes || jsonb_build_object(item ->> 'k', item -> 'v');
          end if;
        else
          raise exception 'a size is 10 to 2000 (or null to reset)' using errcode = 'WS001';
        end if;
      end loop;
      if k = 'rows' then update public.workspace_sheets set row_sizes = sizes where id = sid;
      else update public.workspace_sheets set col_sizes = sizes where id = sid; end if;
    end loop;
    return jsonb_build_object('status', 'applied', 'effective', p_payload);
  end if;

  raise exception 'the operation % is not available yet', p_type using errcode = 'WS001';
end $$;

-- ───────── applying a batch ─────────
-- p_ops: a list of { operation_id, operation_type, payload [, base_seq] }, at most 200, applied in order in one transaction.
-- Returns { results: [{ operation_id, status, seq, ... }], head_seq }. status: applied | conflict | rejected | duplicate.
-- Sending an operation id again returns what happened the first time and changes nothing.
create function public.workspace_apply_ops(p_doc uuid, p_ops jsonb, p_device uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r text; d public.workspace_documents; staff uuid; o jsonb; opid uuid; typ text; pl jsonb; head bigint; start_head bigint;
  ex public.workspace_operations; res jsonb; results jsonb := '[]'::jsonb; st text; eff jsonb; stored jsonb; n int;
begin
  r := public.workspace_role(p_doc);
  if r is null or r not in ('owner', 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) not between 1 and 200 then raise exception 'send 1 to 200 operations' using errcode = 'WS001'; end if;
  if octet_length(p_ops::text) > 4000000 then raise exception 'that batch is too large' using errcode = 'WS001'; end if;
  select * into d from public.workspace_documents where id = p_doc for update;
  if d.kind <> 'workbook' then raise exception 'not a workbook'; end if;
  if d.archived_at is not null then raise exception 'the document is archived'; end if;
  -- check every envelope before writing anything
  for o in select value from jsonb_array_elements(p_ops) loop
    if jsonb_typeof(o) is distinct from 'object' or public.workspace_uuid_or_null(o ->> 'operation_id') is null
       or jsonb_typeof(o -> 'operation_type') is distinct from 'string' or (o ->> 'operation_type') not in ('set_cells', 'set_styles', 'insert_rows',
         'delete_rows', 'move_rows', 'insert_cols', 'delete_cols', 'move_cols', 'resize', 'add_sheet', 'rename_sheet', 'delete_sheet',
         'reorder_sheets', 'duplicate_sheet', 'sort_range') then
      raise exception 'every operation needs an operation_id and a known operation_type' using errcode = 'WS001';
    end if;
  end loop;
  staff := public.workspace_my_staff_id();
  head := d.head_version;
  start_head := head;

  for o in select value from jsonb_array_elements(p_ops) loop
    opid := (o ->> 'operation_id')::uuid;
    typ := o ->> 'operation_type';
    pl := coalesce(o -> 'payload', 'null'::jsonb);
    select * into ex from public.workspace_operations where document_id = p_doc and op_id = opid;
    if found then
      results := results || jsonb_build_array(jsonb_build_object('operation_id', opid, 'status', 'duplicate', 'seq', ex.seq,
        'original_status', coalesce(ex.result ->> 'status', ex.status), 'result', ex.result));
      continue;
    end if;
    head := head + 1;
    if octet_length(pl::text) > 262144 then
      res := jsonb_build_object('status', 'rejected', 'reason', 'that operation is too large', 'effective', '{}'::jsonb);
    else
      begin
        res := public.workspace_apply_one(p_doc, head, auth.uid(), staff, typ, pl);
      exception when sqlstate 'WS001' then
        res := jsonb_build_object('status', 'rejected', 'reason', sqlerrm, 'effective', '{}'::jsonb);
      end;
    end if;
    st := res ->> 'status';
    eff := coalesce(res -> 'effective', '{}'::jsonb);
    stored := res - 'effective';
    insert into public.workspace_operations (document_id, seq, op_id, device_id, actor_user, op_type, base_seq, payload, status, result)
      values (p_doc, head, opid, p_device, auth.uid(), typ, coalesce(public.workspace_json_int(o -> 'base_seq'), public.workspace_json_int(pl -> 'base_seq'), 0),
              case when st = 'rejected' then (case when octet_length(pl::text) <= 262144 then coalesce(pl, '{}'::jsonb) else '{}'::jsonb end) else eff end,
              case when st = 'rejected' then 'rejected'
                   when st = 'conflict' and coalesce((res ->> 'applied_cells')::int, 0) = 0 then 'conflict'
                   else 'applied' end,
              stored);
    results := results || jsonb_build_array(jsonb_build_object('operation_id', opid, 'seq', head) || stored);
  end loop;

  if head > start_head then
    update public.workspace_documents set head_version = head, updated_at = now(), updated_by = auth.uid() where id = p_doc;
    if head / 200 > start_head / 200 then
      perform public.workspace_store_snapshot(p_doc, head, 'checkpoint', null, auth.uid());
    end if;
  end if;
  return jsonb_build_object('results', results, 'head_seq', head);
end $$;

-- ───────── restore points ─────────
create function public.workspace_snapshot_create(p_doc uuid, p_label text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; r text; d public.workspace_documents; sid uuid; res jsonb;
begin
  cached := public.workspace_idem_get(p_key, 'snapshot_create');
  if cached is not null then return cached; end if;
  r := public.workspace_role(p_doc);
  if r is null or r not in ('owner', 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc for update;
  if d.kind <> 'workbook' then raise exception 'not a workbook'; end if;
  if d.archived_at is not null then raise exception 'the document is archived'; end if;
  if p_label is not null and length(p_label) > 100 then raise exception 'a label is at most 100 characters'; end if;
  sid := public.workspace_store_snapshot(p_doc, d.head_version, 'manual', nullif(trim(p_label), ''), auth.uid());
  res := jsonb_build_object('snapshot_id', sid, 'seq', d.head_version);
  perform public.workspace_idem_put(p_key, 'snapshot_create', res);
  return res;
end $$;

create function public.workspace_snapshot_list(p_doc uuid, p_before bigint default null, p_limit int default 50)
returns table (id uuid, seq bigint, kind text, label text, bytes int, author text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare r text; d public.workspace_documents;
begin
  r := public.workspace_role(p_doc);
  if r is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc;
  if d.kind <> 'workbook' then raise exception 'not a workbook'; end if;
  if r = 'viewer' and not d.history_visible_to_viewers then raise exception 'history is not shared' using errcode = '42501'; end if;
  return query
    select v.id, v.seq, v.kind, v.label, v.bytes, s.full_name, v.created_at
    from public.workspace_sheet_revisions v
    left join public.profiles pr on pr.user_id = v.created_by
    left join public.staff s on s.id = pr.staff_id
    where v.document_id = p_doc and (p_before is null or v.seq < p_before)
    order by v.seq desc, v.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- Owner only. Puts the workbook back to a restore point: sheets, order, sizes, styles and cells. Takes a restore point of the
-- present first, then writes the old state as a NEW operation (every cell gets the new seq, so edits made earlier by someone
-- offline become conflicts instead of silently overwriting the restored state).
create function public.workspace_sheet_restore(p_doc uuid, p_snapshot uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; d public.workspace_documents; snap public.workspace_sheet_revisions; sh jsonb; item jsonb; new_seq bigint; res jsonb; sid uuid; keep uuid[];
begin
  cached := public.workspace_idem_get(p_key, 'sheet_restore');
  if cached is not null then return cached; end if;
  if not public.workspace_is_owner(p_doc) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.workspace_documents where id = p_doc for update;
  if d.kind <> 'workbook' then raise exception 'not a workbook'; end if;
  if d.archived_at is not null then raise exception 'the document is archived'; end if;
  select * into snap from public.workspace_sheet_revisions where id = p_snapshot and document_id = p_doc;
  if not found then raise exception 'no such restore point'; end if;
  perform public.workspace_store_snapshot(p_doc, d.head_version, 'pre_restore', null, auth.uid());
  new_seq := d.head_version + 1;

  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into keep from jsonb_array_elements(snap.snapshot -> 'sheets') e;
  -- give every sheet that will be rewritten a temporary unique name so names can swap without clashing
  update public.workspace_sheets set name = left(md5(id::text), 31) where document_id = p_doc and (id = any (keep) or deleted_at is null);
  update public.workspace_sheets set deleted_at = coalesce(deleted_at, now()) where document_id = p_doc and not (id = any (keep));
  for sh in select value from jsonb_array_elements(snap.snapshot -> 'sheets') loop
    sid := (sh ->> 'id')::uuid;
    if exists (select 1 from public.workspace_sheets where id = sid and document_id <> p_doc) then raise exception 'that restore point is not valid'; end if;
    insert into public.workspace_sheets (id, document_id, name, position, row_order, col_order, row_sizes, col_sizes, frozen_rows, frozen_cols, created_by)
      values (sid, p_doc, left(md5(sid::text), 31), (sh ->> 'position')::int,
              (select array_agg(x::int order by o) from jsonb_array_elements_text(sh -> 'row_order') with ordinality t(x, o)),
              (select array_agg(x::int order by o) from jsonb_array_elements_text(sh -> 'col_order') with ordinality t(x, o)),
              sh -> 'row_sizes', sh -> 'col_sizes', (sh ->> 'frozen_rows')::int, (sh ->> 'frozen_cols')::int, auth.uid())
      on conflict (id) do update set position = excluded.position, row_order = excluded.row_order, col_order = excluded.col_order,
        row_sizes = excluded.row_sizes, col_sizes = excluded.col_sizes, frozen_rows = excluded.frozen_rows,
        frozen_cols = excluded.frozen_cols, deleted_at = null;
    delete from public.workspace_cells where sheet_id = sid;
    delete from public.workspace_sheet_styles where sheet_id = sid;
    for item in select value from jsonb_array_elements(sh -> 'styles') loop
      insert into public.workspace_sheet_styles (sheet_id, style_id, style) values (sid, (item ->> 0)::int, item -> 1);
    end loop;
    for item in select value from jsonb_array_elements(sh -> 'cells') loop
      insert into public.workspace_cells (sheet_id, row_id, col_id, value, formula, style_id, last_seq, updated_by)
        values (sid, (item ->> 0)::int, (item ->> 1)::int, nullif(item -> 2, 'null'::jsonb), nullif(item ->> 3, ''), nullif(item ->> 4, '')::int, new_seq, auth.uid());
    end loop;
    update public.workspace_sheets set name = sh ->> 'name' where id = sid;
  end loop;

  insert into public.workspace_operations (document_id, seq, op_id, actor_user, op_type, base_seq, payload, status, result)
    values (p_doc, new_seq, gen_random_uuid(), auth.uid(), 'restore_snapshot', d.head_version,
            jsonb_build_object('snapshot_id', p_snapshot, 'snapshot_seq', snap.seq), 'applied', jsonb_build_object('status', 'applied'));
  update public.workspace_documents set head_version = new_seq, updated_at = now(), updated_by = auth.uid() where id = p_doc;
  perform public.log_activity('workspace.restore', 'workspace_document', p_doc::text,
    jsonb_build_object('seq', d.head_version), jsonb_build_object('seq', new_seq, 'restored_from_seq', snap.seq), null);
  res := jsonb_build_object('status', 'restored', 'seq', new_seq, 'restored_from_seq', snap.seq);
  perform public.workspace_idem_put(p_key, 'sheet_restore', res);
  return res;
end $$;

-- ───────── grants ─────────
revoke all on function
  public.workspace_json_int(jsonb), public.workspace_uuid_or_null(text), public.workspace_style_valid(jsonb),
  public.workspace_append_only(), public.workspace_can_read_sheet(uuid), public.workspace_workbook_open(uuid),
  public.workspace_load_sheet(uuid, int, int, int), public.workspace_pull(uuid, bigint, int),
  public.workspace_build_snapshot(uuid), public.workspace_store_snapshot(uuid, bigint, text, text, uuid),
  public.workspace_apply_one(uuid, bigint, uuid, uuid, text, jsonb), public.workspace_apply_ops(uuid, jsonb, uuid),
  public.workspace_snapshot_create(uuid, text, uuid), public.workspace_snapshot_list(uuid, bigint, int),
  public.workspace_sheet_restore(uuid, uuid, uuid)
  from public, anon, authenticated;

-- The browser may call these (and the policies need can_read_sheet). The validators, the snapshot builders and
-- workspace_apply_one stay internal.
grant execute on function
  public.workspace_can_read_sheet(uuid), public.workspace_workbook_open(uuid), public.workspace_load_sheet(uuid, int, int, int),
  public.workspace_pull(uuid, bigint, int), public.workspace_apply_ops(uuid, jsonb, uuid),
  public.workspace_snapshot_create(uuid, text, uuid), public.workspace_snapshot_list(uuid, bigint, int),
  public.workspace_sheet_restore(uuid, uuid, uuid)
  to authenticated;

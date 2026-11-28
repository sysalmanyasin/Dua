-- Workspace 1112: the structure guard (owner decision "option (a)", 27 Nov 2026).
--
-- Problem: formulas are stored as A1 text, but conflicts were detected only per cell (last_seq > base_seq). A change of rows or
-- columns does not touch cell versions, so a formula saved from a copy that is OLDER than an insert or delete of rows or
-- columns was accepted and silently pointed at the wrong cells.
--
-- Rule: every sheet remembers structure_seq, the seq of its last insert or delete of rows or columns (or of a restore).
--   * set_cells: a cell that carries a FORMULA is answered as a conflict of kind 'structure' (and not written) when its base_seq
--     is older than structure_seq. Values and clears are not affected: they do not depend on positions.
--   * insert_rows, delete_rows, insert_cols, delete_cols: when the payload carries base_seq and it is older than structure_seq,
--     the operation is answered as a conflict of kind 'structure' (the sender worked out its formula rewrite from positions
--     that are no longer true). An operation without base_seq is accepted (older callers and fixtures).
--   * A structure change made earlier in the SAME batch does not count: head_version moves only at the end of the batch, so
--     structure_seq > head_version identifies it. This lets the rewritten formulas travel in the same batch as the insert.
--   * Restoring a restore point sets structure_seq to the restore's seq.
-- Fix-forward: 1102 is not edited. Both functions are replaced with the same text plus the rule (create or replace keeps their
-- privileges).
alter table public.workspace_sheets add column structure_seq bigint not null default 0 check (structure_seq >= 0);
comment on column public.workspace_sheets.structure_seq is 'seq of the last insert/delete of rows or columns, or restore; a formula written from an older copy is refused';

create or replace function public.workspace_apply_one(p_doc uuid, p_seq bigint, p_user uuid, p_staff uuid, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  sid uuid; sh public.workspace_sheets; cell jsonb; cr int; cc int; base bigint; base_default bigint; ex public.workspace_cells;
  nv jsonb; nf text; ns int; eff jsonb := '[]'::jsonb; confs jsonb := '[]'::jsonb; n_applied int := 0; cid uuid; total int;
  ids int[]; anchor int; idx int; new_order int[]; item jsonb; nm text; live int; pos int; st jsonb; k text; v jsonb; sizes jsonb;
  names uuid[]; cur uuid[]; kind_cols boolean; maxn int; unit text; dh bigint; sb bigint;
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
  -- Structure guard (1112). Formulas are stored as A1 text, so a formula written from a copy that is older than the last change
  -- of rows or columns would silently point at the wrong cells. A change from an EARLIER batch has structure_seq <= dh (the
  -- committed head of the document). A change made earlier in THIS batch has structure_seq > dh, because head_version only
  -- moves at the end of the batch: that is how the rewritten formulas that travel with an insert or delete are let through.
  select head_version into dh from public.workspace_documents where id = p_doc;

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
      if nf is not null and base < sh.structure_seq and sh.structure_seq <= dh then
        insert into public.workspace_conflicts (document_id, op_id, actor_staff_id, kind, target, server_state, local_state)
          values (p_doc, gen_random_uuid(), p_staff, 'structure', jsonb_build_object('sheet_id', sid, 'r', cr, 'c', cc),
                  jsonb_build_object('structure_seq', sh.structure_seq),
                  jsonb_build_object('value', nv, 'formula', nf, 'style_id', ns)) returning id into cid;
        confs := confs || jsonb_build_array(jsonb_build_object('conflict_id', cid, 'r', cr, 'c', cc, 'kind', 'structure'));
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
    sb := public.workspace_json_int(p_payload -> 'base_seq');
    if sb is not null and sb < sh.structure_seq and sh.structure_seq <= dh then
      insert into public.workspace_conflicts (document_id, op_id, actor_staff_id, kind, target, server_state, local_state)
        values (p_doc, gen_random_uuid(), p_staff, 'structure', jsonb_build_object('sheet_id', sid, 'op', p_type),
                jsonb_build_object('structure_seq', sh.structure_seq), jsonb_build_object('ids', p_payload -> 'ids')) returning id into cid;
      return jsonb_build_object('status', 'conflict', 'conflicts', jsonb_build_array(jsonb_build_object('conflict_id', cid, 'kind', 'structure')),
        'effective', p_payload);
    end if;
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
    if kind_cols then update public.workspace_sheets set col_order = new_order, structure_seq = p_seq where id = sid;
    else update public.workspace_sheets set row_order = new_order, structure_seq = p_seq where id = sid; end if;
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

create or replace function public.workspace_sheet_restore(p_doc uuid, p_snapshot uuid, p_key uuid) returns jsonb
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
    update public.workspace_sheets set name = sh ->> 'name', structure_seq = new_seq where id = sid;
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

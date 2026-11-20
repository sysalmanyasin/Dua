-- 0411_audit_barcode — Audit slice C2: the Barcode Center, and scanning while counting.
-- One barcode belongs to one product. A barcode is registered (unverified), verified by a second look, and from then on a scan
-- resolves to that product. If someone registers the same barcode for a different product, the existing link is NOT changed:
-- the barcode goes to "conflict" and stays there until a person with audit.barcode_admin decides (keep, reassign or disable).
-- Nothing is ever settled automatically. Scans from a phone are saved as history through an idempotent batch: sending the same
-- scan again changes nothing. Counts themselves still go through audit_count_batch (0402); a scan only finds the item.
-- Roles: audit.barcode_scan reads the barcode list and logs scans; audit.barcode_register also registers, verifies and flags;
-- audit.barcode_admin also changes, disables, enables and settles conflicts, and reads the full history.
-- Tables have row-level security and no direct grants: every read and write is a function that checks the permission.

-- ───────── 1. tables ─────────
create function public.audit_barcode_clean(p_text text) returns text language sql immutable set search_path = public as $$
  select upper(regexp_replace(btrim(coalesce(p_text, '')), '\s+', '', 'g'))
$$;

create table public.audit_barcodes (
  id uuid primary key default gen_random_uuid(),
  barcode text not null check (barcode = public.audit_barcode_clean(barcode) and barcode ~ '^[A-Z0-9._-]{4,48}$'),
  product_id uuid not null,
  product_code text not null check (length(btrim(product_code)) > 0),
  product_name text not null,
  barcode_type text not null default 'unknown'
    check (barcode_type in ('unknown', 'ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'itf', 'qr', 'other')),
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'conflict', 'disabled')),
  verified_before_disable boolean not null default false,
  -- the product someone else claimed for this barcode (only while status = 'conflict')
  conflict_product_id uuid,
  conflict_product_code text,
  conflict_product_name text,
  conflict_note text,
  conflict_by uuid references auth.users (id),
  notes text,
  registered_by uuid not null references auth.users (id),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'conflict') = (conflict_product_id is not null))
);
alter table public.audit_barcodes enable row level security;
create unique index audit_barcodes_barcode on public.audit_barcodes (barcode);
create index audit_barcodes_product on public.audit_barcodes (product_id);
create index audit_barcodes_status on public.audit_barcodes (status, updated_at);
create index audit_barcodes_delta on public.audit_barcodes (updated_at, id);
create trigger audit_barcodes_updated before update on public.audit_barcodes
  for each row execute function public.set_updated_at();

-- What happened to a barcode, never edited or deleted.
create table public.audit_barcode_log (
  id uuid primary key default gen_random_uuid(),
  barcode_id uuid not null references public.audit_barcodes (id),
  barcode text not null,
  action text not null check (action in ('registered', 'verified', 'conflict_flagged', 'changed', 'disabled', 'enabled',
                                          'conflict_kept', 'conflict_reassigned', 'conflict_disabled')),
  from_status text,
  to_status text not null,
  detail jsonb not null default '{}'::jsonb,
  reason text,
  actor uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.audit_barcode_log enable row level security;
create index audit_barcode_log_barcode on public.audit_barcode_log (barcode_id, created_at desc);
create trigger audit_barcode_log_append_only before update or delete on public.audit_barcode_log
  for each row execute function public.audit_append_only();

-- Scans saved from phones. client_event_id is made on the phone, so a resend is recognised and ignored.
create table public.audit_scan_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id uuid not null,
  user_id uuid not null references auth.users (id),
  assignment_id uuid references public.audit_assignments (id),
  scan_type text not null check (scan_type in ('count', 'lookup', 'register')),
  barcode text not null check (length(barcode) between 1 and 64),
  product_code text,
  result text not null check (result in ('matched', 'not_found', 'unverified', 'conflict', 'disabled', 'not_in_assignment', 'ambiguous')),
  scanned_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.audit_scan_events enable row level security;
create unique index audit_scan_events_client on public.audit_scan_events (client_event_id);
create index audit_scan_events_user on public.audit_scan_events (user_id, scanned_at desc);
create index audit_scan_events_barcode on public.audit_scan_events (barcode, scanned_at desc);
create trigger audit_scan_events_append_only before update or delete on public.audit_scan_events
  for each row execute function public.audit_append_only();

-- ───────── 2. permission helpers ─────────
create function public.audit_barcode_require(p_level text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_level = 'admin' and public.has_perm('audit.barcode_admin') then return; end if;
  if p_level = 'register' and (public.has_perm('audit.barcode_register') or public.has_perm('audit.barcode_admin')) then return; end if;
  if p_level = 'scan' and (public.has_perm('audit.barcode_scan') or public.has_perm('audit.barcode_register') or public.has_perm('audit.barcode_admin')) then return; end if;
  raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
end $$;

create function public.audit_barcode_note(p_text text) returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(coalesce(p_text, '')), 500), '')
$$;

-- ───────── 3. who may find a product to register ─────────
create function public.audit_barcode_products(p_query text, p_limit int default 20)
returns table (id uuid, code text, name text, company text, barcodes int)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  perform public.audit_barcode_require('register');
  if length(v_q) < 2 then return; end if;
  v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.code, p.name, p.company, (select count(*)::int from public.audit_barcodes b where b.product_id = p.id)
    from public.inventory_products p
    where p.name ilike v_q or p.code ilike v_q or p.generic ilike v_q
    order by p.name, p.code limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- ───────── 4. register, verify ─────────
-- Outcomes: created (new, unverified), exists (already linked to this product, nothing changed), conflict (linked to another
-- product: the link is kept, the barcode is flagged for a decision), disabled (switched off: nothing changed).
create function public.audit_barcode_register(p_barcode text, p_product uuid, p_type text default 'unknown', p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := public.audit_barcode_clean(p_barcode); pr public.inventory_products; b public.audit_barcodes;
        v_type text := coalesce(nullif(btrim(p_type), ''), 'unknown'); v_id uuid;
begin
  perform public.audit_barcode_require('register');
  if v_code !~ '^[A-Z0-9._-]{4,48}$' then raise exception 'barcode not valid' using errcode = '22023', hint = 'barcode_invalid'; end if;
  if v_type not in ('unknown', 'ean13', 'ean8', 'upca', 'upce', 'code128', 'code39', 'itf', 'qr', 'other') then
    raise exception 'barcode type not valid' using errcode = '22023', hint = 'barcode_type_invalid';
  end if;
  select * into pr from public.inventory_products where id = p_product;
  if not found then raise exception 'product not found' using errcode = '22023', hint = 'product_not_found'; end if;
  if length(btrim(pr.code)) = 0 then raise exception 'product has no code' using errcode = '22023', hint = 'product_no_code'; end if;

  insert into public.audit_barcodes (barcode, product_id, product_code, product_name, barcode_type, notes, registered_by)
  values (v_code, pr.id, btrim(pr.code), pr.name, v_type, public.audit_barcode_note(p_notes), auth.uid())
  on conflict (barcode) do nothing returning id into v_id;
  if v_id is not null then
    insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, actor)
    values (v_id, v_code, 'registered', null, 'unverified', jsonb_build_object('product', pr.code, 'name', pr.name), auth.uid());
    perform public.log_activity('audit.barcode_registered', 'audit_barcodes', v_id::text, null,
      jsonb_build_object('barcode', v_code, 'product', pr.code), null);
    return jsonb_build_object('outcome', 'created', 'id', v_id, 'status', 'unverified');
  end if;

  select * into b from public.audit_barcodes where barcode = v_code for update;
  if b.status = 'disabled' then return jsonb_build_object('outcome', 'disabled', 'id', b.id, 'status', b.status); end if;
  if b.product_id = pr.id then return jsonb_build_object('outcome', 'exists', 'id', b.id, 'status', b.status); end if;
  if b.status = 'conflict' then                                                                  -- one decision at a time: the first claim stays
    return jsonb_build_object('outcome', 'conflict', 'id', b.id, 'status', b.status);
  end if;
  update public.audit_barcodes set status = 'conflict', conflict_product_id = pr.id, conflict_product_code = btrim(pr.code),
    conflict_product_name = pr.name, conflict_note = public.audit_barcode_note(p_notes), conflict_by = auth.uid()
  where id = b.id;
  insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, reason, actor)
  values (b.id, v_code, 'conflict_flagged', b.status, 'conflict',
          jsonb_build_object('kept', b.product_code, 'claimed', pr.code, 'claimed_name', pr.name), public.audit_barcode_note(p_notes), auth.uid());
  perform public.log_activity('audit.barcode_conflict', 'audit_barcodes', b.id::text,
    jsonb_build_object('status', b.status, 'product', b.product_code),
    jsonb_build_object('status', 'conflict', 'claimed', pr.code), public.audit_barcode_note(p_notes));
  return jsonb_build_object('outcome', 'conflict', 'id', b.id, 'status', 'conflict');
end $$;

-- Marks an unverified barcode as checked. Repeating it on a verified barcode changes nothing. A conflict or a disabled barcode
-- cannot be verified here: a decision comes first.
create function public.audit_barcode_verify(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare b public.audit_barcodes;
begin
  perform public.audit_barcode_require('register');
  select * into b from public.audit_barcodes where id = p_id for update;
  if not found then raise exception 'barcode not found' using errcode = '22023', hint = 'barcode_not_found'; end if;
  if b.status = 'verified' then return 'verified'; end if;
  if b.status <> 'unverified' then raise exception 'barcode is %', b.status using errcode = '55000', hint = 'barcode_state'; end if;
  update public.audit_barcodes set status = 'verified', verified_by = auth.uid(), verified_at = now() where id = p_id;
  insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, actor)
  values (b.id, b.barcode, 'verified', 'unverified', 'verified', jsonb_build_object('product', b.product_code), auth.uid());
  perform public.log_activity('audit.barcode_verified', 'audit_barcodes', b.id::text,
    jsonb_build_object('status', 'unverified'), jsonb_build_object('status', 'verified', 'product', b.product_code), null);
  return 'verified';
end $$;

-- ───────── 5. admin: change, disable, enable, settle a conflict ─────────
-- Moves a barcode to another product. The admin has looked at it, so it ends verified. Clears any open conflict claim.
create function public.audit_barcode_change(p_id uuid, p_product uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.audit_barcodes; pr public.inventory_products;
begin
  perform public.audit_barcode_require('admin');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into b from public.audit_barcodes where id = p_id for update;
  if not found then raise exception 'barcode not found' using errcode = '22023', hint = 'barcode_not_found'; end if;
  select * into pr from public.inventory_products where id = p_product;
  if not found then raise exception 'product not found' using errcode = '22023', hint = 'product_not_found'; end if;
  if length(btrim(pr.code)) = 0 then raise exception 'product has no code' using errcode = '22023', hint = 'product_no_code'; end if;
  if b.product_id = pr.id and b.status <> 'conflict' then raise exception 'already this product' using errcode = '22023', hint = 'same_product'; end if;
  update public.audit_barcodes set product_id = pr.id, product_code = btrim(pr.code), product_name = pr.name,
    status = case when status = 'disabled' then 'disabled' else 'verified' end,
    verified_by = auth.uid(), verified_at = now(),
    conflict_product_id = null, conflict_product_code = null, conflict_product_name = null, conflict_note = null, conflict_by = null,
    verified_before_disable = case when status = 'disabled' then true else verified_before_disable end
  where id = p_id;
  insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, reason, actor)
  values (b.id, b.barcode, 'changed', b.status, case when b.status = 'disabled' then 'disabled' else 'verified' end,
          jsonb_build_object('from', b.product_code, 'to', pr.code, 'to_name', pr.name), left(btrim(p_reason), 500), auth.uid());
  perform public.log_activity('audit.barcode_changed', 'audit_barcodes', b.id::text,
    jsonb_build_object('product', b.product_code), jsonb_build_object('product', pr.code), left(btrim(p_reason), 500));
end $$;

create function public.audit_barcode_disable(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.audit_barcodes;
begin
  perform public.audit_barcode_require('admin');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into b from public.audit_barcodes where id = p_id for update;
  if not found then raise exception 'barcode not found' using errcode = '22023', hint = 'barcode_not_found'; end if;
  if b.status = 'disabled' then return; end if;                                                -- a repeat changes nothing
  update public.audit_barcodes set status = 'disabled', verified_before_disable = (b.verified_at is not null),
    conflict_product_id = null, conflict_product_code = null, conflict_product_name = null, conflict_note = null, conflict_by = null
  where id = p_id;
  insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, reason, actor)
  values (b.id, b.barcode, 'disabled', b.status, 'disabled', jsonb_build_object('product', b.product_code), left(btrim(p_reason), 500), auth.uid());
  perform public.log_activity('audit.barcode_disabled', 'audit_barcodes', b.id::text,
    jsonb_build_object('status', b.status), jsonb_build_object('status', 'disabled'), left(btrim(p_reason), 500));
end $$;

-- Switches a disabled barcode back on: verified if it had been verified before, otherwise unverified again.
create function public.audit_barcode_enable(p_id uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare b public.audit_barcodes; v_to text;
begin
  perform public.audit_barcode_require('admin');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into b from public.audit_barcodes where id = p_id for update;
  if not found then raise exception 'barcode not found' using errcode = '22023', hint = 'barcode_not_found'; end if;
  if b.status <> 'disabled' then return b.status; end if;                                      -- a repeat changes nothing
  v_to := case when b.verified_before_disable then 'verified' else 'unverified' end;
  update public.audit_barcodes set status = v_to where id = p_id;
  insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, reason, actor)
  values (b.id, b.barcode, 'enabled', 'disabled', v_to, jsonb_build_object('product', b.product_code), left(btrim(p_reason), 500), auth.uid());
  perform public.log_activity('audit.barcode_enabled', 'audit_barcodes', b.id::text,
    jsonb_build_object('status', 'disabled'), jsonb_build_object('status', v_to), left(btrim(p_reason), 500));
  return v_to;
end $$;

-- A person decides an open conflict: keep the existing link, give the barcode to the product that was claimed, or switch it off.
create function public.audit_barcode_conflict_resolve(p_id uuid, p_decision text, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare b public.audit_barcodes; v_action text; v_to text; v_detail jsonb;
begin
  perform public.audit_barcode_require('admin');
  if p_decision is null or p_decision not in ('keep', 'reassign', 'disable') then
    raise exception 'choose keep, reassign or disable' using errcode = '22023', hint = 'barcode_decision_invalid';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into b from public.audit_barcodes where id = p_id for update;
  if not found then raise exception 'barcode not found' using errcode = '22023', hint = 'conflict_not_found'; end if;
  if b.status <> 'conflict' then raise exception 'not in conflict' using errcode = '55000', hint = 'conflict_resolved'; end if;
  v_detail := jsonb_build_object('kept', b.product_code, 'claimed', b.conflict_product_code);
  if p_decision = 'keep' then
    v_action := 'conflict_kept'; v_to := 'verified';
    update public.audit_barcodes set status = 'verified', verified_by = auth.uid(), verified_at = now(),
      conflict_product_id = null, conflict_product_code = null, conflict_product_name = null, conflict_note = null, conflict_by = null
    where id = p_id;
  elsif p_decision = 'reassign' then
    v_action := 'conflict_reassigned'; v_to := 'verified';
    update public.audit_barcodes set status = 'verified', verified_by = auth.uid(), verified_at = now(),
      product_id = b.conflict_product_id, product_code = b.conflict_product_code, product_name = b.conflict_product_name,
      conflict_product_id = null, conflict_product_code = null, conflict_product_name = null, conflict_note = null, conflict_by = null
    where id = p_id;
  else
    v_action := 'conflict_disabled'; v_to := 'disabled';
    update public.audit_barcodes set status = 'disabled', verified_before_disable = (b.verified_at is not null),
      conflict_product_id = null, conflict_product_code = null, conflict_product_name = null, conflict_note = null, conflict_by = null
    where id = p_id;
  end if;
  insert into public.audit_barcode_log (barcode_id, barcode, action, from_status, to_status, detail, reason, actor)
  values (b.id, b.barcode, v_action, 'conflict', v_to, v_detail, left(btrim(p_reason), 500), auth.uid());
  perform public.log_activity('audit.barcode_' || v_action, 'audit_barcodes', b.id::text,
    jsonb_build_object('status', 'conflict'), jsonb_build_object('status', v_to) || v_detail, left(btrim(p_reason), 500));
  return v_to;
end $$;

-- ───────── 6. reads ─────────
-- The Barcode Center list (people who register or administer). Search matches the barcode, the product name or code.
create function public.audit_barcode_list(p_status text default null, p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, barcode text, product_id uuid, product_code text, product_name text, barcode_type text, status text,
               conflict_product_code text, conflict_product_name text, conflict_note text, notes text,
               registered_by_name text, verified_by_name text, verified_at timestamptz, created_at timestamptz, updated_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  perform public.audit_barcode_require('register');
  if p_status is not null and p_status not in ('unverified', 'verified', 'conflict', 'disabled') then
    raise exception 'status not valid' using errcode = '22023', hint = 'status_invalid';
  end if;
  if v_q <> '' then v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select b.id, b.barcode, b.product_id, b.product_code, b.product_name, b.barcode_type, b.status,
           b.conflict_product_code, b.conflict_product_name, b.conflict_note, b.notes,
           coalesce(rs.full_name, rp.username), coalesce(vs.full_name, vp.username), b.verified_at, b.created_at, b.updated_at,
           count(*) over ()
    from public.audit_barcodes b
    left join public.profiles rp on rp.user_id = b.registered_by left join public.staff rs on rs.id = rp.staff_id
    left join public.profiles vp on vp.user_id = b.verified_by left join public.staff vs on vs.id = vp.staff_id
    where (p_status is null or b.status = p_status)
      and (v_q = '' or b.barcode ilike v_q or b.product_name ilike v_q or b.product_code ilike v_q)
    order by b.updated_at desc, b.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.audit_barcode_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.audit_barcode_require('register');
  return (select jsonb_build_object(
    'unverified', count(*) filter (where status = 'unverified'), 'verified', count(*) filter (where status = 'verified'),
    'conflict', count(*) filter (where status = 'conflict'), 'disabled', count(*) filter (where status = 'disabled'),
    'total', count(*)) from public.audit_barcodes);
end $$;

-- The phone's copy of the barcode list. Only what is needed to recognise a scan: no stock, no prices. Changes since a cursor
-- (updated_at, id), oldest first, so a refresh downloads only what moved. Rows are never deleted (a barcode is disabled instead).
create function public.audit_barcode_mirror(p_since timestamptz default null, p_after uuid default null, p_limit int default 1000)
returns table (id uuid, barcode text, product_code text, product_name text, status text, conflict_product_code text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.audit_barcode_require('scan');
  return query
    select b.id, b.barcode, b.product_code, b.product_name, b.status, b.conflict_product_code, b.updated_at
    from public.audit_barcodes b
    where p_since is null or (b.updated_at, b.id) > (p_since, coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid))
    order by b.updated_at, b.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;

-- One barcode's history (administrators).
create function public.audit_barcode_history(p_id uuid, p_limit int default 100)
returns table (id uuid, action text, from_status text, to_status text, detail jsonb, reason text, actor_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.audit_barcode_require('admin');
  return query
    select l.id, l.action, l.from_status, l.to_status, l.detail, l.reason, coalesce(s.full_name, p.username), l.created_at
    from public.audit_barcode_log l
    left join public.profiles p on p.user_id = l.actor left join public.staff s on s.id = p.staff_id
    where l.barcode_id = p_id order by l.created_at desc, l.id limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- Scan history. Administrators read everyone's; everyone else reads only their own.
create function public.audit_scan_history(p_limit int default 50, p_offset int default 0)
returns table (id uuid, scan_type text, barcode text, product_code text, result text, assignment_id uuid, user_name text,
               scanned_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_all boolean;
begin
  perform public.audit_barcode_require('scan');
  v_all := public.has_perm('audit.barcode_admin');
  return query
    select e.id, e.scan_type, e.barcode, e.product_code, e.result, e.assignment_id, coalesce(s.full_name, p.username), e.scanned_at, count(*) over ()
    from public.audit_scan_events e
    left join public.profiles p on p.user_id = e.user_id left join public.staff s on s.id = p.staff_id
    where v_all or e.user_id = auth.uid()
    order by e.scanned_at desc, e.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ───────── 7. saving scans from a phone ─────────
-- p_events: [{ id, type, barcode, result, assignment, code, at }]. Safe to send again: an id already saved is counted as a
-- duplicate and changes nothing. An event that cannot be read, or that names someone else's assignment, is rejected on its
-- own (the rest are still saved); the answer says how many. A person without the permission is refused as a whole.
create function public.audit_scan_batch(p_events jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare ev jsonb; v_id uuid; v_ass uuid; v_at timestamptz; v_barcode text; v_type text; v_result text; v_code text;
        v_inserted int := 0; v_dup int := 0; v_rejected int := 0; n int;
begin
  perform public.audit_barcode_require('scan');
  if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'events not valid' using errcode = '22023', hint = 'invalid_events'; end if;
  if jsonb_array_length(p_events) > 200 then raise exception 'too many events' using errcode = '22023', hint = 'batch_too_large'; end if;
  for ev in select * from jsonb_array_elements(p_events) loop
    begin
      v_id := (ev ->> 'id')::uuid;
      v_barcode := public.audit_barcode_clean(ev ->> 'barcode');
      v_type := ev ->> 'type';
      v_result := ev ->> 'result';
      v_code := nullif(left(btrim(coalesce(ev ->> 'code', '')), 80), '');
      v_ass := nullif(ev ->> 'assignment', '')::uuid;
      v_at := (ev ->> 'at')::timestamptz;
      if v_at is null or v_at > now() + interval '1 day' or v_at < now() - interval '30 days' then v_at := now(); end if;
      if v_id is null or v_barcode = '' or length(v_barcode) > 64 or v_type not in ('count', 'lookup', 'register')
         or v_result not in ('matched', 'not_found', 'unverified', 'conflict', 'disabled', 'not_in_assignment', 'ambiguous') then
        v_rejected := v_rejected + 1; continue;
      end if;
      if v_ass is not null and not exists (select 1 from public.audit_assignments a where a.id = v_ass and a.auditor_id = auth.uid()) then
        v_rejected := v_rejected + 1; continue;                                                  -- AUD-5: only your own assignment
      end if;
      insert into public.audit_scan_events (client_event_id, user_id, assignment_id, scan_type, barcode, product_code, result, scanned_at)
      values (v_id, auth.uid(), v_ass, v_type, v_barcode, v_code, v_result, v_at)
      on conflict (client_event_id) do nothing;
      get diagnostics n = row_count;
      if n = 1 then v_inserted := v_inserted + 1; else v_dup := v_dup + 1; end if;
    exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
      v_rejected := v_rejected + 1;
    end;
  end loop;
  return jsonb_build_object('saved', v_inserted, 'duplicates', v_dup, 'rejected', v_rejected);
end $$;

-- ───────── 8. counting method of an audit; counters see it on their assignment ─────────
create function public.audit_engagement_set_method(p_engagement uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.audit_engagements;
begin
  perform public.audit_require('audit.manage');
  if p_method is null or p_method not in ('manual', 'barcode', 'hybrid') then raise exception 'method not valid' using errcode = '22023', hint = 'invalid_method'; end if;
  select * into e from public.audit_engagements where id = p_engagement for update;
  if not found then raise exception 'audit not found' using errcode = '22023', hint = 'engagement_not_found'; end if;
  if e.status <> 'open' then raise exception 'audit is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;
  if e.counting_method = p_method then return; end if;
  update public.audit_engagements set counting_method = p_method where id = p_engagement;
  perform public.log_activity('audit.method_changed', 'audit_engagements', p_engagement::text,
    jsonb_build_object('method', e.counting_method), jsonb_build_object('method', p_method), null);
end $$;

-- Same as 0406 plus counting_method. An Individual Audit is always hybrid: the person picks their own items and may scan or type.
drop function public.audit_my_assignments();
create function public.audit_my_assignments()
returns table (assignment_id uuid, engagement_id uuid, engagement_name text, round_id uuid, round_number int, round_suffix text,
               round_state text, status text, method text, template_name text, items int, counted int, created_at timestamptz,
               counting_method text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.audit_require('audit.count');
  return query
    select a.id, a.engagement_id, e.name, a.round_id, r.round_number, r.round_suffix, r.state, a.status, a.method, a.template_name,
           (select count(*)::int from public.audit_assignment_items ai where ai.assignment_id = a.id),
           (select count(distinct ev.round_item_id)::int from public.audit_count_events ev where ev.assignment_id = a.id),
           a.created_at,
           case when e.scope_type = 'individual' then 'hybrid' else e.counting_method end
    from public.audit_assignments a
    join public.audit_rounds r on r.id = a.round_id
    join public.audit_engagements e on e.id = a.engagement_id
    where a.auditor_id = auth.uid() and a.status <> 'revoked'
    order by a.created_at desc, a.id
    limit 200;
end $$;

-- ───────── 9. grants ─────────
revoke all on table public.audit_barcodes, public.audit_barcode_log, public.audit_scan_events from public, anon, authenticated;
revoke all on function public.audit_barcode_clean(text), public.audit_barcode_note(text), public.audit_barcode_require(text)
  from public, anon, authenticated;
revoke all on function public.audit_barcode_products(text, int), public.audit_barcode_register(text, uuid, text, text),
  public.audit_barcode_verify(uuid), public.audit_barcode_change(uuid, uuid, text), public.audit_barcode_disable(uuid, text),
  public.audit_barcode_enable(uuid, text), public.audit_barcode_conflict_resolve(uuid, text, text),
  public.audit_barcode_list(text, text, int, int), public.audit_barcode_overview(),
  public.audit_barcode_mirror(timestamptz, uuid, int), public.audit_barcode_history(uuid, int), public.audit_scan_history(int, int),
  public.audit_scan_batch(jsonb), public.audit_engagement_set_method(uuid, text), public.audit_my_assignments()
  from public, anon, authenticated;
grant execute on function public.audit_barcode_products(text, int), public.audit_barcode_register(text, uuid, text, text),
  public.audit_barcode_verify(uuid), public.audit_barcode_change(uuid, uuid, text), public.audit_barcode_disable(uuid, text),
  public.audit_barcode_enable(uuid, text), public.audit_barcode_conflict_resolve(uuid, text, text),
  public.audit_barcode_list(text, text, int, int), public.audit_barcode_overview(),
  public.audit_barcode_mirror(timestamptz, uuid, int), public.audit_barcode_history(uuid, int), public.audit_scan_history(int, int),
  public.audit_scan_batch(jsonb), public.audit_engagement_set_method(uuid, text), public.audit_my_assignments()
  to authenticated;

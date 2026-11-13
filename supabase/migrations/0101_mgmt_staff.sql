-- 0101_mgmt_staff: Manager module (owner only). Permissions, shared helpers, Staff Registry, private details, notes.
-- See docs/modules/manager.md. All writes go through functions that check the permission, validate, log, and accept an
-- idempotency key. No role preset (junior / senior) receives any Manager permission (MGR-1): the owner holds them as admin
-- (with MFA) and may Allow a single key to a single person by hand.
-- Core `staff` is readable only by the person themselves, so Manager reads names through its own owner-gated functions (MGR-21).

-- ───────── permissions (designed so one capability can be shared at a time, MGR-18) ─────────
-- Existing and reserved in 0001: credit.view, mgmt.salary, mgmt.petty_cash.
insert into public.permissions (key, description) values
 ('mgmt.staff_view', 'See the staff registry: names, codes, designations, phone'),
 ('mgmt.staff_private', 'See and edit private staff details (father name, address, blood group)'),
 ('mgmt.staff_edit', 'Add and edit staff details'),
 ('mgmt.notes', 'Read, add and remove private staff notes'),
 ('mgmt.credit_manage', 'Add staff credit entries, reversals and deductions'),
 ('mgmt.openings', 'Set opening balances'),
 ('mgmt.salary_view', 'See salary, generic and payslip sheets (read only)'),
 ('mgmt.incentive', 'See and edit the incentive calculator'),
 ('mgmt.ledgers', 'See and edit the expense, Jazz Cash and misc ledgers'),
 ('mgmt.inbox_file', 'See the Credit Inbox and file lines into ledgers'),
 ('mgmt.close_month', 'Close a monthly manager sheet');

-- ───────── shared infrastructure for every Manager function ─────────
create table public.mgmt_save_keys (
  key uuid primary key,
  user_id uuid not null,
  action text not null,
  result jsonb not null,
  at timestamptz not null default now()
);
alter table public.mgmt_save_keys enable row level security;
-- no policy: service role only (a retried save is answered from here)

-- Used by Manager functions only (they run as the table owner); nobody else may call these.
create function public.mgmt_idem_get(p_key uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.mgmt_save_keys;
begin
  if p_key is null then raise exception 'idempotency key required'; end if;
  select * into c from public.mgmt_save_keys where key = p_key;
  if not found then return null; end if;
  if c.user_id is distinct from auth.uid() or c.action <> p_action then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return c.result;
end $$;

create function public.mgmt_idem_put(p_key uuid, p_action text, p_result jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.mgmt_save_keys (key, user_id, action, result) values (p_key, auth.uid(), p_action, p_result)
$$;

-- Trigger for tables whose rows may never change (ledger rows, openings). Refuses even the database owner.
create function public.mgmt_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only: add a reversal or a new row instead', tg_table_name; end $$;

-- ───────── staff registry ─────────
create sequence public.mgmt_staff_code_seq;

create table public.mgmt_staff_details (
  staff_id uuid primary key references public.staff(id) on delete restrict,
  staff_code text not null unique check (staff_code ~ '^[A-Z0-9-]{2,16}$'),
  designation text check (designation is null or length(trim(designation)) between 1 and 60),
  sort_order int not null default 999 check (sort_order between 1 and 999),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger mgmt_staff_details_updated before update on public.mgmt_staff_details
  for each row execute function public.set_updated_at();
alter table public.mgmt_staff_details enable row level security;

-- Personal data lives in its own table with its own permission. The national ID number is never stored (MGR-7).
create table public.mgmt_staff_private (
  staff_id uuid primary key references public.staff(id) on delete restrict,
  father_name text check (father_name is null or length(trim(father_name)) between 1 and 80),
  address text check (address is null or length(trim(address)) between 1 and 200),
  blood_group text check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create trigger mgmt_staff_private_updated before update on public.mgmt_staff_private
  for each row execute function public.set_updated_at();
alter table public.mgmt_staff_private enable row level security;

create table public.mgmt_staff_notes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  delete_reason text check (delete_reason is null or length(delete_reason) <= 200)
);
create index mgmt_staff_notes_staff on public.mgmt_staff_notes (staff_id, created_at desc);
alter table public.mgmt_staff_notes enable row level security;

-- A note's text can never change and a note is never deleted; "removing" only stamps deleted_at.
create function public.mgmt_notes_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'notes cannot be deleted'; end if;
  if new.id is distinct from old.id or new.staff_id is distinct from old.staff_id or new.body is distinct from old.body
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or old.deleted_at is not null then
    raise exception 'a note cannot be changed';
  end if;
  return new;
end $$;
create trigger mgmt_staff_notes_guard before update or delete on public.mgmt_staff_notes
  for each row execute function public.mgmt_notes_guard();

-- ───────── read policies (wrapped form: checked once per query, not once per row) ─────────
create policy mgmt_staff_details_read on public.mgmt_staff_details for select to authenticated
  using ((select public.has_perm('mgmt.staff_view') or public.has_perm('mgmt.staff_edit')));
create policy mgmt_staff_private_read on public.mgmt_staff_private for select to authenticated
  using ((select public.has_perm('mgmt.staff_private')));
create policy mgmt_staff_notes_read on public.mgmt_staff_notes for select to authenticated
  using ((select public.has_perm('mgmt.notes')));
grant select on public.mgmt_staff_details, public.mgmt_staff_private, public.mgmt_staff_notes to authenticated;
-- no insert / update / delete policy and no write grant: every write is one of the functions below

-- ───────── reads that need core staff (names) ─────────
create function public.mgmt_staff_list()
returns table (staff_id uuid, full_name text, phone text, joined_on date, active boolean,
               staff_code text, designation text, sort_order int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.has_perm('mgmt.staff_view') or public.has_perm('mgmt.staff_edit')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select s.id, s.full_name, s.phone, s.joined_on, s.active, d.staff_code, d.designation, coalesce(d.sort_order, 999)
    from public.staff s left join public.mgmt_staff_details d on d.staff_id = s.id
    order by coalesce(d.sort_order, 999), s.full_name, s.id;
end $$;

create function public.mgmt_staff_get(p_staff_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare see_private boolean; r jsonb;
begin
  if not (public.has_perm('mgmt.staff_view') or public.has_perm('mgmt.staff_edit')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  see_private := public.has_perm('mgmt.staff_private');
  select jsonb_build_object(
      'staff_id', s.id, 'full_name', s.full_name, 'phone', s.phone, 'joined_on', s.joined_on, 'active', s.active,
      'staff_code', d.staff_code, 'designation', d.designation, 'sort_order', coalesce(d.sort_order, 999),
      'private_visible', see_private,
      'private', case when see_private then jsonb_build_object(
          'father_name', p.father_name, 'address', p.address, 'blood_group', p.blood_group) else null end)
    into r
  from public.staff s
  left join public.mgmt_staff_details d on d.staff_id = s.id
  left join public.mgmt_staff_private p on p.staff_id = s.id
  where s.id = p_staff_id;
  if r is null then raise exception 'unknown staff member'; end if;
  return r;
end $$;

-- ───────── save a person (new or existing) ─────────
-- p_staff_id null = new person. p_private null = leave private details unchanged (needs mgmt.staff_private to send them).
-- A person is never deleted: set p_active false. "Active" here means "on the payroll list"; it does not disable a login (MGR-20).
create function public.mgmt_staff_save(
  p_staff_id uuid, p_full_name text, p_phone text, p_joined_on date, p_active boolean,
  p_designation text, p_staff_code text, p_sort_order int, p_private jsonb, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb;
  v_id uuid := p_staff_id;
  v_name text := trim(p_full_name);
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_desig text := nullif(trim(coalesce(p_designation, '')), '');
  v_code text := nullif(upper(trim(coalesce(p_staff_code, ''))), '');
  v_sort int := coalesce(p_sort_order, 999);
  old_s public.staff; old_d public.mgmt_staff_details; old_p public.mgmt_staff_private;
  v_before jsonb; v_after jsonb; res jsonb; n int := 0; priv_changed boolean := false;
begin
  if not public.has_perm('mgmt.staff_edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'staff_save');
  if cached is not null then return cached; end if;

  if v_name is null or length(v_name) not between 2 and 80 then raise exception 'name must be 2 to 80 characters'; end if;
  if v_phone is not null and v_phone !~ '^[0-9+() -]{5,20}$' then raise exception 'phone number looks wrong'; end if;
  if p_joined_on is not null and (p_joined_on > today or p_joined_on < date '1980-01-01') then raise exception 'joining date looks wrong'; end if;
  if p_active is null then raise exception 'active must be yes or no'; end if;
  if v_desig is not null and length(v_desig) > 60 then raise exception 'designation is too long'; end if;
  if v_sort not between 1 and 999 then raise exception 'order must be 1 to 999'; end if;
  if v_code is not null and v_code !~ '^[A-Z0-9-]{2,16}$' then raise exception 'staff code must be 2 to 16 letters, digits or dashes'; end if;
  if p_private is not null then
    if not public.has_perm('mgmt.staff_private') then raise exception 'not allowed' using errcode = '42501'; end if;
    if jsonb_typeof(p_private) <> 'object' then raise exception 'private details must be an object'; end if;
    if length(coalesce(p_private ->> 'father_name', '')) > 80 then raise exception 'father name is too long'; end if;
    if length(coalesce(p_private ->> 'address', '')) > 200 then raise exception 'address is too long'; end if;
    if nullif(trim(coalesce(p_private ->> 'blood_group', '')), '') is not null
       and trim(p_private ->> 'blood_group') not in ('A+','A-','B+','B-','AB+','AB-','O+','O-') then
      raise exception 'blood group must be like O+ or AB-';
    end if;
  end if;

  begin
    if v_id is null then
      insert into public.staff (full_name, phone, joined_on, active) values (v_name, v_phone, p_joined_on, p_active)
        returning id into v_id;
      if v_code is null then
        loop
          n := n + 1;
          v_code := 'EMP-' || lpad(nextval('public.mgmt_staff_code_seq')::text, 3, '0');
          exit when not exists (select 1 from public.mgmt_staff_details where staff_code = v_code) or n > 200;
        end loop;
      end if;
      insert into public.mgmt_staff_details (staff_id, staff_code, designation, sort_order, updated_by)
        values (v_id, v_code, v_desig, v_sort, auth.uid());
      v_before := null;
    else
      select * into old_s from public.staff where id = v_id for update;
      if not found then raise exception 'unknown staff member'; end if;
      select * into old_d from public.mgmt_staff_details where staff_id = v_id;
      v_before := jsonb_build_object('full_name', old_s.full_name, 'active', old_s.active, 'joined_on', old_s.joined_on,
        'staff_code', old_d.staff_code, 'designation', old_d.designation, 'sort_order', old_d.sort_order);
      update public.staff set full_name = v_name, phone = v_phone, joined_on = p_joined_on, active = p_active where id = v_id;
      if old_d.staff_id is null then
        if v_code is null then
          loop
            n := n + 1;
            v_code := 'EMP-' || lpad(nextval('public.mgmt_staff_code_seq')::text, 3, '0');
            exit when not exists (select 1 from public.mgmt_staff_details where staff_code = v_code) or n > 200;
          end loop;
        end if;
        insert into public.mgmt_staff_details (staff_id, staff_code, designation, sort_order, updated_by)
          values (v_id, v_code, v_desig, v_sort, auth.uid());
      else
        update public.mgmt_staff_details
          set staff_code = coalesce(v_code, old_d.staff_code), designation = v_desig, sort_order = v_sort, updated_by = auth.uid()
          where staff_id = v_id;
      end if;
    end if;
  exception when unique_violation then
    raise exception 'that staff code is already used';
  end;

  if p_private is not null then
    select * into old_p from public.mgmt_staff_private where staff_id = v_id;
    insert into public.mgmt_staff_private (staff_id, father_name, address, blood_group, updated_by)
      values (v_id, nullif(trim(coalesce(p_private ->> 'father_name', '')), ''),
              nullif(trim(coalesce(p_private ->> 'address', '')), ''),
              nullif(trim(coalesce(p_private ->> 'blood_group', '')), ''), auth.uid())
    on conflict (staff_id) do update set father_name = excluded.father_name, address = excluded.address,
      blood_group = excluded.blood_group, updated_by = excluded.updated_by;
    priv_changed := true;
  end if;

  select jsonb_build_object('full_name', s.full_name, 'active', s.active, 'joined_on', s.joined_on,
      'staff_code', d.staff_code, 'designation', d.designation, 'sort_order', d.sort_order)
    into v_after from public.staff s join public.mgmt_staff_details d on d.staff_id = s.id where s.id = v_id;
  -- Phone and private values are never copied into the activity log; only the fact that they changed.
  perform public.log_activity(case when p_staff_id is null then 'mgmt.staff_created' else 'mgmt.staff_saved' end,
    'staff', v_id::text, v_before,
    v_after || jsonb_build_object('private_changed', priv_changed, 'phone_changed',
      p_staff_id is null and v_phone is not null or (old_s.id is not null and old_s.phone is distinct from v_phone)), null);

  res := jsonb_build_object('staff_id', v_id, 'staff_code', (v_after ->> 'staff_code'));
  perform public.mgmt_idem_put(p_key, 'staff_save', res);
  return res;
end $$;

-- ───────── notes ─────────
create function public.mgmt_note_add(p_staff_id uuid, p_body text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; v_body text := trim(coalesce(p_body, '')); v_id uuid; v_at timestamptz; res jsonb;
begin
  if not public.has_perm('mgmt.notes') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'note_add');
  if cached is not null then return cached; end if;
  if length(v_body) not between 1 and 2000 then raise exception 'a note must be 1 to 2000 characters'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id) then raise exception 'unknown staff member'; end if;
  insert into public.mgmt_staff_notes (staff_id, body, created_by) values (p_staff_id, v_body, auth.uid())
    returning id, created_at into v_id, v_at;
  perform public.log_activity('mgmt.note_added', 'mgmt_staff_notes', v_id::text, null,
    jsonb_build_object('staff_id', p_staff_id), null); -- the text of a note is never logged
  res := jsonb_build_object('id', v_id, 'created_at', v_at);
  perform public.mgmt_idem_put(p_key, 'note_add', res);
  return res;
end $$;

create function public.mgmt_note_remove(p_note_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare n public.mgmt_staff_notes; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_perm('mgmt.notes') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;
  select * into n from public.mgmt_staff_notes where id = p_note_id for update;
  if not found then raise exception 'unknown note'; end if;
  if n.deleted_at is not null then return; end if; -- already removed: a retry is harmless
  update public.mgmt_staff_notes set deleted_at = now(), deleted_by = auth.uid(), delete_reason = v_reason where id = p_note_id;
  perform public.log_activity('mgmt.note_removed', 'mgmt_staff_notes', p_note_id::text, null,
    jsonb_build_object('staff_id', n.staff_id), v_reason);
end $$;

-- ───────── grants ─────────
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_idem_get(uuid, text), public.mgmt_idem_put(uuid, text, jsonb),
  public.mgmt_staff_list(), public.mgmt_staff_get(uuid),
  public.mgmt_staff_save(uuid, text, text, date, boolean, text, text, int, jsonb, uuid),
  public.mgmt_note_add(uuid, text, uuid), public.mgmt_note_remove(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mgmt_staff_list(), public.mgmt_staff_get(uuid),
  public.mgmt_staff_save(uuid, text, text, date, boolean, text, text, int, jsonb, uuid),
  public.mgmt_note_add(uuid, text, uuid), public.mgmt_note_remove(uuid, text) to authenticated;

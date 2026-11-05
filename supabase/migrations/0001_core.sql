-- 0001_core: identity, permissions, settings, audit log.
-- Rules: RLS on every table, default deny, no anon access, explicit grants only.

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ───────── people ─────────
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 80),
  phone text,
  joined_on date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger staff_updated before update on public.staff
  for each row execute function public.set_updated_at();

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  username text not null unique check (username ~ '^[a-z][a-z0-9._-]{2,23}$'),
  role_template text not null check (role_template in ('admin','senior','junior')),
  disabled_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────── permissions ─────────
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);
create table public.role_permissions (
  role text not null check (role in ('senior','junior')),
  perm_key text not null references public.permissions(key) on delete cascade,
  primary key (role, perm_key)
);
create table public.user_permissions (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  perm_key text not null references public.permissions(key) on delete cascade,
  effect text not null check (effect in ('grant','deny')),
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now(),
  primary key (user_id, perm_key)
);

-- ───────── access requests / setup codes / login attempts (service role only) ─────────
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 80),
  username text not null check (username ~ '^[a-z][a-z0-9._-]{2,23}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  ip_hash text,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz
);
create unique index access_requests_one_pending on public.access_requests (username) where status = 'pending';

create table public.setup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  code_hash text not null,
  salt text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index setup_codes_user on public.setup_codes (user_id) where used_at is null;

create table public.login_attempts (
  id bigserial primary key,
  username text,
  ip_hash text,
  success boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_user_at on public.login_attempts (username, at desc);
create index login_attempts_ip_at on public.login_attempts (ip_hash, at desc);

-- ───────── settings ─────────
create table public.settings (
  key text primary key,
  value jsonb not null,
  staff_visible boolean not null default false,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table public.settings_history (
  id bigserial primary key,
  key text not null,
  version int not null,
  value jsonb not null,
  reason text,
  changed_by uuid references auth.users(id),
  at timestamptz not null default now()
);

-- ───────── activity log (append-only) ─────────
create table public.activity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  action text not null,
  entity text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text
);
create index activity_log_at on public.activity_log (at desc);
create or replace function public.activity_log_immutable() returns trigger
language plpgsql as $$ begin raise exception 'activity_log is append-only'; end $$;
create trigger activity_log_no_change before update or delete on public.activity_log
  for each row execute function public.activity_log_immutable();

-- ───────── permission check ─────────
-- Admins must be at MFA level aal2 to hold any permission (enforced here, not in the UI).
create or replace function public.has_perm(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
    where pr.user_id = auth.uid()
      and pr.disabled_at is null
      and (pr.expires_at is null or pr.expires_at > now())
      and (
        (pr.role_template = 'admin' and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
        or (
          pr.role_template <> 'admin'
          and (
            exists (select 1 from public.role_permissions rp
                    where rp.role = pr.role_template and rp.perm_key = p_key)
            or exists (select 1 from public.user_permissions up
                    where up.user_id = pr.user_id and up.perm_key = p_key and up.effect = 'grant')
          )
          and not exists (select 1 from public.user_permissions up
                    where up.user_id = pr.user_id and up.perm_key = p_key and up.effect = 'deny')
        )
      )
  )
$$;

-- Internal only: other security-definer functions and the service role call this.
create or replace function public.log_activity(p_action text, p_entity text, p_entity_id text,
  p_old jsonb, p_new jsonb, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log(user_id, action, entity, entity_id, old_value, new_value, reason)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_old, p_new, p_reason)
$$;

-- What the app needs after login: who am I, what may I do, which modules are off.
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.profiles; s public.staff; mfa_ok boolean; perms jsonb;
begin
  select * into pr from public.profiles where user_id = auth.uid();
  if not found or pr.disabled_at is not null or (pr.expires_at is not null and pr.expires_at <= now()) then
    return null;
  end if;
  select * into s from public.staff where id = pr.staff_id;
  mfa_ok := pr.role_template <> 'admin' or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
  perms := case when mfa_ok then
    (select coalesce(jsonb_agg(p.key order by p.key), '[]'::jsonb) from public.permissions p where public.has_perm(p.key))
    else '[]'::jsonb end;
  return jsonb_build_object(
    'user_id', pr.user_id, 'username', pr.username, 'full_name', s.full_name,
    'role', pr.role_template, 'mfa_ok', mfa_ok, 'permissions', perms,
    'modules_disabled', coalesce((select value from public.settings where key = 'modules_disabled'), '[]'::jsonb));
end $$;

create or replace function public.settings_set(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old_row public.settings; new_version int;
begin
  if not public.has_perm('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'reason required'; end if;
  select * into old_row from public.settings where key = p_key for update;
  if not found then raise exception 'unknown setting %', p_key; end if;
  new_version := old_row.version + 1;
  update public.settings set value = p_value, version = new_version, updated_at = now(), updated_by = auth.uid()
    where key = p_key;
  insert into public.settings_history(key, version, value, reason, changed_by)
    values (p_key, new_version, p_value, p_reason, auth.uid());
  perform public.log_activity('settings.set', 'settings', p_key, old_row.value, p_value, p_reason);
end $$;

-- Admin changes go through these functions so every change is logged with who/what/old/new.
create or replace function public.set_user_permission(p_user uuid, p_key text, p_effect text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare old_effect text; tgt_role text;
begin
  if not public.has_perm('users.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  select role_template into tgt_role from public.profiles where user_id = p_user;
  if tgt_role is null then raise exception 'unknown user'; end if;
  if tgt_role = 'admin' then raise exception 'admin permissions are fixed'; end if;
  if p_effect is not null and p_effect not in ('grant','deny') then raise exception 'bad effect'; end if;
  if not exists (select 1 from public.permissions where key = p_key) then raise exception 'unknown permission'; end if;
  select effect into old_effect from public.user_permissions where user_id = p_user and perm_key = p_key;
  if p_effect is null then
    delete from public.user_permissions where user_id = p_user and perm_key = p_key;
  else
    insert into public.user_permissions(user_id, perm_key, effect, set_by) values (p_user, p_key, p_effect, auth.uid())
    on conflict (user_id, perm_key) do update set effect = excluded.effect, set_by = auth.uid(), set_at = now();
  end if;
  perform public.log_activity('permission.set', 'profile', p_user::text,
    jsonb_build_object('key', p_key, 'effect', old_effect), jsonb_build_object('key', p_key, 'effect', p_effect), p_reason);
end $$;

create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare old_role text;
begin
  if not public.has_perm('users.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role not in ('senior','junior') then raise exception 'bad role'; end if;
  select role_template into old_role from public.profiles where user_id = p_user;
  if old_role is null then raise exception 'unknown user'; end if;
  if old_role = 'admin' then raise exception 'admin role is fixed'; end if;
  update public.profiles set role_template = p_role where user_id = p_user;
  perform public.log_activity('role.set', 'profile', p_user::text, to_jsonb(old_role), to_jsonb(p_role), null);
end $$;

-- Run once from the SQL editor after creating the first auth user. Not callable from the app.
create or replace function public.bootstrap_first_admin(p_user_id uuid, p_username text, p_full_name text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if exists (select 1 from public.profiles where role_template = 'admin') then
    raise exception 'an admin already exists';
  end if;
  insert into public.staff(full_name) values (p_full_name) returning id into sid;
  insert into public.profiles(user_id, staff_id, username, role_template) values (p_user_id, sid, p_username, 'admin');
end $$;

-- ───────── RLS ─────────
alter table public.staff enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.access_requests enable row level security;
alter table public.setup_codes enable row level security;
alter table public.login_attempts enable row level security;
alter table public.settings enable row level security;
alter table public.settings_history enable row level security;
alter table public.activity_log enable row level security;

create policy staff_self_read on public.staff for select to authenticated
  using (id in (select staff_id from public.profiles where user_id = auth.uid()) or public.has_perm('users.manage'));

create policy profiles_self_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.has_perm('users.manage'));

create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

create policy user_permissions_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_perm('users.manage'));

create policy access_requests_admin_read on public.access_requests for select to authenticated
  using (public.has_perm('users.manage'));
-- setup_codes, login_attempts: no policies = service role only.

create policy settings_read on public.settings for select to authenticated
  using (staff_visible or public.has_perm('settings.manage'));
create policy settings_history_read on public.settings_history for select to authenticated
  using (public.has_perm('settings.manage'));
create policy activity_read on public.activity_log for select to authenticated
  using (public.has_perm('activity.view'));

-- ───────── grants (explicit, minimal) ─────────
grant usage on schema public to authenticated, service_role;
grant select on public.staff, public.profiles, public.permissions, public.role_permissions,
  public.user_permissions, public.access_requests, public.settings, public.settings_history,
  public.activity_log to authenticated;
-- No direct writes for authenticated users: changes go through logged functions or Edge Functions.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.has_perm(text), public.my_context(), public.settings_set(text, jsonb, text),
  public.log_activity(text, text, text, jsonb, jsonb, text),
  public.bootstrap_first_admin(uuid, text, text),
  public.set_user_permission(uuid, text, text, text), public.set_user_role(uuid, text) from public, anon, authenticated;
grant execute on function public.has_perm(text), public.my_context(), public.settings_set(text, jsonb, text),
  public.set_user_permission(uuid, text, text, text), public.set_user_role(uuid, text) to authenticated;
grant execute on function public.has_perm(text), public.log_activity(text, text, text, jsonb, jsonb, text) to service_role;

-- ───────── seed (reference data only, no people) ─────────
insert into public.permissions(key, description) values
 ('sales.view_last_day','See the most recent closed day total'),
 ('sales.view_history','See sales history'),
 ('sales.enter','Enter daily sales'),
 ('sales.edit','Correct daily sales'),
 ('targets.manage','Manage sales targets'),
 ('closing.enter_own','Enter own shift closing'),
 ('closing.view_all','View all closings'),
 ('closing.review','Review closings'),
 ('closing.correct','Correct a submitted closing'),
 ('closing.settings','Change closing settings'),
 ('audit.count','Count assigned audit items'),
 ('audit.manage','Create and assign audits'),
 ('audit.review','Review audit variances'),
 ('inventory.search','Search inventory'),
 ('inventory.view_cost','See cost prices'),
 ('str.create','Create stock transfer requests'),
 ('str.approve','Approve stock transfer requests'),
 ('credit.view','See credit balances'),
 ('mgmt.salary','See and edit salaries'),
 ('mgmt.petty_cash','Petty cash'),
 ('reports.view','View reports'),
 ('users.manage','Manage users, roles and permissions'),
 ('settings.manage','Change settings'),
 ('activity.view','View activity log'),
 ('backup.run','Run backups');

insert into public.role_permissions(role, perm_key)
select r, k from unnest(array['junior','senior']) r,
  unnest(array['closing.enter_own','audit.count','inventory.search','sales.view_last_day','str.create']) k;

insert into public.settings(key, value, staff_visible) values
 ('till_float', '45000', false),
 ('per_customer_charge', '1', false),
 ('business_timezone', '"Asia/Karachi"', true),
 ('modules_disabled', '[]', true);

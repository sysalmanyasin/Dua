-- 0700_ops_rules: Operations Dashboard foundation (range 0700-0749, prefix ops_).
-- Business rules that decide which issues reach the Owner's Action Centre, and which activity categories the Recent Activity
-- list shows. Rules are plain data the Owner edits; nothing here is decided by AI. Only the Owner (admin at the second
-- factor) holds these permissions; the tables are reachable only through the functions below.

insert into public.permissions (key, description) values
  ('ops.view', 'Open the Owner Operations Dashboard sections: Action Centre and Recent Activity (owner only; admins hold every permission, nobody else is granted it)'),
  ('ops.manage_rules', 'Change the Operations alert rules and which activity categories show (owner only; admins hold every permission, nobody else is granted it)')
on conflict (key) do nothing;

create table public.ops_rules (
  rule_key   text primary key check (rule_key ~ '^[a-z_]{3,40}$'),
  title      text not null check (length(trim(title)) between 3 and 80),
  category   text not null check (category in ('closing', 'sales', 'inventory', 'cash', 'system')),
  severity   text not null check (severity in ('info', 'warning', 'critical')),
  enabled    boolean not null default true,
  params     jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
alter table public.ops_rules enable row level security;
revoke all on table public.ops_rules from anon, authenticated;

create table public.ops_activity_categories (
  category_key text primary key check (category_key ~ '^[a-z_]{3,40}$'),
  title        text not null check (length(trim(title)) between 3 and 60),
  enabled      boolean not null default true,
  sort         integer not null default 100,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id)
);
alter table public.ops_activity_categories enable row level security;
revoke all on table public.ops_activity_categories from anon, authenticated;

-- Defaults (owner, 21 Nov 2026). The deposit rule starts OFF: on the live data the Closing deposit rows do not equal the
-- day's cash sale, so switching it on would raise a false alert every day until the owner decides what "matching" means.
insert into public.ops_rules (rule_key, title, category, severity, enabled, params) values
  ('closing_draft_open', 'A closing draft was left open', 'closing', 'warning', true, '{"hours": 12}'),
  ('sales_missing', 'Daily sales not entered', 'sales', 'warning', true, '{"days": 3, "critical_days": 3}'),
  ('stock_reorder', 'Products are running low on cover', 'inventory', 'info', true, '{"min_count": 1}'),
  ('notify_failures', 'Owner alerts are not being delivered', 'system', 'critical', true, '{}'),
  ('deposit_vs_cash', 'Bank deposit does not match the day''s cash sale', 'cash', 'warning', false, '{"days": 1, "tolerance": 5000}');

insert into public.ops_activity_categories (category_key, title, enabled, sort) values
  ('closing_drafts', 'Closing drafts', true, 10),
  ('closing_done', 'Closing completed', true, 20);

-- Allowed parameters per rule: unknown names and out-of-range values are refused so a typo cannot silently disable a rule.
create or replace function public.ops_params_ok(p_key text, p_params jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare k text; v numeric;
begin
  if jsonb_typeof(p_params) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p_params) loop
    if jsonb_typeof(p_params -> k) <> 'number' then return false; end if;
    v := (p_params ->> k)::numeric;
    if not (
      (p_key = 'closing_draft_open' and k = 'hours' and v between 1 and 168 and v = trunc(v)) or
      (p_key = 'sales_missing' and k in ('days', 'critical_days') and v between 1 and 7 and v = trunc(v)) or
      (p_key = 'stock_reorder' and k = 'min_count' and v between 1 and 100000 and v = trunc(v)) or
      (p_key = 'deposit_vs_cash' and k = 'days' and v between 1 and 7 and v = trunc(v)) or
      (p_key = 'deposit_vs_cash' and k = 'tolerance' and v between 0 and 100000000)
    ) then return false; end if;
  end loop;
  return true;
end $$;

-- The rules and categories as the Owner sees them (null for anyone without ops.view).
create or replace function public.ops_rules_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('ops.view') then return null; end if;
  return jsonb_build_object(
    'rules', coalesce((select jsonb_agg(jsonb_build_object('rule_key', r.rule_key, 'title', r.title, 'category', r.category,
        'severity', r.severity, 'enabled', r.enabled, 'params', r.params, 'updated_at', r.updated_at) order by r.category, r.rule_key)
        from public.ops_rules r), '[]'::jsonb),
    'activity_categories', coalesce((select jsonb_agg(jsonb_build_object('category_key', c.category_key, 'title', c.title,
        'enabled', c.enabled) order by c.sort, c.category_key) from public.ops_activity_categories c), '[]'::jsonb));
end $$;

-- Change one rule. Owner only; every change is written to the audit log with the old and new values.
create or replace function public.ops_rule_set(p_key text, p_enabled boolean, p_severity text, p_params jsonb, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare old public.ops_rules;
begin
  if not public.has_perm('ops.manage_rules') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into old from public.ops_rules where rule_key = p_key for update;
  if not found then raise exception 'unknown rule' using errcode = '22023'; end if;
  if p_severity is not null and p_severity not in ('info', 'warning', 'critical') then
    raise exception 'severity must be info, warning or critical' using errcode = '22023';
  end if;
  if p_params is not null and not public.ops_params_ok(p_key, p_params) then
    raise exception 'invalid rule settings' using errcode = '22023';
  end if;
  update public.ops_rules set enabled = coalesce(p_enabled, enabled), severity = coalesce(p_severity, severity),
         params = coalesce(p_params, params), updated_at = now(), updated_by = auth.uid()
   where rule_key = p_key;
  perform public.log_activity('ops.rule_changed', 'ops_rules', p_key,
    jsonb_build_object('enabled', old.enabled, 'severity', old.severity, 'params', old.params),
    (select jsonb_build_object('enabled', enabled, 'severity', severity, 'params', params) from public.ops_rules where rule_key = p_key),
    nullif(left(trim(coalesce(p_reason, '')), 200), ''));
end $$;

create or replace function public.ops_activity_category_set(p_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare was boolean;
begin
  if not public.has_perm('ops.manage_rules') then raise exception 'not allowed' using errcode = '42501'; end if;
  select enabled into was from public.ops_activity_categories where category_key = p_key for update;
  if not found then raise exception 'unknown category' using errcode = '22023'; end if;
  if p_enabled is null then raise exception 'enabled must be true or false' using errcode = '22023'; end if;
  update public.ops_activity_categories set enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where category_key = p_key;
  perform public.log_activity('ops.activity_category_changed', 'ops_activity_categories', p_key,
    jsonb_build_object('enabled', was), jsonb_build_object('enabled', p_enabled), null);
end $$;

revoke all on function public.ops_params_ok(text, jsonb), public.ops_rules_list(), public.ops_rule_set(text, boolean, text, jsonb, text),
  public.ops_activity_category_set(text, boolean) from public, anon, authenticated;
grant execute on function public.ops_rules_list(), public.ops_rule_set(text, boolean, text, jsonb, text),
  public.ops_activity_category_set(text, boolean) to authenticated;

-- 1401_app_devices: the Dua Android app's side of the database (range 1400-1499, prefix app_; reserved in docs/MODULES.md §5.1).
-- Three things live here:
--   1. app_devices        one row per phone install: its push (FCM) address and, optionally, a secret for the home-screen widget.
--   2. app_push_rules     which people receive which alerts. Table-driven, so recipients change without a new APK.
--   3. app_widget_today   the one number the Today's Sale widget shows, read with the device secret (not with the web login).
--
-- Why the widget has its own secret instead of the web login: Supabase rotates refresh tokens, so a widget that renewed the web
-- app's token would sign the person out of the app. The secret is random, shown to the app ONCE, stored here only as a SHA-256
-- hash, revoked at sign-out, and checked against the person's CURRENT permissions on every read (a revoked person gets nothing).
--
-- Push goes through Firebase Cloud Messaging (free, no message limit). It replaces ntfy: the sender is the Edge Function notify-push.
-- Alerts still come from public.notifications (notify_owner), so no module changes. See docs/ANDROID_ARCHITECTURE.md.

-- ───────── does this person hold this key? (internal; has_perm works only for the signed-in caller) ─────────
-- Same rule as has_perm. An admin counts as holding every key: the owner passed MFA when the device was registered, and a push or
-- a widget read has no MFA session to check.
create function public.app_user_has(p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = p_user and p.disabled_at is null and (p.expires_at is null or p.expires_at > now())
       and (p.role_template = 'admin'
            or ((exists (select 1 from public.role_permissions rp where rp.role = p.role_template and rp.perm_key = p_key)
                 or exists (select 1 from public.user_permissions up where up.user_id = p.user_id and up.perm_key = p_key and up.effect = 'grant'))
                and not exists (select 1 from public.user_permissions up where up.user_id = p.user_id and up.perm_key = p_key and up.effect = 'deny'))))
$$;

-- ───────── devices ─────────
create table public.app_devices (
  id uuid primary key,                      -- made by the app on first start; identifies the install, is not a secret
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android' check (platform = 'android'),
  app_version text check (app_version is null or length(app_version) <= 40),
  fcm_token text check (fcm_token is null or length(fcm_token) between 20 and 4096),
  widget_secret_hash text check (widget_secret_hash is null or widget_secret_hash ~ '^[0-9a-f]{64}$'),
  push_disabled_at timestamptz,
  push_disabled_reason text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index app_devices_token_uidx on public.app_devices (fcm_token) where fcm_token is not null;
create index app_devices_user_idx on public.app_devices (user_id);
alter table public.app_devices enable row level security;
revoke all on public.app_devices from public, anon, authenticated;
-- No policy and no grant: phones use the functions below; the sender uses the service role.

-- Called by the web app inside the Android shell, after sign-in and whenever Firebase issues a new push address.
-- p_want_widget = true also creates the widget secret (returned ONCE) and needs a Candela permission.
create function public.app_device_register(p_device_id uuid, p_fcm_token text, p_app_version text, p_want_widget boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_hash text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles
       where user_id = auth.uid() and disabled_at is null and (expires_at is null or expires_at > now())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_device_id is null then raise exception 'invalid device' using errcode = '22023'; end if;
  if p_want_widget then
    if not (public.has_perm('candela.today_total') or public.has_perm('candela.view')) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hash := encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
  end if;
  -- a push address belongs to one install: if it moved here (reinstall), drop it from the old row
  if p_fcm_token is not null then delete from public.app_devices where fcm_token = p_fcm_token and id <> p_device_id; end if;

  insert into public.app_devices (id, user_id, app_version, fcm_token, widget_secret_hash)
  values (p_device_id, auth.uid(), left(p_app_version, 40), p_fcm_token, v_hash)
  on conflict (id) do update set
    user_id = auth.uid(),
    app_version = left(p_app_version, 40),
    fcm_token = coalesce(excluded.fcm_token, app_devices.fcm_token),
    push_disabled_at = case when excluded.fcm_token is not null then null else app_devices.push_disabled_at end,
    push_disabled_reason = case when excluded.fcm_token is not null then null else app_devices.push_disabled_reason end,
    -- another person signing in on the same phone never inherits the previous person's widget
    widget_secret_hash = case when app_devices.user_id <> auth.uid() then excluded.widget_secret_hash
                              else coalesce(excluded.widget_secret_hash, app_devices.widget_secret_hash) end,
    last_seen_at = now();
  return jsonb_build_object('widget_secret', v_secret);
end $$;

-- Sign-out: this phone stops receiving this person's alerts and the widget stops working.
create function public.app_device_unregister(p_device_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.app_devices where id = p_device_id and user_id = auth.uid()
$$;

-- The person no longer has the Candela permission: switch the widget off (the secret stops working at once).
create function public.app_widget_clear(p_device_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.app_devices set widget_secret_hash = null where id = p_device_id and user_id = auth.uid()
$$;

-- ───────── who receives which alert ─────────
create table public.app_push_rules (
  id uuid primary key default gen_random_uuid(),
  kind_like text not null check (kind_like ~ '^[a-z0-9_.%]{1,60}$'),   -- an alert kind, with % as the only wildcard
  perm_key text not null references public.permissions(key) on delete cascade,
  enabled boolean not null default true,
  note text check (note is null or length(note) <= 200),
  updated_at timestamptz not null default now(),
  unique (kind_like, perm_key)
);
alter table public.app_push_rules enable row level security;
revoke all on public.app_push_rules from public, anon, authenticated;
-- An alert goes to every person who holds ANY enabled matching rule's permission (and has the app signed in).
insert into public.app_push_rules (kind_like, perm_key, note) values
  ('%', 'notifications.view', 'Every owner alert goes to the owner (and to anyone the owner allows notifications.view)');

create function public.app_push_rules_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind_like', kind_like, 'perm_key', perm_key, 'enabled', enabled, 'note', note)
                                    order by kind_like, perm_key) from public.app_push_rules), '[]'::jsonb);
end $$;

-- Add or switch a rule. Example: send every closing alert to people who hold closing.review:  ('closing.%', 'closing.review', true).
create function public.app_push_rule_set(p_kind_like text, p_perm_key text, p_enabled boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.permissions where key = p_perm_key) then raise exception 'unknown permission' using errcode = '22023'; end if;
  insert into public.app_push_rules (kind_like, perm_key, enabled) values (p_kind_like, p_perm_key, coalesce(p_enabled, true))
  on conflict (kind_like, perm_key) do update set enabled = excluded.enabled, updated_at = now();
  perform public.log_activity('app.push_rule_set', 'app_push_rules', p_kind_like || ' → ' || p_perm_key, null,
                              jsonb_build_object('enabled', coalesce(p_enabled, true)), trim(p_reason));
end $$;

-- ───────── sender support (service role only; used by the notify-push Edge Function) ─────────
create function public.app_push_tokens_for(p_kind text) returns table (device_id uuid, fcm_token text)
language sql stable security definer set search_path = public as $$
  select distinct d.id, d.fcm_token
    from public.app_devices d
   where d.fcm_token is not null and d.push_disabled_at is null
     and exists (
       select 1 from public.app_push_rules r
        where r.enabled and p_kind like replace(r.kind_like, '_', '\_')
          and public.app_user_has(d.user_id, r.perm_key))
$$;

-- A push address Firebase says no longer exists is switched off (the app registers a new one on its next start).
create function public.app_push_disable(p_device_id uuid, p_reason text) returns void
language sql security definer set search_path = public as $$
  update public.app_devices set push_disabled_at = now(), push_disabled_reason = left(coalesce(p_reason, 'unknown'), 200) where id = p_device_id
$$;

-- ───────── the home-screen widget ─────────
-- Today's Candela total (Pakistan business day), read with the device secret's SHA-256. Returns null for any problem (unknown device,
-- wrong secret, disabled person, no permission), so a caller learns nothing. Staff holding candela.today_total get ONE number;
-- the owner (candela.view) also gets the cash / card / credit split, exactly like the app's own screens.
create function public.app_widget_today(p_device_id uuid, p_secret_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.app_devices; v_day date := (now() at time zone 'Asia/Karachi')::date; v_full boolean; c public.candela_daily_payments;
begin
  select * into d from public.app_devices where id = p_device_id and widget_secret_hash is not null and widget_secret_hash = p_secret_hash;
  if not found then return null; end if;
  v_full := public.app_user_has(d.user_id, 'candela.view');
  if not (v_full or public.app_user_has(d.user_id, 'candela.today_total')) then return null; end if;
  update public.app_devices set last_seen_at = now() where id = d.id;
  select * into c from public.candela_daily_payments where sale_day = v_day;
  return jsonb_build_object(
    'sale_day', v_day,
    'total', c.total_sale,
    'as_of', c.last_seen_at,
    'breakdown', case when v_full and c.sale_day is not null
                      then jsonb_build_object('cash', c.cash_sale, 'card', c.card_sale, 'credit', c.credit_sale) end);
end $$;

-- ───────── exposure ─────────
revoke all on function
  public.app_user_has(uuid, text), public.app_push_tokens_for(text), public.app_push_disable(uuid, text), public.app_widget_today(uuid, text),
  public.app_device_register(uuid, text, text, boolean), public.app_device_unregister(uuid), public.app_widget_clear(uuid),
  public.app_push_rules_list(), public.app_push_rule_set(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.app_user_has(uuid, text), public.app_push_tokens_for(text), public.app_push_disable(uuid, text), public.app_widget_today(uuid, text)
  to service_role;
grant execute on function
  public.app_device_register(uuid, text, text, boolean), public.app_device_unregister(uuid), public.app_widget_clear(uuid),
  public.app_push_rules_list(), public.app_push_rule_set(text, text, boolean, text)
  to authenticated;

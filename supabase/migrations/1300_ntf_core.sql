-- 1300_ntf_core: per-person in-app messages (Stage 4; range 1300-1399, prefix ntf_, permission ntf.view_own).
-- Decisions: D-58 staff notifications are in-app only (no staff push); D-68 which events and reminders (owner answers, 25 Nov 2026).
-- The table is closed to the browser (row level security on, no policy, no grant): people read and clear their own messages only
-- through the functions in 1301. Other modules send a message with ntf_send(); it is for server code, never callable from the
-- browser, and it never raises, so a failed message can never block the action that caused it. The existing owner push
-- (notifications, notify_owner, notify-ntfy) is not touched.
-- Privacy: a message carries a short title and a line of plain words. No salary, cash or other amounts, ever (D-58).

insert into public.permissions (key, description) values
  ('ntf.view_own', 'See and clear your own inbox messages (carried by Junior and Senior staff; admins hold every permission)')
on conflict (key) do nothing;
insert into public.role_permissions (role, perm_key) values ('junior', 'ntf.view_own'), ('senior', 'ntf.view_own') on conflict do nothing;

create table public.ntf_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z][a-z0-9_.]{1,59}$'),
  title      text not null check (char_length(title) between 3 and 120),
  body       text not null default '' check (char_length(body) <= 300),
  href       text check (href is null or href ~ '^/[a-z0-9/_-]{0,60}$'),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 120),
  created_at timestamptz not null default clock_timestamp(), -- real time, so messages made in one transaction still sort in the order they were sent
  read_at    timestamptz
);
create unique index ntf_messages_dedupe_uq on public.ntf_messages (user_id, dedupe_key) where dedupe_key is not null;
create index ntf_messages_user_idx on public.ntf_messages (user_id, created_at desc);
alter table public.ntf_messages enable row level security;
revoke all on public.ntf_messages from public, anon, authenticated;

-- Sends one message to one person with a working login. Returns its id, or null when it was not sent (no such login, the same
-- dedupe key was already used for that person, the person's inbox is full, or anything went wrong). Never raises.
create function public.ntf_send(p_user uuid, p_kind text, p_title text, p_body text default '', p_href text default null, p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  begin
    if p_user is null or not exists (select 1 from public.profiles pr where pr.user_id = p_user and pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now())) then
      return null;
    end if;
    if (select count(*) from public.ntf_messages where user_id = p_user) >= 500 then
      raise warning 'ntf_send: inbox full, dropped %', p_kind;
      return null;
    end if;
    insert into public.ntf_messages (user_id, kind, title, body, href, dedupe_key)
    values (p_user, p_kind, left(trim(p_title), 120), left(trim(coalesce(p_body, '')), 300), p_href, p_dedupe)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
    returning id into nid;
  exception when others then
    raise warning 'ntf_send failed (%): %', p_kind, sqlerrm;
    return null;
  end;
  return nid;
end $$;
revoke all on function public.ntf_send(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Housekeeping: read messages are kept 60 days, unread ones 180 days. Daily at 03:00 Pakistan time (22:00 UTC), where pg_cron exists.
create function public.ntf_prune() returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.ntf_messages where (read_at is not null and read_at < now() - interval '60 days') or created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ntf_prune() from public, anon, authenticated;

do $cron$
begin
  if to_regclass('cron.job') is null then raise notice 'pg_cron not available: ntf prune job skipped'; return; end if;
  if not exists (select 1 from cron.job where jobname = 'ntf-prune-daily') then
    perform cron.schedule('ntf-prune-daily', '0 22 * * *', 'select public.ntf_prune()');
  end if;
end $cron$;

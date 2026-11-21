-- 0014_staff_logins_pin4: owner creates staff logins from the registry (4-digit PIN, 1-hour lockout, no self sign-up).
-- Foundation / Access. The PIN rules and the lockout window live in the Edge Functions (staff-login, admin-users).
-- Nothing is dropped: access_requests and setup_codes stay as history; no function reads or writes them any more.

-- One login per person. The registry row (staff) is the person; a second login would split their history in two.
create unique index profiles_one_per_staff on public.profiles (staff_id);

-- Which usernames are locked right now? Same rule as staff-login: 5 wrong PINs in the last 60 minutes.
-- Owner only (users.manage). Returns usernames, never counts per IP or hashes.
create or replace function public.access_locked_usernames() returns text[]
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('users.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select array_agg(username order by username) from (
      select username from public.login_attempts
      where success = false and username is not null and at >= now() - interval '60 minutes'
      group by username having count(*) >= 5
    ) t), '{}');
end $$;

revoke all on function public.access_locked_usernames() from public, anon, authenticated;
grant execute on function public.access_locked_usernames() to authenticated;

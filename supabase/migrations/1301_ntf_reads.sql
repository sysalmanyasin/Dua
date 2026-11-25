-- 1301_ntf_reads: a person's own inbox (range 1300-1399). Every function answers null (or 0 for the clear functions) to a caller
-- without ntf.view_own, and only ever touches the caller's own rows. Marking read is idempotent.

-- The caller's messages, newest first. p_limit is clamped to 1..100.
create function public.ntf_list_mine(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm('ntf.view_own') then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'title', m.title, 'body', m.body, 'href', m.href, 'at', m.created_at, 'read', m.read_at is not null) order by m.created_at desc, m.id)
      from (select * from public.ntf_messages where user_id = auth.uid() order by created_at desc, id limit greatest(1, least(coalesce(p_limit, 50), 100))) m
  ), '[]'::jsonb);
end $$;

-- How many of the caller's messages are unread.
create function public.ntf_unread_count() returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm('ntf.view_own') then return null; end if;
  return (select count(*)::int from public.ntf_messages where user_id = auth.uid() and read_at is null);
end $$;

-- Marks the given messages of the caller as read; returns how many changed.
create function public.ntf_mark_read(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.has_perm('ntf.view_own') then return 0; end if;
  update public.ntf_messages set read_at = now() where user_id = auth.uid() and read_at is null and id = any (coalesce(p_ids, '{}'::uuid[]));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.ntf_mark_all_read() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.has_perm('ntf.view_own') then return 0; end if;
  update public.ntf_messages set read_at = now() where user_id = auth.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ntf_list_mine(integer), public.ntf_unread_count(), public.ntf_mark_read(uuid[]), public.ntf_mark_all_read() from public, anon;
grant execute on function public.ntf_list_mine(integer), public.ntf_unread_count(), public.ntf_mark_read(uuid[]), public.ntf_mark_all_read() to authenticated;

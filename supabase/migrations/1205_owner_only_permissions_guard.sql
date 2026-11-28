-- 1205: owner-only permissions can no longer be granted to staff. The permission descriptions already said "owner only";
-- now the database enforces it. Denying is still allowed. Existing grants are not touched here.
-- (Applied live 27 Nov 2026.)
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
  if p_effect = 'grant' and p_key in ('tasks.manage', 'ops.view', 'notifications.view') then
    raise exception 'this permission belongs to the owner only and cannot be given to staff' using errcode = '42501';
  end if;
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

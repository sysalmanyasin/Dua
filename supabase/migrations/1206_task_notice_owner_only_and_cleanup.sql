-- 1206: "work handed in" goes to the Owner only (not every senior with tasks.verify). Named verifiers still find work in
-- To Verify. When a task is approved, sent back or cancelled, the waiting-to-check message is marked read so it does not linger.
-- Everything else in task_notify_on_event is unchanged from 1204. (Applied live 27 Nov 2026.)
create or replace function public.task_notify_on_event() returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.task_items; r public.task_change_requests;
  u uuid; w uuid; body text;
begin
  begin
    select * into t from public.task_items where id = new.task_id;
    if not found then return new; end if;
    select pr.user_id into u from public.profiles pr where pr.staff_id = t.assignee_staff_id and pr.disabled_at is null limit 1;

    if new.kind in ('verified', 'returned', 'cancelled') then
      update public.ntf_messages set read_at = now()
       where kind = 'task.waiting_verification' and read_at is null
         and split_part(dedupe_key, ':', 2) in (select e.id::text from public.task_events e where e.task_id = new.task_id and e.kind = 'submitted');
    end if;

    if new.kind = 'assigned' then
      if u is not null and u is distinct from new.actor_user then
        perform public.ntf_send(u, 'task.assigned', 'A task was given to you', t.title, '/tasks', 'task.assigned:' || new.id);
      end if;
    elsif new.kind = 'returned' then
      if u is not null then
        body := t.title || case when coalesce(new.detail ->> 'comment', '') <> '' then ': ' || (new.detail ->> 'comment') else '' end;
        perform public.ntf_send(u, 'task.returned', 'Sent back for correction', body, '/tasks', 'task.returned:' || new.id);
      end if;
    elsif new.kind = 'deadline_changed' then
      if u is not null and u is distinct from new.actor_user and new.detail ->> 'request' is null then
        perform public.ntf_send(u, 'task.deadline_changed', 'Deadline changed', t.title || ' is now due ' || to_char((new.detail ->> 'to')::date, 'DD Mon YYYY'), '/tasks', 'task.deadline:' || new.id);
      end if;
    elsif new.kind = 'cancelled' then
      if u is not null and u is distinct from new.actor_user then
        perform public.ntf_send(u, 'task.cancelled', 'Task cancelled', t.title || coalesce(': ' || nullif(new.detail ->> 'reason', ''), ''), '/tasks', 'task.cancelled:' || new.id);
      end if;
    elsif new.kind = 'change_decided' then
      select * into r from public.task_change_requests where id = (new.detail ->> 'request')::uuid;
      if found then
        perform public.ntf_send(r.requested_by, 'task.request_decided',
          case when (new.detail ->> 'approved')::boolean then 'Your request was approved' else 'Your request was refused' end,
          t.title || coalesce(': ' || nullif(new.detail ->> 'note', ''), ''), '/tasks', 'task.request:' || new.id);
      end if;
    elsif new.kind = 'change_requested' then
      for w in select pr.user_id from public.profiles pr where pr.role_template = 'admin' and pr.disabled_at is null and pr.user_id is distinct from new.actor_user loop
        perform public.ntf_send(w, 'task.change_requested', 'A team member asked for a change', t.title || coalesce(': ' || nullif(new.detail ->> 'reason', ''), ''), '/tasks/requests', 'task.change_requested:' || new.id || ':' || w);
      end loop;
    elsif new.kind = 'submitted' then
      for w in select pr.user_id from public.profiles pr
                where pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now()) and pr.user_id is distinct from new.actor_user
                  and pr.role_template = 'admin' loop
        perform public.ntf_send(w, 'task.waiting_verification', 'Work is waiting for you to check', t.title, '/tasks/verify', 'task.submitted:' || new.id || ':' || w);
      end loop;
    end if;
  exception when others then
    raise warning 'task_notify_on_event failed (%): %', new.kind, sqlerrm;
  end;
  return new;
end $$;

-- one-off: clear the message that is still unread for a task that has already been decided
update public.ntf_messages m set read_at = now()
 where m.kind = 'task.waiting_verification' and m.read_at is null
   and not exists (select 1 from public.task_events e where e.id::text = split_part(m.dedupe_key, ':', 2)
                      and exists (select 1 from public.task_items i where i.id = e.task_id and i.status in ('submitted', 'in_verification')));

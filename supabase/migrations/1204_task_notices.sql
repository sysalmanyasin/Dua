-- 1204_task_notices: Task Master sends inbox messages (range 1200-1299; uses ntf_send from 1300, so apply 1300 first).
-- D-68 (owner answers, 25 Nov 2026). Staff get a message when: a task is given to them, a task is sent back for correction,
-- their change request is decided, or the deadline of a task they hold changes or it is cancelled. Named verifiers (and the Owner)
-- get a message when work is handed in. The Owner also gets a message for each new change request. Overdue reminders go to the
-- person holding the task, once each morning while it stays overdue, at 08:00 Pakistan time (03:00 UTC).
-- It is a trigger on the append-only history table, so no lifecycle function changed. It can never block a task action: any
-- failure is logged as a warning and the task action goes ahead. Messages hold the task title and plain words, never amounts.

create function public.task_notify_on_event() returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.task_items; r public.task_change_requests;
  u uuid; w uuid; body text;
begin
  begin
    select * into t from public.task_items where id = new.task_id;
    if not found then return new; end if;
    select pr.user_id into u from public.profiles pr where pr.staff_id = t.assignee_staff_id and pr.disabled_at is null limit 1;

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
      -- an approved request already tells the requester through its decision message
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
      -- the Owner and the Seniors the owner has named (the same people task_can_verify allows), never the person who handed it in
      for w in select pr.user_id from public.profiles pr
                where pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now()) and pr.user_id is distinct from new.actor_user
                  and (pr.role_template = 'admin'
                       or (pr.role_template = 'senior' and exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = 'tasks.verify' and up.effect = 'grant'))) loop
        perform public.ntf_send(w, 'task.waiting_verification', 'Work is waiting for you to check', t.title, '/tasks/verify', 'task.submitted:' || new.id || ':' || w);
      end loop;
    end if;
  exception when others then
    raise warning 'task_notify_on_event failed (%): %', new.kind, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.task_notify_on_event() from public, anon, authenticated;

create trigger task_events_notify after insert on public.task_events for each row execute function public.task_notify_on_event();

-- One reminder per overdue task per morning, to the person holding it. Running it twice in a day sends nothing extra.
-- Overdue means the same as everywhere else (D-65 (5)): a deadline before today on work not yet handed in.
create function public.task_overdue_reminders() returns integer language plpgsql security definer set search_path = public as $$
declare t record; u uuid; n integer := 0; today date := public.task_today();
begin
  for t in select i.id, i.title, i.due_on, i.assignee_staff_id from public.task_items i
            where i.due_on < today and i.assignee_staff_id is not null and i.status in ('assigned', 'accepted', 'in_progress', 'returned') loop
    select pr.user_id into u from public.profiles pr where pr.staff_id = t.assignee_staff_id and pr.disabled_at is null limit 1;
    if u is not null and public.ntf_send(u, 'task.overdue', 'Overdue task', t.title || ' was due ' || to_char(t.due_on, 'DD Mon YYYY'), '/tasks', 'task.overdue:' || t.id || ':' || today) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.task_overdue_reminders() from public, anon, authenticated;

do $cron$
begin
  if to_regclass('cron.job') is null then raise notice 'pg_cron not available: task overdue reminder job skipped'; return; end if;
  if not exists (select 1 from cron.job where jobname = 'task-overdue-reminders') then
    perform cron.schedule('task-overdue-reminders', '0 3 * * *', 'select public.task_overdue_reminders()');
  end if;
end $cron$;

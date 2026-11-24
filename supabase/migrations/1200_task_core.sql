-- 1200_task_core: Task Master foundation (range 1200-1299, prefix task_, permissions tasks.*). Independent of AI.
-- Decisions: D-52 Manager is the Owner; D-53 only the Owner and Senior staff the owner names can verify; D-56 no evidence storage
-- (evidence is none, a written note or a tick); D-57 in-app only for staff at first.
-- Every table is closed to the browser (row level security on, no policy, no grant): all reads and writes are functions in
-- 1201-1203. History (events, comments) is append-only by trigger, like the audit log.

insert into public.permissions (key, description) values
  ('tasks.view_own', 'See and work on the tasks assigned to you (carried by Junior and Senior staff)'),
  ('tasks.manage', 'Create, assign and cancel tasks, set schedules, review change requests, see every task and the team overview (owner only; admins hold every permission, no role carries it)'),
  ('tasks.verify', 'Verify submitted tasks. The Owner always can; a Senior only when the owner names them with a personal grant (no role carries it; Juniors can never verify)')
on conflict (key) do nothing;
insert into public.role_permissions (role, perm_key) values ('junior', 'tasks.view_own'), ('senior', 'tasks.view_own') on conflict do nothing;

-- ── the task template and the recurring rule ───────────────────────────────────
create table public.task_defs (
  id                       uuid primary key default gen_random_uuid(),
  title                    text not null check (length(trim(title)) between 3 and 120),
  instructions             text not null default '' check (length(instructions) <= 2000),
  evidence_rule            text not null default 'none' check (evidence_rule in ('none', 'note', 'tick')),
  priority                 text not null default 'normal' check (priority in ('normal', 'urgent')),
  default_assignee_staff_id uuid references public.staff (id),
  active                   boolean not null default true,
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Only the Owner creates schedules, and creating one is approving it (D-56 of the decision log). kinds: daily; weekly on the
-- chosen ISO weekdays (1 = Monday); monthly on a day (clamped to the month's last day); nth_week = the Nth block of seven days
-- in the month (week 3 = days 15 to 21; week 5 = day 29 to the month end), one task for the whole block, due at its end.
create table public.task_schedules (
  id            uuid primary key default gen_random_uuid(),
  def_id        uuid not null references public.task_defs (id),
  kind          text not null check (kind in ('daily', 'weekly', 'monthly', 'nth_week')),
  weekdays      integer[],
  month_day     integer check (month_day between 1 and 31),
  week_of_month integer check (week_of_month between 1 and 5),
  active        boolean not null default true,
  approved_by   uuid not null references auth.users (id),
  approved_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'weekly' or (weekdays is not null and cardinality(weekdays) between 1 and 7 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7])),
  check (kind <> 'monthly' or month_day is not null),
  check (kind <> 'nth_week' or week_of_month is not null)
);

-- ── a task ─────────────────────────────────────────────────────────────────────
create table public.task_items (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) between 3 and 120),
  instructions      text not null default '' check (length(instructions) <= 2000),
  evidence_rule     text not null default 'none' check (evidence_rule in ('none', 'note', 'tick')),
  priority          text not null default 'normal' check (priority in ('normal', 'urgent')),
  status            text not null default 'created' check (status in ('created', 'assigned', 'accepted', 'in_progress', 'submitted', 'in_verification', 'completed', 'returned', 'cancelled')),
  source            text not null default 'manual' check (source in ('manual', 'schedule', 'ai_proposal')),
  def_id            uuid references public.task_defs (id),
  schedule_id       uuid references public.task_schedules (id),
  cycle_key         text,
  created_by        uuid references auth.users (id),
  assignee_staff_id uuid references public.staff (id),
  start_on          date,
  due_on            date,
  accepted_at       timestamptz,
  submitted_at      timestamptz,
  submitted_by      uuid references auth.users (id),
  verifier_user     uuid references auth.users (id),
  completed_at      timestamptz,
  cancelled_reason  text,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (schedule_id, cycle_key),
  check ((schedule_id is null) = (cycle_key is null)),
  check (status not in ('assigned', 'accepted', 'in_progress', 'submitted', 'in_verification', 'returned') or assignee_staff_id is not null)
);
create index task_items_assignee on public.task_items (assignee_staff_id, status);
create index task_items_status_due on public.task_items (status, due_on);

-- ── history, comments, submissions, change requests ────────────────────────────
create table public.task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.task_items (id),
  at          timestamptz not null default now(),
  actor_user  uuid references auth.users (id),
  kind        text not null,
  from_status text,
  to_status   text,
  detail      jsonb not null default '{}'::jsonb
);
create index task_events_task on public.task_events (task_id, id);

create table public.task_comments (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.task_items (id),
  author_user uuid not null references auth.users (id),
  body        text not null check (length(trim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index task_comments_task on public.task_comments (task_id, id);

create table public.task_submissions (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.task_items (id),
  n                integer not null check (n >= 1),
  submitted_by     uuid not null references auth.users (id),
  submitted_at     timestamptz not null default now(),
  note             text check (note is null or length(note) <= 1000),
  tick             boolean not null default false,
  decision         text check (decision in ('approved', 'rejected')),
  decided_by       uuid references auth.users (id),
  decided_at       timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 500),
  unique (task_id, n),
  check ((decision is null) = (decided_by is null))
);

create table public.task_change_requests (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.task_items (id),
  kind            text not null check (kind in ('reassign', 'deadline')),
  reason          text not null check (length(trim(reason)) between 3 and 500),
  proposed_due_on date,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid not null references auth.users (id),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users (id),
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or length(decision_note) <= 500),
  check (kind <> 'deadline' or proposed_due_on is not null)
);
create unique index task_change_one_pending on public.task_change_requests (task_id) where status = 'pending';

alter table public.task_defs enable row level security;
alter table public.task_schedules enable row level security;
alter table public.task_items enable row level security;
alter table public.task_events enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_change_requests enable row level security;
revoke all on table public.task_defs, public.task_schedules, public.task_items, public.task_events, public.task_comments,
  public.task_submissions, public.task_change_requests from anon, authenticated;

-- History is only ever added to: events and comments cannot be changed or removed; a submission can only receive its one decision.
create function public.task_append_only() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'task history is append-only' using errcode = '42501'; end $$;
create trigger task_events_append_only before update or delete on public.task_events for each row execute function public.task_append_only();
create trigger task_comments_append_only before update or delete on public.task_comments for each row execute function public.task_append_only();

create function public.task_submission_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'task history is append-only' using errcode = '42501'; end if;
  if old.decision is not null
     or (new.id, new.task_id, new.n, new.submitted_by, new.submitted_at, new.note, new.tick) is distinct from (old.id, old.task_id, old.n, old.submitted_by, old.submitted_at, old.note, old.tick) then
    raise exception 'a submission cannot be changed once made or decided' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger task_submissions_guard before update or delete on public.task_submissions for each row execute function public.task_submission_guard();

-- ── small internal helpers (not callable from the browser) ─────────────────────
create function public.task_today() returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Karachi')::date $$;

-- the caller's own staff record
create function public.task_my_staff() returns uuid language sql stable security definer set search_path = public as $$
  select staff_id from public.profiles where user_id = auth.uid() and disabled_at is null and (expires_at is null or expires_at > now()) $$;

-- D-53: the Owner, or a Senior login the owner has named with a personal grant of tasks.verify. A Junior never, even if granted.
create function public.task_can_verify() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_perm('tasks.verify') and exists (
    select 1 from public.profiles pr
     where pr.user_id = auth.uid()
       and (pr.role_template = 'admin'
            or (pr.role_template = 'senior' and exists (select 1 from public.user_permissions up
                  where up.user_id = pr.user_id and up.perm_key = 'tasks.verify' and up.effect = 'grant')))) $$;

-- a person with a working login (a task can only be given to someone who can open it)
create function public.task_staff_has_login(p_staff uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles pr where pr.staff_id = p_staff and pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now())) $$;

-- who may open a task: the Owner side, the assignee, or a verifier while it is in (or has been through) their queue
create function public.task_can_see(p_task uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_items t
     where t.id = p_task
       and (public.has_perm('tasks.manage')
            or (public.has_perm('tasks.view_own') and t.assignee_staff_id is not null and t.assignee_staff_id = public.task_my_staff())
            or (public.task_can_verify() and (t.status in ('submitted', 'in_verification') or t.verifier_user = auth.uid())))) $$;

-- one line of history; every lifecycle function calls this
create function public.task_event(p_task uuid, p_kind text, p_from text, p_to text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.task_events (task_id, actor_user, kind, from_status, to_status, detail) values (p_task, auth.uid(), p_kind, p_from, p_to, coalesce(p_detail, '{}'::jsonb)) $$;

revoke all on function public.task_append_only(), public.task_submission_guard(), public.task_today(), public.task_my_staff(),
  public.task_can_verify(), public.task_staff_has_login(uuid), public.task_can_see(uuid), public.task_event(uuid, text, text, text, jsonb)
  from public, anon, authenticated;

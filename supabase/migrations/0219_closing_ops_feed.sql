-- 0219_closing_ops_feed: read-only functions the Operations Dashboard (ops_, 0700-0749) uses to see Closing, so the dashboard
-- never reads closing tables itself and Closing stays the authority for its own data. They hold no business formula: they list
-- rows and add up the deposit rows exactly as typed. Internal only (callable from other database functions, not from the browser);
-- the caller checks the person's permission.

-- Latest closing events: a saved draft or a submitted closing, newest first (superseded revisions are not events).
create or replace function public.closing_ops_feed(p_limit integer default 10)
returns table (kind text, at timestamptz, closing_id uuid, business_date date, slot_kind text, revision integer, responsible text)
language sql stable security definer set search_path = public as $$
  select case when c.status = 'submitted' then 'submitted' else 'draft' end,
         case when c.status = 'submitted' then c.submitted_at else c.updated_at end,
         c.id, s.business_date, s.kind, c.revision, st.full_name
    from public.closings c
    join public.closing_slots s on s.id = c.slot_id
    left join public.staff st on st.id = c.responsible_staff_id
   where c.status in ('draft', 'submitted')
   order by 2 desc, c.id
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- Drafts that have been left open longer than p_hours since they were last saved.
create or replace function public.closing_ops_open_drafts(p_hours integer)
returns table (closing_id uuid, business_date date, slot_kind text, revision integer, responsible text, saved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, s.business_date, s.kind, c.revision, st.full_name, c.updated_at
    from public.closings c
    join public.closing_slots s on s.id = c.slot_id
    left join public.staff st on st.id = c.responsible_staff_id
   where c.status = 'draft' and c.updated_at < now() - make_interval(hours => greatest(1, coalesce(p_hours, 12)))
   order by c.updated_at, c.id;
$$;

-- Sum of the bank deposit rows typed on the submitted closings of one business date (struck-through rows excluded);
-- null when no closing was submitted for that date.
create or replace function public.closing_ops_deposits(p_date date)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(distinct c.id) = 0 then null else coalesce(sum(d.amount) filter (where d.deleted_at is null), 0) end
    from public.closings c
    join public.closing_slots s on s.id = c.slot_id
    left join public.closing_deposits d on d.closing_id = c.id
   where c.status = 'submitted' and s.business_date = p_date;
$$;

revoke all on function public.closing_ops_feed(integer), public.closing_ops_open_drafts(integer), public.closing_ops_deposits(date)
  from public, anon, authenticated;

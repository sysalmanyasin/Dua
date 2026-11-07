-- 0006: Daily Check List (daily inspection report). Content below is carried over from the original app.
-- Private defaults (prepared-by name, contact number, doctor name, competitor figures) are NOT in Git:
-- they are applied separately (see docs/SETUP.md, "Private defaults").

insert into public.permissions (key, description) values
 ('checklist.view', 'View daily check lists'),
 ('checklist.fill', 'Fill in, edit and send the daily check list'),
 ('checklist.manage', 'Change checklist items, defaults and dropdown lists');

create table public.checklist_sections (
  id text primary key,
  number_label text not null,
  title text not null,
  group_no text,
  sort int not null,
  kind text not null check (kind in ('items', 'table')),
  active boolean not null default true
);
create table public.checklist_items (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  section_id text not null references public.checklist_sections (id),
  no text not null default '',
  label text not null,
  default_value text not null default '',
  dropdown_key text,
  optional boolean not null default false,
  sort int not null,
  active boolean not null default true
);
create table public.checklist_dropdown_options (
  dropdown_key text not null,
  option_text text not null check (length(trim(option_text)) between 1 and 120),
  sort int not null,
  primary key (dropdown_key, option_text)
);
create table public.checklist_competitor_defaults (
  sort int primary key,
  name text not null,
  stock_value text not null default '',
  avg_per_day text not null default '',
  monthly_sales text not null default ''
);

create table public.checklist_days (
  report_date date primary key check (report_date >= date '2020-01-01'),
  branch text, prepared_by text, designation text, contact text, report_time time,
  pull_date date,
  meter_ref text, meter_reading text,
  lt7_date date, lt7_zero numeric(14, 2), lt7_days numeric(14, 2),
  s_receive numeric(14, 2), s_cashsale numeric(14, 2), s_cashreturn numeric(14, 2),
  s_creditsale numeric(14, 2), s_creditreturn numeric(14, 2), s_closing numeric(14, 2),
  s_homeservice numeric(14, 2), s_homecount numeric(14, 2), s_drivesales numeric(14, 2), s_drivecount numeric(14, 2),
  s_negstock numeric(14, 2), c_cash numeric(14, 2), c_panel numeric(14, 2),
  notes text,
  version int not null default 1,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
create table public.checklist_answers (
  report_date date not null references public.checklist_days (report_date) on delete cascade,
  item_key text not null references public.checklist_items (key),
  value text not null default '',
  primary key (report_date, item_key)
);
create table public.checklist_competitors (
  report_date date not null references public.checklist_days (report_date) on delete cascade,
  pos int not null,
  name text not null default '', stock_value text not null default '', avg_per_day text not null default '', monthly_sales text not null default '',
  primary key (report_date, pos)
);

-- ───────── functions ─────────
create or replace function public.checklist_get_day(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.checklist_days;
begin
  if not (public.has_perm('checklist.view') or public.has_perm('checklist.fill')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.checklist_days where report_date = p_date;
  if not found then return null; end if;
  return jsonb_build_object(
    'day', to_jsonb(d) - 'created_by' - 'updated_by',
    'answers', coalesce((select jsonb_object_agg(item_key, value) from public.checklist_answers where report_date = p_date), '{}'::jsonb),
    'competitors', coalesce((select jsonb_agg(jsonb_build_array(name, stock_value, avg_per_day, monthly_sales) order by pos)
                             from public.checklist_competitors where report_date = p_date), '[]'::jsonb));
end $$;

-- Autosave target. p_version must match the saved version (null for a new day) or the save is refused as a conflict.
create or replace function public.checklist_save_day(p_date date, p_day jsonb, p_answers jsonb, p_competitors jsonb, p_version int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cur public.checklist_days; new_version int; k text; v text; n int := 0; c jsonb;
begin
  if not public.has_perm('checklist.fill') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null or p_date > today + 1 then raise exception 'date is too far ahead'; end if;
  if jsonb_typeof(coalesce(p_day, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_competitors, '[]'::jsonb)) <> 'array' then raise exception 'bad request'; end if;
  if jsonb_array_length(coalesce(p_competitors, '[]'::jsonb)) > 30 then raise exception 'too many competitor rows'; end if;

  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_answers, '{}'::jsonb)) loop
    if not exists (select 1 from public.checklist_items where key = k and active) then raise exception 'unknown checklist item %', k; end if;
    if length(coalesce(v, '')) > 500 then raise exception 'answer too long'; end if;
  end loop;

  select * into cur from public.checklist_days where report_date = p_date for update;
  if found then
    if p_version is distinct from cur.version then raise exception 'conflict: this day was changed on another device'; end if;
    new_version := cur.version + 1;
  else
    if p_version is not null then raise exception 'conflict: this day no longer exists'; end if;
    new_version := 1;
  end if;

  insert into public.checklist_days (report_date, branch, prepared_by, designation, contact, report_time, pull_date, meter_ref, meter_reading,
      lt7_date, lt7_zero, lt7_days, s_receive, s_cashsale, s_cashreturn, s_creditsale, s_creditreturn, s_closing, s_homeservice, s_homecount,
      s_drivesales, s_drivecount, s_negstock, c_cash, c_panel, notes, version, created_by, updated_by)
  values (p_date, left(p_day ->> 'branch', 80), left(p_day ->> 'prepared_by', 80), left(p_day ->> 'designation', 80), left(p_day ->> 'contact', 40),
      nullif(p_day ->> 'report_time', '')::time, nullif(p_day ->> 'pull_date', '')::date, left(p_day ->> 'meter_ref', 80), left(p_day ->> 'meter_reading', 80),
      nullif(p_day ->> 'lt7_date', '')::date, nullif(p_day ->> 'lt7_zero', '')::numeric, nullif(p_day ->> 'lt7_days', '')::numeric,
      nullif(p_day ->> 's_receive', '')::numeric, nullif(p_day ->> 's_cashsale', '')::numeric, nullif(p_day ->> 's_cashreturn', '')::numeric,
      nullif(p_day ->> 's_creditsale', '')::numeric, nullif(p_day ->> 's_creditreturn', '')::numeric, nullif(p_day ->> 's_closing', '')::numeric,
      nullif(p_day ->> 's_homeservice', '')::numeric, nullif(p_day ->> 's_homecount', '')::numeric, nullif(p_day ->> 's_drivesales', '')::numeric,
      nullif(p_day ->> 's_drivecount', '')::numeric, nullif(p_day ->> 's_negstock', '')::numeric, nullif(p_day ->> 'c_cash', '')::numeric,
      nullif(p_day ->> 'c_panel', '')::numeric, left(p_day ->> 'notes', 4000), new_version, auth.uid(), auth.uid())
  on conflict (report_date) do update set
      branch = excluded.branch, prepared_by = excluded.prepared_by, designation = excluded.designation, contact = excluded.contact,
      report_time = excluded.report_time, pull_date = excluded.pull_date, meter_ref = excluded.meter_ref, meter_reading = excluded.meter_reading,
      lt7_date = excluded.lt7_date, lt7_zero = excluded.lt7_zero, lt7_days = excluded.lt7_days, s_receive = excluded.s_receive,
      s_cashsale = excluded.s_cashsale, s_cashreturn = excluded.s_cashreturn, s_creditsale = excluded.s_creditsale,
      s_creditreturn = excluded.s_creditreturn, s_closing = excluded.s_closing, s_homeservice = excluded.s_homeservice,
      s_homecount = excluded.s_homecount, s_drivesales = excluded.s_drivesales, s_drivecount = excluded.s_drivecount,
      s_negstock = excluded.s_negstock, c_cash = excluded.c_cash, c_panel = excluded.c_panel, notes = excluded.notes,
      version = new_version, updated_by = auth.uid(), updated_at = now();

  delete from public.checklist_answers where report_date = p_date;
  insert into public.checklist_answers (report_date, item_key, value)
  select p_date, key, value #>> '{}' from jsonb_each(coalesce(p_answers, '{}'::jsonb));

  delete from public.checklist_competitors where report_date = p_date;
  for c in select * from jsonb_array_elements(coalesce(p_competitors, '[]'::jsonb)) loop
    n := n + 1;
    insert into public.checklist_competitors (report_date, pos, name, stock_value, avg_per_day, monthly_sales)
    values (p_date, n, left(coalesce(c ->> 0, ''), 80), left(coalesce(c ->> 1, ''), 80), left(coalesce(c ->> 2, ''), 80), left(coalesce(c ->> 3, ''), 80));
  end loop;

  if new_version = 1 then perform public.log_activity('checklist.created', 'checklist_days', p_date::text, null, null, null); end if;
  return jsonb_build_object('version', new_version, 'updated_at', now());
end $$;

create or replace function public.checklist_reset_day(p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('checklist.fill') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.checklist_days where report_date = p_date;
  perform public.log_activity('checklist.reset', 'checklist_days', p_date::text, null, null, null);
end $$;

create or replace function public.checklist_log_send(p_date date, p_channel text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm('checklist.fill') or public.has_perm('checklist.view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_channel not in ('copy', 'print', 'email', 'gmail') then raise exception 'bad channel'; end if;
  perform public.log_activity('checklist.sent', 'checklist_days', p_date::text, null, jsonb_build_object('channel', p_channel), null);
end $$;

-- Dropdown lists are shared by everyone (the original kept them per device).
create or replace function public.checklist_set_dropdown(p_key text, p_options text[]) returns void
language plpgsql security definer set search_path = public as $$
declare clean text[] := '{}'; o text; seen text[] := '{}';
begin
  if not public.has_perm('checklist.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.checklist_items where dropdown_key = p_key) then raise exception 'unknown dropdown'; end if;
  foreach o in array coalesce(p_options, '{}') loop
    o := trim(o);
    if o = '' or lower(o) = any (seen) then continue; end if;
    if length(o) > 120 then raise exception 'option too long'; end if;
    seen := seen || lower(o);
    clean := clean || o;
  end loop;
  if coalesce(array_length(clean, 1), 0) < 3 then raise exception 'at least 3 options are needed'; end if;
  if array_length(clean, 1) > 30 then raise exception 'at most 30 options'; end if;
  delete from public.checklist_dropdown_options where dropdown_key = p_key;
  insert into public.checklist_dropdown_options (dropdown_key, option_text, sort)
  select p_key, x, ord from unnest(clean) with ordinality as t (x, ord);
  perform public.log_activity('checklist.dropdown_set', 'checklist_dropdown_options', p_key, null, to_jsonb(clean), null);
end $$;

-- ───────── RLS and grants ─────────
alter table public.checklist_sections enable row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_dropdown_options enable row level security;
alter table public.checklist_competitor_defaults enable row level security;
alter table public.checklist_days enable row level security;
alter table public.checklist_answers enable row level security;
alter table public.checklist_competitors enable row level security;

create policy cl_template_read on public.checklist_sections for select to authenticated
  using (public.has_perm('checklist.view') or public.has_perm('checklist.fill') or public.has_perm('checklist.manage'));
create policy cl_items_read on public.checklist_items for select to authenticated
  using (public.has_perm('checklist.view') or public.has_perm('checklist.fill') or public.has_perm('checklist.manage'));
create policy cl_dd_read on public.checklist_dropdown_options for select to authenticated
  using (public.has_perm('checklist.view') or public.has_perm('checklist.fill') or public.has_perm('checklist.manage'));
create policy cl_comp_defaults_read on public.checklist_competitor_defaults for select to authenticated
  using (public.has_perm('checklist.view') or public.has_perm('checklist.fill') or public.has_perm('checklist.manage'));
create policy cl_days_read on public.checklist_days for select to authenticated using (public.has_perm('checklist.view') or public.has_perm('checklist.fill'));
create policy cl_answers_read on public.checklist_answers for select to authenticated using (public.has_perm('checklist.view') or public.has_perm('checklist.fill'));
create policy cl_competitors_read on public.checklist_competitors for select to authenticated using (public.has_perm('checklist.view') or public.has_perm('checklist.fill'));

grant select on public.checklist_sections, public.checklist_items, public.checklist_dropdown_options, public.checklist_competitor_defaults,
  public.checklist_days, public.checklist_answers, public.checklist_competitors to authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.checklist_get_day(date), public.checklist_save_day(date, jsonb, jsonb, jsonb, int), public.checklist_reset_day(date),
  public.checklist_log_send(date, text), public.checklist_set_dropdown(text, text[]) from public, anon, authenticated;
grant execute on function public.checklist_get_day(date), public.checklist_save_day(date, jsonb, jsonb, jsonb, int), public.checklist_reset_day(date),
  public.checklist_log_send(date, text), public.checklist_set_dropdown(text, text[]) to authenticated;

-- ───────── content (from the original app) ─────────
insert into public.checklist_sections (id, number_label, title, group_no, sort, kind) values
 ('s1', '1', 'Branch', null, 1, 'items'),
 ('s2', '2', 'Customer Dealing & Checking', null, 2, 'items'),
 ('s3', '3', 'Staff Appearance', '3', 3, 'items'),
 ('s4', '4', 'Strengths & Variants', null, 4, 'items'),
 ('s5', '5', 'Generics & Alternative Promotion', null, 5, 'items'),
 ('s6', '6', 'Stationery Availability', '6', 6, 'items'),
 ('s7', '7–15', 'Daily Operations', null, 7, 'items'),
 ('s16', '16', 'Repair & Maintenance', '16', 8, 'items'),
 ('s17', '17', 'Price Check', '17', 9, 'items'),
 ('s18', '18', 'Narcotics Record', '18', 10, 'items'),
 ('s19', '19–22', 'Daily Figures', null, 11, 'items'),
 ('mc', '25–27', 'Manual cash bill and Credit sales', null, 12, 'table'),
 ('rpo', '28–31', 'RPO and Short excess status', null, 13, 'table');

insert into public.checklist_items (key, section_id, no, label, default_value, dropdown_key, optional, sort) values
 ('s1_1', 's1', '1', 'Branch:', 'Bahria Town', null, false, 1),
 ('s2_1', 's2', '2', 'a) Customer Dealing By Officers:', 'Yes, By Co Manager & Pharmacist', null, false, 1),
 ('s2_2', 's2', '', 'b) Checking of medicines by checker before handing over to customer', 'Yes, SSO is at Packing', null, false, 2),
 ('s3_1', 's3', '', 'a) Staff Shave', 'Ok', null, false, 1),
 ('s3_2', 's3', '', 'b) Overalls', 'Ok', null, false, 2),
 ('s3_3', 's3', '', 'c) Name Tags', 'Ok', null, false, 3),
 ('s3_4', 's3', '', 'd) Staff Search', 'Yes, Ok', null, false, 4),
 ('s3_5', 's3', '', 'e) Dusting of consumer items in customer area', 'Yes, Done', null, false, 5),
 ('s4_1', 's4', '4', 'Medicine with different strengths and variants placed separately.', 'Working continues / More Shelves Required', null, false, 1),
 ('s5_1', 's5', '5', 'Generics promotion by pharmacist', 'Yes (12/33)', null, false, 1),
 ('s5_2', 's5', '', '(ALTERNATIVE INVOICE PROMOTION)', 'Yes (03/13)', null, false, 2),
 ('s6_1', 's6', '', 'a) Brown Bags / Non Woven Bags', 'Ok', null, false, 1),
 ('s6_2', 's6', '', 'b) Printer Paper', 'Ok', null, false, 2),
 ('s6_3', 's6', '', 'c) Tag guns & Rolls', 'Ok', null, false, 3),
 ('s6_4', 's6', '', 'd) N/A Register', 'Yes, Maintained', null, false, 4),
 ('s7_1', 's7', '7', 'Generator Status with Codes/ Working Hours:', 'Yes, FDPP G 01 12 Hrs', null, false, 1),
 ('s7_2', 's7', '8', 'Returns are being checked / Verified by manager:', 'Yes, Entered and Verified', null, false, 2),
 ('s7_3', 's7', '9', 'Home Delivery Service Entered in Google Drive on Daily Basis:', 'Yes', null, false, 3),
 ('s7_4', 's7', '10', 'Stocks are placed as per (First in First Out) FIFO', 'Yes, Fifo followed', null, false, 4),
 ('s7_5', 's7', '11', 'Stock from Warehouse entered in computer under personal supervision:', 'Yes: Stock Entered', null, false, 5),
 ('s7_6', 's7', '12', 'All supply cartons dispatched sealed/signed', 'Yes', null, false, 6),
 ('s7_7', 's7', '13', 'Cash Deposit Slips by Webcam Emailed:', 'Yes', null, false, 7),
 ('s7_8', 's7', '14', 'Customer''s ID card numbers Entered for Bills of Rs.50,000 or more', 'No Bill', null, false, 8),
 ('s7_9', 's7', '15', 'Any supply issue:', 'No Major Supply Issues', null, false, 9),
 ('s16_1', 's16', '', 'a) Lights', 'Ok', null, false, 1),
 ('s16_2', 's16', '', 'b) A/C Filter clean', 'Ok', null, false, 2),
 ('s16_3', 's16', '', 'c) Sign Board', 'Ok', null, false, 3),
 ('s16_4', 's16', '', 'd) Fire Extinguishers', 'Ok', null, false, 4),
 ('s16_5', 's16', '', 'e) Any repair request', 'Ok', null, false, 5),
 ('s17_1', 's17', '', 'a) Computer price verification', 'Ok', null, false, 1),
 ('s17_2', 's17', '', 'b) Tags on Consumer Item', 'Ok', null, false, 2),
 ('s17_3', 's17', '', 'c) Any price changes in warehouse supply.', 'Ok', null, false, 3),
 ('s18_1', 's18', '', 'a) Manual Narcotics register updated.', 'Yes', null, false, 1),
 ('s18_2', 's18', '', 'b) Narcotics updated in the system at the time of sale.', 'Yes', null, false, 2),
 ('s18_3', 's18', '', 'c) Manual Schedule-D register updated.', 'Yes', null, false, 3),
 ('s18_4', 's18', '', 'd) Schedule-D updated in system at the time of sale.', 'Yes', null, false, 4),
 ('s18_5', 's18', '', 'e) Scanning of Prescription.', 'Yes', null, false, 5),
 ('s19_1', 's19', '19', 'Number of prescriptions entered yesterday?', '22 Prescriptions', null, false, 1),
 ('s19_2', 's19', '20', 'Expiry / Near Expiry', '28500', null, false, 2),
 ('s19_3', 's19', '21', 'Night Video viewing Time', '12:30 PM', null, false, 3),
 ('s19_4', 's19', '22', 'Inspection Register Available at Pharmacy or Not', 'No', null, false, 4),
 ('mc_1', 'mc', '25 A', 'Marketing: Flyer distribution', '', null, false, 1),
 ('dd_mkt', 'mc', '25 B', 'Doctor Visits', 'No marketing visit today', 'mkt', false, 2),
 ('mc_3', 'mc', '25 C', 'Doctor sales potential', '', null, false, 3),
 ('mc_4', 'mc', '26', 'Manual cash memo entered in computer or not', 'Book Pending Value: 890', null, false, 4),
 ('mc_5', 'mc', '27', 'Credit sales entered in the computer before handing medicine', 'Yes: All Bills entered at time of Handing Medicines', null, false, 5),
 ('rpo_1', 'rpo', '28', 'Value of plus items', '-2211', null, false, 1),
 ('dd_rpos', 'rpo', '29 A', 'RPOs Status', '', 'rpos', true, 2),
 ('dd_rpor', 'rpo', '29 B', 'RPO Reviewed Carefully', '', 'rpor', false, 3),
 ('dd_rpoa', 'rpo', '29 C', 'Any amendment in RPOs', '', 'rpoa', false, 4),
 ('rpo_5', 'rpo', '30', 'Short & Excess Values of Randoms', '-2211', null, false, 5),
 ('rpo_6', 'rpo', '31', 'Number of customers discount given after approval.', '18', null, false, 6);

insert into public.checklist_dropdown_options (dropdown_key, option_text, sort) values
 ('mkt', 'No marketing visit today', 2),
 ('mkt', 'Company representative visited', 3),
 ('mkt', 'Doctor visit / sample drop', 4),
 ('rpos', 'Reviewed - no issues', 1),
 ('rpos', 'Pending review', 2),
 ('rpos', 'Partially reviewed', 3),
 ('rpos', 'No RPO today', 4),
 ('rpor', 'Yes', 1),
 ('rpor', 'No', 2),
 ('rpor', 'Partially', 3),
 ('rpoa', 'No amendment', 1),
 ('rpoa', 'Yes - amended', 2),
 ('rpoa', 'Yes - pending approval', 3);

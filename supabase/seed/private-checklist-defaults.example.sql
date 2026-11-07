-- TEMPLATE. Copy, fill in your own values, run once in the SQL editor. Do NOT commit the filled-in copy.

-- 1. A starting "prepared by" block, as a first (empty) day so new days copy it.
-- (Skip this: the first day you save carries these values forward automatically.)

-- 2. The doctor-visit dropdown: add the doctor's name as an option.
insert into public.checklist_dropdown_options (dropdown_key, option_text, sort)
values ('mkt', 'DOCTOR NAME (SPECIALTY)', 0)
on conflict do nothing;
update public.checklist_items set default_value = 'DOCTOR NAME (SPECIALTY)' where key = 'dd_mkt';

-- 3. Competitor rows copied onto each new day.
insert into public.checklist_competitor_defaults (sort, name, stock_value, avg_per_day, monthly_sales) values
 (1, 'COMPETITOR A', '', '', ''),
 (2, 'COMPETITOR B', '', '', '');

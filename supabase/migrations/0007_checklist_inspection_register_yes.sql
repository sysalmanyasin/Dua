-- Change the Daily Check List default for question 22.
-- Keep existing submitted checklist answers unchanged; this affects the template default.
update public.checklist_items
set default_value = 'Yes'
where key = 's19_4'
  and label = 'Inspection Register Available at Pharmacy or Not';

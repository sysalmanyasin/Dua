// Daily Check List: the only file that talks to Supabase for this page.
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export async function loadTemplate() {
  const [sections, items, options, competitorDefaults] = await Promise.all([
    one(db().from('checklist_sections').select('id, number_label, title, group_no, sort, kind, active').order('sort')),
    one(
      db().from('checklist_items').select('key, section_id, no, label, default_value, dropdown_key, optional, sort, active').order('sort'),
    ),
    one(db().from('checklist_dropdown_options').select('dropdown_key, option_text, sort').order('sort')),
    one(db().from('checklist_competitor_defaults').select('name, stock_value, avg_per_day, monthly_sales').order('sort')),
  ]);
  const dropdowns = {};
  for (const o of options) (dropdowns[o.dropdown_key] ??= []).push(o.option_text);
  return { sections, items, dropdowns, competitorDefaults };
}

export const getDay = (date) => one(db().rpc('checklist_get_day', { p_date: date }));
export const lastMeta = () =>
  one(
    db()
      .from('checklist_days')
      .select('branch, prepared_by, designation, contact, meter_ref')
      .order('report_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

export const saveDay = (date, day, answers, competitors, version) =>
  db().rpc('checklist_save_day', { p_date: date, p_day: day, p_answers: answers, p_competitors: competitors, p_version: version });
export const resetDay = (date) => db().rpc('checklist_reset_day', { p_date: date });
export const logSend = (date, channel) => db().rpc('checklist_log_send', { p_date: date, p_channel: channel });
export const setDropdown = (key, options) => db().rpc('checklist_set_dropdown', { p_key: key, p_options: options });

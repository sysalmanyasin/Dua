// The only file in this module that talks to Supabase. Reads follow the person's permissions (row-level security);
// writes go through the sales_save_day database function.
import { db } from '../../../core/supabase.js';

const PAGE = 1000; // Supabase returns at most 1000 rows per request

async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}
const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

export const listMethods = () =>
  one(db().from('payment_methods').select('code, label, section, sign, sort, show_in_entry').eq('active', true).order('sort'));

export async function getDay(date) {
  const [day, lines] = await Promise.all([
    one(db().from('daily_sales').select('*').eq('business_date', date).maybeSingle()),
    one(db().from('daily_sale_lines').select('method_code, amount').eq('business_date', date)),
  ]);
  return { day, lines };
}
export const listRevisions = (date) =>
  one(
    db()
      .from('daily_sales_revisions')
      .select('revision, reason, replaced_at, header')
      .eq('business_date', date)
      .order('revision', { ascending: false }),
  );

export const listDays = () =>
  fetchAll(() =>
    db()
      .from('daily_sales')
      .select('business_date, total, comp_sale, diff, customers, low_sale_reason, revision, source')
      .order('business_date', { ascending: false }),
  );
export const listDailyReport = () => fetchAll(() => db().from('v_daily_report').select('*').order('business_date', { ascending: false }));
export const listMonthly = () => one(db().from('v_monthly').select('*'));
export const listMonthlyHistory = () => one(db().from('monthly_history').select('month, total, comp_sale, customers'));

export const saveDay = (date, header, lines, reason, key) =>
  db().rpc('sales_save_day', { p_date: date, p_header: header, p_lines: lines, p_reason: reason || null, p_key: key });
export const lastClosedDay = () => one(db().rpc('sales_last_closed_day'));

// ── Sale Report support ──
export const latestDay = () =>
  one(db().from('daily_sales').select('business_date').order('business_date', { ascending: false }).limit(1).maybeSingle());
export async function monthTotal(monthIso) {
  const first = `${monthIso.slice(0, 7)}-01`;
  const live = await one(db().from('v_monthly').select('total').eq('month', first).maybeSingle());
  if (live) return Number(live.total);
  const hist = await one(db().from('monthly_history').select('total').eq('month', first).maybeSingle());
  return hist ? Number(hist.total) : 0;
}
export const getTarget = async (monthIso) => {
  const r = await one(
    db()
      .from('sales_targets')
      .select('target')
      .eq('month', `${monthIso.slice(0, 7)}-01`)
      .maybeSingle(),
  );
  return r ? Number(r.target) : null;
};
export const setTarget = (monthIso, target) => db().rpc('sales_set_target', { p_month: `${monthIso.slice(0, 7)}-01`, p_target: target });
export const getPref = async (key) => (await one(db().from('user_prefs').select('value').eq('key', key).maybeSingle()))?.value ?? null;
export const setPref = (key, value) => db().rpc('prefs_set', { p_key: key, p_value: value });

// ── Dashboard ──
export const listMonthlyFull = () => one(db().from('v_monthly_full').select('*').order('month'));
export const listDailyFull = () => fetchAll(() => db().from('v_daily_full').select('*').order('business_date'));
export const listTargets = () => one(db().from('sales_targets').select('month, target'));
export const listClientTotals = () => one(db().from('v_client_totals').select('label, total'));

// ── Reports and Manage Fields ──
export const listAllMethods = () =>
  one(db().from('payment_methods').select('code, label, section, sign, sort, show_in_entry, active').order('sort'));
export const listDaysBetween = (from, to) =>
  one(
    db()
      .from('daily_sales')
      .select('business_date, total, comp_sale, customers')
      .gte('business_date', from)
      .lte('business_date', to)
      .order('business_date'),
  );
export const listLinesBetween = (from, to) =>
  fetchAll(() =>
    db()
      .from('daily_sale_lines')
      .select('business_date, method_code, amount')
      .gte('business_date', from)
      .lte('business_date', to)
      .order('business_date')
      .order('method_code'),
  );
export const listMonthlyMethods = () =>
  fetchAll(() => db().from('v_monthly_methods').select('month, method_code, amount').order('month').order('method_code'));
export const saveField = (code, label, section, sign, show, active) =>
  db().rpc('payment_method_save', { p_code: code, p_label: label, p_section: section, p_sign: sign, p_show: show, p_active: active });
export const reorderFields = (codes) => db().rpc('payment_methods_reorder', { p_codes: codes });
export const recentDays = (count = 7) =>
  one(db().from('daily_sales').select('business_date, total, customers').order('business_date', { ascending: false }).limit(count));

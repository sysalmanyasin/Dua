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

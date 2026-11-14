// The only file in this module that talks to Supabase. Reads only: the history tables are filled by the database
// (triggers on the feed) and are readable by the owner alone (candela.view). Staff get one number through
// candela_today_total().
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

const PAY_COLS = 'sale_day, cash_sale, card_sale, credit_sale, total_sale, revision, last_seen_at';

// Daily payment rows between two dates (inclusive), newest first. Either date may be omitted.
export function paymentDays(from = null, to = null) {
  return fetchAll(() => {
    let q = db().from('candela_daily_payments').select(PAY_COLS).order('sale_day', { ascending: false });
    if (from) q = q.gte('sale_day', from);
    if (to) q = q.lte('sale_day', to);
    return q;
  });
}

// Credit rows (one per customer per day). `search` is matched against the customer name on the server.
export function creditRows(from = null, to = null, search = '') {
  const needle = String(search)
    .trim()
    .replace(/[%_,()*]/g, ' ');
  return fetchAll(() => {
    let q = db()
      .from('candela_credit_daily')
      .select('sale_day, customer_key, customer_name, credit_amount, receipt_count')
      .order('sale_day', { ascending: false })
      .order('customer_key');
    if (from) q = q.gte('sale_day', from);
    if (to) q = q.lte('sale_day', to);
    if (needle) q = q.ilike('customer_name', `%${needle}%`);
    return q;
  });
}

// Corrections Candela made to figures that were already stored.
export async function recentChanges(limit = 50) {
  const { data, error } = await db()
    .from('candela_changes')
    .select('kind, sale_day, customer_key, old_values, new_values, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// The staff-safe number: today's total, or null when there is no figure yet. Throws when not allowed.
export async function todayTotal() {
  const { data, error } = await db().rpc('candela_today_total');
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

// The only file in STR that reads from Supabase. Reads follow the person's permission (str.view) through row-level
// security; nothing is written. Columns are always named: a `select *` is refused by the database and cost price is never read.
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const HEADER_COLS =
  'str_id, str_number, master_str_id, ref_no, media, str_status, str_date, issued_by, dispatched_date, dispatch_status, ' +
  'dispatched_by, receive_date, receive_status, received_by, comments, dispatch_branch, receive_branch, direction, ' +
  'no_of_boxes, stage, line_count';
const LINE_COLS = 'str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, receive_qty, product_price';

/** Every STR the feed holds right now (a few days), newest first. */
export const feedHeaders = () =>
  one(
    db()
      .from('str_v_headers')
      .select(HEADER_COLS)
      .eq('in_feed', true)
      .order('str_date', { ascending: false, nullsFirst: false })
      .order('str_id', { ascending: false })
      .limit(1000),
  );

/** Search the feed and the one-month history on the server: 50 rows a call. Words may match the header or a product. */
export const searchHeaders = ({ text = '', from = null, to = null, stage = null, direction = null, limit = 50, offset = 0 } = {}) =>
  one(
    db().rpc('str_search_headers', {
      p_text: text || null,
      p_from: from || null,
      p_to: to || null,
      p_stage: stage || null,
      p_direction: direction || null,
      p_limit: limit,
      p_offset: offset,
    }),
  );

export const headerById = (id) => one(db().from('str_v_headers').select(HEADER_COLS).eq('str_id', id).maybeSingle());

export const lines = (id) => one(db().from('str_v_lines').select(LINE_COLS).eq('str_id', id).order('str_item_id').limit(1000));

/** Lines of many STRs at once (for the Report and Zero Dispatch pages), in small batches so no call hits the row cap. */
export async function linesFor(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const part = await one(
      db()
        .from('str_v_lines')
        .select(LINE_COLS)
        .in('str_id', ids.slice(i, i + 25))
        .order('str_id')
        .order('str_item_id')
        .limit(1000),
    );
    out.push(...part);
  }
  return out;
}

/** When the feed last wrote STR rows (null if there are none). */
export async function dataAsOf() {
  const rows = await one(db().from('str_headers').select('synced_at').order('synced_at', { ascending: false }).limit(1));
  return rows?.[0]?.synced_at ?? null;
}

// Invoice Desk is the only module layer that reads Supabase or calls its write RPCs.
import { db } from '../../../core/supabase.js';

const PAGE = 500;
async function rows(makeQuery) {
  const result = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    result.push(...(data ?? []));
    if (!data || data.length < PAGE) return result;
  }
}
async function one(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
export const listProducts = (businessId, { includeInactive = false } = {}) => {
  let q = db().from('invoice_desk_products').select('id,business_id,name,suggested_price,active,created_at,updated_at').eq('business_id', businessId).order('name');
  if (!includeInactive) q = q.eq('active', true);
  return one(q);
};
export const saveProduct = (product, key) =>
  db().rpc('invoice_desk_product_save', { p_product: product, p_key: key });
export const saveInvoice = (invoice, lines, key) =>
  db().rpc('invoice_desk_save_invoice', { p_invoice: invoice, p_lines: lines, p_key: key });
export const getInvoice = async (id) => {
  const [invoice, lines] = await Promise.all([
    one(db().from('invoice_desk_invoices').select('*').eq('id', id).single()),
    one(db().from('invoice_desk_lines').select('id,product_id,description,quantity,unit_price,line_total,display_order').eq('invoice_id', id).order('display_order')),
  ]);
  return { ...invoice, lines };
};
export const listInvoices = ({ businessId = null, from = null, to = null, search = '', offset = 0, limit = 100 } = {}) => {
  let q = db().from('invoice_desk_invoices').select('id,business_id,invoice_number,invoice_date,template_id,template_version,subtotal,discount,grand_total,created_at').order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).range(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.min(Math.max(Number(limit) || 100, 1), 500) - 1);
  if (businessId) q = q.eq('business_id', businessId);
  if (from) q = q.gte('invoice_date', from);
  if (to) q = q.lte('invoice_date', to);
  if (search.trim()) q = q.ilike('invoice_number', `%${search.trim().replace(/[,%_]/g, '\\$&')}%`);
  return one(q);
};
export const listInvoicesPaged = ({ businessId = null, from = null, to = null, search = '' } = {}) => rows(() => {
  let q = db().from('invoice_desk_invoices').select('id,business_id,invoice_number,invoice_date,template_id,template_version,subtotal,discount,grand_total,created_at').order('invoice_date', { ascending: false }).order('created_at', { ascending: false });
  if (businessId) q = q.eq('business_id', businessId);
  if (from) q = q.gte('invoice_date', from);
  if (to) q = q.lte('invoice_date', to);
  if (search.trim()) q = q.ilike('invoice_number', `%${search.trim().replace(/[,%_]/g, '\\$&')}%`);
  return q;
});

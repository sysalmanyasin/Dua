// TEMPORARY one-time function: imports the old sales backup from the private "imports" storage bucket.
// Protected by a one-time token created from the database side (import_tokens). Deleted after the import.
// POST {token, mode: "dry" | "apply", object, add_mode, trust_month_year}
import { serviceClient } from '../_shared/clients.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
// @ts-ignore: plain JS module shared with tools/import
import { analyze, buildImportPayload, summarize } from '../_shared/sales-import-lib.mjs';

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const CHUNK = 200;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });

  const body = await readJson(req);
  const token = String(body?.token ?? '');
  const mode = body?.mode;
  const object = String(body?.object ?? '');
  if (token.length < 32 || (mode !== 'dry' && mode !== 'apply') || !/^[A-Za-z0-9._-]{1,100}$/.test(object)) {
    return json(req, 400, { error: 'bad_request' });
  }
  const addMode = body?.add_mode === 'abs' ? 'abs' : 'signed';
  if (mode === 'apply' && typeof body?.trust_month_year !== 'boolean') {
    return json(req, 400, { error: 'trust_month_year must be stated explicitly for apply' });
  }
  const trustMonthYear = body?.trust_month_year === true;

  const db = serviceClient();
  const tokenHash = await sha256(token);
  const { data: valid } = await db.rpc('import_check_token', { p_hash: tokenHash, p_consume: false });
  if (valid !== true) return json(req, 403, { error: 'forbidden' });

  const file = await db.storage.from('imports').download(object);
  if (file.error || !file.data) return json(req, 404, { error: 'file_not_found' });
  let backup;
  try {
    backup = JSON.parse(await file.data.text());
  } catch {
    return json(req, 400, { error: 'file_is_not_json' });
  }

  const result = analyze(backup, { addMode, trustMonthYear });
  const summary = summarize(result);
  const days = result.days as unknown as { computed_total: number }[];
  const expectedTotalSum = days.reduce((s, d) => s + d.computed_total, 0);
  const mismatches = result.anomalies.filter((a: { type: string }) => a.type === 'total_mismatch').slice(0, 40);
  const others = result.anomalies.filter((a: { type: string }) => a.type !== 'total_mismatch').slice(0, 40);

  if (mode === 'dry') {
    return json(req, 200, { mode, summary, expected: { days: result.days.length, total_sum: expectedTotalSum }, mismatches, others });
  }

  const payload = buildImportPayload(result);
  const totals = { methods: 0, days: 0, skipped: 0, months: 0 };
  const add = (r: { methods: number; days: number; skipped: number; months: number }) => {
    totals.methods += r.methods;
    totals.days += r.days;
    totals.skipped += r.skipped;
    totals.months += r.months;
  };
  const first = await db.rpc('import_sales_batch', { p_methods: payload.methods, p_days: [], p_months: payload.months });
  if (first.error) return json(req, 500, { error: 'batch_failed', stage: 'methods+months', detail: first.error.message });
  add(first.data);
  for (let i = 0; i < payload.days.length; i += CHUNK) {
    const r = await db.rpc('import_sales_batch', { p_methods: [], p_days: payload.days.slice(i, i + CHUNK), p_months: [] });
    if (r.error) return json(req, 500, { error: 'batch_failed', stage: `days ${i}`, detail: r.error.message, done_so_far: totals });
    add(r.data);
  }
  await db.rpc('import_check_token', { p_hash: tokenHash, p_consume: true });
  return json(req, 200, { mode, summary, applied: totals, expected: { days: result.days.length, total_sum: expectedTotalSum } });
});

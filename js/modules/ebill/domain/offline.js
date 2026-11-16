// Pure rules for working without a connection. They mirror what the server checks again at sync time, so a bill the screen
// accepts offline is very unlikely to be refused later, but the server always has the last word.
import { round2 } from './calc.js';

/** Total discount across lines, customer and receipt, as the server adds it up: { amount, pct } of the pre-discount gross. */
export function discountSummary(totals, lines) {
  const preGross = round2(lines.reduce((s, l) => s + round2((Number(l.rate) || 0) * (Number(l.qty) || 0)), 0));
  const amount = round2(totals.lineDiscounts + totals.customerDiscount + totals.receiptDiscount);
  return { amount, pct: preGross > 0 ? (amount * 100) / preGross : 0 };
}

/** { ok:true } or { ok:false, code:'discount_limit', message }. `limits` = { max_pct, max_amount, override }. */
export function checkDiscount(totals, lines, limits) {
  if (!limits || limits.override) return { ok: true };
  const d = discountSummary(totals, lines);
  if (d.pct > limits.max_pct + 0.0001 || d.amount > limits.max_amount) {
    return {
      ok: false,
      code: 'discount_limit',
      message: `The discount is above your limit (${limits.max_pct}% / Rs ${limits.max_amount}).`,
    };
  }
  return { ok: true };
}

/** A short reference to show for an invoice that has no server number yet, e.g. LOCAL-261115-3FA9. */
export function localRef(invoiceId, when = new Date()) {
  const d = new Date(when);
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `LOCAL-${ymd}-${String(invoiceId).replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

/** Why an upload threw, in the three ways that matter: no connection, not signed in, or something the server said. */
export function classifyError(e, online = true) {
  const msg = String(e?.message || e || '');
  if (!online || e?.status === 0 || /failed to fetch|networkerror|network request failed|load failed|timeout|offline/i.test(msg))
    return 'network';
  if (e?.status === 401 || /jwt|token|not authenticated|invalid claim/i.test(msg)) return 'auth';
  return 'server';
}

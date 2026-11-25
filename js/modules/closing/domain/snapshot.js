// The "Previous closing" card under each section: what the closing before this one entered for that section, as read-only rows.
// Pure functions over one book page (closing_book_own / closing_prev_page). Every figure is one the database stored or the
// cashier typed; nothing is calculated here except showing signs and labels.
import { DENOMINATIONS, reconciliation } from './compute.js';
import { fmt } from './sheet.js';
import { slotLabel } from './slots.js';

// amounts as the old app wrote them: "Rs. 1,200" (decimals only when there are some)
const M = (v) => `Rs. ${fmt(v)}`;

/** "Previous shift — 2026-11-14 · Closing 3 — Evening" */
export const prevTitle = (page) =>
  `Previous shift — ${page.business_date} · Closing ${page.day_no ?? '?'} — ${slotLabel(page.kind, page.seq)}`;
const num = (v) => Number(v) || 0;
const DENOM_LABEL = {
  5000: 'Rs. 5,000 notes',
  1000: 'Rs. 1,000 notes',
  500: 'Rs. 500 notes',
  100: 'Rs. 100 notes',
  50: 'Rs. 50 notes',
  20: 'Rs. 20 notes',
  10: 'Rs. 10 notes',
  1: 'Coins / loose change',
};

const cashRows = (cash, area) =>
  DENOMINATIONS.map((d) => {
    const qty = num((cash ?? []).find((c) => c.area === area && Number(c.denomination) === d)?.qty);
    return qty ? [DENOM_LABEL[d] ?? String(d), d === 1 ? M(qty) : `${qty} × ${M(d)} = ${M(qty * d)}`] : null;
  }).filter(Boolean);

/** Rows [label, value] for a section key of the ledger (see domain/sections.js), or [] when that closing had nothing there. */
export function snapshotRows(key, page) {
  const i = page?.inputs ?? {};
  const r = page?.results ?? {};
  switch (key) {
    case 'pos':
      return [
        ['System Cash Sales Total', M(i.sys_cash)],
        ['Last Bill Number', String(num(i.last_bill_no))],
        ['Last Bill Amount', M(i.last_bill_amt)],
        ['Computer Card Sale', M(i.comp_sale)],
        ['Bank Alfalah Card Machine', M(i.alfalah)],
        ['Keenu Card Machine', M(i.keenu)],
        ['Return 1', M(i.ret_manual_1)],
        ['Return 2', M(i.ret_manual_2)],
        ['Return 3', M(i.ret_manual_3)],
        ['System Return', M(i.ret_system)],
        ['Total Returns', M(r.total_returns)],
      ];
    case 'mediq': {
      const rows = (page.mediq ?? []).map((m) => [
        `Bill ${m.bill_no || '—'} — ${M(m.collected)} − ${M(m.pharmacy_bill)}`,
        M(num(m.collected) - num(m.pharmacy_bill)),
      ]);
      if (!rows.length) rows.push(['No COD orders that shift', '']);
      if (num(i.prev_mediq)) rows.push(['Previous MEDIQ amount collected', M(i.prev_mediq)]);
      return [...rows, ['Extra MEDIQ Collected', M(r.mediq_extra)]];
    }
    case 'shift':
      return [
        ["This Shift's Sales (delta)", M(r.shift_sale)],
        ['Book Bill 1', M(i.book_bill_1)],
        ['Book Bill 2', M(i.book_bill_2)],
        ['Customers This Shift (delta)', String(num(r.customers))],
        ['Net Sale (this shift)', M(r.net_sale)],
      ];
    case 'hs':
      return [
        ...(page.hs ?? []).filter((h) => num(h.amount) || h.label).map((h, n) => [h.label || `Row ${n + 1}`, M(h.amount)]),
        ['Total HS (A)', M(r.hs_total)],
      ];
    case 'strips': {
      const rows = (page.strips ?? [])
        .filter((s) => num(s.qty))
        .map((s) => [s.label, `${num(s.qty)} × ${M(s.price)} = ${M(num(s.qty) * num(s.price))}`]);
      if (!rows.length) rows.push(['No items sold that shift', '']);
      return [...rows, ['Total Inventory Revenue (B)', M(r.strips_a)]];
    }
    case 'invaudit': {
      const a = page.audit;
      return a
        ? [
            ['Verified', a.verified_at ? new Date(a.verified_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : ''],
            ['Codes checked', String(num(a.codes_checked))],
          ]
        : [['No inventory audit recorded', '']];
    }
    case 'misc':
      return [...(page.misc ?? []).map((m) => [m.label || 'Item', M(m.amount)]), ['Total Misc (C)', M(r.misc_g)]];
    case 'cc':
      return [
        ['Carried CC from Previous', M(num(r.cc_total) - num(r.cc_curr))],
        ['Card Sales This Shift (D)', M(r.cc_curr)],
        ['Total CC', M(r.cc_total)],
      ];
    case 'till':
      return [...cashRows(page.cash, 'till'), ['Total Till Cash (E)', M(r.till_c)]];
    case 'vault':
      return [...cashRows(page.cash, 'vault'), ['Total Draw Cash (F)', M(r.vault_d)]];
    case 'credit':
      return [
        ['Carried Debt from Previous Shift', M(i.prev_credit)],
        ['Credit Adjustment', M(i.credit_adj)],
        ...(page.credit ?? []).map((c) => [c.label || 'Credit', M(c.amount)]),
        ['Total Credit Detail (G)', M(r.debt_e)],
      ];
    case 'deposits':
      return [
        ['Carried Deposits from Previous', M(i.prev_deposits)],
        ...(page.deposits ?? []).filter((d) => num(d.amount)).map((d) => [d.label || 'Deposit', M(d.amount)]),
        ['Total Cash Deposits (H)', M(r.deposits_f)],
      ];
    case 'audit':
      return [
        ['Net Cash Available', M(r.liquid)],
        ["Less: Previous Shift's Cash Position", M(r.prev_cash)],
        ['Net Committed Cash (this shift)', M(r.net_cash)],
        ['Extra Cash Added to Pharmacy', M(i.extra_cash)],
        ['Variance', M(r.shift_variance)],
      ];
    case 'final-agg':
      return page?.mode === 'final'
        ? [
            ['Net Final Sale', M(r.final_net_sale)],
            ['Net Final Cash Available', M(r.final_net_cash)],
          ]
        : [];
    default:
      return [];
  }
}

/**
 * The "Aggregated Final Closing" card of a saved closing: the full period since the last Final, as the ledger's last section showed it
 * when the closing was typed: { target, cash, diff } in rupees, or null when there is nothing to show (the opening closing, or a page
 * without stored results).
 */
export function finalAggregate(page) {
  const r = page?.results;
  if (!page || page.is_opening || !r) return null;
  const sale = Number(r.final_net_sale);
  const cash = Number(r.final_net_cash);
  if (r.final_net_sale === null || r.final_net_cash === null || !Number.isFinite(sale) || !Number.isFinite(cash)) return null; // Number(undefined) is NaN
  return reconciliation({ final_net_sale: sale, final_net_cash: cash }, 'final');
}

/** Value shown beside each section in "View all", from the quick totals of the form (see localTotals). Sections without a total give ''. */
export function overviewValue(key, t, form) {
  const m = (paisa) => M(paisa / 100);
  const map = {
    pos: () => M(Number(String(form.sys_cash).replace(/,/g, '')) || 0),
    mediq: () => m(t.mediqExtra),
    hs: () => m(t.hs),
    strips: () => m(t.strips),
    misc: () => m(t.misc),
    cc: () => m(t.ccTotal),
    till: () => m(t.till),
    vault: () => m(t.vault),
    credit: () => m(t.debt),
    deposits: () => m(t.deposits),
  };
  return map[key]?.() ?? '';
}

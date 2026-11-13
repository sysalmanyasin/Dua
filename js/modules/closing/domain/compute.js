// Shift-closing maths. Pure functions: no DOM, no database, no network.
// Rules: docs/BUSINESS_RULES.md sections 4-6 (copied from the old Closing app's calc()).
// All money is INTEGER PAISA inside this file (D-13). Inputs arrive in rupees (what a person types and
// what the database stores as numeric(14,2)); results are returned in paisa.
// The SQL function closing_calc() must give identical answers: both run tests/fixtures/closing-cases.json.

// Cash-count denominations, in rupees, in screen order (C11, confirmed against the old DENOMS).
export const DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 1];

export const toPaisa = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) : 0;
};

const count = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
};

const live = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => !r.deleted);
const sumRows = (rows, key) => live(rows).reduce((t, r) => t + toPaisa(r[key]), 0);
const sumList = (list) => (Array.isArray(list) ? list : []).reduce((t, v) => t + toPaisa(v), 0);

// counts[i] notes or coins of DENOMINATIONS[i]
export const cashTotal = (counts) =>
  DENOMINATIONS.reduce((t, d, i) => {
    const q = Number(counts?.[i]);
    return t + (Number.isFinite(q) ? Math.round(q * d * 100) : 0);
  }, 0);

// An override is "set" only when it is not null/undefined/empty. A typed 0 is a real override.
const hasOverride = (v) => v !== null && v !== undefined && v !== '';

function requireSettings(s) {
  if (!s || !Number.isFinite(Number(s.till_float)) || !Number.isFinite(Number(s.per_customer_charge))) {
    throw new Error('closing settings (till_float, per_customer_charge) are required');
  }
}

/**
 * @param {object} input  see tests/fixtures/closing-cases.json for the full shape
 * @returns {object} results, money in paisa; `customers` is a plain count; final_variance is null in shift mode
 */
export function computeClosing(input) {
  const s = input.settings;
  requireSettings(s);
  const isFinal = input.mode === 'final';
  const tillFloat = toPaisa(s.till_float);
  const charge = toPaisa(s.per_customer_charge);
  const pos = input.pos ?? {};
  const ov = input.overrides ?? {};
  const prev = input.prev ?? {};
  const carried = input.carried ?? {};
  const agg = input.agg ?? {};
  const credit = input.credit ?? {};

  const hsTotal = sumRows(input.hs, 'v');
  const stripsA = live(input.strips).reduce((t, r) => t + Math.round(toPaisa(r.price) * (Number(r.qty) || 0)), 0);
  const manual = [0, 1, 2].map((i) => toPaisa(input.returns?.manual?.[i]));
  const sysReturn = toPaisa(input.returns?.system);
  const totalReturns = manual[0] + manual[1] + manual[2] + sysReturn;
  const mediqExtra = toPaisa(input.prev_mediq) + live(input.mediq).reduce((t, r) => t + toPaisa(r.collected) - toPaisa(r.bill), 0);

  const sysCash = toPaisa(pos.sys_cash);
  const prevExists = Boolean(prev.exists);
  const sale = isFinal || prev.day_changed || !prevExists ? sysCash : sysCash - toPaisa(prev.sys_cash);
  const shiftSale = hasOverride(ov.shift_sale) ? toPaisa(ov.shift_sale) : sale;
  const bills = prevExists ? Math.max(0, count(pos.last_bill_no) - count(prev.last_bill_no)) : 0;
  const customers = hasOverride(ov.customers) ? count(ov.customers) : bills;
  const customersCharge = customers * charge;
  const book = toPaisa(input.book?.[0]) + toPaisa(input.book?.[1]);

  const netSale = shiftSale + book + customersCharge - totalReturns + mediqExtra;

  const ccCurr = hasOverride(ov.curr_cc) ? toPaisa(ov.curr_cc) : toPaisa(pos.alfalah) + toPaisa(pos.keenu) - toPaisa(pos.comp_sale);
  const ccTotal = toPaisa(carried.cc) + ccCurr;

  const tillC = cashTotal(input.till);
  const vaultD = cashTotal(input.vault);
  const debtE =
    toPaisa(carried.credit) + sumRows(credit.named, 'v') + sumList(credit.tier) + sumRows(credit.free, 'v') + toPaisa(input.credit_adj);
  const depositsF = toPaisa(carried.deposits) + sumRows(input.deposits, 'v');
  const miscG = sumRows(input.misc, 'v');

  const grand = hsTotal + stripsA + miscG + ccTotal + tillC + vaultD + debtE + depositsF;
  const liquid = grand - tillFloat;
  const prevCash = hasOverride(ov.prev_cash) ? toPaisa(ov.prev_cash) : toPaisa(carried.cash);
  const extraCash = toPaisa(input.extra_cash);
  const netCash = liquid - prevCash - extraCash;
  const shiftVariance = netCash - netSale; // each shift keeps its OWN variance (C7)

  // Period roll-up since the last Final. A Final uses only its own values (BUSINESS_RULES section 5).
  const A = (k) => (isFinal ? 0 : toPaisa(agg[k]));
  const N = (k) => (isFinal ? 0 : count(agg[k]));
  const sameCust = (isFinal ? 0 : N('same_date_customers') + N('lf_same_date_cust')) + customers;
  const preCust = N('pre_date_customers') + N('lf_pre_date_cust');
  const finalNetSale =
    A('same_date_shift_sale') +
    A('lf_same_date_sale') +
    shiftSale +
    (A('total_book_bills') + book) +
    sameCust * charge +
    (A('total_mediq_extra') + mediqExtra) -
    (A('total_manual_returns') + manual[0] + manual[1] + manual[2]) -
    (A('same_date_sys_returns') + A('lf_same_date_sys_ret') + sysReturn) -
    toPaisa(input.final_sys_returns);
  const preDateTotal =
    A('pre_date_shift_sale') + A('lf_pre_date_sale') + preCust * charge - (A('pre_date_sys_returns') + A('lf_pre_date_sys_ret'));
  const finalNetCash = liquid - preDateTotal - (A('total_extra_cash') + extraCash) - finalNetSale;

  return {
    customers_charge: customersCharge,
    hs_total: hsTotal,
    strips_a: stripsA,
    total_returns: totalReturns,
    mediq_extra: mediqExtra,
    shift_sale: shiftSale,
    customers,
    net_sale: netSale,
    cc_curr: ccCurr,
    cc_total: ccTotal,
    till_c: tillC,
    vault_d: vaultD,
    debt_e: debtE,
    deposits_f: depositsF,
    misc_g: miscG,
    grand,
    liquid,
    prev_cash: prevCash,
    net_cash: netCash,
    shift_variance: shiftVariance,
    final_net_sale: finalNetSale,
    final_net_cash: finalNetCash,
    final_variance: isFinal ? finalNetCash : null,
  };
}

// Plus / Less / Even label and arrow for the screens (status is never colour-only).
export function varianceLabel(paisa) {
  if (paisa === null || paisa === undefined) return { word: '', arrow: '' };
  if (paisa === 0) return { word: 'Even', arrow: '✓' };
  return paisa > 0 ? { word: 'Plus', arrow: '▲' } : { word: 'Less', arrow: '▼' };
}

// Daily sales maths. Pure functions: no DOM, no database. The database function sales_compute_total()
// must give the same answers (both are tested against tests/fixtures/sales-total-cases.json).

// Rounds like JavaScript Math.round, which the original app used and the database copies.
export const roundRupee = (x) => Math.floor(x + 0.5);

export const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// methods: [{ code, sign: 'add' | 'sub' | 'none' }]; lines: [{ method, amount }]
export function computeTotal(lines, methods) {
  const sign = new Map(methods.map((m) => [m.code, m.sign]));
  let t = 0;
  for (const { method, amount } of lines) {
    const s = sign.get(method);
    const a = toNumber(amount);
    if (s === 'add') t += a;
    else if (s === 'sub') t -= Math.abs(a);
  }
  return roundRupee(t);
}

export const computeDiff = (total, compSale) => roundRupee(total - toNumber(compSale));

// Percentage change helper used by the dashboard; null when there is no base to compare with.
export const percentChange = (now, before) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

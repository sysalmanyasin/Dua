// Sales Dashboard maths. Pure functions: no DOM, no database. Rules are carried over from the original app;
// two comparisons were made like-for-like (see D-32 in docs/DECISIONS.md).
export const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const n = (v) => Number(v) || 0;
const round = (x) => Math.floor(x + 0.5);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const pct = (now, before) => (before ? ((now - before) / Math.abs(before)) * 100 : null);
const pctNum = (now, before) => pct(now, before) ?? 0;

export const ymOf = (iso) => iso.slice(0, 7);
export const monthLabelShort = (key) => `${MS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
export const daysInMonth = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();

// ── data shapes ──
export function normalizeMonths(rows) {
  return rows
    .map((r) => {
      const key = String(r.month).slice(0, 7);
      return {
        key,
        year: Number(key.slice(0, 4)),
        mi: Number(key.slice(5, 7)) - 1,
        total: n(r.total),
        comp: r.comp_sale === null || r.comp_sale === undefined ? null : n(r.comp_sale),
        customers: n(r.customers),
        days: n(r.days),
        cash: n(r.cash),
        banks: n(r.banks),
        credit: n(r.credit),
        monthlyOnly: Boolean(r.monthly_only),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
export function normalizeDays(rows) {
  return rows
    .map((r) => {
      const date = String(r.business_date).slice(0, 10);
      return {
        date,
        ym: ymOf(date),
        day: Number(date.slice(8, 10)),
        wd: new Date(`${date}T00:00:00Z`).getUTCDay(),
        total: n(r.total),
        comp: r.comp_sale === null || r.comp_sale === undefined ? null : n(r.comp_sale),
        customers: n(r.customers),
        cash: n(r.cash),
        banks: n(r.banks),
        credit: n(r.credit),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── CAGR and score (as in the original) ──
export function cagr(chrono) {
  if (chrono.length < 24) return null;
  const first12 = chrono.slice(0, 12).reduce((s, m) => s + m.total, 0);
  const last12 = chrono.slice(-12).reduce((s, m) => s + m.total, 0);
  const span = (chrono.length - 12) / 12;
  if (first12 <= 0 || span <= 0) return null;
  return (Math.pow(last12 / first12, 1 / span) - 1) * 100;
}

// ── headline numbers ──
// months/days are the normalized arrays; targets maps "YYYY-MM" to a number; todayIso is today in Pakistan.
export function computeKpis(months, days, targets, todayIso) {
  const curKey = ymOf(todayIso);
  const chrono = months.filter((m) => m.key <= curKey);
  if (chrono.length < 2) return null;
  const lat = chrono.at(-1);
  const prv = chrono.at(-2);
  const isLive = lat.key === curKey;
  const filled = days.filter((d) => d.ym === lat.key && d.total > 0);
  const D = isLive ? Math.max(0, ...filled.map((d) => d.day)) : 0;

  // Month-to-date for any month up to day D; a month with no daily detail falls back to its full figures.
  const mtd = (key) => {
    const rows = days.filter((d) => d.ym === key && d.day <= D);
    const full = chrono.find((m) => m.key === key);
    if (!rows.length && full) return { total: full.total, cash: full.cash + full.banks, credit: full.credit, customers: full.customers };
    return rows.reduce(
      (a, d) => ({
        total: a.total + d.total,
        cash: a.cash + d.cash + d.banks,
        credit: a.credit + d.credit,
        customers: a.customers + d.customers,
      }),
      { total: 0, cash: 0, credit: 0, customers: 0 },
    );
  };
  const prvAt = isLive ? mtd(prv.key) : { total: prv.total, cash: prv.cash + prv.banks, credit: prv.credit, customers: prv.customers };

  const prevYearKey = `${lat.year - 1}-${String(lat.mi + 1).padStart(2, '0')}`;
  const yoyFull = chrono.find((m) => m.key === prevYearKey);
  const yoyAt = isLive ? (yoyFull ? mtd(prevYearKey) : null) : yoyFull ? { total: yoyFull.total } : null;

  const ytd = chrono.filter((m) => m.year === lat.year).reduce((s, m) => s + m.total, 0);
  const pYtd = chrono.filter((m) => m.year === lat.year - 1 && m.mi < lat.mi).reduce((s, m) => s + m.total, 0) + (yoyAt ? yoyAt.total : 0);

  const tgt = targets[lat.key] ?? null;
  const latDays = days.filter((d) => d.ym === lat.key && d.total > 0).length;
  const dim = daysInMonth(lat.key);
  const elapsed = isLive ? D : latDays;
  const dailyAvg = elapsed ? lat.total / elapsed : 0;
  const forecastTotal = isLive ? dailyAvg * dim : lat.total;

  const comps = [];
  if (tgt) comps.push(clamp((lat.total / tgt) * 100, 0, 100));
  if (yoyAt) comps.push(clamp(50 + pctNum(lat.total, yoyAt.total) * 2.5, 0, 100));
  comps.push(clamp(50 + pctNum(lat.customers, prvAt.customers) * 2.5, 0, 100));

  return {
    lat,
    prv,
    isLive,
    D,
    daysInMonth: dim,
    latDays,
    mtd: { total: lat.total, cash: lat.cash + lat.banks, credit: lat.credit, customers: lat.customers },
    prvAt,
    yoyAt,
    vs: {
      total: pct(lat.total, prvAt.total),
      cash: pct(lat.cash + lat.banks, prvAt.cash),
      credit: pct(lat.credit, prvAt.credit),
      customers: pct(lat.customers, prvAt.customers),
      avgBill: pct(lat.customers ? lat.total / lat.customers : 0, prvAt.customers ? prvAt.total / prvAt.customers : 0),
      ytd: pct(ytd, pYtd),
    },
    ytd,
    pYtd,
    year: lat.year,
    avgBill: lat.customers ? lat.total / lat.customers : 0,
    target: tgt,
    dailyAvg,
    forecastTotal,
    forecastVsTarget: tgt ? pct(forecastTotal, tgt) : null,
    cagr: cagr(chrono),
    score: Math.round(comps.reduce((a, b) => a + b, 0) / comps.length),
    cumDiff: chrono.reduce((s, m) => s + (m.comp ? round(m.total - m.comp) : 0), 0),
    grandTotal: chrono.reduce((s, m) => s + m.total, 0),
    recordedDays: days.filter((d) => d.total > 0).length,
  };
}

// ── chart data ──
export const PRESETS = ['3M', '6M', '12M', '24M', 'YTD', 'ALL'];
export function presetSlice(rows, preset) {
  if (!rows.length) return [];
  const k = { '3M': 3, '6M': 6, '12M': 12, '24M': 24 }[preset];
  if (k) return rows.slice(-k);
  if (preset === 'YTD') return rows.filter((r) => r.year === rows.at(-1).year);
  return rows.slice();
}
// The period just before the chosen one, so "Compare" overlays like with like.
export function comparePeriod(rows, preset) {
  if (!rows.length || preset === 'ALL') return [];
  const k = { '3M': 3, '6M': 6, '12M': 12, '24M': 24 }[preset];
  if (k) {
    const prev = rows.slice(Math.max(0, rows.length - 2 * k), rows.length - k);
    return prev.length === k ? prev : [];
  }
  const last = rows.at(-1);
  return rows.filter((r) => r.year === last.year - 1 && r.mi <= last.mi);
}
export function totalChart(months, preset, compare) {
  const cur = presetSlice(months, preset);
  const datasets = [{ label: 'Total', data: cur.map((m) => m.total), keys: cur.map((m) => m.key) }];
  let labels = cur.map((m) => monthLabelShort(m.key));
  if (compare) {
    const prev = comparePeriod(months, preset);
    if (prev.length) {
      const len = Math.max(cur.length, prev.length);
      const pad = (a, len2) =>
        Array(len2 - a.length)
          .fill(null)
          .concat(a);
      datasets[0].data = pad(datasets[0].data, len);
      datasets.push({
        label: 'Previous period',
        data: pad(
          prev.map((m) => m.total),
          len,
        ),
      });
      labels = pad(labels, len).map((l, i) => l ?? monthLabelShort(prev[i - (len - prev.length)].key));
    }
  }
  return { labels, datasets };
}
export const yearsOf = (months) => [...new Set(months.map((m) => m.year))].sort();
export const filterYear = (months, year) => (year === 'all' ? months : months.filter((m) => m.year === Number(year)));
export const cashBankChart = (months) => ({
  labels: months.map((m) => monthLabelShort(m.key)),
  datasets: [
    { label: 'Cash', data: months.map((m) => m.cash) },
    { label: 'Banks', data: months.map((m) => m.banks) },
  ],
});
export const customersChart = (months) => ({
  labels: months.map((m) => monthLabelShort(m.key)),
  datasets: [{ label: 'Customers', data: months.map((m) => m.customers) }],
});
export const clientsChart = (clients, top = 10) => {
  const list = clients
    .map((c) => ({ label: c.label, value: n(c.total) }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
  return { labels: list.map((c) => c.label), data: list.map((c) => c.value) };
};
export function yoyChart(months) {
  return {
    labels: MS,
    datasets: yearsOf(months).map((y) => ({
      label: String(y),
      data: MS.map((_, i) => months.find((m) => m.year === y && m.mi === i)?.total ?? null),
    })),
  };
}

// ── tables ──
export const summaryRows = (months, count = 12) =>
  months
    .slice(-count)
    .reverse()
    .map((m) => ({ ...m, diff: m.comp ? round(m.total - m.comp) : null }));
export const topDays = (days, count = 10) =>
  [...days]
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, count);
export function dayOfWeek(days) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const rows = names.map((name, wd) => {
    const list = days.filter((d) => d.wd === wd && d.total > 0);
    return { wd, name, count: list.length, avg: list.length ? list.reduce((s, d) => s + d.total, 0) / list.length : 0 };
  });
  const max = Math.max(...rows.map((r) => r.avg), 1);
  return rows.map((r) => ({ ...r, share: r.avg / max }));
}
// Best and worst complete month in each year (the running month is left out: it is not finished).
export function bestWorst(months, todayIso) {
  const done = months.filter((m) => m.key < ymOf(todayIso) && m.total > 0);
  return yearsOf(done).map((y) => {
    const list = done.filter((m) => m.year === y);
    const best = list.reduce((a, b) => (b.total > a.total ? b : a));
    const worst = list.reduce((a, b) => (b.total < a.total ? b : a));
    return { year: y, best, worst, months: list.length };
  });
}

// Calendar heat map: one cell per day, shaded by quartile among that year's own sale days.
export function heatmapYear(days, year) {
  const inYear = days.filter((d) => d.date.startsWith(`${year}-`) && d.total > 0);
  const sorted = inYear.map((d) => d.total).sort((a, b) => a - b);
  const at = (p) => sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
  const q1 = at(0.25);
  const q2 = at(0.5);
  const q3 = at(0.75);
  const level = (v) => (v <= 0 ? 0 : v <= q1 ? 1 : v <= q2 ? 2 : v <= q3 ? 3 : 4);
  const byDate = new Map(inYear.map((d) => [d.date, d.total]));
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const offset = (start.getUTCDay() + 6) % 7; // week starts on Monday
  const cells = [];
  for (let t = start, i = 0; t <= end; t = new Date(t.getTime() + 86_400_000), i++) {
    const date = t.toISOString().slice(0, 10);
    const total = byDate.get(date) ?? 0;
    cells.push({ date, total, level: level(total), col: Math.floor((i + offset) / 7), row: (i + offset) % 7 });
  }
  return { year, cells, cols: Math.floor((cells.length - 1 + offset) / 7) + 1, thresholds: [q1, q2, q3], saleDays: inYear.length };
}

// ── insights (plain rules, no guessing) ──
export function buildInsights(k, days, todayIso) {
  if (!k) return [];
  const out = [];
  if (k.isLive && k.target) {
    const left = k.daysInMonth - k.D;
    const need = left > 0 ? Math.max(0, (k.target - k.lat.total) / left) : 0;
    out.push({
      id: 'pace',
      tone: k.forecastTotal >= k.target ? 'good' : 'warn',
      title: 'Target pace',
      text:
        left > 0
          ? `To reach the target you need ₨${round(need).toLocaleString('en-US')} a day for the next ${left} days. The current average is ₨${round(k.dailyAvg).toLocaleString('en-US')}.`
          : 'The month is over.',
    });
  }
  const past = days.filter((d) => d.date < todayIso && d.total > 0);
  const last = past.at(-1);
  if (last) {
    const same = past.filter((d) => d.wd === last.wd && d.date < last.date).slice(-8);
    if (same.length >= 3) {
      const avg = same.reduce((s, d) => s + d.total, 0) / same.length;
      const change = pct(last.total, avg);
      const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][last.wd];
      out.push({
        id: 'weekday',
        tone: change >= 0 ? 'good' : 'warn',
        title: `Last ${name}`,
        text: `₨${round(last.total).toLocaleString('en-US')} is ${Math.abs(change).toFixed(1)}% ${change >= 0 ? 'above' : 'below'} the average of the previous ${same.length} ${name}s.`,
      });
    }
    const window = past.slice(-90);
    if (window.length >= 30 && last.total === Math.max(...window.map((d) => d.total))) {
      out.push({
        id: 'record',
        tone: 'good',
        title: 'Best day in 90 days',
        text: `${last.date} sold ₨${round(last.total).toLocaleString('en-US')}, the highest of the last ${window.length} sale days.`,
      });
    }
  }
  if (k.vs.total !== null) {
    out.push({
      id: 'mom',
      tone: k.vs.total >= 0 ? 'good' : 'warn',
      title: k.isLive ? `Month so far (days 1–${k.D})` : 'Month against the one before',
      text: `${Math.abs(k.vs.total).toFixed(1)}% ${k.vs.total >= 0 ? 'ahead of' : 'behind'} the previous month${k.isLive ? ' over the same days' : ''}.`,
    });
  }
  return out;
}

// "Race the Forecast": how far along the month is against target and where the pace is heading.
export function raceData(k) {
  if (!k || !k.target) return null;
  const top = Math.max(k.target, k.forecastTotal, k.lat.total) || 1;
  return {
    actual: k.lat.total,
    target: k.target,
    forecast: k.forecastTotal,
    actualPct: (k.lat.total / top) * 100,
    targetPct: (k.target / top) * 100,
    forecastPct: (k.forecastTotal / top) * 100,
    onTrack: k.forecastTotal >= k.target,
  };
}

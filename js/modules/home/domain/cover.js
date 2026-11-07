// What the Cover page shows. Pure functions: the database decides what a person may see;
// this only turns the summary it returns into cards and to-do items.
import { dateNice } from '../../sales/domain/checklist.js';

export function greeting(hourPkt) {
  if (hourPkt < 5) return 'Good night';
  if (hourPkt < 12) return 'Good morning';
  if (hourPkt < 17) return 'Good afternoon';
  return 'Good evening';
}

export const hourInPkt = (now = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', hour12: false }).format(now)) % 24;

const pct = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);

// Cards for the top row, in order. A card is left out when the person may not see that figure.
export function buildKpis(summary) {
  const s = summary?.sales;
  if (!s) return [];
  const cards = [];
  if (s.last_day) {
    cards.push({
      id: 'latest',
      label: 'Latest sale',
      value: Number(s.last_day.total),
      date: s.last_day.date,
      diff: s.last_day.has_comp === true ? Number(s.last_day.diff) : null,
      href: '#/sales/yesterday',
    });
  }
  if (s.mtd) {
    const total = Number(s.mtd.total);
    cards.push({
      id: 'mtd',
      label: 'This month so far',
      value: total,
      days: s.mtd.days,
      vsLastYear: pct(total, Number(s.mtd.last_year_total)),
      month: s.month,
      href: '#/sales',
    });
    if (s.target) {
      const t = Number(s.target);
      cards.push({
        id: 'target',
        label: 'Monthly target',
        target: t,
        value: total,
        pct: Math.min(100, Math.round((total / t) * 100)),
        remaining: Math.max(0, t - total),
        href: '#/sales/report',
      });
    }
  }
  if (s.last_day && s.last_day.customers !== undefined && s.last_day.customers !== null) {
    cards.push({ id: 'customers', label: 'Customers (last day)', value: Number(s.last_day.customers), date: s.last_day.date });
  }
  return cards;
}

// Things that need doing, most urgent first.
export function buildAttention(summary, perms, hourPkt) {
  const items = [];
  const can = (p) => perms.includes(p);
  const s = summary?.sales;
  for (const d of s?.missing_days ?? []) {
    items.push({
      id: `missing-${d}`,
      text: `Sales for ${dateNice(d)} have not been entered`,
      action: can('sales.enter') ? { label: 'Add entry', href: '#/sales/entry', handoff: d } : null,
    });
  }
  if (summary?.checklist && summary.checklist.today_exists === false && hourPkt >= 16 && can('checklist.fill')) {
    items.push({
      id: 'checklist',
      text: "Today's check list has not been started",
      action: { label: 'Open check list', href: '#/sales/checklist' },
    });
  }
  if (s && s.mtd && !s.target && can('targets.manage')) {
    items.push({ id: 'target', text: 'No sales target is set for this month', action: { label: 'Set target', href: '#/sales/report' } });
  }
  return items;
}

// Tiles for every page the person can open, grouped by section. `modules` comes from the app shell,
// already filtered by permission, so nothing is offered that would be refused.
export function buildTiles(modules) {
  return modules
    .filter((m) => m.id !== 'home')
    .map((m) => ({
      id: m.id,
      title: m.title,
      icon: m.icon,
      pages: m.routes.filter((r) => r.title).map((r) => ({ title: r.title, desc: r.desc ?? '', href: `#${r.path}` })),
    }))
    .filter((g) => g.pages.length);
}

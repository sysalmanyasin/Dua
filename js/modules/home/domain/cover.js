// Pure presentation helpers for the Home command centre. The shell supplies permission-filtered modules.
import { alertLabel } from '../../../shared/alerts.js';
import { dateNice } from '../../sales/domain/checklist.js';

export function greeting(hourPkt) {
  if (hourPkt < 5) return 'Good night';
  if (hourPkt < 12) return 'Good morning';
  if (hourPkt < 17) return 'Good afternoon';
  return 'Good evening';
}

export const hourInPkt = (now = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    hour12: false,
  }).format(now)) % 24;

const pct = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);

// Cards appear only when the database summary contains data for this person's permissions.
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
      const target = Number(s.target);
      cards.push({
        id: 'target',
        label: 'Monthly target',
        target,
        value: total,
        pct: Math.min(100, Math.round((total / target) * 100)),
        remaining: Math.max(0, target - total),
        href: '#/sales/report',
      });
    }
  }

  if (s.last_day && s.last_day.customers !== undefined && s.last_day.customers !== null) {
    cards.push({
      id: 'customers',
      label: 'Customers (last day)',
      value: Number(s.last_day.customers),
      date: s.last_day.date,
    });
  }

  return cards;
}

export function buildStockCards(cover) {
  if (!cover || typeof cover !== 'object') return [];

  const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const part = (value) => ({ count: n(value?.count), value: n(value?.value) });
  const reorder = part(cover.reorder);
  const notSold = part(cover.notSold);
  const excess = part(cover.excess);

  return [
    {
      id: 'stock',
      label: 'Stock value',
      value: n(cover.stockValue),
      sub: 'at selling price',
      href: '#/inventory/health',
    },
    {
      id: 'reorder',
      label: 'To reorder',
      value: reorder.value,
      count: reorder.count,
      sub: 'to buy up to 30 days',
      href: '#/inventory/reorder',
    },
    {
      id: 'notsold',
      label: 'Not selling',
      value: notSold.value,
      count: notSold.count,
      sub: 'whole packs, 60 days',
      href: '#/inventory/ledger',
    },
    {
      id: 'excess',
      label: 'Excess',
      value: excess.value,
      count: excess.count,
      sub: '200+ days of cover',
      href: '#/inventory/excess',
    },
  ];
}

export function buildAlertItems(alerts, perms) {
  if (!alerts || !Array.isArray(alerts.items)) return [];

  const out = alerts.items.map((notification) => {
    const what = alertLabel(notification.kind);
    const note = notification.status === 'failed'
      ? 'the alert could not be delivered'
      : 'the alert has not been sent yet';

    return {
      id: `alert-${notification.id}`,
      text: `${what} (${note})`,
      action: perms.includes('notifications.view') && perms.includes('tools.view')
        ? { label: 'Review', href: '#/tools' }
        : null,
    };
  });

  const more = Number(alerts.failed ?? 0) + Number(alerts.stuck ?? 0) - out.length;
  if (more > 0) {
    out.push({
      id: 'alert-more',
      text: `${more} more alert${more === 1 ? '' : 's'} need a look`,
      action: null,
    });
  }

  return out;
}

export function buildAttention(summary, perms, hourPkt, alerts = null) {
  const items = buildAlertItems(alerts, perms);
  const can = (permission) => perms.includes(permission);
  const sales = summary?.sales;

  for (const day of sales?.missing_days ?? []) {
    items.push({
      id: `missing-${day}`,
      text: `Sales for ${dateNice(day)} have not been entered`,
      action: can('sales.enter') || can('sales.edit')
        ? { label: 'Add entry', href: '#/sales/entry', handoff: day }
        : null,
    });
  }

  if (
    summary?.checklist &&
    summary.checklist.today_exists === false &&
    hourPkt >= 16 &&
    can('checklist.fill')
  ) {
    items.push({
      id: 'checklist',
      text: "Today's check list has not been started",
      action: { label: 'Open check list', href: '#/sales/checklist' },
    });
  }

  if (
    sales &&
    sales.mtd &&
    !sales.target &&
    can('targets.manage') &&
    can('sales.view_history')
  ) {
    items.push({
      id: 'target',
      text: 'No sales target is set for this month',
      action: { label: 'Set target', href: '#/sales/report' },
    });
  }

  return items;
}

// Daily progress is intentionally limited to facts returned by cover_summary().
export function buildDailyProgress(summary, perms) {
  const items = [];

  if (summary?.checklist && (perms.includes('checklist.view') || perms.includes('checklist.fill'))) {
    const started = summary.checklist.today_exists === true;
    items.push({
      id: 'checklist',
      label: 'Daily check list',
      status: started ? 'Started' : 'Not started',
      started,
      href: '#/sales/checklist',
    });
  }

  const missing = summary?.sales?.missing_days ?? [];
  if (perms.includes('sales.view_history') && missing.length) {
    items.push({
      id: 'sales',
      label: 'Sales entries',
      status: `${missing.length} day${missing.length === 1 ? '' : 's'} to review`,
      complete: false,
      href: perms.includes('sales.enter') || perms.includes('sales.edit') ? '#/sales/entry' : null,
    });
  }

  return items;
}

export function buildTiles(modules) {
  return modules
    .filter((module) => module.id !== 'home')
    .map((module) => ({
      id: module.id,
      title: module.title,
      icon: module.icon,
      blurb: module.blurb ?? '',
      pages: module.routes
        .filter((route) => route.title)
        .map((route) => ({
          title: route.title,
          desc: route.desc ?? '',
          href: `#${route.path}`,
        })),
    }))
    .filter((group) => group.pages.length);
}

export function buildQuickActions(modules, limit = 4) {
  const pages = buildTiles(modules).flatMap((group) =>
    group.pages.map((page) => ({ ...page, module: group.title })),
  );
  const preferred = pages.filter((page) =>
    /add|new|create|entry|invoice|closing|point of sale|pos/i.test(
      `${page.title} ${page.desc} ${page.href}`,
    ),
  );

  return (preferred.length ? preferred : pages).slice(0, limit);
}

export function searchPages(modules, query) {
  const q = String(query ?? '').trim().toLocaleLowerCase();
  if (!q) return [];

  return buildTiles(modules)
    .flatMap((group) => group.pages.map((page) => ({ ...page, module: group.title })))
    .filter((page) =>
      `${page.title} ${page.module} ${page.desc}`.toLocaleLowerCase().includes(q),
    )
    .slice(0, 12);
}

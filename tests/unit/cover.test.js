// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAlertItems,
  buildAttention,
  buildKpis,
  buildLifetimeSales,
  buildStockCards,
  buildTiles,
  greeting,
  hourInPkt,
} from '../../js/modules/home/domain/cover.js';

const full = {
  sales: {
    last_day: { date: '2026-11-04', total: 614758, diff: 24977, customers: 639, has_comp: true },
    mtd: { total: 3171201, days: 5, last_year_total: 2000000 },
    target: 16500000,
    month: '2026-11-01',
    missing_days: ['2026-11-03'],
  },
  checklist: { today_exists: false },
};

describe('greeting', () => {
  it('follows the Pakistan hour', () => {
    expect([2, 9, 14, 19].map(greeting)).toEqual(['Good night', 'Good morning', 'Good afternoon', 'Good evening']);
    expect(hourInPkt(new Date('2026-11-05T18:30:00Z'))).toBe(23);
    expect(hourInPkt(new Date('2026-11-05T19:05:00Z'))).toBe(0);
  });
});

describe('lifetime sales', () => {
  it('adds daily and monthly-only history once, from April 2020 through the current month', () => {
    const rows = [
      { month: '2020-03-01', days: 31, total: 999 },
      { month: '2020-04-01', days: 30, total: 1000 },
      { month: '2020-05-01', days: 0, total: 250 },
      { month: '2026-12-01', days: 31, total: 5000 },
    ];
    expect(buildLifetimeSales(rows, '2026-11-18')).toEqual({ total: 1250, months: 2, recordedDays: 30 });
  });
  it('returns no hero when there are no eligible months', () => {
    expect(buildLifetimeSales([], '2026-11-18')).toBeNull();
    expect(buildLifetimeSales([{ month: '2020-03-01', total: 1 }], '2026-11-18')).toBeNull();
  });
});

describe('key numbers', () => {
  it('owner sees latest sale, month so far, target and customers', () => {
    const k = buildKpis(full, ['sales.view_history', 'sales.view_last_day']);
    expect(k.map((c) => c.id)).toEqual(['latest', 'mtd', 'target', 'customers']);
    expect(k[0]).toMatchObject({ value: 614758, diff: 24977, href: '#/sales/yesterday' });
    expect(k[1].vsLastYear).toBeCloseTo(58.56, 1);
    expect(k[2]).toMatchObject({ pct: 19, remaining: 13328799 });
  });
  it('a person with last-day access only gets one card and nothing else', () => {
    const k = buildKpis({ sales: { last_day: { date: '2026-11-04', total: 614758 } } });
    expect(k.map((c) => c.id)).toEqual(['latest']);
    expect(k[0].diff).toBeNull();
    expect(buildKpis({ sales: { last_day: { date: '2026-11-04', total: 1 } } }, ['sales.view_last_day'])[0].href).toBe('#/sales/yesterday');
    expect(buildKpis({ sales: { last_day: { date: '2026-11-04', total: 1 } } }, ['sales.view_history'])[0].href).toBe('#/sales');
  });
  it('no target, no last-year figure, no data: cards are simply left out or blank', () => {
    expect(
      buildKpis({ sales: { last_day: null, mtd: { total: 0, days: 0, last_year_total: 0 }, target: null, month: '2026-11-01' } }).map(
        (c) => c.id,
      ),
    ).toEqual(['mtd']);
    expect(buildKpis({ sales: { mtd: { total: 5, days: 1, last_year_total: 0 }, month: '2026-11-01' } })[0].vsLastYear).toBeNull();
    expect(buildKpis(null)).toEqual([]);
  });
});

describe('needs attention', () => {
  it('lists missing days, an unstarted check list in the evening, and a missing target, only for people who can act', () => {
    const noTarget = { ...full, sales: { ...full.sales, target: null } };
    const t = buildAttention(noTarget, ['sales.view_history', 'sales.enter', 'checklist.fill', 'targets.manage'], 19);
    expect(t.map((i) => i.id)).toEqual(['missing-2026-11-03', 'checklist', 'target']);
    expect(t[0].action).toMatchObject({ href: '#/sales/entry', handoff: '2026-11-03' });
  });
  it('does not nag about the check list in the morning', () => {
    expect(buildAttention(full, ['checklist.fill'], 9).some((i) => i.id === 'checklist')).toBe(false);
  });
  it('shows a missing day without a button when the person cannot enter sales', () => {
    const t = buildAttention({ sales: { missing_days: ['2026-11-03'] } }, [], 12);
    expect(t[0].action).toBeNull();
  });
  it('is empty when everything is done', () => {
    expect(
      buildAttention(
        { sales: { missing_days: [], mtd: {}, target: 5 }, checklist: { today_exists: true } },
        ['targets.manage', 'checklist.fill'],
        20,
      ),
    ).toEqual([]);
  });
});

describe('owner alerts in needs attention', () => {
  const alerts = {
    failed: 2,
    stuck: 1,
    items: [
      { id: 'a1', kind: 'backup.failed', status: 'failed', attempts: 5 },
      { id: 'a2', kind: 'inventory.sync_stale', status: 'pending', attempts: 0 },
    ],
  };
  it('puts failed and unsent alerts first, with a link for people who can view them', () => {
    const t = buildAttention(full, ['notifications.view', 'tools.view'], 9, alerts);
    expect(t[0]).toMatchObject({ id: 'alert-a1', text: 'The daily backup failed (the alert could not be delivered)' });
    expect(t[0].action).toMatchObject({ href: '#/tools' });
    expect(t[1].text).toContain('has not been sent yet');
    expect(t.at(2).id).toBe('alert-more');
  });
  it('shows no link to someone without the permission', () => {
    expect(buildAlertItems(alerts, ['notifications.view'])[0].action).toBeNull();
  });
  it('shows nothing when there are no alerts, or when they could not be loaded', () => {
    expect(buildAlertItems(null, ['notifications.view'])).toEqual([]);
    expect(buildAlertItems({ failed: 0, stuck: 0, items: [] }, ['notifications.view'])).toEqual([]);
    expect(buildAttention({ sales: { missing_days: [] } }, [], 9, undefined)).toEqual([]);
  });
  it('names an unknown kind plainly', () => {
    expect(buildAlertItems({ failed: 1, stuck: 0, items: [{ id: 'z', kind: 'x.y', status: 'failed' }] }, [])[0].text).toContain(
      'Alert: x.y',
    );
  });
});

describe('tiles', () => {
  it('offers only pages that have a title, in each section, and never the home page itself', () => {
    const t = buildTiles([
      { id: 'home', title: 'Home', icon: 'home', routes: [{ path: '/home' }] },
      { id: 'sales', title: 'Sales', icon: 'chart', routes: [{ path: '/sales', title: 'Index', desc: 'x' }, { path: '/sales/hidden' }] },
      { id: 'empty', title: 'Empty', icon: 'chart', routes: [{ path: '/e' }] },
    ]);
    expect(t).toEqual([{ id: 'sales', title: 'Sales', icon: 'chart', blurb: '', pages: [{ title: 'Index', desc: 'x', href: '#/sales' }] }]);
  });
});

const stockCover = {
  asOf: '2026-11-17T08:00:00Z',
  stockValue: 98765432.1,
  reorder: { count: 412, value: 2345678 },
  notSold: { count: 1, value: 1500 },
  excess: { count: 0, value: 0 },
};

describe('stock cards', () => {
  it('gives the four numbers in order, each linking to the page that explains it', () => {
    const c = buildStockCards(stockCover);
    expect(c.map((x) => x.id)).toEqual(['stock', 'reorder', 'notsold', 'excess']);
    expect(c.map((x) => x.href)).toEqual(['#/inventory/health', '#/inventory/reorder', '#/inventory/ledger', '#/inventory/excess']);
    expect(c[0]).toMatchObject({ value: 98765432.1 });
    expect(c[1]).toMatchObject({ count: 412, value: 2345678 });
    expect(c[3]).toMatchObject({ count: 0, value: 0 });
  });
  it('gives nothing when there is no summary, so the Cover never shows a half-empty row', () => {
    expect(buildStockCards(null)).toEqual([]);
    expect(buildStockCards(undefined)).toEqual([]);
    expect(buildStockCards('x')).toEqual([]);
  });
  it('treats missing or odd parts as zero instead of showing NaN', () => {
    const c = buildStockCards({ stockValue: 'abc', reorder: { count: null } });
    expect(c[0].value).toBe(0);
    expect(c[1]).toMatchObject({ count: 0, value: 0 });
    expect(c[2]).toMatchObject({ count: 0, value: 0 });
  });
});

describe('Cover page', () => {
  const api = { coverSummary: vi.fn(async () => full) };
  vi.mock('../../js/modules/home/data/api.js', () => ({
    coverSummary: (...a) => globalThis.__cover(...a),
    notificationsAttention: (...a) => globalThis.__alerts(...a),
    inventoryCover: (...a) => globalThis.__inv(...a),
    lifetimeSalesMonths: (...a) => globalThis.__lifetime(...a),
  }));
  beforeEach(() => {
    document.body.innerHTML = '<div id="p"></div>';
    sessionStorage.clear();
    localStorage.clear();
    globalThis.__cover = api.coverSummary;
    globalThis.__alerts = async () => null;
    globalThis.__inv = async () => stockCover;
    globalThis.__lifetime = async () => [{ month: '2026-11-01', days: 5, total: 1234567 }];
    api.coverSummary.mockImplementation(async () => full);
  });
  const ctx = {
    full_name: 'Salman Yasin',
    username: 'owner',
    permissions: ['sales.view_history', 'sales.view_last_day', 'sales.enter', 'checklist.fill', 'targets.manage'],
  };
  const modules = [
    {
      id: 'sales',
      title: 'Sales',
      icon: 'chart',
      routes: [{ path: '/sales/entry', title: 'Add Entry', desc: 'Record or correct one day of sales' }],
    },
  ];

  it('keeps the staff landing page limited to the summary and modules supplied by permissions', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const staffModules = [
      {
        id: 'sales',
        title: 'Sales',
        icon: 'chart',
        routes: [{ path: '/sales/yesterday', title: 'Last Day', desc: 'The latest closed day' }],
      },
    ];
    const staffSummary = { sales: { last_day: { date: '2026-11-16', total: 120000 } } };
    api.coverSummary.mockImplementation(async () => staffSummary);
    const el = document.getElementById('p');
    await mount(el, {
      ctx: { full_name: 'Test Staff', username: 'staff', permissions: ['sales.view_last_day'] },
      modules: staffModules,
    });
    expect(el.textContent).toContain('Latest sale');
    expect(el.textContent).not.toContain('This month so far');
    expect(el.textContent).not.toContain('Customers');
    expect(el.textContent).not.toContain('Manager');
    expect(el.querySelector('.home-lifetime-hero')).toBeNull();
    expect(el.querySelectorAll('.home-module').length).toBe(1);
    expect(el.querySelector('.home-module .home-page-link').getAttribute('href')).toBe('#/sales/yesterday');
  });

  it('lets a person pin and unpin only accessible pages', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx, modules });
    const pin = el.querySelector('[data-pin="#/sales/entry"]');
    pin.click();
    expect(el.querySelector('#home-favourites').textContent).toContain('Add Entry');
    expect(localStorage.getItem('dua.home.favourites.owner')).toContain('#/sales/entry');
    el.querySelector('[data-unpin="#/sales/entry"]').click();
    expect(el.querySelector('#home-favourites').textContent).toContain('Pin the pages you use most');
  });

  it('still shows the Cover when owner alerts fail to load', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    globalThis.__alerts = async () => {
      throw new Error('boom');
    };
    const el = document.getElementById('p');
    await mount(el, { ctx: { ...ctx, permissions: [...ctx.permissions, 'notifications.view'] }, modules });
    expect(el.textContent).toContain('have not been entered');
  });
  it('shows the greeting, key numbers, attention items and tiles', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx, modules });
    const t = el.textContent.replace(/\s+/g, ' ');
    expect(t).toMatch(/Good (morning|afternoon|evening|night), Salman/);
    expect(t).toContain('₨ 614,758');
    expect(t).toContain('This month so far');
    expect(t).toContain('have not been entered');
    expect(t).toContain('TOTAL CUMULATIVE SALES');
    expect(t).toContain('₨ 1,234,567');
    expect(t).toContain('Since April 2020');
    const hero = el.querySelector('.home-lifetime-hero');
    const firstSection = el.querySelector('.home-section');
    expect(hero.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el.querySelector('.home-module .home-page-link').getAttribute('href')).toBe('#/sales/entry');
    expect(el.querySelector('.kpfill').style.width).toBe('19%');
  });

  it('shows the stock numbers to a person who may view inventory', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx: { ...ctx, permissions: [...ctx.permissions, 'inventory.view'] }, modules });
    const t = el.textContent.replace(/\s+/g, ' ');
    expect(t).toContain('Stock value');
    expect(t).toContain('₨ 98,765,432');
    expect(t).toContain('412 products');
    expect(t).toMatch(/1 product(?!s)/);
    expect(el.querySelector('a.kpi[href="#/inventory/reorder"]')).not.toBeNull();
  });
  it('does not ask for or show stock numbers without inventory.view', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const asked = vi.fn(async () => stockCover);
    globalThis.__inv = asked;
    const el = document.getElementById('p');
    await mount(el, { ctx, modules });
    expect(asked).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain('Stock value');
  });
  it('still shows the rest of the Cover when the stock numbers fail to load', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    globalThis.__inv = async () => {
      throw new Error('boom');
    };
    const el = document.getElementById('p');
    await mount(el, { ctx: { ...ctx, permissions: [...ctx.permissions, 'inventory.view'] }, modules });
    expect(el.textContent).toContain('This month so far');
    expect(el.textContent).not.toContain('Stock value');
  });

  it('"Add entry" remembers which day to open', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx, modules });
    const link = el.querySelector('a[data-handoff]');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(sessionStorage.getItem('sales.entry.date')).toBe('2026-11-03');
  });

  it('still opens, with a message, if the numbers cannot be loaded', async () => {
    api.coverSummary.mockImplementation(async () => {
      throw new Error('offline');
    });
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx, modules });
    expect(el.textContent).toContain('could not be loaded');
    expect(el.querySelector('.home-module')).not.toBeNull();
  });

  it("escapes the person's name", async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx: { ...ctx, full_name: '<img src=x onerror=alert(1)>' }, modules });
    expect(el.querySelector('img')).toBeNull();
  });
});

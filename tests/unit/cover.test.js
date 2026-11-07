// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAttention, buildKpis, buildTiles, greeting, hourInPkt } from '../../js/modules/home/domain/cover.js';

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

describe('key numbers', () => {
  it('owner sees latest sale, month so far, target and customers', () => {
    const k = buildKpis(full);
    expect(k.map((c) => c.id)).toEqual(['latest', 'mtd', 'target', 'customers']);
    expect(k[0]).toMatchObject({ value: 614758, diff: 24977 });
    expect(k[1].vsLastYear).toBeCloseTo(58.56, 1);
    expect(k[2]).toMatchObject({ pct: 19, remaining: 13328799 });
  });
  it('a person with last-day access only gets one card and nothing else', () => {
    const k = buildKpis({ sales: { last_day: { date: '2026-11-04', total: 614758 } } });
    expect(k.map((c) => c.id)).toEqual(['latest']);
    expect(k[0].diff).toBeNull();
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
    const t = buildAttention(noTarget, ['sales.enter', 'checklist.fill', 'targets.manage'], 19);
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

describe('tiles', () => {
  it('offers only pages that have a title, in each section, and never the home page itself', () => {
    const t = buildTiles([
      { id: 'home', title: 'Home', icon: 'home', routes: [{ path: '/home' }] },
      { id: 'sales', title: 'Sales', icon: 'chart', routes: [{ path: '/sales', title: 'Index', desc: 'x' }, { path: '/sales/hidden' }] },
      { id: 'empty', title: 'Empty', icon: 'chart', routes: [{ path: '/e' }] },
    ]);
    expect(t).toEqual([{ id: 'sales', title: 'Sales', icon: 'chart', pages: [{ title: 'Index', desc: 'x', href: '#/sales' }] }]);
  });
});

describe('Cover page', () => {
  const api = { coverSummary: vi.fn(async () => full) };
  vi.mock('../../js/modules/home/data/api.js', () => ({ coverSummary: (...a) => globalThis.__cover(...a) }));
  beforeEach(() => {
    document.body.innerHTML = '<div id="p"></div>';
    sessionStorage.clear();
    globalThis.__cover = api.coverSummary;
    api.coverSummary.mockImplementation(async () => full);
  });
  const ctx = { full_name: 'Salman Yasin', username: 'owner', permissions: ['sales.enter', 'checklist.fill'] };
  const modules = [
    {
      id: 'sales',
      title: 'Sales',
      icon: 'chart',
      routes: [{ path: '/sales/entry', title: 'Add Entry', desc: 'Record or correct one day of sales' }],
    },
  ];

  it('shows the greeting, key numbers, attention items and tiles', async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx, modules });
    const t = el.textContent.replace(/\s+/g, ' ');
    expect(t).toMatch(/Good (morning|afternoon|evening|night), Salman/);
    expect(t).toContain('₨ 614,758');
    expect(t).toContain('This month so far');
    expect(t).toContain('have not been entered');
    expect(el.querySelector('.tile').getAttribute('href')).toBe('#/sales/entry');
    expect(el.querySelector('.kpfill').style.width).toBe('19%');
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
    expect(el.querySelector('.tile')).not.toBeNull();
  });

  it("escapes the person's name", async () => {
    const { mount } = await import('../../js/modules/home/ui/page.js');
    const el = document.getElementById('p');
    await mount(el, { ctx: { ...ctx, full_name: '<img src=x onerror=alert(1)>' }, modules });
    expect(el.querySelector('img')).toBeNull();
  });
});

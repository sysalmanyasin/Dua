import { describe, expect, it } from 'vitest';
import { buildDailyProgress, buildQuickActions, searchPages } from '../../js/modules/home/domain/cover.js';

const modules = [
  { id: 'home', title: 'Home', routes: [{ path: '/home', title: 'Home' }] },
  { id: 'sales', title: 'Sales', routes: [
    { path: '/sales', title: 'Sales overview', desc: 'Business figures' },
    { path: '/sales/entry', title: 'Add entry', desc: 'Record daily sales' },
    { path: '/sales/yesterday', title: 'Yesterday', desc: 'Latest day total' },
  ] },
  { id: 'manager', title: 'Manager', routes: [{ path: '/manager/staff', title: 'Staff registry' }] },
];

describe('Home 2.0 navigation helpers', () => {
  it('builds quick actions only from the already permission-filtered route list', () => {
    expect(buildQuickActions(modules).map((x) => x.href)).toEqual(['#/sales/entry']);
  });
  it('searches accessible page titles, module names and descriptions', () => {
    expect(searchPages(modules, 'staff').map((x) => x.href)).toEqual(['#/manager/staff']);
    expect(searchPages(modules, 'daily').map((x) => x.href)).toEqual(['#/sales/entry']);
    expect(searchPages(modules, 'no match')).toEqual([]);
    expect(searchPages(modules, '').length).toBe(0);
  });
  it('shows only daily progress supported by returned data and permissions', () => {
    const summary = { checklist: { today_exists: false }, sales: { missing_days: ['2026-11-17'] } };
    expect(buildDailyProgress(summary, ['checklist.fill', 'sales.view_history']).map((x) => x.id)).toEqual(['checklist', 'sales']);
    expect(buildDailyProgress(summary, []).map((x) => x.id)).toEqual([]);
    expect(buildDailyProgress(summary, ['checklist.view'])[0]).toMatchObject({ status: 'Not started', href: '#/sales/checklist' });
  });
});

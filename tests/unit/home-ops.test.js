import { describe, expect, it } from 'vitest';
import {
  categoriesIn,
  countBySeverity,
  filterItems,
  freshness,
  normaliseEvents,
  normaliseItems,
  timeAgo,
} from '../../js/modules/home/domain/ops.js';

const raw = (o = {}) => ({
  rule_key: 'sales_missing',
  category: 'sales',
  severity: 'warning',
  title: 'Daily sales not entered',
  detail: 'No sales for 20 Nov.',
  responsible: 'Owner',
  deadline: null,
  href: '/sales',
  ref: '',
  ...o,
});

describe('Action Centre items', () => {
  it('sorts critical first, then needs attention, then information', () => {
    const items = normaliseItems({
      items: [raw({ severity: 'info', title: 'B' }), raw({ severity: 'critical', title: 'C' }), raw({ severity: 'warning', title: 'A' })],
    });
    expect(items.map((i) => i.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('turns database paths into in-app links and refuses anything else', () => {
    const items = normaliseItems({
      items: [
        raw({ href: '/closing' }),
        raw({ title: 'x2', href: 'https://evil.example' }),
        raw({ title: 'x3', href: '//evil.example' }),
        raw({ title: 'x4', href: 'javascript:alert(1)' }),
      ],
    });
    expect(items.map((i) => i.href)).toEqual(['#/closing', null, null, null]);
  });

  it('treats an unknown priority as needs attention, never as information', () => {
    expect(normaliseItems({ items: [raw({ severity: 'whatever' })] })[0].severity).toBe('warning');
  });

  it('drops malformed rows and tolerates a missing result', () => {
    expect(normaliseItems(null)).toEqual([]);
    expect(normaliseItems({ items: 'nope' })).toEqual([]);
    expect(normaliseItems({ items: [null, 5, {}, raw({ title: '' })] })).toEqual([]);
  });

  it('defaults the responsible person to the Owner and keeps a valid deadline date', () => {
    const [i] = normaliseItems({ items: [raw({ responsible: '', deadline: '2026-11-25T00:00:00Z' })] });
    expect(i.responsible).toBe('Owner');
    expect(i.deadline).toBe('2026-11-25');
  });

  it('filters by priority and area and counts each priority', () => {
    const items = normaliseItems({
      items: [
        raw({ severity: 'critical', title: 'a' }),
        raw({ category: 'inventory', severity: 'info', title: 'b' }),
        raw({ category: 'system', severity: 'critical', title: 'c' }),
      ],
    });
    expect(filterItems(items, { priority: 'critical' })).toHaveLength(2);
    expect(filterItems(items, { category: 'inventory' }).map((i) => i.title)).toEqual(['b']);
    expect(filterItems(items, { priority: 'critical', category: 'inventory' })).toEqual([]);
    expect(filterItems(items)).toHaveLength(3);
    expect(countBySeverity(items)).toEqual({ critical: 2, warning: 0, info: 1 });
    expect(categoriesIn(items)).toEqual(['sales', 'inventory', 'system']);
  });
});

describe('Recent Activity events', () => {
  const ev = (o = {}) => ({
    at: '2026-11-21T10:00:00Z',
    category: 'closing_done',
    title: 'Closing submitted',
    detail: '21 Nov · Evening',
    href: '/closing',
    ref: 'x',
    ...o,
  });

  it('keeps the newest ten, newest first', () => {
    const events = Array.from({ length: 14 }, (_, i) => ev({ at: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00Z`, ref: String(i) }));
    const out = normaliseEvents({ events });
    expect(out).toHaveLength(10);
    expect(out[0].at).toBe('2026-11-14T10:00:00Z');
  });

  it('drops events with no valid time or title', () => {
    expect(normaliseEvents({ events: [ev({ at: 'not a date' }), ev({ title: '' }), null] })).toEqual([]);
    expect(normaliseEvents(null)).toEqual([]);
  });
});

describe('wording of times and freshness', () => {
  const now = Date.parse('2026-11-22T10:00:00Z');
  it('says how long ago something happened', () => {
    expect(timeAgo('2026-11-22T09:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-22T09:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-11-22T07:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-11-10T07:00:00Z', now)).toMatch(/10 Nov/);
    expect(timeAgo('garbage', now)).toBe('');
  });

  it('tells the person whether to trust what they see', () => {
    expect(freshness({ status: 'loading', lastSuccess: null, stale: false }).text).toBe('Loading…');
    expect(freshness({ status: 'error', lastSuccess: null, stale: true }).tone).toBe('bad');
    expect(freshness({ status: 'ok', lastSuccess: now, stale: false })).toMatchObject({ tone: 'ok' });
    expect(freshness({ status: 'ok', lastSuccess: now, stale: true })).toMatchObject({ tone: 'warn' });
    const failed = freshness({ status: 'error', lastSuccess: now, stale: true });
    expect(failed.tone).toBe('bad');
    expect(failed.text).toMatch(/out of date/);
  });
});

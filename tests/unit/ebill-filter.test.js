import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  GLOBAL_FIELDS,
  activeFilters,
  clearAll,
  clearOne,
  distinct,
  emptyState,
  filterRows,
  setColumn,
  setGlobal,
  setPage,
  setSort,
  view,
} from '../../js/modules/ebill/domain/productFilter.js';

const rows = [
  {
    code: 'P001',
    name: 'Panadol Tablet',
    generic: 'Paracetamol',
    company: 'GSK',
    supplier: 'Sup One',
    qty: 50,
    pack: 10,
    price: 5,
    received: '2026-10-01',
    sold: '2026-11-10',
    created: '2025-01-05',
  },
  {
    code: 'P002',
    name: 'Calpol Syrup',
    generic: 'Paracetamol',
    company: 'GSK',
    supplier: 'Sup Two',
    qty: 0,
    pack: 1,
    price: 120,
    received: '2026-09-15',
    sold: '2026-11-01',
    created: '2025-03-01',
  },
  {
    code: 'A100',
    name: 'Augmentin 625',
    generic: 'Amoxicillin',
    company: 'Beecham',
    supplier: 'Sup One',
    qty: 8,
    pack: 6,
    price: 90,
    received: '2026-11-01',
    sold: '',
    created: '2024-06-30',
  },
  {
    code: 'B200',
    name: 'Brufen 400',
    generic: 'Ibuprofen',
    company: 'Abbott',
    supplier: 'Sup Three',
    qty: -2,
    pack: 10,
    price: 3.5,
    received: '',
    sold: '2026-10-20',
    created: '2024-02-02',
  },
];
const col = (s, key, f) => setColumn(s, key, f);
const codes = (s) => filterRows(rows, s).map((r) => r.code);

describe('global search (filter 1)', () => {
  it('searches every searchable field', () => {
    expect(GLOBAL_FIELDS).toEqual(['name', 'generic', 'code', 'company', 'supplier']);
    expect(codes(setGlobal(emptyState(), 'panadol'))).toEqual(['P001']);
    expect(codes(setGlobal(emptyState(), 'ibuprofen'))).toEqual(['B200']); // generic
    expect(codes(setGlobal(emptyState(), 'a100'))).toEqual(['A100']); // code
    expect(codes(setGlobal(emptyState(), 'abbott'))).toEqual(['B200']); // manufacturer
    expect(codes(setGlobal(emptyState(), 'sup three'))).toEqual(['B200']); // supplier
  });
  it('needs every word, in any order and in any field', () => {
    expect(codes(setGlobal(emptyState(), 'paracetamol gsk')).sort()).toEqual(['P001', 'P002']);
    expect(codes(setGlobal(emptyState(), 'syrup paracetamol'))).toEqual(['P002']);
    expect(codes(setGlobal(emptyState(), 'syrup tablet'))).toEqual([]);
  });
  it('treats % and _ as ordinary characters', () => {
    expect(codes(setGlobal(emptyState(), '%'))).toEqual([]);
    expect(codes(setGlobal(emptyState(), '_'))).toEqual([]);
  });
  it('ranks the best match first when no sort is chosen', () => {
    expect(codes(setGlobal(emptyState(), 'p00'))[0]).toBe('P001');
  });
});

describe('every column has a working filter (filter 2)', () => {
  it('covers every column', () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      'name',
      'generic',
      'code',
      'company',
      'supplier',
      'qty',
      'pack',
      'price',
      'received',
      'sold',
      'created',
    ]);
  });
  for (const key of ['name', 'generic', 'code']) {
    it(`text column ${key}: contains, starts with, exact`, () => {
      const r = rows[0];
      const v = r[key];
      expect(codes(col(emptyState(), key, { op: 'contains', value: v.slice(1, 4).toUpperCase() }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'starts', value: v.slice(0, 3) }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'starts', value: v.slice(1, 4) }))).not.toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'exact', value: v.toLowerCase() }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'exact', value: v.slice(0, 3) }))).not.toContain('P001');
    });
  }
  for (const key of ['company', 'supplier']) {
    it(`pick-list column ${key}`, () => {
      const v = rows[0][key];
      const hit = codes(col(emptyState(), key, { values: [v] }));
      expect(hit).toEqual(rows.filter((r) => r[key] === v).map((r) => r.code));
      expect(codes(col(emptyState(), key, { values: [rows[0][key], rows[3][key]] })).length).toBeGreaterThan(hit.length - 1);
      expect(codes(col(emptyState(), key, { values: [] }))).toHaveLength(rows.length); // empty = no filter
    });
  }
  for (const key of ['qty', 'pack', 'price']) {
    it(`number column ${key}: equals, greater, less, range`, () => {
      const exact = rows[0][key];
      expect(codes(col(emptyState(), key, { op: 'eq', value: exact }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'gt', value: exact }))).not.toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'lt', value: exact }))).not.toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'gt', value: exact - 0.01 }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'range', min: exact, max: exact }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'range', min: exact + 1 }))).not.toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'range', max: exact - 1 }))).not.toContain('P001');
    });
  }
  it('stock availability: in stock / out of stock (zero and negative are out)', () => {
    expect(codes(col(emptyState(), 'qty', { op: 'in' }))).toEqual(['P001', 'A100']);
    expect(codes(col(emptyState(), 'qty', { op: 'out' }))).toEqual(['P002', 'B200']);
  });
  for (const key of ['received', 'sold', 'created']) {
    it(`date column ${key}: exact day and range`, () => {
      const d = rows[0][key];
      expect(codes(col(emptyState(), key, { op: 'on', value: d }))).toEqual(rows.filter((r) => r[key] === d).map((r) => r.code));
      expect(codes(col(emptyState(), key, { op: 'between', from: d, to: d }))).toContain('P001');
      expect(codes(col(emptyState(), key, { op: 'between', from: '2999-01-01' }))).toEqual([]);
      expect(codes(col(emptyState(), key, { op: 'between', to: '1999-01-01' }))).toEqual([]);
    });
  }
  it('a blank date never matches a date range', () => {
    expect(codes(col(emptyState(), 'sold', { op: 'between', from: '2000-01-01' }))).not.toContain('A100');
  });
  it('accepts date-times by comparing the day only', () => {
    const r = [{ ...rows[0], received: '2026-10-01T08:30:00Z' }];
    expect(filterRows(r, col(emptyState(), 'received', { op: 'on', value: '2026-10-01' }))).toHaveLength(1);
  });
});

describe('combined filters, sorting and paging', () => {
  it('global + several column filters all apply (AND)', () => {
    let s = setGlobal(emptyState(), 'paracetamol');
    expect(codes(s).sort()).toEqual(['P001', 'P002']);
    s = col(s, 'qty', { op: 'in' });
    expect(codes(s)).toEqual(['P001']);
    s = col(s, 'price', { op: 'lt', value: 1 });
    expect(codes(s)).toEqual([]);
  });
  it('shows what is active and clears one or all', () => {
    let s = setGlobal(emptyState(), 'gsk');
    s = col(s, 'qty', { op: 'in' });
    s = col(s, 'company', { values: ['GSK'] });
    expect(activeFilters(s).map((c) => c.id)).toEqual(['global', 'company', 'qty']);
    expect(activeFilters(clearOne(s, 'qty')).map((c) => c.id)).toEqual(['global', 'company']);
    expect(activeFilters(clearOne(s, 'global')).map((c) => c.id)).toEqual(['company', 'qty']);
    expect(activeFilters(clearAll(s))).toEqual([]);
    expect(codes(clearAll(s))).toHaveLength(rows.length);
  });
  it('an emptied column filter is removed, not left behind', () => {
    const s = col(col(emptyState(), 'name', { op: 'contains', value: 'x' }), 'name', { op: 'contains', value: '  ' });
    expect(s.columns).toEqual({});
  });
  it('sorting works alongside filtering and cycles asc, desc, off', () => {
    let s = col(emptyState(), 'qty', { op: 'in' });
    s = setSort(s, 'price');
    expect(codes(s)).toEqual(['P001', 'A100']);
    s = setSort(s, 'price');
    expect(codes(s)).toEqual(['A100', 'P001']);
    expect(setSort(s, 'price').sort).toBeNull();
    expect(codes(setSort(emptyState(), 'qty'))).toEqual(['B200', 'P002', 'A100', 'P001']); // numeric, not text
    expect(clearAll(setSort(emptyState(), 'name')).sort).toEqual({ key: 'name', dir: 'asc' }); // sort survives Clear All
  });
  it('lists the distinct values of a column for its pick-list', () => {
    expect(distinct(rows, 'company')).toEqual(['Abbott', 'Beecham', 'GSK']);
    expect(distinct(rows, 'supplier', 2)).toHaveLength(2);
  });
});

describe('large catalogue', () => {
  const big = Array.from({ length: 6000 }, (_, i) => ({
    code: `C${String(i).padStart(5, '0')}`,
    name: `Product ${i} ${i % 7 === 0 ? 'Syrup' : 'Tablet'}`,
    generic: `Generic ${i % 300}`,
    company: `Maker ${i % 40}`,
    supplier: `Sup ${i % 12}`,
    qty: i % 5 === 0 ? 0 : i % 90,
    pack: (i % 10) + 1,
    price: (i % 500) + 0.5,
    received: `2026-0${(i % 9) + 1}-10`,
    sold: i % 3 ? `2026-1${i % 2}-05` : '',
    created: '2024-01-01',
  }));
  it('filters, sorts and pages 6,000 rows quickly and keeps the match count right', () => {
    let s = setGlobal(emptyState(), 'syrup');
    s = col(s, 'qty', { op: 'in' });
    s = col(s, 'company', { values: ['Maker 7', 'Maker 14'] });
    s = setSort(s, 'price');
    const t0 = performance.now();
    const v = view(big, s);
    expect(performance.now() - t0).toBeLessThan(500);
    const expected = big.filter((r) => /syrup/.test(r.name.toLowerCase()) && r.qty > 0 && ['Maker 7', 'Maker 14'].includes(r.company));
    expect(v.total).toBe(expected.length);
    expect(v.rows.length).toBe(Math.min(50, expected.length));
  });
  it('keeps filters when paging, and clamps a page that no longer exists', () => {
    let s = setGlobal(emptyState(), 'tablet');
    const total = view(big, s).total;
    const v1 = view(big, setPage(s, 2));
    expect(v1.page).toBe(2);
    expect(v1.total).toBe(total);
    s = setPage(col(s, 'price', { op: 'gt', value: 498 }), 99);
    const v2 = view(big, s);
    expect(v2.page).toBe(v2.pages - 1);
    expect(setColumn(setPage(s, 3), 'qty', { op: 'in' }).page).toBe(0); // a new filter starts on page 1
  });
});

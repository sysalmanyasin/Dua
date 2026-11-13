import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeCreditMonth,
  deductionChange,
  fromPaisa,
  monthStart,
  shiftMonth,
  sumNet,
  toPaisa,
  validateEntry,
} from '../../js/modules/manager/domain/credit.js';
import { BLOOD_GROUPS, staffPayload, validateStaffForm } from '../../js/modules/manager/domain/staff.js';

const cases = JSON.parse(readFileSync('tests/fixtures/manager-credit-cases.json', 'utf8'));

describe('credit month (shared cases, also run against the database)', () => {
  it('has the cases', () => expect(cases.length).toBe(14));
  for (const c of cases) {
    it(c.name, () => {
      const got = computeCreditMonth({
        opening: c.opening ? { month: c.opening.month, amount: c.opening.amount } : null,
        rows: c.rows,
        month: c.month,
        active: c.active ?? true,
      });
      expect(got.listed).toBe(c.expect.listed);
      if (c.expect.listed) {
        for (const k of ['prev', 'entries', 'salary_deduction', 'generic_deduction', 'net']) expect(got[k], k).toBe(c.expect[k]);
      }
    });
  }
});

describe('exact money', () => {
  it('sums paisa without floating point drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(fromPaisa(toPaisa(0.1) + toPaisa(0.2))).toBe(0.3);
    expect(sumNet([{ net: 0.1 }, { net: 0.2 }, { net: -0.3 }])).toBe(0);
  });
  it('is the old formula: previous + entries - salary - less generic', () => {
    const r = computeCreditMonth({
      opening: { month: '2026-01-01', amount: 1000 },
      rows: [
        { date: '2026-03-02', kind: 'entry', amount: 500 },
        { date: '2026-03-30', kind: 'salary_deduction', amount: -200 },
        { date: '2026-03-30', kind: 'generic_deduction', amount: -50 },
      ],
      month: '2026-03-01',
    });
    expect(r.net).toBe(1000 + 500 - 200 - 50);
  });
});

describe('month helpers', () => {
  it('moves across year ends', () => {
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-03-01', -15)).toBe('2024-12-01');
    expect(monthStart('2026-11-12')).toBe('2026-11-01');
  });
});

describe('entry and deduction checks (the database repeats them)', () => {
  const today = '2026-11-12';
  it('refuses blank, zero, huge, future and pre-opening entries', () => {
    expect(validateEntry({ date: today, amount: null, today })).toMatch(/amount/i);
    expect(validateEntry({ date: today, amount: 0, today })).toMatch(/amount/i);
    expect(validateEntry({ date: today, amount: Number.NaN, today })).toMatch(/amount/i);
    expect(validateEntry({ date: today, amount: 2e9, today })).toMatch(/large/);
    expect(validateEntry({ date: '2026-11-13', amount: 5, today })).toMatch(/future/);
    expect(validateEntry({ date: '2026-10-31', amount: 5, today, openingMonth: '2026-11-01' })).toMatch(/opening/);
    expect(validateEntry({ date: today, amount: -300, today, openingMonth: '2026-11-01' })).toBeNull();
  });
  it('a deduction needs a reason only when it replaces a non-zero figure', () => {
    expect(deductionChange(0, 500)).toEqual({ delta: 500, unchanged: false, needsReason: false });
    expect(deductionChange(500, 500).unchanged).toBe(true);
    expect(deductionChange(500, 300)).toEqual({ delta: -200, unchanged: false, needsReason: true });
    expect(deductionChange(500, 0).needsReason).toBe(true);
  });
});

describe('staff form', () => {
  const ok = {
    full_name: 'Test Person',
    phone: '0300-1234567',
    joined_on: '2024-01-01',
    designation: 'Salesman',
    staff_code: 'emp-007',
    sort_order: '2',
  };
  it('accepts a good form and normalises it', () => {
    expect(validateStaffForm(ok, '2026-11-12')).toEqual({});
    const p = staffPayload({ ...ok, active: true, staff_id: null, private: null }, 'k');
    expect(p).toMatchObject({ p_full_name: 'Test Person', p_staff_code: 'EMP-007', p_sort_order: 2, p_private: null, p_key: 'k' });
  });
  it('catches each bad field', () => {
    const e = validateStaffForm(
      { full_name: 'X', phone: 'abc', joined_on: '2030-01-01', staff_code: 'no good', sort_order: '1000', private: { blood_group: 'Z+' } },
      '2026-11-12',
    );
    expect(Object.keys(e).sort()).toEqual(['blood_group', 'full_name', 'joined_on', 'phone', 'sort_order', 'staff_code']);
  });
  it('leaves the order blank = 999 and the code blank = automatic', () => {
    const p = staffPayload({ ...ok, sort_order: '', staff_code: '', active: false, private: null }, 'k');
    expect(p.p_sort_order).toBe(999);
    expect(p.p_staff_code).toBeNull();
    expect(p.p_active).toBe(false);
  });
  it('knows the eight blood groups', () => expect(BLOOD_GROUPS).toHaveLength(8));
});

// ── guards that keep the module honest ──
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const moduleFiles = walk('js/modules/manager').filter((f) => f.endsWith('.js'));
const allMigrations = readdirSync('supabase/migrations')
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');
const seeded = new Set([...allMigrations.matchAll(/^ \('([a-z_]+\.[a-z_]+)',/gm)].map((m) => m[1]));

describe('module guards', () => {
  it('every permission key used in the Manager code is seeded in the database', () => {
    const used = new Set();
    for (const f of moduleFiles) for (const m of readFileSync(f, 'utf8').matchAll(/'((?:mgmt|credit)\.[a-z_]+)'/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(8);
    for (const k of used) expect(seeded.has(k), `${k} is not seeded`).toBe(true);
  });
  it('no Manager role preset exists: no role template is granted a Manager key', () => {
    const grants = allMigrations.match(/insert into public\.role_permissions[\s\S]*?;/g) ?? [];
    for (const g of grants) expect(g).not.toMatch(/'(mgmt|credit)\./);
  });
  it('the national ID number is never stored or asked for (MGR-7)', () => {
    const text = [...moduleFiles, 'supabase/migrations/0101_mgmt_staff.sql', 'supabase/migrations/0102_mgmt_credit.sql']
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(text.toLowerCase()).not.toMatch(/cnic|national_id|id_number|id_card/);
  });
  it('the page code never writes to a table directly (only database functions)', () => {
    const api = readFileSync('js/modules/manager/data/api.js', 'utf8');
    expect(api).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});

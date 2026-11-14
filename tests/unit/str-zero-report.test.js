import { describe, expect, it } from 'vitest';
import cases from '../fixtures/str-cases.json';
import { groupBySupplier } from '../../js/modules/str/domain/group.js';
import {
  hideZeroDispatchGroups,
  isZeroDispatchLine,
  itemCount,
  printableSelection,
  pruneSelection,
  visibleReportEntries,
  zeroDispatchEntries,
  zeroDispatchGroups,
} from '../../js/modules/str/domain/zero.js';
import { REPORT_COLUMNS, groupByBranch, normalizeColumns, visibleColumns } from '../../js/modules/str/domain/report.js';

describe('zero dispatch rule (STR-5)', () => {
  for (const c of cases.zero) {
    it(`${c.stage}, STR ${c.strQty}, dispatch ${c.dispatchQty} -> ${c.zero}`, () => {
      expect(isZeroDispatchLine(c.stage, { strQty: c.strQty, dispatchQty: c.dispatchQty })).toBe(c.zero);
    });
  }
  it('uses loose units: 5 loose dispatched of a 10-pack is NOT zero dispatch', () => {
    const groups = groupBySupplier([{ productCode: 'P1', productName: 'T', strQty: 50, dispatchQty: 5, receiveQty: null }], {
      P1: { supplier: 'S', factor: 10 },
    });
    expect(groups[0].rows[0].packDispatchQty).toBe(0);
    expect(zeroDispatchGroups('dispatched', groups)).toEqual([]);
  });
});

const meta = { P1: { supplier: 'Alpha', factor: 1 }, P2: { supplier: 'Beta', factor: 1 } };
const mk = (id, stage, branch, rows) => ({
  h: { strId: id, stage, dispatchBranch: branch },
  groups: groupBySupplier(
    rows.map(([code, str, disp], i) => ({
      strId: id,
      itemId: i,
      productCode: code,
      productName: code,
      strQty: str,
      dispatchQty: disp,
      receiveQty: null,
    })),
    meta,
  ),
});
const entries = [
  mk(3, 'dispatched', 'Warehouse', [
    ['P1', 10, 0],
    ['P2', 10, 10],
  ]),
  mk(2, 'received', 'Warehouse', [['P1', 10, 4]]),
  mk(1, 'awaited', 'Main Store', [['P1', 10, null]]),
];

describe('zero dispatch page', () => {
  it('keeps only zero-dispatch lines and drops empty groups and STRs', () => {
    const z = zeroDispatchEntries(entries);
    expect(z.map((e) => e.h.strId)).toEqual([3]);
    expect(z[0].groups).toHaveLength(1);
    expect(z[0].groups[0].rows.map((r) => r.productCode)).toEqual(['P1']);
    expect(itemCount(z[0].groups)).toBe(1);
  });
  it('lets a received STR with a zero-dispatch line appear', () => {
    const only = [mk(9, 'received', 'Warehouse', [['P1', 3, 0]])];
    expect(zeroDispatchEntries(only)).toHaveLength(1);
  });
  it('prints only ticked STRs that are still on the page', () => {
    const z = zeroDispatchEntries(entries);
    expect(printableSelection(z, new Set([3, 99])).map((e) => e.h.strId)).toEqual([3]);
    expect([...pruneSelection(z, new Set([3, 99]))]).toEqual([3]);
    expect(printableSelection(z, new Set())).toEqual([]);
  });
});

describe('report page', () => {
  it('hide 0-dispatch removes exactly the zero-dispatch lines and then empty STRs', () => {
    const v = visibleReportEntries(entries, true);
    expect(v.map((e) => e.h.strId)).toEqual([3, 2, 1]);
    expect(v[0].groups.flatMap((g) => g.rows.map((r) => r.productCode))).toEqual(['P2']);
    const allZero = [mk(5, 'dispatched', 'Warehouse', [['P1', 4, 0]])];
    expect(visibleReportEntries(allZero, true)).toEqual([]);
  });
  it('hide 0-dispatch off leaves everything', () => {
    expect(visibleReportEntries(entries, false)).toBe(entries);
  });
  it('hide and zero are exact opposites on a dispatched STR', () => {
    const e = entries[0];
    const z = zeroDispatchGroups(e.h.stage, e.groups).flatMap((g) => g.rows).length;
    const h = hideZeroDispatchGroups(e.h.stage, e.groups).flatMap((g) => g.rows).length;
    expect(z + h).toBe(2);
  });
  it('groups by dispatch branch alphabetically, keeping the STR order inside, blank = Unknown Branch', () => {
    const g = groupByBranch([...entries, mk(0, 'awaited', '', [['P1', 1, 0]])]);
    expect(g.map((b) => b.branch)).toEqual(['Main Store', 'Unknown Branch', 'Warehouse']);
    expect(g[2].entries.map((e) => e.h.strId)).toEqual([3, 2]);
  });
  it('column choices default to shown and ignore junk', () => {
    expect(normalizeColumns(REPORT_COLUMNS, null)).toEqual({ price: true, strQty: true, dispatchQty: true, receiveQty: true, diff: true });
    const c = normalizeColumns(REPORT_COLUMNS, { price: false, diff: 'no', nope: false });
    expect(c.price).toBe(false);
    expect(c.diff).toBe(true);
    expect(visibleColumns(REPORT_COLUMNS, c).map((x) => x.key)).toEqual(['strQty', 'dispatchQty', 'receiveQty', 'diff']);
  });
});

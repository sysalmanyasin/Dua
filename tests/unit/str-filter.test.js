import { describe, expect, it } from 'vitest';
import { branchCounts, filterHeaders, searchWords, sortHeaders } from '../../js/modules/str/domain/filter.js';

const h = (o) => ({
  strId: 1,
  strNumber: '',
  masterStrId: '',
  refNo: '',
  comments: '',
  issuedBy: '',
  dispatchedBy: '',
  receivedBy: '',
  dispatchBranch: 'Warehouse',
  receiveBranch: 'Test Branch',
  strDate: '2026-11-10',
  direction: 'in',
  stage: 'awaited',
  ...o,
});
const list = [
  h({ strId: 5, strNumber: 'STR-105', strDate: '2026-11-12', direction: 'in', stage: 'dispatched', comments: 'Urgent cold items' }),
  h({ strId: 4, strNumber: 'STR-104', strDate: '2026-11-12', direction: 'out', stage: 'received', issuedBy: 'Tester One' }),
  h({ strId: 3, strNumber: 'STR-103', strDate: '2026-11-11', direction: 'in', stage: 'awaited', masterStrId: 'M-77' }),
  h({ strId: 2, strNumber: 'STR-102', strDate: null, direction: '', stage: 'awaited' }),
  h({ strId: 1, strNumber: 'STR-101', strDate: '2026-11-09', direction: 'in', stage: 'received', refNo: 'REF-9' }),
];
const ids = (r) => r.map((x) => x.strId);

describe('STR list filters', () => {
  it('sorts newest date first, then highest id, with no-date last', () => {
    expect(ids(filterHeaders(list, {}))).toEqual([5, 4, 3, 1, 2]);
    expect(ids(sortHeaders([h({ strId: 1 }), h({ strId: 9 })]))).toEqual([9, 1]);
  });
  it('filters by stage', () => {
    expect(ids(filterHeaders(list, { stage: 'received' }))).toEqual([4, 1]);
    expect(ids(filterHeaders(list, { stage: 'all' }))).toHaveLength(5);
  });
  it('filters by branch chip, and a blank direction is in neither chip', () => {
    expect(ids(filterHeaders(list, { branch: 'dispatched' }))).toEqual([4]);
    expect(ids(filterHeaders(list, { branch: 'received' }))).toEqual([5, 3, 1]);
    expect(branchCounts(list)).toEqual({ dispatched: 1, received: 3 });
  });
  it('filters by date range inclusive, and drops STRs with no date', () => {
    expect(ids(filterHeaders(list, { dateFrom: '2026-11-11' }))).toEqual([5, 4, 3]);
    expect(ids(filterHeaders(list, { dateTo: '2026-11-11' }))).toEqual([3, 1]);
    expect(ids(filterHeaders(list, { dateFrom: '2026-11-11', dateTo: '2026-11-11' }))).toEqual([3]);
  });
  it('searches header words: number, master, ref, comments, people, branches', () => {
    expect(ids(filterHeaders(list, { search: 'str-103' }))).toEqual([3]);
    expect(ids(filterHeaders(list, { search: 'm-77' }))).toEqual([3]);
    expect(ids(filterHeaders(list, { search: 'REF-9' }))).toEqual([1]);
    expect(ids(filterHeaders(list, { search: 'cold' }))).toEqual([5]);
    expect(ids(filterHeaders(list, { search: 'tester' }))).toEqual([4]);
    expect(ids(filterHeaders(list, { search: 'warehouse' }))).toHaveLength(5);
  });
  it('needs every word to match, in any order', () => {
    expect(ids(filterHeaders(list, { search: 'urgent str-105' }))).toEqual([5]);
    expect(ids(filterHeaders(list, { search: 'urgent str-104' }))).toEqual([]);
  });
  it('treats % and _ as plain text', () => {
    expect(filterHeaders(list, { search: '%' })).toEqual([]);
    expect(filterHeaders(list, { search: '_' })).toEqual([]);
  });
  it('uses the database result when product words were searched there', () => {
    expect(ids(filterHeaders(list, { search: 'syrup', matchIds: new Set([3, 4]) }))).toEqual([4, 3]);
    expect(ids(filterHeaders(list, { search: 'syrup', matchIds: new Set([3, 4]), stage: 'received' }))).toEqual([4]);
  });
  it('combines filters', () => {
    expect(ids(filterHeaders(list, { stage: 'received', branch: 'received', dateFrom: '2026-11-01' }))).toEqual([1]);
  });
  it('keeps at most six words', () => {
    expect(searchWords('a b c d e f g h')).toHaveLength(6);
    expect(searchWords('  ')).toEqual([]);
  });
});

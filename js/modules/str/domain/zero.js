import { grandTotals } from './group.js';

// Zero Dispatch (owner decision STR-5, 13 Nov 2026). A line is "zero dispatch" when:
//   - its STR is Dispatched or Received (Awaited STRs are not included), and
//   - the STR quantity is above 0, and
//   - the dispatch quantity is 0, counted in LOOSE units (a null dispatch counts as 0).
// A partial dispatch (above 0 but below the STR quantity) is NOT zero dispatch, even if it is less than one pack.
// "Hide 0-Dispatch" in the Report uses this same rule.
export const ZERO_DISPATCH_STAGES = new Set(['dispatched', 'received']);

export function isZeroDispatchLine(stage, line) {
  if (!ZERO_DISPATCH_STAGES.has(stage)) return false;
  if (!((Number(line.strQty) || 0) > 0)) return false;
  return (Number(line.dispatchQty ?? 0) || 0) === 0;
}

const keep = (groups, test) => groups.map((g) => ({ supplier: g.supplier, rows: g.rows.filter(test) })).filter((g) => g.rows.length > 0);

// Only the zero-dispatch lines; supplier groups left empty disappear.
export const zeroDispatchGroups = (stage, groups) => keep(groups, (l) => isZeroDispatchLine(stage, l));

// Everything except the zero-dispatch lines; supplier groups left empty disappear.
export const hideZeroDispatchGroups = (stage, groups) => keep(groups, (l) => !isZeroDispatchLine(stage, l));

// entries = [{ h, groups }]. An STR left with no groups drops out of the page.
export function zeroDispatchEntries(entries) {
  return entries.map((e) => ({ h: e.h, groups: zeroDispatchGroups(e.h.stage, e.groups) })).filter((e) => e.groups.length > 0);
}

export function visibleReportEntries(entries, hideZero) {
  if (!hideZero) return entries;
  return entries.map((e) => ({ h: e.h, groups: hideZeroDispatchGroups(e.h.stage, e.groups) })).filter((e) => e.groups.length > 0);
}

// Selection for printing: only ticked STRs that are still on the page (stale ticks are dropped).
export function printableSelection(entries, selectedIds) {
  return entries.filter((e) => selectedIds.has(e.h.strId));
}

export function pruneSelection(entries, selectedIds) {
  const present = new Set(entries.map((e) => e.h.strId));
  return new Set([...selectedIds].filter((id) => present.has(id)));
}

export const itemCount = (groups) => grandTotals(groups).items;

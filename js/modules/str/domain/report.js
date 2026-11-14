// Report / Zero Dispatch nesting: Dispatch Branch -> STR -> Supplier -> lines.
// entries = [{ h, groups }] in display order (newest first); the order inside a branch is kept.
export const UNKNOWN_BRANCH = 'Unknown Branch';

export function groupByBranch(entries) {
  const byBranch = new Map();
  for (const e of entries) {
    const name = e.h.dispatchBranch || UNKNOWN_BRANCH;
    if (!byBranch.has(name)) byBranch.set(name, []);
    byBranch.get(name).push(e);
  }
  return [...byBranch.entries()].map(([branch, list]) => ({ branch, entries: list })).sort((a, b) => a.branch.localeCompare(b.branch));
}

// Column pickers. Product is always shown; these are optional and remembered per person (user_prefs).
export const REPORT_COLUMNS = [
  { key: 'price', label: 'R. Price' },
  { key: 'strQty', label: 'STR Qty (Pack)' },
  { key: 'dispatchQty', label: 'Dispatch Qty (Pack)' },
  { key: 'receiveQty', label: 'Receive Qty (Pack)' },
  { key: 'diff', label: 'Difference' },
];
export const ZERO_COLUMNS = [
  { key: 'price', label: 'R. Price' },
  { key: 'strQty', label: 'STR Qty (Pack)' },
  { key: 'dispatchQty', label: 'Dispatch Qty (Pack)' },
];

// Saved choice -> full map. Unknown keys are ignored, missing keys default to shown, non-booleans are ignored.
export function normalizeColumns(defs, saved) {
  const out = {};
  for (const c of defs) out[c.key] = saved && typeof saved[c.key] === 'boolean' ? saved[c.key] : true;
  return out;
}

export const visibleColumns = (defs, cols) => defs.filter((c) => cols[c.key]);

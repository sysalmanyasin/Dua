// The live view of one round in the progress popup: items with their count, system quantity and difference, A to Z, filtered;
// and each counter's progress. Pure: the database answer (audit_round_live, migration 0420) in, plain objects out.
// Nothing is worked out here that the database has not already stated except the totals shown at the top.

export const LIVE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'diff', label: 'Differences' },
  { key: 'counted', label: 'Counted' },
  { key: 'left', label: 'Not counted' },
];

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const az = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** Rows, people and totals. An item with no count has qty and difference null (not zero). Items are sorted A to Z by product name. */
export function liveFrom(res) {
  const items = (res?.items ?? [])
    .map((i) => {
      const counted = Boolean(i.counted);
      const qty = counted ? num(i.qty) : null;
      const difference = counted ? num(i.difference) : null;
      return {
        key: `${i.assignment_id ?? ''}:${i.round_item_id}`,
        id: i.round_item_id,
        assignmentId: i.assignment_id ?? null,
        person: i.person ?? '',
        code: String(i.code ?? ''),
        name: String(i.name ?? ''),
        company: String(i.company ?? ''),
        systemQty: num(i.system_qty),
        counted,
        qty,
        assumed: Boolean(i.auto_matched),
        note: i.note ?? '',
        difference,
        value: counted ? num(i.difference_value) : null,
        hasDifference: counted && difference !== null && difference !== 0,
      };
    })
    .sort(az);

  const people = (res?.assignments ?? []).map((a) => {
    const total = Number(a.items || 0);
    const done = Math.min(total, Number(a.counted || 0));
    return {
      id: a.id,
      name: a.name || 'Counter',
      status: a.status,
      submitted: a.status === 'submitted',
      forced: Boolean(a.forced),
      total,
      done,
      percent: total ? Math.round((done / total) * 100) : 0,
      differences: Number(a.differences || 0),
    };
  });

  const total = items.length;
  const counted = items.filter((i) => i.counted).length;
  const differences = items.filter((i) => i.hasDifference);
  return {
    state: res?.round?.state ?? null,
    items,
    people,
    totals: {
      items: total,
      counted,
      remaining: total - counted,
      percent: total ? Math.round((counted / total) * 100) : 0,
      differences: differences.length,
      value: differences.reduce((n, i) => n + (i.value ?? 0), 0),
    },
  };
}

const TEST = {
  all: () => true,
  diff: (i) => i.hasDifference,
  counted: (i) => i.counted,
  left: (i) => !i.counted,
};
export const filterLive = (items, key) => (items ?? []).filter(TEST[key] ?? TEST.all);

/** How many items each filter would show, for the chips. */
export const liveCounts = (items) => Object.fromEntries(LIVE_FILTERS.map((f) => [f.key, filterLive(items, f.key).length]));

/** "+2" / "−1" / "0": the difference with its sign. */
export const diffText = (d) => {
  if (d === null || d === undefined) return '–';
  const n = Number(Number(d).toFixed(3));
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
};

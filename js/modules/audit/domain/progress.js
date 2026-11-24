// One person's progress (items counted and not yet counted) and the "needs attention" lists. Pure: database rows in, plain objects out.

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'left', label: 'Not counted' },
  { key: 'counted', label: 'Counted' },
  { key: 'assumed', label: 'Assumed to match' },
  { key: 'notes', label: 'With a note' },
];

/** audit_assignment_progress result as the panel shows it. Not-counted items keep qty null: they are not zero. */
export function progressModel(res) {
  const a = res?.assignment ?? {};
  const items = (res?.items ?? []).map((i) => ({
    id: i.round_item_id,
    code: i.code,
    name: i.name,
    company: i.company,
    counted: Boolean(i.counted),
    qty: i.counted && i.qty !== null && i.qty !== undefined ? Number(i.qty) : null,
    assumed: Boolean(i.auto_matched),
    confirmed: Boolean(i.confirmed_same),
    note: i.note ?? '',
    at: i.counted_at ?? null,
  }));
  const counted = items.filter((i) => i.counted).length;
  return {
    assignmentId: a.id ?? null,
    name: a.name ?? 'Someone',
    status: a.status ?? '',
    roundState: a.round_state ?? '',
    items,
    total: items.length,
    counted,
    left: items.length - counted,
  };
}

const TEST = {
  all: () => true,
  left: (i) => !i.counted,
  counted: (i) => i.counted,
  assumed: (i) => i.assumed,
  notes: (i) => i.note !== '',
};
export const filterItems = (items, key) => (items ?? []).filter(TEST[key] ?? TEST.all);

/** How many items each filter would show, for the chips. */
export const filterCounts = (items) => Object.fromEntries(FILTERS.map((f) => [f.key, filterItems(items, f.key).length]));

const ROUND_LABEL = 'round_label';

/**
 * audit_attention_summary as badges. Each badge number equals the list behind it: the row count for "ready to compile",
 * the sum of n for conflicts and corrections. Badges with nothing to do are left out.
 */
export function attentionBadges(res) {
  const defs = [
    ['ready', '', '', (rows) => rows.length],
    ['conflicts', 'open conflict', 'open conflicts', (rows) => rows.reduce((n, r) => n + Number(r.n), 0)],
    ['corrections', 'correction waiting', 'corrections waiting', (rows) => rows.reduce((n, r) => n + Number(r.n), 0)],
  ];
  const out = [];
  for (const [key, one, many, count] of defs) {
    const rows = (res?.[key] ?? []).map((r) => ({
      engagementId: r.engagement_id,
      engagementName: r.engagement_name,
      roundId: r.round_id,
      label: r[ROUND_LABEL],
      n: Number(r.n),
    }));
    const n = count(rows);
    if (n === 0) continue;
    const text = key === 'ready' ? (n === 1 ? '1 round ready to compile' : `${n} rounds ready to compile`) : `${n} ${n === 1 ? one : many}`;
    out.push({ key, count: n, text, rows });
  }
  return out;
}

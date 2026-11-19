// Company picker logic: search, sort and the one-line summary under each name. Pure functions.

/** Companies whose name contains the search text (ignoring case), sorted by name. */
export function visibleCompanies(list, query = '', ascending = true) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  const out = q ? list.filter((c) => c.company.toLowerCase().includes(q)) : [...list];
  out.sort((a, b) => a.company.localeCompare(b.company));
  return ascending ? out : out.reverse();
}

/** "10 SKUs · Rs 115,769", as the old Random app showed it. */
export function companySummary(c, fmt = (n) => Math.round(n).toLocaleString('en-US')) {
  return `${c.skus.toLocaleString('en-US')} ${c.skus === 1 ? 'SKU' : 'SKUs'} · Rs ${fmt(c.value)}`;
}

/** Adds names to a selection without passing `max`. Returns { next, hitLimit }. */
export function addUpTo(selected, names, max) {
  const next = new Set(selected);
  let hitLimit = false;
  for (const n of names) {
    if (next.has(n)) continue;
    if (next.size >= max) {
      hitLimit = true;
      break;
    }
    next.add(n);
  }
  return { next, hitLimit };
}

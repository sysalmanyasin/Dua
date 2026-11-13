// Ranked text search over the local products. Ported from the old app's BTSearch so results come back in the same order.
// Scores: exact 100, starts with 95, contains 85, all words present 80, any word of 2+ letters 60, letters in order 35.
const norm = (s) => String(s || '').toLowerCase().trim();

export function score(text, query) {
  const t = norm(text);
  const q = norm(query);
  if (!q) return 50;
  if (t === q) return 100;
  if (t.startsWith(q)) return 95;
  if (t.includes(q)) return 85;
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 80;
  if (words.some((w) => w.length >= 2 && t.includes(w))) return 60;
  if (q.length >= 3) {
    let ti = 0;
    for (let qi = 0; qi < q.length; qi++) {
      while (ti < t.length && t[ti] !== q[qi]) ti++;
      if (ti >= t.length) return 0;
      ti++;
    }
    return 35;
  }
  return 0;
}

/** Keep the items that match, best score first; equal scores keep their original order. No query returns the items as they are. */
export function filterAndRank(items, query, fields = ['name']) {
  if (!query) return items;
  return (items || [])
    .map((item) => ({ item, score: fields.reduce((max, f) => Math.max(max, score(item[f] || '', query)), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

export const SEARCH_FIELDS = ['code', 'name', 'generic', 'company', 'supplier'];

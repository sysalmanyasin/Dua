// The auto-split preview. The same rules as the database function audit_assign_auto (0401, ordered by 0404), so what the owner
// sees before applying is what the database then does. Pure functions, no DOM, no database.
//
//  * Companies are taken biggest first; equal sizes in plain character order.
//  * Round unit "company": a company goes whole to the least-loaded person; a tie goes to the first listed.
//    Load grows by 1 per company ("company" split) or by the company's item count ("volume" split).
//  * Round unit "item": every item goes one by one to the least-loaded person, load growing by 1 per item.
//  * A person who gets nothing is not given an empty assignment.

export const SPLITS = { company: 'Balance the number of companies', volume: 'Balance the number of items' };

const byChar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {{ companies: {company: string, items: number}[], auditors: string[], split: 'company'|'volume', unit: 'company'|'item' }} input
 * @returns {{ auditorId: string, items: number, companies: string[] }[]}  only people who get something, in the order given
 */
export function planAutoSplit({ companies, auditors, split = 'company', unit = 'company' }) {
  const people = [...new Set(auditors)];
  if (people.length === 0) return [];
  const got = people.map((id) => ({ auditorId: id, items: 0, companies: new Set() }));
  const loads = people.map(() => 0);
  const least = () => loads.reduce((best, v, j) => (v < loads[best] ? j : best), 0);
  const ordered = [...companies].sort((a, b) => b.items - a.items || byChar(a.company, b.company));
  for (const c of ordered) {
    if (unit === 'item') {
      for (let n = 0; n < c.items; n += 1) {
        const j = least();
        got[j].items += 1;
        got[j].companies.add(c.company);
        loads[j] += 1;
      }
    } else {
      const j = least();
      got[j].items += c.items;
      got[j].companies.add(c.company);
      loads[j] += split === 'company' ? 1 : c.items;
    }
  }
  return got.filter((g) => g.items > 0).map((g) => ({ auditorId: g.auditorId, items: g.items, companies: [...g.companies] }));
}

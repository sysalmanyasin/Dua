// Petty Detail rules (the database repeats them in 0106_mgmt_petty.sql). A voucher is a titled list of lines; each line amount is rounded
// to a whole rupee on its own, and the voucher total is the sum of those. A refund is a negative line.
import { parseAmount } from '../../../shared/format.js';
import { rup } from './salary.js';

export const lineAmount = (text) => {
  const n = parseAmount(String(text ?? ''));
  return n === null || Number.isNaN(n) ? 0 : rup(n);
};
export const groupTotal = (group) => group.lines.reduce((s, l) => s + lineAmount(l.amount), 0);
export const monthTotal = (groups) => groups.reduce((s, g) => s + groupTotal(g), 0);

export const blankLine = () => ({ description: '', amount: '' });
export const isBlankLine = (l) => String(l.description ?? '').trim() === '' && String(l.amount ?? '').trim() === '';
export const newGroup = (key) => ({ group_key: key, title: '', lines: [blankLine()], isNew: true });

// Turns the editable groups into what is sent: blank lines and untouched blank new groups are dropped.
export function toPayload(groups, removedKeys) {
  const keep = groups
    .map((g) => ({ ...g, lines: g.lines.filter((l) => !isBlankLine(l)) }))
    .filter((g) => !(g.isNew && g.title.trim() === '' && g.lines.length === 0));
  return [
    ...keep.map((g) => ({
      group_key: g.group_key,
      title: g.title.trim(),
      lines: g.lines.map((l) => ({ description: l.description.trim(), amount: lineAmount(l.amount) })),
    })),
    ...removedKeys.map((k) => ({ group_key: k, removed: true })),
  ];
}

// Early feedback only; the database checks again. Returns a plain sentence or null.
export function validateGroups(groups) {
  for (const g of groups) {
    const lines = g.lines.filter((l) => !isBlankLine(l));
    if (g.isNew && g.title.trim() === '' && lines.length === 0) continue;
    const name = g.title.trim() || 'A voucher';
    if (g.title.trim() === '') return 'Give every voucher a title.';
    if (lines.length === 0) return `${name} needs at least one line.`;
    for (const l of lines) {
      if (l.description.trim() === '') return `${name}: every line needs a description.`;
      const n = parseAmount(String(l.amount ?? ''));
      if (n === null || Number.isNaN(n)) return `${name}: check the amount for “${l.description.trim()}”.`;
      if (rup(n) === 0) return `${name}: an amount cannot be zero (“${l.description.trim()}”).`;
    }
  }
  return null;
}

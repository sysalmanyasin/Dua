// Report helpers: the CSV file, the trail wording and money text. Pure functions, no network or DOM.
// A cell that a spreadsheet could read as a formula (starts with = + - @ or a tab / return) gets a leading apostrophe
// (CSV injection), but only in text columns: a negative quantity is a number and stays one.
const FORMULA = /^[=+\-@\t\r]/;
export const csvText = (v) => {
  const t = String(v ?? '');
  return FORMULA.test(t) ? `'${t}` : t;
};
export const csvCell = (v) => {
  const t = String(v ?? '');
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

const CONFLICT = { a: 'kept this round', b: 'kept the earlier round' };

/** The final lines as CSV text (header row first, CRLF line ends, UTF-8 with a byte-order mark added by the caller). */
export function finalCsv(lines) {
  const head = [
    'Company',
    'Code',
    'Product',
    'System qty',
    'Retail price',
    'Counted qty',
    'Final qty',
    'Difference',
    'Difference value',
    'Counted by',
    'Not counted',
    'Assumed matching',
    'Conflict',
    'Note',
  ];
  const rows = lines.map((l) => [
    csvText(l.company),
    csvText(l.code),
    csvText(l.name),
    l.system_qty,
    l.retail_price,
    l.counted_qty,
    l.final_qty,
    l.variance,
    l.variance_value,
    csvText(l.auditor_name ?? ''),
    l.missing && !l.auto_matched ? 'yes' : '',
    l.auto_matched ? 'yes' : '',
    l.conflict_side ? CONFLICT[l.conflict_side] : '',
    csvText(l.note ?? ''),
  ]);
  return [csvRow(head), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

/** A file name that is safe on every system: letters, digits, dash and underscore only. */
export const safeFileName = (name, ext) =>
  `${
    String(name ?? 'audit')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'audit'
  }.${ext}`;

const ACTION = {
  'audit.engagement_created': 'Audit created',
  'audit.member_set': 'Team changed',
  'audit.round_created': 'Round made',
  'audit.round_locked': 'Round locked',
  'audit.round_started': 'Counting started',
  'audit.assigned_auto': 'Items given out',
  'audit.assign_moved': 'Items moved',
  'audit.assign_revoked': 'Part taken back',
  'audit.individual_started': 'Individual audit started',
  'audit.submitted': 'Count submitted',
  'audit.force_submitted': 'Submitted by the owner',
  'audit.reopened': 'Count reopened',
  'audit.compiled': 'Compiled',
  'audit.recompiled': 'Compiled again',
  'audit.correction_proposed': 'Correction proposed',
  'audit.correction_approved': 'Correction approved',
  'audit.correction_rejected': 'Correction rejected',
  'audit.conflict_resolved': 'Conflict settled',
  'audit.round_next': 'Next round made',
  'audit.finalized': 'Final snapshot created',
};
/** Plain words for an action code; an unknown one is shown readably rather than hidden. */
export const actionText = (code) =>
  ACTION[code] ??
  String(code ?? '')
    .replace(/^audit\./, '')
    .replace(/_/g, ' ');

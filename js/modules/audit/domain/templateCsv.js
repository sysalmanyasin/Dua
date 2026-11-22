// Reads CSV (or plain text) files that hold product codes only. One file makes one template, named after the file.
// A code is kept exactly as written, so leading zeros survive. Nothing here touches the database or the page.
import { parseCodes } from './count.js';

export const MAX_CODES = 5000; // the database refuses a template with more (migration 0406)
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_FILES = 20;

// A first row made only of words like "Code", "Product Code" or "SKU" is a heading, not a product.
const HEADING = /^(?:(?:product|item|stock)[\s_-]*)?(?:codes?|ids?|skus?|barcodes?|items?|products?)$/i;
// Excel turns long numbers into 1.23E+10 and the real code cannot be recovered, so such a value is never used.
const MANGLED = /^\d+(?:\.\d+)?e[+-]?\d+$/i;

/** Splits one line at commas, semicolons or tabs, keeping a quoted cell whole. */
function splitRow(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** Undoes what spreadsheets add in front of a code: ="00123" or a leading apostrophe. */
function cleanCell(cell) {
  let c = String(cell ?? '').trim();
  if (c.startsWith('=')) c = c.slice(1); // the quotes of ="00123" are already removed when the cell is split
  if (c.startsWith("'")) c = c.slice(1);
  return c.trim();
}

/**
 * @param {string} text the file's contents
 * @returns {{ codes: string[], heading: boolean, suspect: number, error?: string }}
 *   codes are distinct, in file order; suspect counts values left out because they look like spreadsheet-damaged numbers.
 */
export function parseCodesCsv(text) {
  const lines = String(text ?? '')
    .replace(/^\ufeff/, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '');
  const rows = lines.map((l) =>
    splitRow(l)
      .map(cleanCell)
      .filter((c) => c !== ''),
  );
  let heading = false;
  if (rows.length > 0 && rows[0].length > 0 && rows[0].every((c) => HEADING.test(c))) {
    heading = true;
    rows.shift();
  }
  let suspect = 0;
  const kept = [];
  for (const cell of rows.flat()) {
    if (MANGLED.test(cell)) suspect += 1;
    else kept.push(cell);
  }
  const codes = parseCodes(kept.join(' '));
  if (codes.length === 0) {
    return {
      codes,
      heading,
      suspect,
      error:
        suspect > 0
          ? 'Every value looks like a number a spreadsheet has shortened (such as 1.2E+10). Save the codes as text and try again.'
          : 'No product codes found in this file.',
    };
  }
  if (codes.length > MAX_CODES)
    return { codes, heading, suspect, error: `A template can hold up to ${MAX_CODES} codes; this file has ${codes.length}.` };
  return { codes, heading, suspect };
}

/** "weekly_fridge.csv" becomes "weekly fridge". */
export function templateNameFromFile(fileName) {
  return String(fileName ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** One chosen file turned into a row the person can check before anything is saved. */
export function planFromFile({ name, text, error }) {
  const base = { file: name, name: templateNameFromFile(name), codes: [], heading: false, suspect: 0 };
  if (error) return { ...base, error };
  return { ...base, ...parseCodesCsv(text) };
}

const same = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();

/**
 * What stops each row from being saved, or null when it can be. Matches the database rules: a name of 2 to 80 letters,
 * not used by another template (case is ignored), and not used twice in this batch.
 * @param {Array<{name:string, error?:string, saveError?:string}>} plan
 * @param {string[]} existingNames
 */
export function checkPlan(plan, existingNames = []) {
  const taken = new Set(existingNames.map(same));
  const uses = new Map();
  for (const p of plan) if (!p.error) uses.set(same(p.name), (uses.get(same(p.name)) ?? 0) + 1);
  return plan.map((p) => {
    if (p.error) return p.error;
    if (p.saveError) return p.saveError;
    const n = String(p.name ?? '').trim();
    if (n.length < 2 || n.length > 80) return 'A template needs a name of 2 to 80 letters.';
    if (taken.has(same(n))) return 'A template with this name already exists. Change the name.';
    if (uses.get(same(n)) > 1) return 'Two files have this name. Change one of them.';
    return null;
  });
}

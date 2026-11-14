// Filtering and ordering of STR headers already loaded on the phone.
// Header shape (camelCase, made by data/): strId, strNumber, masterStrId, refNo, comments, issuedBy, dispatchedBy,
// receivedBy, dispatchBranch, receiveBranch, strDate ('YYYY-MM-DD' or null), direction ('in' | 'out' | ''), stage.
// `stage` is decided by the database (str_stage), never re-derived here.

export const STAGES = ['awaited', 'dispatched', 'received'];
export const STAGE_LABEL = { awaited: 'Awaited', dispatched: 'Dispatched', received: 'Received' };

export const isDispatchedFromBT = (h) => h.direction === 'out';
export const isReceivedAtBT = (h) => h.direction === 'in';

// Same fields the database search looks at (str_search_headers), so both give the same answer.
const SEARCH_FIELDS = [
  'strNumber',
  'masterStrId',
  'refNo',
  'comments',
  'issuedBy',
  'dispatchedBy',
  'receivedBy',
  'dispatchBranch',
  'receiveBranch',
];

export function searchWords(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

// filters = { search, stage: 'all'|stage, branch: 'all'|'dispatched'|'received', dateFrom, dateTo, matchIds: Set|null }
// Text search has two sources. Header words (STR number, ref, comments, people, branches) are matched here on the loaded
// list. Product code/name needs the lines, which are not all on the phone: the database search (str_search_headers) does
// the whole search and its result ids come back as `matchIds`. When matchIds is given it is the text result and the words
// are not matched again here; the stage, branch and date filters still apply.
export function filterHeaders(headers, f = {}) {
  let list = headers;
  if (f.matchIds) list = list.filter((h) => f.matchIds.has(h.strId));
  if (f.branch === 'dispatched') list = list.filter(isDispatchedFromBT);
  else if (f.branch === 'received') list = list.filter(isReceivedAtBT);
  if (f.stage && f.stage !== 'all') list = list.filter((h) => h.stage === f.stage);
  if (f.dateFrom) list = list.filter((h) => h.strDate && h.strDate >= f.dateFrom);
  if (f.dateTo) list = list.filter((h) => h.strDate && h.strDate <= f.dateTo);
  const words = f.matchIds ? [] : searchWords(f.search);
  if (words.length) {
    list = list.filter((h) => {
      const hay = SEARCH_FIELDS.map((k) => String(h[k] || '').toLowerCase()).join('\n');
      return words.every((w) => hay.includes(w));
    });
  }
  return sortHeaders(list);
}

// Newest first: date descending (no date last), then id descending.
export function sortHeaders(list) {
  return list.slice().sort((a, b) => (b.strDate || '').localeCompare(a.strDate || '') || Number(b.strId) - Number(a.strId));
}

export function branchCounts(headers) {
  return { dispatched: headers.filter(isDispatchedFromBT).length, received: headers.filter(isReceivedAtBT).length };
}

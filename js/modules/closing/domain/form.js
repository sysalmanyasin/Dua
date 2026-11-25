// The draft form: what a person has typed, as plain strings, and how it maps to and from the database.
// Pure functions (no DOM, no network). Money maths for the screen's quick totals reuses toPaisa from compute.js so a total
// shown while typing can never disagree with the server's (a test compares them on the same data).
import { parseAmount } from '../../../shared/format.js';
import { DENOMINATIONS, toPaisa } from './compute.js';

let counter = 0;
export const rowId = () => `r${Date.now().toString(36)}${(counter++).toString(36)}`;

const text = (v) => (v === null || v === undefined ? '' : String(v));
// a saved 0 shows as an empty box (the original ledger looks empty until something is typed); anything else shows as saved
const amountText = (v) => (v === null || v === undefined || Number(v) === 0 ? '' : String(Number(v)));
const overrideText = (v) => (v === null || v === undefined ? '' : String(Number(v))); // a typed 0 IS an override

export const emptyRow = (extra = {}) => ({ id: rowId(), deleted: false, ...extra });

export const TIER_SLOTS = 3;
/** A named account shows its entry row only once there is something in it (or the person opened it): the old app's compact look. */
export const namedShown = (r) => Boolean(r.shown || r.line_id || r.deleted || String(r.desc ?? '').trim() || String(r.amount ?? '').trim());

/** The three staff-credit groups (owner decision, 21 Nov 2026). The same active staff list is offered under each one. */
export const CREDIT_GROUPS = ['Morning Shift', 'Evening Shift', 'Night Shift'];
const blankTier = () => ({ id: rowId(), line_id: null, label: '', amount: '', group: '', person: '' });
const namedLine = (a) => ({ id: rowId(), line_id: null, account_id: a.id, label: a.label, desc: '', amount: '', deleted: false });
/** One more entry for a named account (the old app let an account have several, each with an optional description). */
export const namedEntry = (accountId, label) => ({
  id: rowId(),
  line_id: null,
  account_id: accountId,
  label,
  desc: '',
  amount: '',
  deleted: false,
});
// A named line is saved with the label "Account — description" (no database change); on loading it is split again.
const NAMED_SEP = ' — ';
/** A saved staff-credit label ("Morning Shift — Ali") back into its two boxes. Older free-text labels still show, in the Name box. */
export const tierSplit = (label) => {
  const s = String(label ?? '').trim();
  const i = s.indexOf(NAMED_SEP);
  if (i >= 0) return { group: s.slice(0, i).trim(), person: s.slice(i + NAMED_SEP.length).trim() };
  return CREDIT_GROUPS.includes(s) ? { group: s, person: '' } : { group: '', person: s };
};
/** The two boxes into the one label the database stores (the same "A — B" pattern the named accounts use). */
export const tierJoin = (group, person) =>
  [group, person]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(NAMED_SEP)
    .slice(0, 120);
export const namedLabel = (r) =>
  String(r.desc ?? '').trim() ? `${r.label.trim()}${NAMED_SEP}${String(r.desc).trim()}`.slice(0, 120) : r.label.trim();

export function emptyForm(catalogue = [], accounts = []) {
  return {
    sys_cash: '',
    last_bill_no: '',
    last_bill_amt: '',
    comp_sale: '',
    alfalah: '',
    keenu: '',
    ret_manual: ['', '', ''],
    ret_system: '',
    prev_mediq: '',
    mediq: [],
    book: ['', ''],
    overrides: { shift_sale: '', customers: '', curr_cc: '', prev_cash: '', prev_cc: '' },
    hs: [],
    strips: catalogue.map((s) => stripLine(s)),
    responsible_staff_id: '',
    opening: { cc: '', credit: '', deposits: '', cash: '' },
    extra_cash: '',
    final_sys_returns: '',
    credit_adj: '',
    till: Array(8).fill(''),
    vault: Array(8).fill(''),
    misc: [],
    deposits: [],
    credit: {
      named: accounts.filter((a) => a.kind === 'named').map(namedLine),
      tier: Array.from({ length: TIER_SLOTS }, blankTier),
      free: [],
    },
  };
}

const stripLine = (s) => ({ id: rowId(), deleted: false, strip_id: s.id, label: s.label, price: amountText(s.price), qty: '' });

const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);

/** Builds the form from a closings row with its sections embedded (see data/api.js loadDraft). */
export function formFromRow(row, catalogue = [], accounts = []) {
  const f = emptyForm([], []);
  f.sys_cash = amountText(row.sys_cash);
  f.last_bill_no = amountText(row.last_bill_no);
  f.last_bill_amt = amountText(row.last_bill_amt);
  f.comp_sale = amountText(row.comp_sale);
  f.alfalah = amountText(row.alfalah);
  f.keenu = amountText(row.keenu);
  f.ret_manual = [amountText(row.ret_manual_1), amountText(row.ret_manual_2), amountText(row.ret_manual_3)];
  f.ret_system = amountText(row.ret_system);
  f.prev_mediq = amountText(row.prev_mediq);
  f.book = [amountText(row.book_bill_1), amountText(row.book_bill_2)];
  f.overrides = {
    shift_sale: overrideText(row.ov_shift_sale),
    customers: overrideText(row.ov_customers),
    curr_cc: overrideText(row.ov_curr_cc),
    prev_cash: overrideText(row.ov_prev_cash),
    prev_cc: overrideText(row.ov_prev_cc),
  };
  f.responsible_staff_id = row.responsible_staff_id ?? '';
  f.opening = {
    cc: amountText(row.prev_cc),
    credit: amountText(row.prev_credit),
    deposits: amountText(row.prev_deposits),
    cash: amountText(row.prev_cash),
  };
  f.mediq = [...(row.closing_mediq_orders ?? [])].sort(bySort).map((r) => ({
    id: r.id,
    bill_no: text(r.bill_no),
    collected: amountText(r.collected),
    pharmacy_bill: amountText(r.pharmacy_bill),
    deleted: Boolean(r.deleted_at),
  }));
  f.hs = [...(row.closing_hs_rows ?? [])]
    .sort(bySort)
    .map((r) => ({ id: r.id, label: text(r.label), amount: amountText(r.amount), deleted: Boolean(r.deleted_at) }));
  const saved = [...(row.closing_strip_lines ?? [])].sort(bySort).map((r) => ({
    id: r.id,
    strip_id: r.strip_id ?? null,
    label: text(r.label),
    price: amountText(r.price),
    qty: amountText(r.qty),
    deleted: Boolean(r.deleted_at),
  }));
  // a strip added to the catalogue after this draft began still gets a line
  const have = new Set(saved.map((l) => l.strip_id).filter(Boolean));
  f.strips = [...saved, ...catalogue.filter((s) => !have.has(s.id)).map((s) => stripLine(s))];

  f.extra_cash = amountText(row.extra_cash);
  f.final_sys_returns = amountText(row.final_sys_returns);
  f.credit_adj = amountText(row.credit_adj);
  const counts = (area) => {
    const out = Array(8).fill('');
    for (const k of row.closing_cash_counts ?? []) {
      const i = DENOMINATIONS.indexOf(Number(k.denomination));
      if (k.area === area && i >= 0) out[i] = amountText(k.qty);
    }
    return out;
  };
  f.till = counts('till');
  f.vault = counts('vault');
  f.misc = [...(row.closing_misc_rows ?? [])].sort(bySort).map((r) => ({
    id: r.id,
    charge_id: r.charge_id,
    label: text(r.label),
    amount: amountText(r.amount),
    deleted: Boolean(r.deleted_at),
  }));
  f.deposits = [...(row.closing_deposits ?? [])]
    .sort(bySort)
    .map((r) => ({ id: r.id, label: text(r.label), amount: amountText(r.amount), deleted: Boolean(r.deleted_at) }));
  const lines = row.closing_credit_lines ?? [];
  const line = (r) => ({
    id: r.id,
    line_id: r.line_id,
    label: text(r.label),
    amount: amountText(r.amount),
    deleted: Boolean(r.deleted_at),
  });
  const savedNamed = lines.filter((r) => r.kind === 'named').sort(bySort);
  const haveAcc = new Set(savedNamed.map((r) => r.account_id));
  const accLabel = (id) => accounts.find((a) => a.id === id)?.label;
  f.credit.named = [
    ...savedNamed.map((r) => {
      const l = line(r);
      const base = accLabel(r.account_id);
      if (base && l.label.startsWith(base + NAMED_SEP))
        return { ...l, account_id: r.account_id, label: base, desc: l.label.slice(base.length + NAMED_SEP.length) };
      return { ...l, account_id: r.account_id, desc: '' };
    }),
    ...accounts.filter((a) => a.kind === 'named' && !haveAcc.has(a.id)).map(namedLine),
  ];
  f.credit.tier = Array.from({ length: TIER_SLOTS }, (_, i) => {
    const r = lines.find((x) => x.kind === 'tier' && x.tier_slot === i + 1);
    if (!r) return blankTier();
    const l = line(r);
    return { ...l, ...tierSplit(l.label) };
  });
  f.credit.free = lines
    .filter((r) => r.kind === 'free')
    .sort(bySort)
    .map(line);
  return f;
}

// `whole`: a count of notes or a bill number cannot have a fraction (the database would round 12.5 to 13 without a word)
const num = (s, invalid, path, { quantity = false, whole = false } = {}) => {
  const v = parseAmount(s);
  if (Number.isNaN(v) || (quantity && v !== null && v < 0) || (whole && v !== null && !Number.isInteger(v))) {
    invalid.push(path);
    return 0;
  }
  return v ?? 0;
};
const overrideNum = (s, invalid, path) => {
  if (String(s ?? '').trim() === '') return null;
  const v = parseAmount(s);
  if (Number.isNaN(v) || v === null) {
    invalid.push(path);
    return null;
  }
  return v;
};
const isBlank = (r, keys) => !r.deleted && keys.every((k) => String(r[k] ?? '').trim() === '');

/**
 * The payload the database function takes (closing_save_draft). `invalid` lists the paths of fields that could not be read;
 * the screen shows those and does not send until they are fixed, so a typo can never be saved as 0.
 */
export function payloadFromForm(form, { isOpening = false } = {}) {
  const invalid = [];
  const n = (k) => num(form[k], invalid, k);
  const payload = {
    sys_cash: n('sys_cash'),
    last_bill_no: num(form.last_bill_no, invalid, 'last_bill_no', { quantity: true, whole: true }),
    last_bill_amt: n('last_bill_amt'),
    comp_sale: n('comp_sale'),
    alfalah: n('alfalah'),
    keenu: n('keenu'),
    ret_manual_1: num(form.ret_manual[0], invalid, 'ret_manual.0'),
    ret_manual_2: num(form.ret_manual[1], invalid, 'ret_manual.1'),
    ret_manual_3: num(form.ret_manual[2], invalid, 'ret_manual.2'),
    ret_system: n('ret_system'),
    prev_mediq: n('prev_mediq'),
    book_bill_1: num(form.book[0], invalid, 'book.0'),
    book_bill_2: num(form.book[1], invalid, 'book.1'),
    // all five are always sent: the database sets each one from this object, and a missing key would clear it
    overrides: {
      shift_sale: overrideNum(form.overrides.shift_sale, invalid, 'overrides.shift_sale'),
      customers: overrideNum(form.overrides.customers, invalid, 'overrides.customers'),
      curr_cc: overrideNum(form.overrides.curr_cc, invalid, 'overrides.curr_cc'),
      prev_cash: overrideNum(form.overrides.prev_cash, invalid, 'overrides.prev_cash'),
      prev_cc: overrideNum(form.overrides.prev_cc, invalid, 'overrides.prev_cc'),
    },
    mediq: form.mediq
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !isBlank(r, ['bill_no', 'collected', 'pharmacy_bill']))
      .map(({ r, i }) => ({
        bill_no: r.bill_no.trim(),
        collected: num(r.collected, invalid, `mediq.${i}.collected`),
        pharmacy_bill: num(r.pharmacy_bill, invalid, `mediq.${i}.pharmacy_bill`),
        deleted: r.deleted,
      })),
    hs: form.hs
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !isBlank(r, ['label', 'amount']))
      .map(({ r, i }) => ({ label: r.label.trim(), amount: num(r.amount, invalid, `hs.${i}.amount`), deleted: r.deleted })),
    strips: form.strips
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.strip_id || !isBlank(r, ['label', 'price', 'qty']))
      .map(({ r, i }) => ({
        strip_id: r.strip_id || null,
        label: r.label.trim(),
        price: num(r.price, invalid, `strips.${i}.price`),
        qty: num(r.qty, invalid, `strips.${i}.qty`, { quantity: true }),
        deleted: r.deleted,
      })),
  };
  payload.extra_cash = n('extra_cash');
  payload.final_sys_returns = n('final_sys_returns');
  payload.credit_adj = num(form.credit_adj, invalid, 'credit_adj');
  // the last box is coins / loose change (an amount, so it may have paisa); the others count whole notes
  const noteCount = (area) =>
    form[area].map((v, i) => num(v, invalid, `${area}.${i}`, { quantity: true, whole: i < DENOMINATIONS.length - 1 }));
  payload.till = noteCount('till');
  payload.vault = noteCount('vault');
  payload.misc = form.misc
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.charge_id || !isBlank(r, ['label', 'amount']))
    .map(({ r, i }) => ({
      ...(r.charge_id ? { charge_id: r.charge_id } : {}),
      label: r.label.trim(),
      amount: num(r.amount, invalid, `misc.${i}.amount`),
      deleted: r.deleted,
    }));
  payload.deposits = form.deposits
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !isBlank(r, ['label', 'amount']))
    .map(({ r, i }) => ({ label: r.label.trim(), amount: num(r.amount, invalid, `deposits.${i}.amount`), deleted: r.deleted }));
  const lastTier = form.credit.tier.reduce((last, t, i) => (String(t.label).trim() || String(t.amount).trim() ? i : last), -1);
  payload.credit = {
    // each account keeps its first line even when empty; further entries are saved only when something was typed
    named: form.credit.named
      .map((r, i) => ({ r, i, first: form.credit.named.findIndex((x) => x.account_id === r.account_id) === i }))
      .filter(({ r, first }) => first || r.line_id || !isBlank(r, ['desc', 'amount']))
      .map(({ r, i }) => ({
        ...(r.line_id ? { line_id: r.line_id } : {}),
        account_id: r.account_id,
        label: namedLabel(r),
        amount: num(r.amount, invalid, `credit.named.${i}.amount`),
        deleted: r.deleted,
      })),
    tier: form.credit.tier.slice(0, lastTier + 1).map((r, i) => ({
      ...(r.line_id ? { line_id: r.line_id } : {}),
      label: r.label.trim(),
      amount: num(r.amount, invalid, `credit.tier.${i}.amount`),
    })),
    free: form.credit.free
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.line_id || !isBlank(r, ['label', 'amount']))
      .map(({ r, i }) => ({
        ...(r.line_id ? { line_id: r.line_id } : {}),
        label: r.label.trim(),
        amount: num(r.amount, invalid, `credit.free.${i}.amount`),
        deleted: r.deleted,
      })),
  };
  if (form.responsible_staff_id) payload.responsible_staff_id = form.responsible_staff_id;
  if (isOpening) {
    payload.opening = {
      cc: num(form.opening.cc, invalid, 'opening.cc'),
      credit: num(form.opening.credit, invalid, 'opening.credit'),
      deposits: num(form.opening.deposits, invalid, 'opening.deposits'),
      cash: num(form.opening.cash, invalid, 'opening.cash'),
    };
  }
  return { payload, invalid };
}

// ── live sync (migration 0217) ──
// The single-box fields are saved one by one (closing_patch_draft) and refreshed from other devices one by one; every list
// section (rows, cash counts, credit, opening figures) is still saved whole with the draft's version check.
export const SIMPLE_PATHS = [
  'sys_cash',
  'last_bill_no',
  'last_bill_amt',
  'comp_sale',
  'alfalah',
  'keenu',
  'ret_manual.0',
  'ret_manual.1',
  'ret_manual.2',
  'ret_system',
  'prev_mediq',
  'book.0',
  'book.1',
  'overrides.shift_sale',
  'overrides.customers',
  'overrides.curr_cc',
  'overrides.prev_cash',
  'overrides.prev_cc',
  'extra_cash',
  'final_sys_returns',
  'credit_adj',
  'responsible_staff_id',
];
export const isSimplePath = (path) => SIMPLE_PATHS.includes(path);
export const getPath = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);

// the key a simple path has in the payload the database takes
const PAYLOAD_KEY = {
  'ret_manual.0': 'ret_manual_1',
  'ret_manual.1': 'ret_manual_2',
  'ret_manual.2': 'ret_manual_3',
  'book.0': 'book_bill_1',
  'book.1': 'book_bill_2',
};
const SIMPLE_KEYS = new Set([...SIMPLE_PATHS.filter((p) => !p.startsWith('overrides.')).map((p) => PAYLOAD_KEY[p] ?? p), 'overrides']);

/** The payload for the whole-draft save: everything except the simple fields, which travel on their own. */
export function listPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !SIMPLE_KEYS.has(k)));
}

/** The fields object closing_patch_draft takes, for the given simple paths, read from an already validated payload. */
export function patchFields(payload, paths) {
  const fields = {};
  for (const path of paths) {
    if (path.startsWith('overrides.')) {
      const k = path.slice('overrides.'.length);
      fields.overrides = { ...(fields.overrides ?? {}), [k]: payload.overrides[k] };
    } else if (path === 'responsible_staff_id') {
      if (payload.responsible_staff_id) fields.responsible_staff_id = payload.responsible_staff_id;
    } else {
      const key = PAYLOAD_KEY[path] ?? path;
      fields[key] = payload[key];
    }
  }
  return fields;
}

/** The text each simple box shows for a saved row (closings columns), by path. Same rules as formFromRow. */
export function simpleTexts(row) {
  return {
    sys_cash: amountText(row.sys_cash),
    last_bill_no: amountText(row.last_bill_no),
    last_bill_amt: amountText(row.last_bill_amt),
    comp_sale: amountText(row.comp_sale),
    alfalah: amountText(row.alfalah),
    keenu: amountText(row.keenu),
    'ret_manual.0': amountText(row.ret_manual_1),
    'ret_manual.1': amountText(row.ret_manual_2),
    'ret_manual.2': amountText(row.ret_manual_3),
    ret_system: amountText(row.ret_system),
    prev_mediq: amountText(row.prev_mediq),
    'book.0': amountText(row.book_bill_1),
    'book.1': amountText(row.book_bill_2),
    'overrides.shift_sale': overrideText(row.ov_shift_sale),
    'overrides.customers': overrideText(row.ov_customers),
    'overrides.curr_cc': overrideText(row.ov_curr_cc),
    'overrides.prev_cash': overrideText(row.ov_prev_cash),
    'overrides.prev_cc': overrideText(row.ov_prev_cc),
    extra_cash: amountText(row.extra_cash),
    final_sys_returns: amountText(row.final_sys_returns),
    credit_adj: amountText(row.credit_adj),
    responsible_staff_id: row.responsible_staff_id ?? '',
  };
}

/** Two box texts mean the same when they read as the same number ("5.50" and "5.5"), or are both empty, or are the same text. */
export function sameText(a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (x === y) return true;
  const nx = parseAmount(x);
  const ny = parseAmount(y);
  return nx !== null && ny !== null && !Number.isNaN(nx) && !Number.isNaN(ny) && nx === ny;
}

/** Simple paths where two forms differ. */
export const simpleDiff = (a, b) => SIMPLE_PATHS.filter((p) => !sameText(getPath(a, p), getPath(b, p)));

/**
 * `form` with the simple fields in `incoming` (path → text) laid over it, except the paths in `keep` (typed here and not yet
 * saved) and the ones in `skip` (the box the person is in right now). Returns { form, changed } where `changed` lists the paths
 * whose text actually changed. Never mutates `form`.
 */
export function mergeSimple(form, incoming, { keep = new Set(), skip = new Set() } = {}) {
  const next = {
    ...form,
    ret_manual: [...form.ret_manual],
    book: [...form.book],
    overrides: { ...form.overrides },
  };
  const changed = [];
  for (const path of SIMPLE_PATHS) {
    if (keep.has(path) || skip.has(path) || !(path in incoming)) continue;
    if (sameText(getPath(next, path), incoming[path])) continue;
    const parts = path.split('.');
    const holder = parts.slice(0, -1).reduce((o, k) => o[k], next);
    holder[parts.at(-1)] = incoming[path];
    changed.push(path);
  }
  return { form: next, changed };
}

// ── quick totals while typing (paisa). Same definitions as computeClosing; money is shown in rupees by the screen. ──
const live = (rows) => rows.filter((r) => !r.deleted);
const p = (s) => {
  const v = parseAmount(s);
  return Number.isNaN(v) || v === null ? 0 : toPaisa(v);
};

export function localTotals(form, carry = {}) {
  const hs = live(form.hs).reduce((t, r) => t + p(r.amount), 0);
  const strips = live(form.strips).reduce((t, r) => {
    const q = parseAmount(r.qty);
    return t + Math.round(p(r.price) * (Number.isNaN(q) || q === null ? 0 : q));
  }, 0);
  const mediqRows = live(form.mediq).reduce((t, r) => t + p(r.collected) - p(r.pharmacy_bill), 0);
  const returns = p(form.ret_manual[0]) + p(form.ret_manual[1]) + p(form.ret_manual[2]) + p(form.ret_system);
  const cash = (counts) =>
    DENOMINATIONS.reduce((tot, d, i) => {
      const q = parseAmount(counts[i]);
      return tot + (Number.isNaN(q) || q === null ? 0 : Math.round(q * d * 100));
    }, 0);
  const misc = live(form.misc).reduce((t, r) => t + p(r.amount), 0);
  const ov = parseAmount(form.overrides.curr_cc);
  const ccCurr = ov !== null && !Number.isNaN(ov) ? toPaisa(ov) : p(form.alfalah) + p(form.keenu) - p(form.comp_sale);
  // a closing may type its own carried CC; empty means use the carried figure (a typed 0 counts)
  const ovCarried = parseAmount(form.overrides.prev_cc);
  const carriedCc = ovCarried !== null && !Number.isNaN(ovCarried) ? toPaisa(ovCarried) : toPaisa(carry.cc);
  const debt =
    toPaisa(carry.credit) +
    live(form.credit.named).reduce((t, r) => t + p(r.amount), 0) +
    form.credit.tier.reduce((t, r) => t + p(r.amount), 0) +
    live(form.credit.free).reduce((t, r) => t + p(r.amount), 0) +
    p(form.credit_adj);
  const deposits = toPaisa(carry.deposits) + live(form.deposits).reduce((t, r) => t + p(r.amount), 0);
  return {
    hs,
    strips,
    mediqExtra: p(form.prev_mediq) + mediqRows,
    mediqRows,
    returns,
    misc,
    ccCurr,
    ccTotal: carriedCc + ccCurr,
    till: cash(form.till),
    vault: cash(form.vault),
    debt,
    deposits,
  };
}
export const rowExtra = (r) => p(r.collected) - p(r.pharmacy_bill);
export const stripLineTotal = (r) => {
  const q = parseAmount(r.qty);
  return Math.round(p(r.price) * (Number.isNaN(q) || q === null ? 0 : q));
};
export const rupees = (paisa) => paisa / 100;

// Rich-text note format and validation. Pure functions: no DOM, no network.
// This mirrors public.workspace_note_valid in 1100_workspace_core.sql. The database is the authority; the browser checks
// first so people get a plain message instead of a refused save. tests/fixtures/workspace-note-cases.json drives both
// validators (see tools/workspace-note-cases.mjs), so they cannot drift apart unnoticed.

export const NOTE_VERSION = 1;
export const NOTE_LIMITS = Object.freeze({
  // The database limit is 262,144 bytes of jsonb text, which spaces out colons and commas more than JSON.stringify does.
  // Keeping the browser limit a little lower means a note the browser accepts is never refused by the database for size.
  bytes: 250000,
  blocks: 5000,
  depth: 8,
  text: 50000,
  marks: 4,
  href: 2000,
  title: 200,
});

const BLOCKS = ['paragraph', 'heading', 'bullet_list', 'ordered_list', 'task_list'];
const IN_ITEM = ['paragraph', 'bullet_list', 'ordered_list', 'task_list'];
const ALLOWED_CHILDREN = {
  doc: BLOCKS,
  bullet_list: ['list_item'],
  ordered_list: ['list_item'],
  task_list: ['task_item'],
  list_item: IN_ITEM,
  task_item: IN_ITEM,
  paragraph: ['text', 'hard_break'],
  heading: ['text', 'hard_break'],
};
const NEEDS_CONTENT = new Set(['bullet_list', 'ordered_list', 'task_list', 'list_item', 'task_item']);
const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline']);
const NODE_KEYS = new Set(['type', 'content', 'text', 'marks', 'attrs']);
const BLOCK_ID = /^[A-Za-z0-9_-]{1,32}$/;
// eslint-disable-next-line no-control-regex
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)[^\s\u0000-\u001f\u007f]+$/i;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const chars = (s) => [...s].length;

export const isValidBlockId = (id) => typeof id === 'string' && BLOCK_ID.test(id);

export const isSafeHref = (href) => typeof href === 'string' && chars(href) <= NOTE_LIMITS.href && SAFE_HREF.test(href);

// Returns an error message, or null when the node is fine. `where` is a short path used in the message.
function checkNode(n, parent, depth, where) {
  if (depth > NOTE_LIMITS.depth) return `${where}: nested too deeply`;
  if (!isObject(n) || typeof n.type !== 'string') return `${where}: not a valid node`;
  for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) return `${where}: unexpected "${k}"`;
  const t = n.type;
  if (!(ALLOWED_CHILDREN[parent] ?? []).includes(t)) return `${where}: a ${t} is not allowed inside ${parent}`;

  if (t === 'text') {
    if (n.content !== undefined || n.attrs !== undefined) return `${where}: text cannot have content or attributes`;
    if (typeof n.text !== 'string' || chars(n.text) < 1 || chars(n.text) > NOTE_LIMITS.text)
      return `${where}: text must be 1 to ${NOTE_LIMITS.text} characters`;
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks) || n.marks.length > NOTE_LIMITS.marks) return `${where}: too many marks`;
      for (const m of n.marks) {
        if (!isObject(m) || typeof m.type !== 'string') return `${where}: not a valid mark`;
        for (const k of Object.keys(m)) if (k !== 'type' && k !== 'attrs') return `${where}: unexpected "${k}" in a mark`;
        if (SIMPLE_MARKS.has(m.type)) {
          if (m.attrs !== undefined) return `${where}: ${m.type} takes no attributes`;
        } else if (m.type === 'link') {
          if (!isObject(m.attrs) || Object.keys(m.attrs).length !== 1 || !isSafeHref(m.attrs.href))
            return `${where}: links must start with http://, https://, mailto: or tel:`;
        } else return `${where}: unknown mark "${m.type}"`;
      }
    }
    return null;
  }
  if (t === 'hard_break') {
    return n.content === undefined && n.text === undefined && n.marks === undefined && n.attrs === undefined
      ? null
      : `${where}: a line break takes nothing`;
  }

  if (n.text !== undefined || n.marks !== undefined) return `${where}: only text carries text or marks`;
  const a = n.attrs;
  if (parent === 'doc' && a === undefined) return `${where}: every top-level block needs an id`;
  if (a !== undefined) {
    if (!isObject(a)) return `${where}: attributes must be an object`;
    for (const k of Object.keys(a)) {
      if (!(k === 'id' || (k === 'level' && t === 'heading') || (k === 'checked' && t === 'task_item')))
        return `${where}: unexpected attribute "${k}"`;
    }
    if (a.id !== undefined && (typeof a.id !== 'string' || !BLOCK_ID.test(a.id))) return `${where}: bad block id`;
    if (parent === 'doc' && a.id === undefined) return `${where}: every top-level block needs an id`;
    if (a.checked !== undefined && typeof a.checked !== 'boolean') return `${where}: checked must be true or false`;
  }
  if (t === 'heading' && (a === undefined || !(a.level === 1 || a.level === 2 || a.level === 3)))
    return `${where}: heading level must be 1, 2 or 3`;

  let count = 0;
  if (n.content !== undefined) {
    if (!Array.isArray(n.content)) return `${where}: content must be a list`;
    count = n.content.length;
  }
  if (NEEDS_CONTENT.has(t) && count < 1) return `${where}: a ${t} cannot be empty`;
  for (let i = 0; i < count; i += 1) {
    const e = checkNode(n.content[i], t, depth + 1, `${where}.${t}[${i}]`);
    if (e) return e;
  }
  return null;
}

// validateNote(note) -> { valid, errors } where errors has at most one message (the first problem found).
export function validateNote(note) {
  const fail = (m) => ({ valid: false, errors: [m] });
  if (!isObject(note) || note.v !== NOTE_VERSION) return fail('Unknown note format.');
  for (const k of Object.keys(note)) if (k !== 'v' && k !== 'doc') return fail(`Unexpected "${k}" in the note.`);
  const d = note.doc;
  if (!isObject(d) || d.type !== 'doc' || !Array.isArray(d.content)) return fail('The note has no document.');
  for (const k of Object.keys(d)) if (k !== 'type' && k !== 'content') return fail(`Unexpected "${k}" in the document.`);
  if (d.content.length < 1 || d.content.length > NOTE_LIMITS.blocks)
    return fail(`A note needs between 1 and ${NOTE_LIMITS.blocks} blocks.`);
  for (let i = 0; i < d.content.length; i += 1) {
    const e = checkNode(d.content[i], 'doc', 1, `block ${i + 1}`);
    if (e) return fail(e);
  }
  if (new TextEncoder().encode(JSON.stringify(note)).length > NOTE_LIMITS.bytes) return fail('This note is too large to save.');
  return { valid: true, errors: [] };
}

// A short random id for a block. Letters and digits only, so it always passes the id rule.
export function newBlockId(random = globalThis.crypto) {
  const bytes = new Uint8Array(9);
  random.getRandomValues(bytes);
  return `b${[...bytes].map((b) => (b % 36).toString(36)).join('')}`;
}

export const emptyNote = (id = newBlockId()) => ({
  v: NOTE_VERSION,
  doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { id } }] },
});

function nodeText(n) {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hard_break') return '\n';
  let out = '';
  for (const c of n.content ?? []) {
    const piece = nodeText(c);
    if (out !== '' && c.type !== 'text' && c.type !== 'hard_break') out += '\n';
    out += piece;
  }
  return out;
}
// Same text the server keeps for search: blocks separated by line breaks, capped at 20,000 characters.
export const notePlainText = (note) => [...nodeText(note?.doc ?? { type: 'doc' })].slice(0, 20000).join('');

export function validateTitle(title) {
  if (typeof title !== 'string' || title.trim().length < 1) return 'Give the document a title.';
  if (chars(title.trim()) > NOTE_LIMITS.title) return `Keep the title under ${NOTE_LIMITS.title} characters.`;
  return null;
}

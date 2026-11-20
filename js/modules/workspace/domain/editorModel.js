// How the rich-text editor sees a note. Plain data and pure functions, so it can be tested without a browser.
//  * SCHEMA_SPEC describes the nodes and marks to the editor library (ProseMirror). It allows exactly what the note format
//    allows (domain/validation.js, and public.workspace_note_valid in the database) and nothing more, so the editor cannot
//    produce a note the database would refuse, and pasted content that is not on the list is dropped.
//  * docToNote turns the editor's JSON into a note: it removes empty attributes and gives every top-level block a unique id.
import { isSafeHref, isValidBlockId, newBlockId, NOTE_VERSION } from './validation.js';

const id = { default: null };
const LIST_ITEM_CONTENT = 'paragraph (paragraph | bullet_list | ordered_list | task_list)*';

export const SCHEMA_SPEC = {
  nodes: {
    doc: { content: 'block+' },
    paragraph: { attrs: { id }, content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    heading: {
      attrs: { id, level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 3 } },
        { tag: 'h5', attrs: { level: 3 } },
        { tag: 'h6', attrs: { level: 3 } },
      ],
      toDOM: (n) => [`h${n.attrs.level}`, 0],
    },
    task_list: {
      attrs: { id },
      content: 'task_item+',
      group: 'block',
      parseDOM: [{ tag: 'ul[data-type="task_list"]', priority: 60 }],
      toDOM: () => ['ul', { 'data-type': 'task_list', class: 'ws-tasks' }, 0],
    },
    bullet_list: { attrs: { id }, content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: { attrs: { id }, content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
    list_item: { content: LIST_ITEM_CONTENT, defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    task_item: {
      attrs: { checked: { default: false } },
      content: LIST_ITEM_CONTENT,
      defining: true,
      parseDOM: [
        { tag: 'li[data-type="task_item"]', priority: 60, getAttrs: (dom) => ({ checked: dom.getAttribute('data-checked') === 'true' }) },
      ],
      toDOM: (n) => ['li', { 'data-type': 'task_item', 'data-checked': String(!!n.attrs.checked) }, 0],
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  },
  marks: {
    bold: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2})$/.test(v) && null }],
      toDOM: () => ['strong', 0],
    },
    italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      // A pasted link that is not http, https, mailto or tel is not kept as a link (its text stays).
      parseDOM: [
        { tag: 'a[href]', getAttrs: (dom) => (isSafeHref(dom.getAttribute('href')) ? { href: dom.getAttribute('href') } : false) },
      ],
      toDOM: (m) => ['a', { href: m.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0],
    },
  },
};

function cleanMark(m) {
  return m.type === 'link' ? { type: 'link', attrs: { href: m.attrs?.href } } : { type: m.type };
}

function cleanNode(n, top, seen, makeId) {
  const out = { type: n.type };
  if (n.type === 'text') {
    out.text = n.text;
    if (n.marks?.length) out.marks = n.marks.map(cleanMark);
    return out;
  }
  if (n.type === 'hard_break') return out;
  const attrs = {};
  if (top) {
    let blockId = n.attrs?.id;
    // The editor copies attributes when a block splits, so ids can repeat: keep the first, make fresh ids for the others.
    if (!isValidBlockId(blockId) || seen.has(blockId)) blockId = makeId();
    seen.add(blockId);
    attrs.id = blockId;
  }
  if (n.type === 'heading') attrs.level = n.attrs?.level ?? 1;
  if (n.type === 'task_item') attrs.checked = !!n.attrs?.checked;
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (n.content?.length) out.content = n.content.map((c) => cleanNode(c, false, seen, makeId));
  return out;
}

// The editor's document JSON -> a note ready to validate and save.
export function docToNote(docJson, makeId = newBlockId) {
  const seen = new Set();
  return {
    v: NOTE_VERSION,
    doc: { type: 'doc', content: (docJson?.content ?? []).map((n) => cleanNode(n, true, seen, makeId)) },
  };
}

// A note -> the JSON the editor loads. (The note format is the editor's own JSON format, so this is the document itself.)
export const noteToDocJson = (note) => note.doc;

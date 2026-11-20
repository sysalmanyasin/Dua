// The rich-text editor: a thin layer over the vendored ProseMirror bundle. It loads only when a note is opened.
// The schema (domain/editorModel.js) allows exactly the note format, so the editor cannot make an invalid note.
import { docToNote, noteToDocJson, SCHEMA_SPEC } from '../domain/editorModel.js';
import { isSafeHref } from '../domain/validation.js';

let library = null;
export const loadEditorLibrary = () => (library ??= import('../../../../vendor/workspace/prosemirror-bundle-1.0.0.mjs'));

// What the toolbar can ask for.
export const COMMANDS = Object.freeze([
  'paragraph',
  'h1',
  'h2',
  'h3',
  'bold',
  'italic',
  'underline',
  'bullet_list',
  'ordered_list',
  'task_list',
  'undo',
  'redo',
]);

function taskItemView() {
  return (node, view, getPos) => {
    const dom = document.createElement('li');
    dom.className = 'ws-task';
    dom.dataset.checked = String(!!node.attrs.checked);
    const holder = document.createElement('span');
    holder.className = 'ws-task-box';
    holder.contentEditable = 'false';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!node.attrs.checked;
    box.setAttribute('aria-label', 'Done');
    holder.append(box);
    const contentDOM = document.createElement('div');
    contentDOM.className = 'ws-task-body';
    dom.append(holder, contentDOM);
    let current = node;
    box.addEventListener('change', () => {
      if (!view.editable) {
        box.checked = !!current.attrs.checked;
        return;
      }
      view.dispatch(view.state.tr.setNodeMarkup(getPos(), undefined, { ...current.attrs, checked: box.checked }));
    });
    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== current.type) return false;
        current = next;
        box.checked = !!next.attrs.checked;
        dom.dataset.checked = String(!!next.attrs.checked);
        return true;
      },
      stopEvent: (event) => event.target === box,
      ignoreMutation: (m) => !contentDOM.contains(m.target),
    };
  };
}

// The link around the cursor or selection: { href, from, to } or null.
function linkAt(state, schema) {
  const { $from, from, to, empty } = state.selection;
  const type = schema.marks.link;
  if (!empty) {
    if (!state.doc.rangeHasMark(from, to, type)) return null;
    let found = null;
    state.doc.nodesBetween(from, to, (node) => {
      const m = node.marks.find((x) => x.type === type);
      if (m && !found) found = m;
    });
    return found ? { href: found.attrs.href, from, to } : null;
  }
  const mark = $from.marks().find((x) => x.type === type) || ($from.nodeAfter?.marks ?? []).find((x) => x.type === type);
  if (!mark) return null;
  const base = $from.start();
  let range = null;
  $from.parent.forEach((child, offset) => {
    const start = base + offset;
    if (child.marks.some((x) => x.eq(mark)) && start <= from && from <= start + child.nodeSize)
      range = { from: start, to: start + child.nodeSize };
  });
  return range ? { href: mark.attrs.href, ...range } : null;
}

// createEditor({ host, note, editable, onChange, onState }) -> editor
//  host: element to put the editor in. note: a valid note. onChange(): the document changed. onState(): selection or
//  document changed (use to refresh the toolbar).
export async function createEditor({ host, note, editable = true, onChange = () => {}, onState = () => {} }) {
  const pm = await loadEditorLibrary();
  const schema = new pm.Schema(SCHEMA_SPEC);
  const { paragraph, heading, bullet_list, ordered_list, task_list, list_item, task_item, hard_break } = schema.nodes;
  let isEditable = editable;

  const toggleList = (listType) => (state, dispatch) => {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d -= 1) {
      if ($from.node(d).type === listType) {
        const item = $from.node(d + 1)?.type ?? list_item;
        return pm.liftListItem(item)(state, dispatch);
      }
    }
    return pm.wrapInList(listType)(state, dispatch);
  };
  // Changing a block's type must not change its id: ids are how two people's edits to different blocks are told apart.
  const keepIds = (cmd) => (state, dispatch) => {
    if (!dispatch) return cmd(state);
    let captured = null;
    if (!cmd(state, (tr) => (captured = tr))) return false;
    const ids = [];
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (node.isTextblock && node.attrs.id) ids.push([pos, node.attrs.id]);
    });
    for (const [pos, blockId] of ids) {
      const at = captured.mapping.map(pos);
      const node = captured.doc.nodeAt(at);
      if (node?.isTextblock && !node.attrs.id) captured.setNodeMarkup(at, undefined, { ...node.attrs, id: blockId });
    }
    dispatch(captured);
    return true;
  };
  const toggleBlock = (type, attrs) =>
    keepIds((state, dispatch) => {
      const { $from } = state.selection;
      const same = $from.parent.type === type && (!attrs || $from.parent.attrs.level === attrs.level);
      return same ? pm.setBlockType(paragraph)(state, dispatch) : pm.setBlockType(type, attrs)(state, dispatch);
    });
  const commands = {
    paragraph: keepIds(pm.setBlockType(paragraph)),
    h1: toggleBlock(heading, { level: 1 }),
    h2: toggleBlock(heading, { level: 2 }),
    h3: toggleBlock(heading, { level: 3 }),
    bold: pm.toggleMark(schema.marks.bold),
    italic: pm.toggleMark(schema.marks.italic),
    underline: pm.toggleMark(schema.marks.underline),
    bullet_list: toggleList(bullet_list),
    ordered_list: toggleList(ordered_list),
    task_list: toggleList(task_list),
    undo: pm.undo,
    redo: pm.redo,
  };

  const hardBreak = (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
    return true;
  };
  const splitItem = pm.chainCommands(pm.splitListItem(task_item), pm.splitListItem(list_item));
  const plugins = [
    pm.inputRules({
      rules: [
        pm.textblockTypeInputRule(/^(#{1,3})\s$/, heading, (m) => ({ level: m[1].length })),
        pm.wrappingInputRule(/^\s*([-+*])\s$/, bullet_list),
        pm.wrappingInputRule(/^(\d+)\.\s$/, ordered_list),
        pm.wrappingInputRule(/^\s*\[\s?\]\s$/, task_list),
      ],
    }),
    pm.history(),
    pm.keymap({
      'Mod-z': pm.undo,
      'Mod-y': pm.redo,
      'Shift-Mod-z': pm.redo,
      'Mod-b': commands.bold,
      'Mod-i': commands.italic,
      'Mod-u': commands.underline,
      'Shift-Enter': hardBreak,
      Enter: splitItem,
      Tab: pm.chainCommands(pm.sinkListItem(task_item), pm.sinkListItem(list_item)),
      'Shift-Tab': pm.chainCommands(pm.liftListItem(task_item), pm.liftListItem(list_item)),
    }),
    pm.keymap(pm.baseKeymap),
  ];

  const makeState = (n) => pm.EditorState.create({ schema, doc: schema.nodeFromJSON(noteToDocJson(n)), plugins });
  const view = new pm.EditorView(host, {
    state: makeState(note),
    editable: () => isEditable,
    nodeViews: { task_item: taskItemView() },
    attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Note text', spellcheck: 'true' },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) onChange();
      onState();
    },
  });
  host.classList.toggle('ws-readonly', !isEditable);

  const run = (name) => {
    const cmd = commands[name];
    if (!cmd) return false;
    const ok = cmd(view.state, view.dispatch, view);
    if (isEditable) view.focus();
    return ok;
  };

  return {
    view,
    schema,
    getNote: () => docToNote(view.state.doc.toJSON()),
    setNote(next) {
      view.updateState(makeState(next));
      onState();
    },
    setEditable(value) {
      isEditable = !!value;
      view.setProps({ editable: () => isEditable });
      host.classList.toggle('ws-readonly', !isEditable);
    },
    focus: () => view.focus(),
    run,
    canRun: (name) => !!commands[name]?.(view.state),
    // What is true at the cursor, for the toolbar.
    format() {
      const { $from } = view.state.selection;
      const marks = view.state.storedMarks ?? $from.marks();
      const inList = (type) => {
        for (let d = $from.depth; d > 0; d -= 1) if ($from.node(d).type === type) return true;
        return false;
      };
      const link = linkAt(view.state, schema);
      return {
        block: $from.parent.type === heading ? `h${$from.parent.attrs.level}` : 'paragraph',
        bold: marks.some((m) => m.type === schema.marks.bold),
        italic: marks.some((m) => m.type === schema.marks.italic),
        underline: marks.some((m) => m.type === schema.marks.underline),
        bullet_list: inList(bullet_list),
        ordered_list: inList(ordered_list),
        task_list: inList(task_list),
        link: link?.href ?? null,
        hasSelection: !view.state.selection.empty,
        canUndo: pm.undo(view.state),
        canRedo: pm.redo(view.state),
      };
    },
    // Adds, changes or removes the link at the selection or cursor. href null removes it. False if the address is unsafe.
    setLink(href) {
      const type = schema.marks.link;
      const { from, to, empty } = view.state.selection;
      const existing = linkAt(view.state, schema);
      if (href === null || href === '') {
        if (existing) view.dispatch(view.state.tr.removeMark(existing.from, existing.to, type));
        return true;
      }
      if (!isSafeHref(href)) return false;
      let tr = view.state.tr;
      if (empty && !existing) {
        tr = tr.insertText(href, from, to).addMark(from, from + href.length, type.create({ href }));
      } else {
        const range = existing && empty ? existing : { from, to };
        tr = tr.removeMark(range.from, range.to, type).addMark(range.from, range.to, type.create({ href }));
      }
      view.dispatch(tr);
      return true;
    },
    destroy: () => view.destroy(),
  };
}

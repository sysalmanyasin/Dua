// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEditor } from '../../js/modules/workspace/ui/noteEditor.js';
import { emptyNote, validateNote } from '../../js/modules/workspace/domain/validation.js';

// jsdom has no layout; the editor only needs these to exist.
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  document.elementFromPoint = () => null;
  Element.prototype.scrollIntoView = () => {};
});

const mounts = [];
async function make(note = emptyNote('a'), opts = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const changes = vi.fn();
  const ed = await createEditor({ host, note, onChange: changes, ...opts });
  mounts.push([ed, host]);
  return { ed, host, changes };
}
afterEach(() => {
  while (mounts.length) {
    const [ed, host] = mounts.pop();
    ed.destroy();
    host.remove();
  }
});
const note = (...blocks) => ({ v: 1, doc: { type: 'doc', content: blocks } });
const p = (id, text) => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : undefined });
const select = (ed, from, to = from) =>
  ed.view.dispatch(ed.view.state.tr.setSelection(ed.view.state.selection.constructor.create(ed.view.state.doc, from, to)));

describe('note editor', () => {
  it('loads a note and gives it back unchanged and valid', async () => {
    const n = note({ type: 'heading', attrs: { id: 'h', level: 2 }, content: [{ type: 'text', text: 'Title' }] }, p('p', 'Hello'));
    const { ed } = await make(n);
    expect(ed.getNote()).toEqual(n);
    expect(validateNote(ed.getNote()).valid).toBe(true);
  });

  it('marks the page as an accessible text box', async () => {
    const { host } = await make();
    const box = host.querySelector('.ProseMirror');
    expect(box.getAttribute('role')).toBe('textbox');
    expect(box.getAttribute('aria-label')).toBe('Note text');
    expect(box.getAttribute('contenteditable')).toBe('true');
  });

  it('formats the selected text with bold, italic and underline, and the result is valid', async () => {
    const { ed, changes } = await make(note(p('a', 'Hello world')));
    select(ed, 1, 6);
    ed.run('bold');
    ed.run('italic');
    ed.run('underline');
    expect(changes).toHaveBeenCalled();
    const out = ed.getNote();
    expect(out.doc.content[0].content[0]).toEqual({
      type: 'text',
      text: 'Hello',
      marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }],
    });
    expect(validateNote(out).valid).toBe(true);
    expect(ed.format()).toMatchObject({ bold: true, italic: true, underline: true });
    ed.run('bold');
    expect(ed.format().bold).toBe(false);
  });

  it('switches a paragraph to headings and back, and a repeated heading command toggles it off', async () => {
    const { ed } = await make(note(p('a', 'Words')));
    select(ed, 2);
    ed.run('h2');
    expect(ed.getNote().doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(ed.format().block).toBe('h2');
    ed.run('h3');
    expect(ed.format().block).toBe('h3');
    ed.run('h3');
    expect(ed.format().block).toBe('paragraph');
    expect(validateNote(ed.getNote()).valid).toBe(true);
  });

  it("keeps a block's id when its type changes (ids tell two people's edits apart)", async () => {
    const { ed } = await make(note(p('keep1', 'first'), p('keep2', 'second')));
    select(ed, 2);
    ed.run('h1');
    expect(ed.getNote().doc.content.map((b) => [b.type, b.attrs.id])).toEqual([
      ['heading', 'keep1'],
      ['paragraph', 'keep2'],
    ]);
    ed.run('paragraph');
    expect(ed.getNote().doc.content[0]).toMatchObject({ type: 'paragraph', attrs: { id: 'keep1' } });
    select(ed, 1, ed.view.state.doc.content.size - 1);
    ed.run('h2');
    expect(ed.getNote().doc.content.map((b) => [b.type, b.attrs.id])).toEqual([
      ['heading', 'keep1'],
      ['heading', 'keep2'],
    ]);
  });

  it('makes and removes bullet, numbered and checklists', async () => {
    const { ed } = await make(note(p('a', 'item')));
    select(ed, 2);
    for (const [cmd, type] of [
      ['bullet_list', 'bullet_list'],
      ['ordered_list', 'ordered_list'],
      ['task_list', 'task_list'],
    ]) {
      ed.run(cmd);
      expect(ed.getNote().doc.content[0].type, cmd).toBe(type);
      expect(validateNote(ed.getNote()).valid, cmd).toBe(true);
      expect(ed.format()[cmd]).toBe(true);
      ed.run(cmd);
      expect(ed.getNote().doc.content[0].type, `${cmd} off`).toBe('paragraph');
    }
  });

  it('checking a task updates the note', async () => {
    const n = note({
      type: 'task_list',
      attrs: { id: 't' },
      content: [{ type: 'task_item', attrs: { checked: false }, content: [p(undefined, 'buy stamps')] }],
    });
    n.doc.content[0].content[0].content[0] = { type: 'paragraph', content: [{ type: 'text', text: 'buy stamps' }] };
    const { ed, host, changes } = await make(n);
    const box = host.querySelector('.ws-task-box input');
    expect(box).not.toBeNull();
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(changes).toHaveBeenCalled();
    expect(ed.getNote().doc.content[0].content[0].attrs.checked).toBe(true);
    expect(host.querySelector('.ws-task').dataset.checked).toBe('true');
  });

  it('a read-only editor refuses to change a task', async () => {
    const n = note({
      type: 'task_list',
      attrs: { id: 't' },
      content: [{ type: 'task_item', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
    });
    const { ed, host } = await make(n, { editable: false });
    expect(host.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('false');
    const box = host.querySelector('.ws-task-box input');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ed.getNote().doc.content[0].content[0].attrs.checked).toBe(false);
    expect(box.checked).toBe(false);
  });

  it('can switch between read-only and editable', async () => {
    const { ed, host } = await make();
    ed.setEditable(false);
    expect(host.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('false');
    expect(host.classList.contains('ws-readonly')).toBe(true);
    ed.setEditable(true);
    expect(host.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('true');
  });

  it('adds, reads, changes and removes a link, and refuses unsafe ones', async () => {
    const { ed } = await make(note(p('a', 'see docs now')));
    select(ed, 5, 9);
    expect(ed.setLink('javascript:alert(1)')).toBe(false);
    expect(ed.setLink('https://example.com/docs')).toBe(true);
    expect(ed.getNote().doc.content[0].content[1].marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com/docs' } }]);
    expect(ed.format().link).toBe('https://example.com/docs');
    select(ed, 7);
    expect(ed.format().link).toBe('https://example.com/docs');
    expect(ed.setLink('mailto:someone@example.com')).toBe(true);
    expect(JSON.stringify(ed.getNote())).toContain('mailto:someone@example.com');
    expect(JSON.stringify(ed.getNote())).not.toContain('example.com/docs');
    expect(ed.setLink(null)).toBe(true);
    expect(JSON.stringify(ed.getNote())).not.toContain('link');
    expect(validateNote(ed.getNote()).valid).toBe(true);
  });

  it('a link added with nothing selected inserts the address as text', async () => {
    const { ed } = await make(note(p('a', 'x')));
    select(ed, 2);
    expect(ed.setLink('https://example.com')).toBe(true);
    const out = ed.getNote();
    expect(JSON.stringify(out)).toContain('https://example.com');
    expect(validateNote(out).valid).toBe(true);
  });

  it('undo and redo work and report availability', async () => {
    const { ed } = await make(note(p('a', 'abc')));
    expect(ed.format().canUndo).toBe(false);
    select(ed, 1, 4);
    ed.run('bold');
    expect(ed.format().canUndo).toBe(true);
    ed.run('undo');
    expect(JSON.stringify(ed.getNote())).not.toContain('bold');
    expect(ed.format().canRedo).toBe(true);
    ed.run('redo');
    expect(JSON.stringify(ed.getNote())).toContain('bold');
  });

  it('setNote replaces the content and clears undo history', async () => {
    const { ed } = await make(note(p('a', 'old')));
    select(ed, 1, 4);
    ed.run('bold');
    ed.setNote(note(p('z', 'brand new')));
    expect(ed.getNote().doc.content[0].content[0].text).toBe('brand new');
    expect(ed.format().canUndo).toBe(false);
  });

  it('every block keeps a unique id even when a block is split', async () => {
    const { ed } = await make(note(p('a', 'onetwo')));
    select(ed, 4);
    ed.view.dispatch(ed.view.state.tr.split(4));
    const ids = ed.getNote().doc.content.map((b) => b.attrs.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
    expect(validateNote(ed.getNote()).valid).toBe(true);
  });

  it('ignores commands it does not know', async () => {
    const { ed } = await make();
    expect(ed.run('launch')).toBe(false);
    expect(ed.canRun('launch')).toBe(false);
  });

  it('never leaves the document without a block', async () => {
    const { ed } = await make(note(p('a', 'x')));
    select(ed, 1, 2);
    ed.view.dispatch(ed.view.state.tr.deleteSelection());
    expect(ed.getNote().doc.content.length).toBeGreaterThanOrEqual(1);
    expect(validateNote(ed.getNote()).valid).toBe(true);
  });
});

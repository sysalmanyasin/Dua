// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  listFolders: vi.fn(),
  listUserState: vi.fn(),
  saveFolder: vi.fn(),
  setDocumentFlags: vi.fn(),
  setDocumentState: vi.fn(),
  renameDocument: vi.fn(),
  setHistoryVisible: vi.fn(),
  openNote: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  resolveConflict: vi.fn(),
  restoreNote: vi.fn(),
  listHistory: vi.fn(),
  getRevision: vi.fn(),
  listMembers: vi.fn(),
  shareCandidates: vi.fn(),
  setMember: vi.fn(),
  removeMember: vi.fn(),
  transferOwnership: vi.fn(),
}));
vi.mock('../../js/modules/workspace/data/documents.js', () => ({
  listDocuments: m.listDocuments,
  createDocument: m.createDocument,
  listFolders: m.listFolders,
  listUserState: m.listUserState,
  saveFolder: m.saveFolder,
  setDocumentFlags: m.setDocumentFlags,
  setDocumentState: m.setDocumentState,
  renameDocument: m.renameDocument,
  setHistoryVisible: m.setHistoryVisible,
}));
vi.mock('../../js/modules/workspace/data/notes.js', () => ({
  openNote: m.openNote,
  saveNote: m.saveNote,
  searchNotes: m.searchNotes,
  resolveConflict: m.resolveConflict,
  restoreNote: m.restoreNote,
}));
vi.mock('../../js/modules/workspace/data/revisions.js', () => ({ listHistory: m.listHistory, getRevision: m.getRevision }));
vi.mock('../../js/modules/workspace/data/sharing.js', () => ({
  listMembers: m.listMembers,
  shareCandidates: m.shareCandidates,
  setMember: m.setMember,
  removeMember: m.removeMember,
  transferOwnership: m.transferOwnership,
}));

import { mount as mountHome } from '../../js/modules/workspace/ui/home.js';
import { mount as mountNote } from '../../js/modules/workspace/ui/note.js';
import { draftKey, OPEN_KEY } from '../../js/modules/workspace/domain/documents.js';

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} };
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  document.elementFromPoint = () => null;
  Element.prototype.scrollIntoView = () => {};
});

const NOW = new Date().toISOString();
const doc = (over = {}) => ({
  id: 'd1',
  kind: 'note',
  title: 'Pharmacy rota',
  my_role: 'owner',
  owner_name: 'Alice Author',
  updated_at: NOW,
  archived_at: null,
  deleted_at: null,
  head_version: 2,
  member_count: 0,
  ...over,
});
const para = (id, text) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const content = (...b) => ({ v: 1, doc: { type: 'doc', content: b } });
const opened = (over = {}) => ({
  id: 'd1',
  title: 'Pharmacy rota',
  role: 'owner',
  archived: false,
  head_version: 2,
  content: content(para('a', 'Hello')),
  sealed: false,
  history_visible_to_viewers: true,
  ...over,
});
const settle = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const click = (root, sel) => {
  const el = typeof sel === 'string' ? root.querySelector(sel) : sel;
  expect(el, String(sel)).not.toBeNull();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const buttonByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
// The newest dialog on screen (a confirmation opens on top of the panel that asked for it).
const topPanel = () => [...document.body.querySelectorAll('.ws-panel')].at(-1);

let el;
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.listDocuments.mockResolvedValue([]);
  m.listFolders.mockResolvedValue([]);
  m.listUserState.mockResolvedValue([]);
  m.searchNotes.mockResolvedValue([]);
  sessionStorage.clear();
  location.hash = '#/workspace';
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('Workspace home', () => {
  it('lists documents with owner, role and recency, and opens one', async () => {
    m.listDocuments.mockResolvedValue([doc(), doc({ id: 'd2', title: 'Shop ideas', my_role: 'viewer', owner_name: 'Bob Editor' })]);
    await mountHome(el, { ctx: { permissions: ['workspace.use', 'workspace.create'] } });
    expect(el.textContent).toContain('Pharmacy rota');
    expect(el.textContent).toContain('Shop ideas');
    expect(el.textContent).toContain('Bob Editor');
    expect(el.textContent).toContain('Can view');
    expect(el.textContent).toContain('just now');
    click(el, '[data-open="d2"]');
    expect(sessionStorage.getItem(OPEN_KEY)).toBe('d2');
    expect(location.hash).toBe('#/workspace/note');
  });

  it('asks for the first page of "all" documents', async () => {
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    expect(m.listDocuments).toHaveBeenCalledWith({ scope: 'all', query: null, after: null, limit: 50 });
    expect(el.textContent).toContain('No documents here yet.');
  });

  it('only people with workspace.create can start a note, and others are told why', async () => {
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    expect(el.querySelector('[data-act="new-note"]').disabled).toBe(true);
    expect(el.textContent).toContain('Ask the owner');
  });

  it('creates a note with a fresh id and key, then opens it', async () => {
    m.createDocument.mockResolvedValue({ id: 'new1', kind: 'note', title: 'Untitled note', head_version: 0 });
    await mountHome(el, { ctx: { permissions: ['workspace.use', 'workspace.create'] } });
    click(el, '[data-act="new-note"]');
    await settle();
    const args = m.createDocument.mock.calls[0][0];
    expect(args.kind).toBe('note');
    expect(args.title).toBe('Untitled note');
    expect(args.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessionStorage.getItem(OPEN_KEY)).toBe('new1');
    expect(location.hash).toBe('#/workspace/note');
  });

  it('shows a plain message when creating fails and lets the person try again', async () => {
    m.createDocument.mockRejectedValue(new Error('You do not have access to this.'));
    await mountHome(el, { ctx: { permissions: ['workspace.use', 'workspace.create'] } });
    click(el, '[data-act="new-note"]');
    await settle();
    expect(el.querySelector('.note-error').textContent).toContain('You do not have access');
    expect(el.querySelector('[data-act="new-note"]').disabled).toBe(false);
  });

  it('switches between Mine, Shared, Archived and Trash', async () => {
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    click(el, '[data-scope="shared"]');
    await settle();
    expect(m.listDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'shared' }));
    click(el, '[data-scope="trash"]');
    await settle();
    expect(m.listDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'trash' }));
    expect(el.textContent).toContain('The trash is empty.');
    expect(el.querySelector('[data-scope="trash"]').getAttribute('aria-selected')).toBe('true');
  });

  it('searches titles and note text, and shows text-only matches separately', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    m.listDocuments.mockResolvedValue([doc()]);
    m.searchNotes.mockResolvedValue([
      { document_id: 'd1', title: 'Pharmacy rota', my_role: 'owner', excerpt: 'dup', updated_at: NOW },
      { document_id: 'd9', title: 'Stock ideas', my_role: 'viewer', excerpt: 'order zebra stickers', updated_at: NOW },
    ]);
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    const q = el.querySelector('#ws-q');
    q.value = '  zebra ';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(m.searchNotes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(m.listDocuments).toHaveBeenLastCalledWith({ scope: 'all', query: 'zebra', after: null, limit: 50 });
    expect(m.searchNotes).toHaveBeenCalledWith('zebra');
    expect(el.textContent).toContain('Also found in note text');
    expect(el.textContent).toContain('order zebra stickers');
    expect(el.querySelectorAll('[data-open="d1"]').length).toBe(1);
  });

  it('does not search note text for one character', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    const q = el.querySelector('#ws-q');
    q.value = 'z';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);
    expect(m.searchNotes).not.toHaveBeenCalled();
  });

  it('files a document in a personal folder without losing its other flags', async () => {
    m.listDocuments.mockResolvedValue([doc()]);
    m.listFolders.mockResolvedValue([{ id: 'f1', parent_id: null, name: 'Rotas' }]);
    m.listUserState.mockResolvedValue([{ document_id: 'd1', folder_id: null, pinned: true, offline_pinned: true }]);
    m.setDocumentFlags.mockResolvedValue({});
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    const sel = el.querySelector('select[data-move="d1"]');
    sel.value = 'f1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.setDocumentFlags).toHaveBeenCalledWith('d1', { folderId: 'f1', pinned: true, offline: true });
    click(el, '[data-folder="none"]');
    expect(el.querySelector('[data-open="d1"]')).toBeNull();
    click(el, '[data-folder="f1"]');
    expect(el.querySelector('[data-open="d1"]')).not.toBeNull();
  });

  it('creates a folder after asking for a name', async () => {
    m.saveFolder.mockResolvedValue({ id: 'f2', name: 'Orders' });
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    click(el, '[data-act="new-folder"]');
    const input = document.body.querySelector('.ws-panel input');
    input.value = 'Orders';
    click(topPanel(), buttonByText(topPanel(), 'Create'));
    await settle();
    expect(m.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ name: 'Orders' }));
    expect(m.listFolders).toHaveBeenCalledTimes(2);
  });

  it('shows a list error without breaking the page', async () => {
    m.listDocuments.mockRejectedValue(new Error('Something went wrong. Please try again.'));
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    expect(el.querySelector('.note-error').textContent).toContain('Something went wrong');
    expect(el.querySelector('[data-act="new-folder"]')).not.toBeNull();
  });

  it('shows no unescaped text from document titles', async () => {
    m.listDocuments.mockResolvedValue([doc({ title: '<img src=x onerror=alert(1)>' })]);
    await mountHome(el, { ctx: { permissions: ['workspace.use'] } });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('Workspace note page', () => {
  const open = async (data = opened()) => {
    sessionStorage.setItem(OPEN_KEY, 'd1');
    m.openNote.mockResolvedValue(data);
    await mountNote(el);
    await settle();
  };

  it('explains when no note is chosen, and when a note cannot be opened', async () => {
    await mountNote(el);
    expect(el.textContent).toContain('No note is open');
    sessionStorage.setItem(OPEN_KEY, 'd1');
    m.openNote.mockRejectedValue(new Error('You do not have access to this.'));
    await mountNote(el);
    expect(el.textContent).toContain('could not be opened');
    expect(el.textContent).toContain('You do not have access');
  });

  it('opens a note for its owner with the editor, toolbar, title and actions', async () => {
    await open();
    expect(el.querySelector('.ProseMirror').textContent).toBe('Hello');
    expect(el.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('true');
    expect(el.querySelector('#ws-title').value).toBe('Pharmacy rota');
    expect(el.querySelector('#ws-toolbar').hidden).toBe(false);
    expect(el.querySelectorAll('#ws-toolbar [data-cmd]').length).toBe(12);
    for (const a of ['share', 'history', 'save-version', 'archive', 'delete'])
      expect(el.querySelector(`[data-act="${a}"]`), a).not.toBeNull();
    expect(el.querySelector('#ws-status').textContent).toBe('Saved');
    expect(document.title).toContain('Pharmacy rota');
  });

  it('a viewer gets a read-only page: no toolbar, no title box, no owner actions', async () => {
    await open(opened({ role: 'viewer' }));
    expect(el.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('false');
    expect(el.querySelector('#ws-toolbar').hidden).toBe(true);
    expect(el.querySelector('#ws-title')).toBeNull();
    for (const a of ['save-version', 'archive', 'delete']) expect(el.querySelector(`[data-act="${a}"]`), a).toBeNull();
    expect(el.textContent).toContain('You can read this note');
    expect(el.querySelector('[data-act="share"]').textContent).toBe('Who has access');
    expect(el.querySelector('#ws-status').textContent).toContain('read only');
  });

  it('an editor can edit but not rename, archive or delete', async () => {
    await open(opened({ role: 'editor' }));
    expect(el.querySelector('#ws-toolbar').hidden).toBe(false);
    expect(el.querySelector('#ws-title')).toBeNull();
    expect(el.querySelector('[data-act="archive"]')).toBeNull();
    expect(el.querySelector('[data-act="save-version"]')).not.toBeNull();
  });

  it('an archived note is read-only for its owner too, and offers to unarchive', async () => {
    await open(opened({ archived: true }));
    expect(el.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('false');
    expect(el.querySelector('#ws-toolbar').hidden).toBe(true);
    expect(el.textContent).toContain('archived');
    expect(el.querySelector('[data-act="unarchive"]')).not.toBeNull();
  });

  it('autosaves an edit from the version the note was opened at, then shows Saved', async () => {
    await open();
    m.saveNote.mockResolvedValue({ status: 'saved', version: 3, head_version: 3 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(el, '[data-cmd="h1"]');
    expect(el.querySelector('#ws-status').textContent).toBe('Unsaved changes…');
    expect(m.saveNote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(m.saveNote).toHaveBeenCalledTimes(1);
    const call = m.saveNote.mock.calls[0][0];
    expect(call).toMatchObject({ docId: 'd1', baseVersion: 2 });
    expect(call.content.doc.content[0]).toMatchObject({ type: 'heading', attrs: { id: 'a', level: 1 } });
    expect(call.opId).toMatch(/^[0-9a-f-]{36}$/);
    expect(el.querySelector('#ws-status').textContent).toBe('Saved');
    // the next save starts from the version the server just returned
    click(el, '[data-cmd="h2"]');
    await vi.advanceTimersByTimeAsync(1600);
    expect(m.saveNote.mock.calls[1][0].baseVersion).toBe(3);
  });

  it('keeps unsaved text for this browser tab while saving fails, and says it is offline', async () => {
    await open();
    m.saveNote.mockRejectedValue(Object.assign(new Error('offline'), { code: 'offline' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(el, '[data-cmd="h1"]');
    await vi.advanceTimersByTimeAsync(1600);
    expect(el.querySelector('#ws-status').textContent).toContain('Offline');
    const draft = JSON.parse(sessionStorage.getItem(draftKey('d1')));
    expect(draft.baseVersion).toBe(2);
    expect(draft.content.doc.content[0].type).toBe('heading');
  });

  it('offers to put back unsaved text found on this device', async () => {
    sessionStorage.setItem(
      draftKey('d1'),
      JSON.stringify({ content: content(para('a', 'Typed before the tab closed')), baseVersion: 2, at: Date.now() }),
    );
    await open();
    expect(el.textContent).toContain('Unsaved changes from earlier were found');
    click(el, '[data-act="draft-restore"]');
    expect(el.querySelector('.ProseMirror').textContent).toBe('Typed before the tab closed');
    expect(el.textContent).not.toContain('Unsaved changes from earlier were found');
  });

  it('can discard an old draft', async () => {
    sessionStorage.setItem(draftKey('d1'), JSON.stringify({ content: content(para('a', 'Old')), baseVersion: 2, at: 1 }));
    await open();
    click(el, '[data-act="draft-discard"]');
    expect(sessionStorage.getItem(draftKey('d1'))).toBeNull();
    expect(el.querySelector('.ProseMirror').textContent).toBe('Hello');
  });

  it('ignores a draft that is invalid or identical to what is on screen', async () => {
    sessionStorage.setItem(draftKey('d1'), JSON.stringify({ content: { v: 9 }, baseVersion: 2 }));
    await open();
    expect(el.textContent).not.toContain('Unsaved changes from earlier');
  });

  describe('a conflict', () => {
    const conflict = async () => {
      await open();
      m.saveNote.mockResolvedValueOnce({ status: 'conflict', conflict_id: 'c1', head_version: 5, base_version: 2 });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      click(el, '[data-cmd="h1"]');
      await vi.advanceTimersByTimeAsync(1600);
      vi.useRealTimers();
    };

    it('stops autosave and shows three clear choices', async () => {
      await conflict();
      expect(el.querySelector('.ws-conflict')).not.toBeNull();
      for (const a of ['keep-mine', 'use-latest', 'copy-mine']) expect(el.querySelector(`[data-act="${a}"]`), a).not.toBeNull();
      expect(el.querySelector('#ws-status').textContent).toBe('Needs your attention');
      expect(el.textContent).toContain('Your text is safe');
    });

    it('"Keep my version on top" saves from the newer version and resolves the conflict', async () => {
      await conflict();
      m.saveNote.mockResolvedValueOnce({ status: 'saved', version: 6, head_version: 6 });
      click(el, '[data-act="keep-mine"]');
      await settle();
      const call = m.saveNote.mock.calls.at(-1)[0];
      expect(call).toMatchObject({ docId: 'd1', baseVersion: 5, resolves: 'c1', resolution: 'kept_local' });
      expect(call.content.doc.content[0].type).toBe('heading');
      expect(el.querySelector('.ws-conflict')).toBeNull();
      expect(el.textContent).toContain('saved on top');
    });

    it('"Use the latest version" asks first, then loads the newest text', async () => {
      await conflict();
      m.resolveConflict.mockResolvedValue({ status: 'kept_server' });
      m.openNote.mockResolvedValue(opened({ head_version: 5, content: content(para('a', 'Their newer text')) }));
      click(el, '[data-act="use-latest"]');
      expect(document.body.querySelector('.ws-panel').textContent).toContain('Copy your text first');
      click(topPanel(), buttonByText(topPanel(), 'Use latest'));
      await settle();
      expect(m.resolveConflict).toHaveBeenCalledWith('c1', 'kept_server', expect.any(String));
      expect(el.querySelector('.ProseMirror').textContent).toBe('Their newer text');
      expect(el.querySelector('.ws-conflict')).toBeNull();
      expect(el.querySelector('#ws-status').textContent).toBe('Saved');
    });

    it('cancelling "Use the latest version" changes nothing', async () => {
      await conflict();
      click(el, '[data-act="use-latest"]');
      click(topPanel(), buttonByText(topPanel(), 'Cancel'));
      await settle();
      expect(m.resolveConflict).not.toHaveBeenCalled();
      expect(el.querySelector('.ws-conflict')).not.toBeNull();
    });

    it('"Copy my text" puts the plain text on the clipboard', async () => {
      await conflict();
      const writeText = vi.fn().mockResolvedValue();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      click(el, '[data-act="copy-mine"]');
      await settle();
      expect(writeText).toHaveBeenCalledWith('Hello');
      expect(el.textContent).toContain('copied');
    });

    it('falls back to showing the text when the clipboard is unavailable', async () => {
      await conflict();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
        configurable: true,
      });
      click(el, '[data-act="copy-mine"]');
      await settle();
      expect(document.body.querySelector('.ws-panel textarea').value).toBe('Hello');
    });
  });

  it('renames a note (owner), refusing a blank title', async () => {
    await open();
    m.renameDocument.mockResolvedValue({ id: 'd1', title: 'Rota 2026' });
    const input = el.querySelector('#ws-title');
    input.value = '   ';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.renameDocument).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Give the document a title');
    expect(input.value).toBe('Pharmacy rota');
    input.value = '  Rota   2026 ';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(m.renameDocument).toHaveBeenCalledWith('d1', 'Rota 2026', expect.any(String));
    expect(document.title).toContain('Rota 2026');
  });

  it('archives after confirmation and becomes read-only; unarchive reverses it', async () => {
    await open();
    m.setDocumentState.mockResolvedValue({ archived: true });
    click(el, '[data-act="archive"]');
    click(topPanel(), buttonByText(topPanel(), 'Archive'));
    await settle();
    expect(m.setDocumentState).toHaveBeenCalledWith('d1', 'archive', expect.any(String));
    expect(el.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('false');
    expect(el.querySelector('[data-act="unarchive"]')).not.toBeNull();
    click(el, '[data-act="unarchive"]');
    await settle();
    expect(m.setDocumentState).toHaveBeenLastCalledWith('d1', 'unarchive', expect.any(String));
    expect(el.querySelector('.ProseMirror').getAttribute('contenteditable')).toBe('true');
  });

  it('deletes after confirmation and returns to the list', async () => {
    await open();
    m.setDocumentState.mockResolvedValue({ deleted: true });
    click(el, '[data-act="delete"]');
    expect(document.body.querySelector('.ws-panel').textContent).toContain('trash');
    click(topPanel(), buttonByText(topPanel(), 'Delete'));
    await settle();
    expect(m.setDocumentState).toHaveBeenCalledWith('d1', 'delete', expect.any(String));
    expect(sessionStorage.getItem(OPEN_KEY)).toBeNull();
    expect(location.hash).toBe('#/workspace');
  });

  it('"Save version" waits for the save, then seals it', async () => {
    await open();
    m.saveNote.mockResolvedValue({ status: 'saved', version: 2, head_version: 2 });
    click(el, '[data-act="save-version"]');
    await settle();
    expect(m.saveNote).toHaveBeenCalledWith(expect.objectContaining({ docId: 'd1', baseVersion: 2, seal: true }));
    expect(el.textContent).toContain('Version 2 saved');
  });

  it('opens the sharing panel with the people who have access', async () => {
    await open();
    m.listMembers.mockResolvedValue([
      { staff_id: 's1', full_name: 'Alice Author', role: 'owner' },
      { staff_id: 's2', full_name: 'Bob Editor', role: 'editor' },
    ]);
    m.shareCandidates.mockResolvedValue([{ staff_id: 's3', full_name: 'Carol Viewer' }]);
    click(el, '[data-act="share"]');
    await settle();
    const panel = document.body.querySelector('.ws-panel');
    expect(panel.textContent).toContain('Bob Editor');
    expect(panel.textContent).toContain('Carol Viewer');
    expect(panel.querySelector('[data-role-for="s2"]')).not.toBeNull();
    m.setMember.mockResolvedValue({});
    click(panel, '[data-add="s3"][data-as="viewer"]');
    await settle();
    expect(m.setMember).toHaveBeenCalledWith('d1', 's3', 'viewer', expect.any(String));
  });

  it('a non-owner sees the list but no controls to change it', async () => {
    await open(opened({ role: 'editor' }));
    m.listMembers.mockResolvedValue([{ staff_id: 's1', full_name: 'Alice Author', role: 'owner' }]);
    click(el, '[data-act="share"]');
    await settle();
    const panel = document.body.querySelector('.ws-panel');
    expect(panel.textContent).toContain('Only the owner can change who has access');
    expect(panel.querySelector('[data-add]')).toBeNull();
    expect(panel.querySelector('select')).toBeNull();
    expect(m.shareCandidates).not.toHaveBeenCalled();
  });

  it('opens history, previews a version, and restores it after confirmation', async () => {
    await open();
    m.listHistory.mockResolvedValue([
      {
        version: 2,
        kind: 'edit',
        restored_from: null,
        author: 'Alice Author',
        created_at: NOW,
        saved_at: NOW,
        sealed: false,
        chars: 5,
        is_head: true,
      },
      {
        version: 1,
        kind: 'create',
        restored_from: null,
        author: 'Alice Author',
        created_at: NOW,
        saved_at: NOW,
        sealed: true,
        chars: 3,
        is_head: false,
      },
    ]);
    m.getRevision.mockResolvedValue({
      version: 1,
      content: content(para('a', 'First draft')),
      kind: 'create',
      created_at: NOW,
      sealed: true,
    });
    m.restoreNote.mockResolvedValue({ status: 'restored', version: 3, restored_from: 1 });
    click(el, '[data-act="history"]');
    await settle();
    const panel = document.body.querySelector('.ws-panel');
    expect(panel.textContent).toContain('Version 2');
    click(panel, '[data-version="1"]');
    await settle(10);
    expect(panel.querySelector('#ws-preview .ProseMirror').textContent).toBe('First draft');
    expect(panel.querySelector('#ws-preview .ProseMirror').getAttribute('contenteditable')).toBe('false');
    m.openNote.mockResolvedValue(opened({ head_version: 3, content: content(para('a', 'First draft')) }));
    click(panel, '[data-restore]');
    click(topPanel(), buttonByText(topPanel(), 'Restore'));
    await settle(10);
    expect(m.restoreNote).toHaveBeenCalledWith('d1', 1, expect.any(String));
    expect(el.querySelector('.ProseMirror').textContent).toBe('First draft');
    expect(el.textContent).toContain('Restored');
  });

  it('a viewer cannot restore, and sees a message when history is not shared', async () => {
    await open(opened({ role: 'viewer', history_visible_to_viewers: false }));
    click(el, '[data-act="history"]');
    await settle();
    expect(document.body.querySelector('.ws-panel').textContent).toContain('has not shared earlier versions');
    expect(m.listHistory).not.toHaveBeenCalled();
  });

  it('removes its page listeners when you leave', async () => {
    await open();
    const spy = vi.spyOn(window, 'removeEventListener');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    expect(spy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('hashchange', expect.any(Function));
    spy.mockRestore();
  });

  it('warns before the tab closes while there are unsaved changes', async () => {
    await open();
    m.saveNote.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(el, '[data-cmd="h1"]');
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('dialogs', () => {
  it('Escape closes a dialog and hands focus back', async () => {
    const { openPanel } = await import('../../js/modules/workspace/ui/panel.js');
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const p = openPanel({ title: 'Test', onClose });
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(p.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes when the address changes', async () => {
    const { openPanel } = await import('../../js/modules/workspace/ui/panel.js');
    const p = openPanel({ title: 'Test' });
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(p.isOpen()).toBe(false);
  });
});

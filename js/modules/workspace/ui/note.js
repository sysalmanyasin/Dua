// One open note: title, formatting toolbar, the editor, autosave, sharing, history, archive and delete.
// Which note is open comes from session storage (the router carries no ids); home.js sets it.
import { html, render } from '../../../shared/html.js';
import { createAutosaver } from '../domain/autosave.js';
import { draftKey, newId, normalizeTitle, OPEN_KEY } from '../domain/documents.js';
import { can, roleLabel } from '../domain/permissions.js';
import { emptyNote, notePlainText, validateNote, validateTitle } from '../domain/validation.js';
import { renameDocument, setDocumentState } from '../data/documents.js';
import { openNote, resolveConflict, saveNote } from '../data/notes.js';
import { createEditor } from './noteEditor.js';
import { openHistory } from './history.js';
import { confirmAction, openPanel } from './panel.js';
import { openSharing } from './sharing.js';

const TOOLS = [
  ['h1', 'H1', 'Heading 1'],
  ['h2', 'H2', 'Heading 2'],
  ['h3', 'H3', 'Heading 3'],
  ['bold', 'B', 'Bold'],
  ['italic', 'I', 'Italic'],
  ['underline', 'U', 'Underline'],
  ['bullet_list', '• List', 'Bulleted list'],
  ['ordered_list', '1. List', 'Numbered list'],
  ['task_list', '☑ Tasks', 'Checklist'],
  ['link', 'Link', 'Add or change a link'],
  ['undo', 'Undo', 'Undo'],
  ['redo', 'Redo', 'Redo'],
];

const STATUS = {
  saved: ['Saved', ''],
  dirty: ['Unsaved changes…', ''],
  saving: ['Saving…', ''],
  offline: ['Offline. Will save when you reconnect.', 'warn'],
  error: ['Could not save. Trying again…', 'warn'],
  conflict: ['Needs your attention', 'warn'],
  invalid: ['Cannot save this note', 'warn'],
};

const readDraft = (id) => {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey(id)) ?? 'null');
  } catch {
    return null;
  }
};
const writeDraft = (id, value) => {
  try {
    if (value) sessionStorage.setItem(draftKey(id), JSON.stringify(value));
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    // Storage full or blocked: the draft is only a safety net.
  }
};

function message(el, title, text) {
  render(
    el,
    html`<div class="card">
      <h2>${title}</h2>
      <p class="muted">${text}</p>
      <a class="btn" href="#/workspace">Back to Workspace</a>
    </div>`,
  );
}

function showText(text) {
  const p = openPanel({ title: 'Your text' });
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'Select the text below and copy it.';
  const area = document.createElement('textarea');
  area.readOnly = true;
  area.rows = 10;
  area.className = 'ws-copy';
  area.value = text;
  p.body.append(note, area);
  area.focus();
  area.select();
}

export async function mount(el) {
  const id = sessionStorage.getItem(OPEN_KEY);
  if (!id) return message(el, 'No note is open', 'Choose a note from your Workspace.');
  render(el, html`<div class="card"><p class="muted">Opening note…</p></div>`);
  let data;
  try {
    data = await openNote(id);
  } catch (e) {
    return message(el, 'This note could not be opened', e.message);
  }

  const s = {
    role: data.role,
    archived: !!data.archived,
    title: data.title,
    historyVisible: data.history_visible_to_viewers !== false,
    baseVersion: data.head_version,
    conflict: null,
    notice: '',
    error: '',
    draft: null,
    linkOpen: false,
    linkError: '',
  };
  const isOwner = () => s.role === 'owner';
  const canEdit = () => can(s.role, 'edit', { archived: s.archived });

  render(
    el,
    html`<div class="ws-note">
      <div class="ws-note-head">
        <a class="btn btn-ghost btn-sm" href="#/workspace">‹ Workspace</a>
        <span id="ws-title-slot" class="ws-grow"></span>
        <span id="ws-status" class="pill ws-status" role="status" aria-live="polite"></span>
      </div>
      <div id="ws-actions" class="ws-toolbar-row"></div>
      <div id="ws-banner"></div>
      <div id="ws-toolbar" class="ws-toolbar" role="toolbar" aria-label="Formatting"></div>
      <div id="ws-linkbar" class="ws-linkbar" hidden></div>
      <div id="ws-editor" class="ws-editor"></div>
    </div>`,
  );
  const $ = (sel) => el.querySelector(sel);
  document.title = `${s.title} · Dua`;

  let editor = null;
  const autosaver = createAutosaver({
    makeId: newId,
    getContent: () => editor.getNote(),
    onStatus(status, extra) {
      drawStatus(status, extra);
      if (status === 'conflict') {
        s.conflict = { id: extra.conflict_id, head: extra.head_version };
        drawBanner();
      }
      // A safety net until offline editing exists: unsaved text is also kept for this browser tab.
      if (status === 'saved') writeDraft(id, null);
      else if (editor && (status === 'dirty' || status === 'offline' || status === 'error' || status === 'conflict')) {
        writeDraft(id, { content: editor.getNote(), baseVersion: s.baseVersion, at: Date.now() });
      }
    },
    async send({ content, opId }) {
      const check = validateNote(content);
      if (!check.valid) return { status: 'invalid', message: check.errors[0] };
      const res = await saveNote({ docId: id, baseVersion: s.baseVersion, content, opId });
      if (res.status === 'saved') s.baseVersion = res.head_version;
      return res;
    },
  });

  function drawStatus(status = autosaver.status(), extra) {
    const [text, tone] = STATUS[status] ?? STATUS.saved;
    const label = status === 'invalid' ? (extra?.message ?? text) : text;
    const slot = $('#ws-status');
    slot.textContent = canEdit() || status !== 'saved' ? label : `${roleLabel(s.role)} · read only`;
    slot.dataset.tone = tone;
  }

  function drawTitle() {
    render(
      $('#ws-title-slot'),
      isOwner() && !s.archived
        ? html`<input id="ws-title" class="ws-title" value="${s.title}" maxlength="200" aria-label="Title" />`
        : html`<h1 class="ws-title">${s.title}</h1>`,
    );
  }

  function drawActions() {
    render(
      $('#ws-actions'),
      html`<button class="btn btn-sm" data-act="share">${isOwner() ? 'Share' : 'Who has access'}</button>
        <button class="btn btn-sm" data-act="history">History</button>
        ${canEdit() ? html`<button class="btn btn-sm" data-act="save-version">Save version</button>` : ''}
        <span class="ws-grow"></span>
        ${isOwner() ? html`<button class="btn btn-ghost btn-sm" data-act="${s.archived ? 'unarchive' : 'archive'}">${s.archived ? 'Unarchive' : 'Archive'}</button><button class="btn btn-ghost btn-sm ws-danger-text" data-act="delete">Delete</button>` : ''}`,
    );
  }

  function drawBanner() {
    render(
      $('#ws-banner'),
      html`${s.error ? html`<p class="note-error" role="alert">${s.error}</p>` : ''}
      ${s.notice ? html`<p class="note-ok" role="status">${s.notice}</p>` : ''}
      ${s.archived ? html`<p class="note-box">This note is archived, so it is read-only.${isOwner() ? ' Unarchive it to edit.' : ''}</p>` : ''}
      ${!s.archived && !canEdit() ? html`<p class="note-box">You can read this note. Only the owner and editors can change it.</p>` : ''}
      ${
        s.draft
          ? html`<div class="note-box" role="alert">
              <strong>Unsaved changes from earlier were found on this device.</strong>
              <div class="actions">
                <button class="btn btn-primary btn-sm" data-act="draft-restore">Put them back</button
                ><button class="btn btn-sm" data-act="draft-discard">Discard them</button>
              </div>
            </div>`
          : ''
      }
      ${
        s.conflict
          ? html`<div class="note-box ws-conflict" role="alert">
              <strong>Someone else saved a newer version while you were editing.</strong>
              <p>Your text is safe. Choose what to do:</p>
              <div class="actions">
                <button class="btn btn-primary btn-sm" data-act="keep-mine">Keep my version on top</button>
                <button class="btn btn-sm" data-act="use-latest">Use the latest version</button>
                <button class="btn btn-sm" data-act="copy-mine">Copy my text</button>
              </div>
              <p class="muted">Their version stays in History either way.</p>
            </div>`
          : ''
      }`,
    );
  }

  function drawToolbar() {
    const bar = $('#ws-toolbar');
    bar.hidden = !canEdit();
    if (!canEdit()) return;
    render(
      bar,
      html`${TOOLS.map(([cmd, label, tip]) => html`<button type="button" class="btn btn-sm ws-tb" data-cmd="${cmd}" aria-label="${tip}" title="${tip}" aria-pressed="false">${label}</button>`)}`,
    );
    syncToolbar();
  }

  function syncToolbar() {
    if (!editor || !canEdit()) return;
    const f = editor.format();
    $('#ws-toolbar')
      .querySelectorAll('[data-cmd]')
      .forEach((b) => {
        const c = b.dataset.cmd;
        const on = c === 'link' ? !!f.link : c === 'h1' || c === 'h2' || c === 'h3' ? f.block === c : !!f[c];
        if (c !== 'undo' && c !== 'redo') b.setAttribute('aria-pressed', String(on));
        if (c === 'undo') b.disabled = !f.canUndo;
        if (c === 'redo') b.disabled = !f.canRedo;
      });
  }

  function drawLinkBar() {
    const bar = $('#ws-linkbar');
    bar.hidden = !s.linkOpen || !canEdit();
    if (bar.hidden) return;
    const f = editor.format();
    render(
      bar,
      html`<label class="field ws-grow"
          ><span>Link address</span><input id="ws-href" type="url" value="${f.link ?? 'https://'}" autocomplete="off"
        /></label>
        <div class="actions">
          <button class="btn btn-primary btn-sm" data-act="link-apply">Apply</button>
          ${f.link ? html`<button class="btn btn-sm" data-act="link-remove">Remove link</button>` : ''}
          <button class="btn btn-sm" data-act="link-close">Cancel</button>
        </div>
        ${s.linkError ? html`<p class="note-error" role="alert">${s.linkError}</p>` : ''}`,
    );
    bar.querySelector('#ws-href').focus();
  }

  function applyEditable() {
    editor?.setEditable(canEdit());
    drawTitle();
    drawActions();
    drawToolbar();
    drawBanner();
    drawStatus();
  }

  // Pull the newest saved version into the editor (after a restore or choosing "use the latest version").
  async function loadLatest() {
    const fresh = await openNote(id);
    s.baseVersion = fresh.head_version;
    s.title = fresh.title;
    s.archived = !!fresh.archived;
    s.role = fresh.role;
    s.historyVisible = fresh.history_visible_to_viewers !== false;
    editor.setNote(fresh.content ?? emptyNote());
    autosaver.reset();
    writeDraft(id, null);
    s.conflict = null;
    applyEditable();
  }

  editor = await createEditor({
    host: $('#ws-editor'),
    note: data.content ?? emptyNote(),
    editable: canEdit(),
    onChange: () => autosaver.changed(),
    onState: () => syncToolbar(),
  });
  drawTitle();
  drawActions();
  drawToolbar();
  drawStatus('saved');
  const draft = readDraft(id);
  if (
    draft?.content &&
    canEdit() &&
    validateNote(draft.content).valid &&
    JSON.stringify(draft.content) !== JSON.stringify(editor.getNote())
  )
    s.draft = draft;
  drawBanner();

  async function leave() {
    removeEventListener('hashchange', onHash);
    removeEventListener('beforeunload', guard);
    document.removeEventListener('visibilitychange', onHide);
    await autosaver.flush().catch(() => {});
    autosaver.destroy();
    editor.destroy();
  }
  const onHash = () => leave();
  const guard = (e) => {
    if (autosaver.isUnsaved()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') autosaver.flush();
  };
  addEventListener('hashchange', onHash);
  addEventListener('beforeunload', guard);
  document.addEventListener('visibilitychange', onHide);

  const say = (notice, error = '') => {
    s.notice = notice;
    s.error = error;
    drawBanner();
  };

  async function onAction(act) {
    if (act === 'share') {
      openSharing({
        doc: { id, title: s.title, history_visible_to_viewers: s.historyVisible },
        role: s.role,
        onChanged: (change) => {
          if (change.historyVisible !== undefined) s.historyVisible = change.historyVisible;
          if (change.transferred) loadLatest().catch((e) => say('', e.message));
        },
      });
    } else if (act === 'history') {
      openHistory({
        doc: { id, archived: s.archived, history_visible_to_viewers: s.historyVisible },
        role: s.role,
        beforeRestore: async () => (await autosaver.flush()) === 'saved',
        onRestored: () =>
          loadLatest()
            .then(() => say('Restored. The note now matches that version.'))
            .catch((e) => say('', e.message)),
      });
    } else if (act === 'save-version') {
      const status = await autosaver.flush();
      if (status !== 'saved') return say('', 'Your latest changes are not saved yet. Try again in a moment.');
      try {
        const res = await saveNote({ docId: id, baseVersion: s.baseVersion, content: editor.getNote(), opId: newId(), seal: true });
        if (res.status === 'conflict') {
          s.conflict = { id: res.conflict_id, head: res.head_version };
          return drawBanner();
        }
        s.baseVersion = res.head_version;
        say(`Version ${res.version} saved.`);
      } catch (e) {
        say('', e.message);
      }
    } else if (act === 'archive' || act === 'unarchive') {
      if (
        act === 'archive' &&
        !(await confirmAction({
          title: 'Archive this note?',
          message: 'It becomes read-only for everyone and leaves the main list. You can unarchive it later.',
          confirmLabel: 'Archive',
        }))
      )
        return;
      try {
        await autosaver.flush();
        await setDocumentState(id, act, newId());
        s.archived = act === 'archive';
        s.notice = '';
        applyEditable();
      } catch (e) {
        say('', e.message);
      }
    } else if (act === 'delete') {
      if (
        !(await confirmAction({
          title: 'Delete this note?',
          message: 'It moves to your trash. People it was shared with can no longer open it. You can restore it from the trash.',
          confirmLabel: 'Delete',
          danger: true,
        }))
      )
        return;
      try {
        await autosaver.flush();
        await setDocumentState(id, 'delete', newId());
        sessionStorage.removeItem(OPEN_KEY);
        location.hash = '#/workspace';
      } catch (e) {
        say('', e.message);
      }
    } else if (act === 'keep-mine' && s.conflict) {
      const content = editor.getNote();
      const check = validateNote(content);
      if (!check.valid) return say('', check.errors[0]);
      try {
        const res = await saveNote({
          docId: id,
          baseVersion: s.conflict.head,
          content,
          opId: newId(),
          resolves: s.conflict.id,
          resolution: 'kept_local',
        });
        if (res.status === 'conflict') {
          s.conflict = { id: res.conflict_id, head: res.head_version };
          return drawBanner();
        }
        s.baseVersion = res.head_version;
        s.conflict = null;
        autosaver.resume();
        writeDraft(id, null);
        say('Your version is saved on top. The other version is in History.');
      } catch (e) {
        say('', e.message);
      }
    } else if (act === 'use-latest' && s.conflict) {
      if (
        !(await confirmAction({
          title: 'Use the latest version?',
          message: 'Your text on screen is replaced by the latest saved version. Copy your text first if you want to keep it.',
          confirmLabel: 'Use latest',
        }))
      )
        return;
      try {
        await resolveConflict(s.conflict.id, 'kept_server', newId());
        await loadLatest();
        say('Showing the latest version.');
      } catch (e) {
        say('', e.message);
      }
    } else if (act === 'copy-mine') {
      const text = notePlainText(editor.getNote());
      try {
        await navigator.clipboard.writeText(text);
        say('Your text is copied.');
      } catch {
        showText(text);
      }
    } else if (act === 'draft-restore' && s.draft) {
      editor.setNote(s.draft.content);
      s.draft = null;
      autosaver.changed();
      drawBanner();
    } else if (act === 'draft-discard') {
      writeDraft(id, null);
      s.draft = null;
      drawBanner();
    } else if (act === 'link-apply') {
      let v = $('#ws-href').value.trim();
      if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && /^[^\s/]+\.[^\s]+$/.test(v)) v = `https://${v}`;
      if (!editor.setLink(v)) {
        s.linkError = 'Links must start with http://, https://, mailto: or tel:';
        return drawLinkBar();
      }
      s.linkOpen = false;
      s.linkError = '';
      drawLinkBar();
      editor.focus();
    } else if (act === 'link-remove') {
      editor.setLink(null);
      s.linkOpen = false;
      drawLinkBar();
      editor.focus();
    } else if (act === 'link-close') {
      s.linkOpen = false;
      s.linkError = '';
      drawLinkBar();
      editor.focus();
    }
  }

  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ws-tb')) e.preventDefault(); // keep the text selection while a toolbar button is pressed
  });
  el.addEventListener('click', (e) => {
    const tool = e.target.closest('[data-cmd]');
    if (tool && canEdit()) {
      if (tool.dataset.cmd === 'link') {
        s.linkOpen = !s.linkOpen;
        s.linkError = '';
        drawLinkBar();
      } else editor.run(tool.dataset.cmd);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (b && el.contains(b)) onAction(b.dataset.act);
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.id === 'ws-href' && e.key === 'Enter') {
      e.preventDefault();
      onAction('link-apply');
    }
  });
  el.addEventListener('change', async (e) => {
    if (e.target.id !== 'ws-title') return;
    const title = normalizeTitle(e.target.value);
    const problem = validateTitle(title);
    if (problem) {
      e.target.value = s.title;
      return say('', problem);
    }
    if (title === s.title) return;
    try {
      await renameDocument(id, title, newId());
      s.title = title;
      document.title = `${title} · Dua`;
      say('');
    } catch (err) {
      e.target.value = s.title;
      say('', err.message);
    }
  });
}

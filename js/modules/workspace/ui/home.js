// Workspace home: your notes and notes shared with you, search, personal folders, and the way into a note.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { roleLabel } from '../domain/permissions.js';
import { cleanQuery, kindLabel, newId, nextCursor, OPEN_KEY, relativeWhen } from '../domain/documents.js';
import { createDocument, listDocuments, listFolders, listUserState, saveFolder, setDocumentFlags } from '../data/documents.js';
import { searchNotes } from '../data/notes.js';
import { askText } from './panel.js';

export function openDocument(id, kind = 'note') {
  sessionStorage.setItem(OPEN_KEY, id);
  location.hash = kind === 'note' ? '#/workspace/note' : '#/workspace';
}

const SCOPES = [
  ['all', 'All'],
  ['mine', 'Mine'],
  ['shared', 'Shared with me'],
  ['archived', 'Archived'],
  ['trash', 'Trash'],
];

export async function mount(el, { ctx } = {}) {
  const canCreate = new Set(ctx?.permissions ?? []).has('workspace.create');
  const s = {
    scope: 'all',
    query: '',
    folder: '',
    docs: [],
    more: false,
    textHits: [],
    folders: [],
    flags: new Map(),
    loading: true,
    error: '',
    busy: false,
  };
  let searchTimer = null;
  let token = 0;

  render(
    el,
    html`${hero({ label: 'Dua Workspace', title: 'Notes and sheets', sub: 'Write notes, share them with colleagues, and find them again.' })}
      <section class="card ws-home">
        <div class="ws-toolbar-row">
          <button class="btn btn-primary" data-act="new-note" ${canCreate ? '' : 'disabled'}>New note</button>
          <button class="btn" disabled title="Sheets arrive in a later update">New workbook</button>
          <button class="btn btn-ghost" data-act="new-folder">New folder</button>
          <span class="ws-grow"></span>
          <label class="field ws-search"
            ><span class="ws-sr">Search</span><input id="ws-q" type="search" placeholder="Search your documents" autocomplete="off"
          /></label>
        </div>
        ${canCreate ? '' : html`<p class="muted">You can open what is shared with you. Ask the owner if you need to create your own notes.</p>`}
        <div id="ws-tabs" class="tabs-seg" role="tablist" aria-label="Which documents"></div>
        <div id="ws-folders" class="ws-chips" aria-label="Folders"></div>
        <div id="ws-list" aria-live="polite"></div>
        <p class="muted ws-sheets-note">Sheets: workbooks with formulas are coming in a later update. Notes work now.</p>
      </section>`,
  );
  const $ = (sel) => el.querySelector(sel);

  const rowsInFolder = () => {
    if (!s.folder) return s.docs;
    return s.docs.filter((d) => {
      const f = s.flags.get(d.id)?.folder_id ?? null;
      return s.folder === 'none' ? f === null : f === s.folder;
    });
  };

  function drawTabs() {
    render(
      $('#ws-tabs'),
      html`${SCOPES.map(([k, label]) => html`<button class="tab" role="tab" data-scope="${k}" aria-selected="${s.scope === k}">${label}</button>`)}`,
    );
    const chips = [['', 'Every folder'], ['none', 'Not in a folder'], ...s.folders.map((f) => [f.id, f.name])];
    render(
      $('#ws-folders'),
      html`${chips.map(([id, name]) => html`<button class="pill ${s.folder === id ? 'is-active' : ''}" data-folder="${id}" aria-pressed="${s.folder === id}">${name}</button>`)}`,
    );
  }

  function drawList() {
    const rows = rowsInFolder();
    const hits = s.textHits.filter((h) => !s.docs.some((d) => d.id === h.document_id));
    render(
      $('#ws-list'),
      html`${s.error ? html`<p class="note-error" role="alert">${s.error}</p>` : ''} ${s.loading ? html`<p class="muted">Loading…</p>` : ''}
        ${!s.loading && !rows.length && !hits.length && !s.error ? html`<p class="muted">${s.query ? 'Nothing matches that search.' : s.scope === 'trash' ? 'The trash is empty.' : 'No documents here yet.'}</p>` : ''}
        <ul class="ws-list">
          ${rows.map((d) => {
            const flag = s.flags.get(d.id);
            return html`<li class="ws-row ws-doc">
              <button class="ws-open" data-open="${d.id}" data-kind="${d.kind}" ${d.deleted_at ? 'disabled' : ''}>
                <strong>${d.title}</strong>
                <span class="muted"
                  >${kindLabel(d.kind)} · ${d.my_role === 'owner' ? 'You' : d.owner_name} · edited ${relativeWhen(d.updated_at)}</span
                >
              </button>
              <span class="pill">${roleLabel(d.my_role)}</span>
              ${
                s.folders.length
                  ? html`<label class="ws-inline"
                      ><span class="ws-sr">Folder for ${d.title}</span
                      ><select data-move="${d.id}">
                        <option value="">No folder</option>
                        ${s.folders.map((f) => html`<option value="${f.id}" ${flag?.folder_id === f.id ? 'selected' : ''}>${f.name}</option>`)}
                      </select></label
                    >`
                  : ''
              }
            </li>`;
          })}
        </ul>
        ${s.more ? html`<button class="btn btn-sm" data-act="more">Show more</button>` : ''}
        ${
          hits.length
            ? html`<h3 class="sec-label">Also found in note text</h3>
                <ul class="ws-list">
                  ${hits.map(
                    (h) =>
                      html`<li class="ws-row ws-doc">
                        <button class="ws-open" data-open="${h.document_id}" data-kind="note">
                          <strong>${h.title}</strong><span class="muted">${h.excerpt}</span>
                        </button>
                        <span class="pill">${roleLabel(h.my_role)}</span>
                      </li>`,
                  )}
                </ul>`
            : ''
        }`,
    );
  }

  async function load({ append = false } = {}) {
    const mine = ++token;
    s.loading = true;
    s.error = '';
    drawList();
    try {
      const after = append ? nextCursor(s.docs) : null;
      const [rows, hits] = await Promise.all([
        listDocuments({ scope: s.scope, query: s.query || null, after, limit: 50 }),
        s.query.length >= 2 && s.scope !== 'trash' ? searchNotes(s.query).catch(() => []) : Promise.resolve([]),
      ]);
      if (mine !== token) return;
      s.docs = append ? [...s.docs, ...rows] : rows;
      s.more = rows.length === 50;
      s.textHits = hits;
    } catch (e) {
      if (mine !== token) return;
      s.error = e.message;
    }
    s.loading = false;
    drawList();
  }

  async function loadOrganisation() {
    try {
      const [folders, state] = await Promise.all([listFolders(), listUserState()]);
      s.folders = folders;
      s.flags = new Map(state.map((r) => [r.document_id, r]));
    } catch {
      // Folders are a convenience: the list still works without them.
    }
    drawTabs();
    drawList();
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.scope) {
      s.scope = b.dataset.scope;
      drawTabs();
      load();
    } else if (b.dataset.folder !== undefined && b.matches('.pill')) {
      s.folder = b.dataset.folder;
      drawTabs();
      drawList();
    } else if (b.dataset.open) {
      openDocument(b.dataset.open, b.dataset.kind);
    } else if (b.dataset.act === 'more') {
      load({ append: true });
    } else if (b.dataset.act === 'new-note' && !s.busy) {
      s.busy = true;
      b.disabled = true;
      try {
        const doc = await createDocument({ id: newId(), kind: 'note', title: 'Untitled note', key: newId() });
        openDocument(doc.id, 'note');
        return;
      } catch (err) {
        s.error = err.message;
        drawList();
      }
      s.busy = false;
      b.disabled = !canCreate;
    } else if (b.dataset.act === 'new-folder') {
      const name = await askText({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create', maxLength: 80 });
      if (!name) return;
      try {
        await saveFolder({ name, key: newId() });
        await loadOrganisation();
      } catch (err) {
        s.error = err.message;
        drawList();
      }
    }
  });
  el.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-move]');
    if (!sel) return;
    const id = sel.dataset.move;
    const prev = s.flags.get(id);
    try {
      await setDocumentFlags(id, { folderId: sel.value || null, pinned: !!prev?.pinned, offline: !!prev?.offline_pinned });
      s.flags.set(id, { ...(prev ?? { document_id: id }), folder_id: sel.value || null });
    } catch (err) {
      s.error = err.message;
    }
    drawList();
  });
  $('#ws-q').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      s.query = cleanQuery(e.target.value);
      load();
    }, 300);
  });
  // Leaving the page cancels a pending search.
  addEventListener('hashchange', () => clearTimeout(searchTimer), { once: true });

  drawTabs();
  await Promise.all([load(), loadOrganisation()]);
}

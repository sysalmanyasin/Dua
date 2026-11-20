// Who can open this document. Everyone with access sees the list; only the owner changes it.
// The database enforces this: the buttons here only decide what to show.
import { html, render } from '../../../shared/html.js';
import { roleLabel } from '../domain/permissions.js';
import { newId } from '../domain/documents.js';
import * as sharing from '../data/sharing.js';
import { setHistoryVisible } from '../data/documents.js';
import { confirmAction, openPanel } from './panel.js';

// openSharing({ doc: { id, title, history_visible_to_viewers }, role, onChanged })
//  onChanged({ transferred?: boolean, historyVisible?: boolean }) is called after something changed.
export function openSharing({ doc, role, onChanged = () => {} }) {
  const isOwner = role === 'owner';
  const p = openPanel({ title: `Share “${doc.title}”`, wide: true });
  const s = {
    members: [],
    candidates: [],
    query: '',
    error: '',
    busy: false,
    loading: true,
    historyVisible: doc.history_visible_to_viewers !== false,
  };
  let searchTimer = null;

  async function reload() {
    try {
      s.members = await sharing.listMembers(doc.id);
      s.error = '';
    } catch (e) {
      s.error = e.message;
    }
    s.loading = false;
    draw();
  }

  async function act(fn, { after } = {}) {
    if (s.busy) return;
    s.busy = true;
    s.error = '';
    draw();
    try {
      await fn();
      if (after) after();
      await reload();
      onChanged({});
    } catch (e) {
      s.error = e.message;
    }
    s.busy = false;
    draw();
  }

  async function search() {
    if (!isOwner) return;
    try {
      const rows = await sharing.shareCandidates(s.query.trim() || null);
      const have = new Set(s.members.map((m) => m.staff_id));
      s.candidates = rows.filter((r) => !have.has(r.staff_id));
    } catch (e) {
      s.error = e.message;
    }
    draw(true);
  }

  function draw(keepFocus = false) {
    const focused = keepFocus ? p.body.querySelector('#ws-find') : null;
    const selectionStart = focused?.selectionStart;
    const others = s.members.filter((m) => m.role !== 'owner');
    render(
      p.body,
      html`
        ${s.error ? html`<p class="note-error" role="alert">${s.error}</p>` : ''}
        <h3 class="sec-label">People with access</h3>
        ${s.loading ? html`<p class="muted">Loading…</p>` : ''}
        <ul class="ws-list">
          ${s.members.map(
            (m) =>
              html`<li class="ws-row">
                <span class="ws-grow"><strong>${m.full_name}</strong></span>
                ${
                  isOwner && m.role !== 'owner'
                    ? html`<label class="ws-inline"
                          ><span class="ws-sr">Access for ${m.full_name}</span>
                          <select data-role-for="${m.staff_id}" ${s.busy ? 'disabled' : ''}>
                            <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>${roleLabel('editor')}</option>
                            <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>${roleLabel('viewer')}</option>
                          </select></label
                        ><button class="btn btn-sm" data-remove="${m.staff_id}" ${s.busy ? 'disabled' : ''}>Remove</button>`
                    : html`<span class="pill">${roleLabel(m.role)}</span>`
                }
              </li>`,
          )}
        </ul>
        ${
          isOwner
            ? html`
                <h3 class="sec-label">Add someone</h3>
                <label class="field"
                  ><span>Find a colleague</span
                  ><input id="ws-find" type="search" value="${s.query}" placeholder="Start typing a name" autocomplete="off"
                /></label>
                <ul class="ws-list">
                  ${s.candidates.length === 0 && s.query ? html`<li class="muted">No one found who can use Workspace.</li>` : ''}
                  ${s.candidates.map(
                    (c) =>
                      html`<li class="ws-row">
                        <span class="ws-grow">${c.full_name}</span>
                        <button class="btn btn-sm" data-add="${c.staff_id}" data-as="editor" ${s.busy ? 'disabled' : ''}>Can edit</button>
                        <button class="btn btn-sm" data-add="${c.staff_id}" data-as="viewer" ${s.busy ? 'disabled' : ''}>Can view</button>
                      </li>`,
                  )}
                </ul>
                <h3 class="sec-label">Earlier versions</h3>
                <label class="ws-check"
                  ><input type="checkbox" id="ws-hist" ${s.historyVisible ? 'checked' : ''} ${s.busy ? 'disabled' : ''} /> People who can
                  only view may see earlier versions</label
                >
                <h3 class="sec-label">Hand over ownership</h3>
                ${
                  others.length
                    ? html`<div class="ws-row">
                          <label class="field ws-grow"
                            ><span>New owner</span
                            ><select id="ws-owner">
                              ${others.map((m) => html`<option value="${m.staff_id}">${m.full_name}</option>`)}
                            </select></label
                          ><button class="btn" data-transfer ${s.busy ? 'disabled' : ''}>Make owner</button>
                        </div>
                        <p class="muted">
                          You stay on the document as an editor. The new owner must be allowed to create Workspace documents.
                        </p>`
                    : html`<p class="muted">Share the document with someone first.</p>`
                }
              `
            : html`<p class="muted">Only the owner can change who has access.</p>`
        }
      `,
    );
    if (keepFocus) {
      const input = p.body.querySelector('#ws-find');
      if (input) {
        input.focus();
        if (selectionStart !== undefined && selectionStart !== null) input.setSelectionRange(selectionStart, selectionStart);
      }
    }
  }

  p.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-role-for]')) {
      act(() => sharing.setMember(doc.id, t.dataset.roleFor, t.value, newId()));
    } else if (t.id === 'ws-hist') {
      const visible = t.checked;
      act(() => setHistoryVisible(doc.id, visible, newId()), { after: () => (s.historyVisible = visible) });
      onChanged({ historyVisible: visible });
    }
  });
  p.body.addEventListener('input', (e) => {
    if (e.target.id !== 'ws-find') return;
    s.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 250);
  });
  p.body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.remove) {
      const who = s.members.find((m) => m.staff_id === b.dataset.remove)?.full_name ?? 'this person';
      if (
        await confirmAction({
          title: 'Remove access?',
          message: `${who} will no longer be able to open this document.`,
          confirmLabel: 'Remove',
          danger: true,
        })
      ) {
        act(() => sharing.removeMember(doc.id, b.dataset.remove, newId()));
      }
    } else if (b.dataset.add) {
      act(() => sharing.setMember(doc.id, b.dataset.add, b.dataset.as, newId()), {
        after: () => (s.candidates = s.candidates.filter((c) => c.staff_id !== b.dataset.add)),
      });
    } else if (b.dataset.transfer !== undefined) {
      const sel = p.body.querySelector('#ws-owner');
      const who = s.members.find((m) => m.staff_id === sel.value)?.full_name ?? 'this person';
      if (
        await confirmAction({
          title: 'Hand over ownership?',
          message: `${who} becomes the owner. You stay on as an editor and can no longer change who has access.`,
          confirmLabel: 'Make owner',
        })
      ) {
        s.busy = true;
        draw();
        try {
          await sharing.transferOwnership(doc.id, sel.value, newId());
          onChanged({ transferred: true });
          p.close();
          return;
        } catch (err) {
          s.error = err.message;
        }
        s.busy = false;
        draw();
      }
    }
  });

  draw();
  reload().then(() => isOwner && search());
  return p;
}

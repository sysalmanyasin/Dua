// Earlier versions of a note: browse, preview, and (owner only) restore. Restoring writes a NEW version; nothing is erased.
import { html, render } from '../../../shared/html.js';
import { describeRevision } from '../domain/revisions.js';
import { formatWhen, newId } from '../domain/documents.js';
import { can } from '../domain/permissions.js';
import { getRevision, listHistory } from '../data/revisions.js';
import { restoreNote } from '../data/notes.js';
import { createEditor } from './noteEditor.js';
import { confirmAction, openPanel } from './panel.js';

const PAGE = 30;

// openHistory({ doc: { id, archived, history_visible_to_viewers }, role, onRestored, beforeRestore })
//  beforeRestore() resolves true when it is safe to replace the text on screen (nothing unsaved).
export function openHistory({ doc, role, onRestored = () => {}, beforeRestore = async () => true }) {
  const p = openPanel({ title: 'Earlier versions', wide: true });
  const s = { rows: [], more: false, selected: null, previewNote: null, previewVersion: null, error: '', loading: true, busy: false };
  let preview = null;
  const canSee = can(role, 'view_history', { historyVisible: doc.history_visible_to_viewers !== false });
  const canRestore = can(role, 'restore', { archived: !!doc.archived });

  async function load(before = null) {
    s.loading = true;
    draw();
    try {
      const rows = await listHistory(doc.id, { before, limit: PAGE });
      s.rows = before ? [...s.rows, ...rows] : rows;
      s.more = rows.length === PAGE;
      s.error = '';
    } catch (e) {
      s.error = e.message;
    }
    s.loading = false;
    draw();
  }

  // The preview editor lives inside the re-rendered panel, so it is rebuilt after every draw from the loaded note.
  async function mountPreview() {
    const version = s.selected;
    const host = p.body.querySelector('#ws-preview');
    preview?.destroy();
    preview = null;
    if (!host || !s.previewNote || s.previewVersion !== version) return;
    try {
      const ed = await createEditor({ host, note: s.previewNote, editable: false });
      if (s.selected !== version || !host.isConnected) ed.destroy();
      else preview = ed;
    } catch (e) {
      s.error = e.message;
    }
  }

  async function select(version) {
    s.selected = version;
    s.previewNote = null;
    s.previewVersion = null;
    s.error = '';
    draw();
    try {
      const rev = await getRevision(doc.id, version);
      if (s.selected !== version) return;
      s.previewNote = rev.content;
      s.previewVersion = version;
      mountPreview();
    } catch (e) {
      s.error = e.message;
      draw();
    }
  }

  function draw() {
    if (!canSee) {
      render(p.body, html`<p class="muted">The owner has not shared earlier versions with people who can only view.</p>`);
      return;
    }
    const chosen = s.rows.find((r) => r.version === s.selected);
    render(
      p.body,
      html`
        ${s.error ? html`<p class="note-error" role="alert">${s.error}</p>` : ''}
        <div class="ws-history">
          <ul class="ws-list ws-versions" aria-label="Versions">
            ${s.rows.map(
              (r) =>
                html`<li>
                  <button
                    class="ws-version ${r.version === s.selected ? 'is-active' : ''}"
                    data-version="${r.version}"
                    aria-pressed="${r.version === s.selected}"
                  >
                    <strong>Version ${r.version}</strong>${r.is_head ? html` <span class="pill">Current</span>` : ''}
                    <span class="muted">${describeRevision(r)} · ${r.author ?? 'Unknown'}</span>
                    <span class="muted">${formatWhen(r.saved_at)}</span>
                  </button>
                </li>`,
            )}
            ${s.loading ? html`<li class="muted">Loading…</li>` : ''}
            ${s.more && !s.loading ? html`<li><button class="btn btn-sm" data-more>Show older versions</button></li>` : ''}
          </ul>
          <div class="ws-preview-wrap">
            ${
              chosen
                ? html`<div class="ws-preview-head">
                      <strong>Version ${chosen.version}</strong>
                      ${canRestore && !chosen.is_head ? html`<button class="btn btn-primary btn-sm" data-restore ${s.busy ? 'disabled' : ''}>Restore this version</button>` : ''}
                    </div>
                    <div id="ws-preview" class="ws-editor ws-readonly"></div>
                    ${canRestore && !chosen.is_head ? html`<p class="muted">Restoring adds a new version with this text. Nothing is erased.</p>` : ''}`
                : html`<p class="muted">Choose a version to preview it.</p>`
            }
          </div>
        </div>
      `,
    );
    mountPreview();
  }

  p.body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.version) select(Number(b.dataset.version));
    else if (b.dataset.more !== undefined) load(s.rows.at(-1)?.version ?? null);
    else if (b.dataset.restore !== undefined && s.selected) {
      const version = s.selected;
      if (
        !(await confirmAction({
          title: 'Restore this version?',
          message: `The note will go back to version ${version}. Your current text stays in the history.`,
          confirmLabel: 'Restore',
        }))
      )
        return;
      if (!(await beforeRestore())) {
        s.error = 'Your latest changes are not saved yet. Wait until the note says Saved, then try again.';
        draw();
        return;
      }
      s.busy = true;
      draw();
      try {
        const res = await restoreNote(doc.id, version, newId());
        onRestored(res);
        p.close();
        return;
      } catch (err) {
        s.error = err.message;
      }
      s.busy = false;
      draw();
    }
  });

  if (canSee) load();
  else draw();
  const close = p.close;
  p.close = () => {
    preview?.destroy();
    close();
  };
  return p;
}

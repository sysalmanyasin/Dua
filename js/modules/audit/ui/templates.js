// Templates: saved lists of product codes. Only codes are kept; names, stock and prices are read fresh when a template is used (R12).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { parseCodes } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { parseTemplateImport } from '../domain/templateImport.js';
import { checkPlan, MAX_FILE_BYTES, MAX_FILES, planFromFile } from '../domain/templateCsv.js';
import { errorCard, loadingCard, toast } from './parts.js';

const readText = (file) =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });

export async function mount(el, { ctx } = {}) {
  const canEdit = (ctx?.permissions ?? []).includes('audit.templates');
  const s = { list: [], editing: null, name: '', codes: '', busy: false, error: null, confirmDelete: null, importText: '', csv: [] };

  async function load() {
    s.list = await api.listTemplates();
  }

  const csvLabel = (n) => `Create ${n} ${n === 1 ? 'template' : 'templates'}`;
  const csvIssues = () =>
    checkPlan(
      s.csv,
      s.list.map((t) => t.name),
    );

  function draw() {
    const typed = parseCodes(s.codes);
    const issues = csvIssues();
    const okCount = issues.filter((x) => x === null).length;
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Templates', sub: 'Saved lists of product codes for repeat audits.' })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
        <section class="card aud-card" aria-label="Templates">
          <h2>Saved templates</h2>
          ${
            s.list.length === 0
              ? html`<p class="muted">No templates yet.</p>`
              : s.list.map(
                  (t) =>
                    html`<div class="row">
                      <div><strong>${t.name}</strong><br /><span class="muted small">${t.codes.length} codes</span></div>
                      ${
                        canEdit
                          ? html`<div class="aud-actions">
                              <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${t.id}">Edit</button>
                              ${
                                s.confirmDelete === t.id
                                  ? html`<button
                                      type="button"
                                      class="btn btn-sm"
                                      data-act="delete-yes"
                                      data-id="${t.id}"
                                      ${s.busy ? 'disabled' : ''}
                                    >
                                      Delete for good
                                    </button>`
                                  : html`<button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="${t.id}">
                                      Delete
                                    </button>`
                              }
                            </div>`
                          : ''
                      }
                    </div>`,
                )
          }
        </section>
        ${
          canEdit
            ? html`<section class="card aud-card" aria-label="${s.editing ? 'Edit template' : 'New template'}">
                <h2>${s.editing ? 'Edit template' : 'New template'}</h2>
                <label class="field"><span>Name</span><input type="text" data-f="name" maxlength="80" value="${s.name}" /></label>
                <label class="field"
                  ><span>Product codes (spaces, commas or new lines)</span
                  ><textarea data-f="codes" rows="6" spellcheck="false">${s.codes}</textarea>
                </label>
                <p class="muted small" data-count>${typed.length} ${typed.length === 1 ? 'code' : 'codes'}</p>
                <div class="aud-actions">
                  <button
                    type="button"
                    class="btn btn-primary"
                    data-act="save"
                    ${s.busy || s.name.trim().length < 2 || typed.length === 0 ? 'disabled' : ''}
                  >
                    Save
                  </button>
                  ${s.editing ? html`<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>` : ''}
                </div>
              </section>`
            : ''
        }
        ${
          canEdit
            ? html`<section class="card aud-card" aria-label="Make templates from CSV files">
                <h2>Make templates from CSV files</h2>
                <p class="muted small">
                  Choose one or more CSV files that hold product codes only. Each file becomes one template, named after the file.
                </p>
                <label class="field"
                  ><span>CSV files</span
                  ><input type="file" data-act="csv-files" accept=".csv,.txt,text/csv,text/plain" multiple ${s.busy ? 'disabled' : ''}
                /></label>
                ${
                  s.csv.length === 0
                    ? ''
                    : html`<div data-csv>
                        ${s.csv.map(
                          (p, i) =>
                            html`<div class="row">
                              <div>
                                ${
                                  p.error && p.codes.length === 0
                                    ? html`<strong>${p.file}</strong>`
                                    : html`<label class="field"
                                        ><span>Template name</span
                                        ><input type="text" data-f="csvname" data-i="${i}" maxlength="80" value="${p.name}"
                                      /></label>`
                                }
                                <span class="muted small"
                                  >${p.file} · ${p.codes.length}
                                  ${p.codes.length === 1 ? 'code' : 'codes'}${
                                    p.codes.length ? ` · e.g. ${p.codes.slice(0, 3).join(', ')}` : ''
                                  }${p.suspect ? ` · ${p.suspect} shortened by a spreadsheet, left out` : ''}</span
                                >
                                <p class="note note-error small" data-csv-note="${i}" role="alert" ${issues[i] ? '' : 'hidden'}>
                                  ${issues[i] ?? ''}
                                </p>
                              </div>
                            </div>`,
                        )}
                        <div class="aud-actions">
                          <button type="button" class="btn btn-primary" data-act="csv-create" ${s.busy || okCount === 0 ? 'disabled' : ''}>
                            ${csvLabel(okCount)}
                          </button>
                          <button type="button" class="btn btn-ghost" data-act="csv-clear" ${s.busy ? 'disabled' : ''}>Clear</button>
                        </div>
                      </div>`
                }
              </section>`
            : ''
        }
        ${
          canEdit
            ? html`<section class="card aud-card" aria-label="Import templates">
                <h2>Import from the old app</h2>
                <p class="muted small">Paste the templates exported from the old Audit Hub. Names already here are left alone.</p>
                <label class="field"
                  ><span>Exported templates</span
                  ><textarea data-f="import" rows="4" spellcheck="false" placeholder='[{"name":"Syrups","codes":["040700"]}]'>
${s.importText}</textarea>
                </label>
                <button type="button" class="btn" data-act="import" ${s.busy || s.importText.trim() === '' ? 'disabled' : ''}>
                  Import
                </button>
              </section>`
            : ''
        }
      </div>`,
    );
  }

  async function run(fn, done) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      await load();
      if (done) toast(done);
    } catch (e) {
      s.error = friendlyError(e).message;
    }
    s.busy = false;
    draw();
  }

  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'import') {
      s.importText = e.target.value;
      const b = el.querySelector('button[data-act="import"]');
      if (b) b.disabled = s.busy || s.importText.trim() === '';
      return;
    }
    if (f === 'csvname') {
      const row = s.csv[Number(e.target.dataset.i)];
      if (!row) return;
      row.name = e.target.value;
      delete row.saveError;
      // Update the notes and the button in place; redrawing here would drop focus and swallow the next tap.
      const issues = csvIssues();
      issues.forEach((msg, i) => {
        const note = el.querySelector(`[data-csv-note="${i}"]`);
        if (!note) return;
        note.textContent = msg ?? '';
        note.hidden = msg === null;
      });
      const ok = issues.filter((x) => x === null).length;
      const btn = el.querySelector('button[data-act="csv-create"]');
      if (btn) {
        btn.disabled = s.busy || ok === 0;
        btn.textContent = csvLabel(ok);
      }
      return;
    }
    if (f !== 'name' && f !== 'codes') return;
    s[f === 'name' ? 'name' : 'codes'] = e.target.value;
    const n = parseCodes(s.codes).length;
    const btn = el.querySelector('button[data-act="save"]');
    if (btn) btn.disabled = s.busy || s.name.trim().length < 2 || n === 0;
    const c = el.querySelector('[data-count]');
    if (c) c.textContent = `${n} ${n === 1 ? 'code' : 'codes'}`;
  };
  el.onchange = async (e) => {
    const input = e.target;
    if (input.dataset?.act !== 'csv-files' || !input.files?.length) return;
    const chosen = Array.from(input.files).slice(0, MAX_FILES);
    s.error = input.files.length > MAX_FILES ? `Only the first ${MAX_FILES} files were used.` : null;
    const plan = [];
    for (const f of chosen) {
      if (f.size > MAX_FILE_BYTES) {
        plan.push(planFromFile({ name: f.name, error: 'This file is too big (over 1 MB). Is it only product codes?' }));
        continue;
      }
      try {
        plan.push(planFromFile({ name: f.name, text: await readText(f) }));
      } catch {
        plan.push(planFromFile({ name: f.name, error: 'This file could not be read.' }));
      }
    }
    s.csv = plan;
    draw();
  };

  async function createFromCsv() {
    const issues = csvIssues();
    s.busy = true;
    s.error = null;
    draw();
    let made = 0;
    const left = [];
    for (let i = 0; i < s.csv.length; i += 1) {
      const p = s.csv[i];
      if (issues[i] !== null) {
        left.push(p);
        continue;
      }
      try {
        await api.saveTemplate({ id: null, name: p.name.trim(), codes: p.codes });
        made += 1;
      } catch (err) {
        left.push({ ...p, saveError: friendlyError(err).message });
      }
    }
    s.csv = left;
    try {
      await load();
    } catch (err) {
      s.error = friendlyError(err).message;
    }
    s.busy = false;
    if (made > 0) toast(`${made} ${made === 1 ? 'template' : 'templates'} created.`);
    draw();
  }

  el.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'edit': {
        const t = s.list.find((x) => x.id === id);
        Object.assign(s, { editing: id, name: t.name, codes: t.codes.join('\n'), error: null });
        return draw();
      }
      case 'cancel':
        Object.assign(s, { editing: null, name: '', codes: '', error: null });
        return draw();
      case 'save':
        return run(async () => {
          await api.saveTemplate({ id: s.editing, name: s.name.trim(), codes: parseCodes(s.codes) });
          Object.assign(s, { editing: null, name: '', codes: '' });
        }, 'Template saved.');
      case 'import': {
        const r = parseTemplateImport(
          s.importText,
          s.list.map((t) => t.name),
        );
        if (r.error) {
          s.error = r.error;
          return draw();
        }
        if (r.templates.length === 0) {
          s.error = 'Nothing new to import.';
          return draw();
        }
        return run(
          async () => {
            for (const t of r.templates) await api.saveTemplate({ id: null, name: t.name, codes: t.codes });
            s.importText = '';
          },
          `${r.templates.length} ${r.templates.length === 1 ? 'template' : 'templates'} imported${r.skipped ? `, ${r.skipped} skipped` : ''}.`,
        );
      }
      case 'csv-create':
        return createFromCsv();
      case 'csv-clear':
        s.csv = [];
        s.error = null;
        return draw();
      case 'delete':
        s.confirmDelete = id;
        return draw();
      case 'delete-yes':
        return run(async () => {
          await api.deleteTemplate(id);
          s.confirmDelete = null;
        }, 'Template deleted.');
      default:
    }
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('templates', friendlyError(e).message));
  }
  draw();
}

// Daily Check List: the branch inspection report. Autosaves to the database as you type, keeps a local copy
// while offline, and can be copied, printed or e-mailed in the original layout.
import { html, render } from '../../../shared/html.js';
import { money, todayPkt } from '../../../shared/format.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/checklistApi.js';
import {
  buildEmailHtml,
  buildModel,
  buildPlainText,
  calcCustomers,
  calcLt7,
  calcStock,
  fmtNum,
  hasNum,
  pageSections,
  reportSubject,
  sectionProgress,
} from '../domain/checklist.js';
import { errorCard, loadingCard, openDialog, toast } from './parts.js';
import { printReport, reportView } from './checklistReport.js';

const TEXT = ['branch', 'prepared_by', 'designation', 'contact', 'meter_ref', 'meter_reading', 'notes'];
const NUM = [
  'lt7_zero',
  'lt7_days',
  's_receive',
  's_cashsale',
  's_cashreturn',
  's_creditsale',
  's_creditreturn',
  's_closing',
  's_homeservice',
  's_homecount',
  's_drivesales',
  's_drivecount',
  's_negstock',
  'c_cash',
  'c_panel',
];
const DRAFT = (date) => `dua.checklist.draft.${date}`;
const SAVE_DELAY = 800;
const RETRY_DELAY = 6000;

const nowTime = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

function fieldsFromDay(day) {
  const f = { report_time: String(day.report_time ?? '').slice(0, 5), lt7_date: day.lt7_date ?? '' };
  for (const k of TEXT) f[k] = day[k] ?? '';
  for (const k of NUM) f[k] = day[k] === null || day[k] === undefined ? '' : String(Number(day[k]));
  return f;
}
function newDayFields(meta) {
  const f = { report_time: nowTime(), lt7_date: '' };
  for (const k of TEXT) f[k] = '';
  for (const k of NUM) f[k] = '';
  Object.assign(f, {
    branch: meta?.branch ?? '',
    prepared_by: meta?.prepared_by ?? '',
    designation: meta?.designation ?? '',
    contact: meta?.contact ?? '',
    meter_ref: meta?.meter_ref ?? '',
  });
  return f;
}

export async function mount(el, { ctx }) {
  render(el, loadingCard());
  const perms = new Set(ctx.permissions);
  const canFill = perms.has('checklist.fill');
  const canManage = perms.has('checklist.manage');
  let template;
  let meta = null;
  try {
    template = await api.loadTemplate();
    meta = await api.lastMeta().catch(() => null);
  } catch {
    return render(el, errorCard('the check list'));
  }
  const sections = pageSections(template);
  const state = {
    date: todayPkt(),
    version: null,
    fields: {},
    answers: {},
    comp: [],
    dirty: false,
    saving: false,
    again: false,
    conflict: false,
  };
  let timer = null;

  // ── loading a day ──
  async function loadDate(date) {
    clearTimeout(timer);
    state.date = date;
    state.conflict = false;
    state.dirty = false;
    const saved = await api.getDay(date);
    state.version = saved ? saved.day.version : null;
    state.fields = saved ? fieldsFromDay(saved.day) : newDayFields(meta);
    state.answers = Object.fromEntries(template.items.filter((i) => i.active).map((i) => [i.key, i.default_value]));
    if (saved) Object.assign(state.answers, saved.answers);
    state.comp = saved
      ? saved.competitors.map((r) => r.map(String))
      : template.competitorDefaults.map((c) => [c.name, c.stock_value, c.avg_per_day, c.monthly_sales]);
    restoreDraft();
  }

  function restoreDraft() {
    let d;
    try {
      d = JSON.parse(localStorage.getItem(DRAFT(state.date)) ?? 'null');
    } catch {
      d = null;
    }
    if (!d) return;
    if (d.baseVersion === state.version && canFill) {
      Object.assign(state, { fields: d.fields, answers: { ...state.answers, ...d.answers }, comp: d.comp, dirty: true });
      queueSave();
      toast('Restored unsaved changes from this device.');
    } else {
      localStorage.removeItem(DRAFT(state.date));
    }
  }
  const persistDraft = () => {
    try {
      localStorage.setItem(
        DRAFT(state.date),
        JSON.stringify({ baseVersion: state.version, fields: state.fields, answers: state.answers, comp: state.comp }),
      );
    } catch {
      /* storage full or blocked: the server save is still tried */
    }
  };

  // ── saving ──
  function setStatus(kind, text) {
    const pill = el.querySelector('#cl-save');
    if (!pill) return;
    pill.dataset.state = kind;
    pill.querySelector('span').textContent = text;
  }
  function queueSave() {
    if (!canFill) return;
    state.dirty = true;
    persistDraft();
    setStatus('saving', 'Saving…');
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
  }
  async function save() {
    if (!canFill || !state.dirty || state.conflict) return;
    if (state.saving) {
      state.again = true;
      return;
    }
    state.saving = true;
    const date = state.date;
    const { data, error } = await api.saveDay(date, state.fields, state.answers, state.comp, state.version);
    state.saving = false;
    if (date !== state.date) return; // the person moved to another day meanwhile
    if (error) {
      if (/conflict/i.test(error.message)) {
        state.conflict = true;
        setStatus('error', 'Changed on another device');
        el.querySelector('#cl-conflict')?.removeAttribute('hidden');
      } else {
        setStatus('offline', 'Not saved yet — will retry');
        timer = setTimeout(save, RETRY_DELAY);
      }
      return;
    }
    state.version = data.version;
    if (state.again) {
      state.again = false;
      return save();
    }
    state.dirty = false;
    localStorage.removeItem(DRAFT(date));
    setStatus('saved', 'Saved');
  }
  const flush = async () => {
    clearTimeout(timer);
    if (state.dirty && !state.conflict) await save();
  };

  // ── derived figures ──
  const model = () => buildModel(template, state);
  const meta4report = () => ({
    branch: state.fields.branch,
    date: state.date,
    time: state.fields.report_time,
    preparedBy: state.fields.prepared_by,
    designation: state.fields.designation,
  });
  const ro = (id, value) => {
    const e = el.querySelector(`[data-ro="${id}"]`);
    if (e) e.value = value;
  };

  function refresh() {
    const s = calcStock(state.fields);
    ro('opening', s.hasClosing ? fmtNum(s.totalHand - Number(state.fields.s_receive || 0)) : '');
    ro('totalhand', s.hasClosing ? fmtNum(s.totalHand) : '');
    ro('returntotal', hasNum(state.fields.s_cashreturn) || hasNum(state.fields.s_creditreturn) ? fmtNum(s.ret) : '');
    ro('nettotal', hasNum(state.fields.s_cashsale) || hasNum(state.fields.s_creditsale) ? fmtNum(s.net) : '');
    ro('custtotal', hasNum(state.fields.c_cash) || hasNum(state.fields.c_panel) ? fmtNum(calcCustomers(state.fields)) : '');
    ro('lt7total', state.fields.lt7_zero !== '' || state.fields.lt7_days !== '' ? fmtNum(calcLt7(state.fields)) : '');

    const setText = (id, v) => {
      const e = el.querySelector(id);
      if (e) e.textContent = v;
    };
    setText('#snap-net', hasNum(state.fields.s_cashsale) || hasNum(state.fields.s_creditsale) ? money(s.net) : '0');
    setText('#snap-closing', s.hasClosing ? money(Number(state.fields.s_closing)) : '–');
    setText('#snap-cust', String(calcCustomers(state.fields)));
    setText('#snap-flag', String(calcLt7(state.fields)));

    let done = 0;
    for (const sec of sections) {
      const p = sectionProgress(sec, state, template);
      if (p >= 1) done++;
      el.querySelector(`#cl-sec-${sec.id}`)?.classList.toggle('done', p >= 1);
      const link = el.querySelector(`[data-jump="${sec.id}"]`);
      if (link) link.dataset.p = p >= 1 ? 'done' : p > 0 ? 'part' : 'none';
    }
    el.querySelector('#cl-fill').style.width = `${Math.round((done / sections.length) * 100)}%`;
    el.querySelector('#cl-plabel').textContent = `${done} of ${sections.length} sections complete`;
  }

  // ── markup ──
  const dis = canFill ? '' : 'disabled';
  const numInput = (key, label, extra = '') =>
    html`<div class="cl-stat ${extra}">
      <label>${label}</label
      ><input type="number" step="any" inputmode="decimal" data-f="${key}" value="${state.fields[key] ?? ''}" ${dis} />
    </div>`;
  const roInput = (id, label, extra = '') =>
    html`<div class="cl-stat ro ${extra}"><label>${label}</label><input readonly data-ro="${id}" /></div>`;
  const textItem = (label, key, type = 'text', extra = '') =>
    html`<div class="cl-item">
      <div class="cl-label">${label}</div>
      <input type="${type}" data-f="${key}" value="${state.fields[key] ?? ''}" ${extra} ${dis} />
    </div>`;

  function optionsFor(item, current) {
    const list = [...(template.dropdowns[item.dropdown_key] ?? [])];
    if (current && !list.includes(current)) list.push(current);
    return html`${item.optional || current === '' ? html`<option value="" ${current === '' ? 'selected' : ''}>—</option>` : ''}${list.map((o) => html`<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`)}`;
  }
  function itemRow(it) {
    const label = html`<div class="cl-label">${it.no ? html`<span class="cl-no">${it.no}</span>` : ''}${it.label}</div>`;
    const cur = state.answers[it.key] ?? '';
    if (it.dropdown_key) {
      return html`<div class="cl-item" data-key="${it.key}">
        ${label}
        <div class="cl-ddwrap">
          <select data-a="${it.key}" aria-label="${it.label}" ${dis}>
            ${optionsFor(it, cur)}
          </select>
          ${canManage ? html`<button type="button" class="cl-ddedit" data-act="ddedit" data-dd="${it.dropdown_key}" title="Edit this list" aria-label="Edit list for ${it.label}">✎</button>` : ''}
        </div>
      </div>`;
    }
    return html`<div class="cl-item" data-key="${it.key}">
      ${label}<input type="text" data-a="${it.key}" value="${cur}" aria-label="${it.label}" ${dis} />
    </div>`;
  }
  const itemsOf = (sec) => template.items.filter((i) => i.section_id === sec.id && i.active).sort((a, b) => a.sort - b.sort);

  function compTable() {
    return html`<div class="cl-tscroll">
        <table class="cl-table">
          <thead>
            <tr>
              <th>Pharmacy or medical store</th>
              <th>Stock value</th>
              <th>Average per day</th>
              <th>Total monthly sales</th>
            </tr>
          </thead>
          <tbody>
            ${state.comp.map(
              (r, i) =>
                html`<tr>
                  ${r.map((c, j) => html`<td><input data-c="${i},${j}" value="${c}" aria-label="Row ${i + 1} column ${j + 1}" ${dis} /></td>`)}
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${canFill ? html`<button class="btn btn-ghost" data-act="addcomp" type="button">+ Add competitor</button>` : ''}`;
  }

  function bodyOf(sec) {
    switch (sec.id) {
      case 'stocks':
        return html`<p class="muted small">Sales figures are entered by hand for now; automatic filling will come later.</p>
          <div class="cl-g2">
            ${roInput('opening', 'Opening stock (A) — worked out')}${numInput('s_receive', 'Stock receive from warehouse (B)')}
          </div>
          <div class="cl-row">${roInput('totalhand', 'Total stock in hand (A+B)')}</div>
          <div class="cl-sub"><b>Daily sales (C)</b><i>Figures already net of returns</i></div>
          <div class="cl-g2">${numInput('s_cashsale', 'Cash sale')}${numInput('s_creditsale', 'Credit sale')}</div>
          <div class="cl-sub"><b>Returns</b><i>Shown as negative in the report</i></div>
          <div class="cl-g2">
            ${numInput('s_cashreturn', 'Cash sale return', 'ref')}${numInput('s_creditreturn', 'Credit sale return', 'ref')}
          </div>
          <div class="cl-g2 gap">
            ${roInput('returntotal', 'Cash + credit return total', 'ref')}${roInput('nettotal', 'Net total (C) = Cash + Credit')}
          </div>
          <div class="cl-g2 gap">
            ${numInput('s_closing', 'Closing stock position (enter)')}${numInput('s_homeservice', 'Daily home service')}
          </div>
          <div class="cl-g3 gap">
            ${numInput('s_homecount', 'Home service no. of customers')}${numInput('s_drivesales', 'Drive thru customers sales')}${numInput('s_drivecount', 'No. of drive thru customers')}
          </div>
          <div class="cl-g3 gap">
            ${numInput('c_cash', 'Cash customers')}${numInput('c_panel', 'Panel customers')}${roInput('custtotal', 'Total number of customers')}
          </div>
          <div class="cl-row">${textItem('Current stocks negative value', 's_negstock', 'number', 'step="any" inputmode="decimal"')}</div>`;
      case 'lt7':
        return html`${textItem('Date', 'lt7_date', 'date')}
          <div class="cl-g3 gap">
            ${numInput('lt7_zero', 'Zero items')}${numInput('lt7_days', 'Less than 7 days')}${roInput('lt7total', 'Total items', 'flag')}
          </div>`;
      case 'meter':
        return html`${textItem('Meter reference number', 'meter_ref')}${textItem('Meter reading', 'meter_reading')}`;
      case 'comp':
        return html`<div id="cl-comp">${compTable()}</div>`;
      case 'notes':
        return html`<textarea data-f="notes" placeholder="Additional remarks…" aria-label="Notes" ${dis}>
${state.fields.notes ?? ''}</textarea>`;
      case 'sig':
        return html`<div class="cl-sig">
          <div><b>Prepared by</b><span id="sig-name">${state.fields.prepared_by}</span></div>
          <div><b>Designation</b><span id="sig-desig">${state.fields.designation}</span></div>
          <div><b>Branch</b><span id="sig-branch">${state.fields.branch}</span></div>
          <div><b>Date</b><span>${state.date}</span></div>
        </div>`;
      default:
        return html`${itemsOf(sec).map(itemRow)}`;
    }
  }

  function draw() {
    render(
      el,
      html` ${hero({ label: 'Daily check list', title: 'Branch Inspection Report', sub: canFill ? 'Fills in as you type. Copy, print or e-mail it when it is done.' : 'View only.' })}
        <div class="cl-toolbar">
          <span class="cl-save" id="cl-save" data-state="saved"><i></i><span>Saved</span></span>
          <div class="cl-tr">
            <button class="btn" data-act="next">↓ Next incomplete</button>
            ${canFill ? html`<button class="btn" data-act="reset">↺ Reset day</button>` : ''}
            <button class="btn" data-act="preview">👁 Preview</button><button class="btn" data-act="copy">⧉ Copy</button>
            <button class="btn" data-act="print">🖶 Print</button><button class="btn" data-act="email">✉ Email</button>
            <button class="btn btn-primary" data-act="gmail" disabled title="Coming next">✉ Send via Gmail</button>
          </div>
        </div>
        <p class="note note-error" id="cl-conflict" role="alert" hidden>
          This day was changed on another device. <button class="link" data-act="reload">Load the latest</button> (your unsaved edits on
          this device will be dropped).
        </p>
        <div class="cl-progress">
          <div class="cl-track"><div class="cl-fill" id="cl-fill"></div></div>
          <div class="cl-plabel" id="cl-plabel"></div>
        </div>
        <div class="cl-meta">
          ${[
            ['branch', 'Branch', 'text'],
            ['prepared_by', 'Prepared by', 'text'],
            ['designation', 'Designation', 'text'],
          ].map(
            ([k, l, t]) =>
              html`<div class="cl-mf"><label>${l}</label><input type="${t}" data-f="${k}" value="${state.fields[k] ?? ''}" ${dis} /></div>`,
          )}
          <div class="cl-mf"><label>Date</label><input type="date" id="cl-date" value="${state.date}" max="${todayPkt()}" /></div>
          <div class="cl-mf">
            <label>Time</label><input type="time" data-f="report_time" value="${state.fields.report_time ?? ''}" ${dis} />
          </div>
          <div class="cl-mf"><label>Contact</label><input type="text" data-f="contact" value="${state.fields.contact ?? ''}" ${dis} /></div>
        </div>
        <div class="cl-wrap">
          <nav class="cl-rail" aria-label="Checklist sections">
            <div class="cl-rail-title">Jump to</div>
            ${sections.map((s) => html`<button type="button" class="cl-rail-link" data-jump="${s.id}" data-p="none"><i></i><span class="rn">${s.number_label}</span><span>${s.title}</span></button>`)}
          </nav>
          <div class="cl-main">
            ${sections.map(
              (s) =>
                html`<section class="cl-sec" id="cl-sec-${s.id}">
                  <div class="cl-sec-head">
                    <span class="cl-num">${s.number_label}</span>
                    <h2>${s.title}</h2>
                    <span class="cl-tick">✓</span>
                  </div>
                  <div class="cl-body">${bodyOf(s)}</div>
                </section>`,
            )}
          </div>
        </div>
        <div class="cl-snap">
          <div><span>Net sales</span><b id="snap-net">0</b></div>
          <div><span>Closing stock</span><b id="snap-closing">–</b></div>
          <div><span>Customers</span><b id="snap-cust">0</b></div>
          <div><span>Flagged items &lt;7d</span><b id="snap-flag">0</b></div>
        </div>`,
    );
    refresh();
    setStatus(state.dirty ? 'saving' : 'saved', state.dirty ? 'Saving…' : state.version ? 'Saved' : 'New day');
  }

  // ── events ──
  const bind = (t) => {
    if (t.dataset.f !== undefined) state.fields[t.dataset.f] = t.value;
    else if (t.dataset.a !== undefined) state.answers[t.dataset.a] = t.value;
    else if (t.dataset.c !== undefined) {
      const [i, j] = t.dataset.c.split(',').map(Number);
      state.comp[i][j] = t.value;
    } else return false;
    return true;
  };
  const onEdit = (e) => {
    if (!canFill || !bind(e.target)) return;
    const f = e.target.dataset.f;
    if (f === 'prepared_by') el.querySelector('#sig-name').textContent = e.target.value;
    if (f === 'designation') el.querySelector('#sig-desig').textContent = e.target.value;
    if (f === 'branch') el.querySelector('#sig-branch').textContent = e.target.value;
    refresh();
    queueSave();
  };
  el.addEventListener('input', onEdit);
  el.addEventListener('change', async (e) => {
    if (e.target.id === 'cl-date' && e.target.value) {
      await flush();
      await loadDate(e.target.value > todayPkt() ? todayPkt() : e.target.value);
      draw();
    } else if (e.target.tagName === 'SELECT') onEdit(e);
  });

  async function log(channel) {
    if (state.version) api.logSend(state.date, channel).catch?.(() => {});
  }
  async function copyReport() {
    await flush();
    const m = model();
    const htmlText = buildEmailHtml(m);
    const text = buildPlainText(m);
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlText], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
        toast('Copied — paste into Gmail to keep the formatting');
        return log('copy');
      } catch {
        /* fall through to plain text */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied as plain text');
      log('copy');
    } catch {
      toast('Copy failed. Use Preview and copy by hand.', 'error');
    }
  }

  function ddEditor(key) {
    const dlg = openDialog(
      html`<h2>Edit list</h2>
        <p class="muted small">One option per line, at least 3. Shared by everyone who uses the check list.</p>
        <textarea id="dd-text" rows="8" class="cl-dd-text">${(template.dropdowns[key] ?? []).join('\n')}</textarea>
        <div class="actions-bar">
          <button class="btn btn-primary" data-dd-save>Save list</button><button class="btn" data-close>Cancel</button>
        </div>`,
      { label: 'Edit dropdown list' },
    );
    dlg.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-dd-save]')) return;
      const list = dlg
        .querySelector('#dd-text')
        .value.split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      const { error } = await api.setDropdown(key, list);
      if (error) return toast(/at least 3/.test(error.message) ? 'Add at least 3 options.' : 'Could not save the list.', 'error');
      template.dropdowns = (await api.loadTemplate()).dropdowns;
      dlg.close();
      draw();
      toast('List saved');
    });
  }

  el.addEventListener('click', async (e) => {
    const j = e.target.closest('[data-jump]');
    if (j) return el.querySelector(`#cl-sec-${j.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'next': {
        const s = sections.find((x) => sectionProgress(x, state, template) < 1);
        if (s) el.querySelector(`#cl-sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else toast('Every section is complete.');
        break;
      }
      case 'copy':
        return copyReport();
      case 'preview':
        return openDialog(
          html`<div class="rpt-wrap">${reportView(model(), meta4report())}</div>
            <div class="actions-bar"><button class="btn" data-close>Close</button></div>`,
          { label: 'Report preview' },
        );
      case 'print':
        await flush();
        printReport(model(), meta4report());
        return log('print');
      case 'email':
        await flush();
        location.href = `mailto:?subject=${encodeURIComponent(reportSubject(state.fields.branch, state.date))}&body=${encodeURIComponent(buildPlainText(model()))}`;
        return log('email');
      case 'reset':
        if (!window.confirm("Clear this day's saved check list and start from the defaults? This cannot be undone.")) return;
        clearTimeout(timer);
        state.dirty = false;
        localStorage.removeItem(DRAFT(state.date));
        if (state.version) {
          const { error } = await api.resetDay(state.date);
          if (error) return toast('Could not reset the day.', 'error');
        }
        await loadDate(state.date);
        draw();
        return toast('Day reset');
      case 'reload':
        localStorage.removeItem(DRAFT(state.date));
        await loadDate(state.date);
        return draw();
      case 'addcomp':
        state.comp.push(['', '', '', '']);
        render(el.querySelector('#cl-comp'), compTable());
        refresh();
        return queueSave();
      case 'ddedit':
        return ddEditor(b.dataset.dd);
      default:
    }
  });

  try {
    await loadDate(state.date);
  } catch {
    return render(el, errorCard('the check list'));
  }
  draw();
}

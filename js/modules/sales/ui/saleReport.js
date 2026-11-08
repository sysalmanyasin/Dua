// Sale Report: pick a date, add Till Short and Patty Cash, then print, copy or send the day's report.
import { html, render } from '../../../shared/html.js';
import { monthLabel, money, todayPkt } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import { hero } from '../../../shared/ui.js';
import { openMailDialog } from '../../../shared/mailDialog.js';
import * as api from '../data/api.js';
import { parseAmount } from '../../../shared/format.js';
import {
  ROW_CATALOG,
  buildEmailHtml,
  buildPlainText,
  buildReport,
  dayFigures,
  reportSubject,
  targetProgress,
} from '../domain/saleReport.js';
import { errorCard, loadingCard, openDialog, toast } from './parts.js';
import { printSaleReport, saleReportView } from './saleReportView.js';

const HIDDEN_PREF = 'sale_report.hidden';

export async function mount(el, { ctx }) {
  render(el, loadingCard());
  const canTarget = ctx.permissions.includes('targets.manage');
  let methods;
  let latest;
  let hidden = new Set();
  try {
    [methods, latest] = await Promise.all([api.listMethods(), api.latestDay()]);
    hidden = new Set((await api.getPref(HIDDEN_PREF).catch(() => null)) ?? []);
  } catch {
    return render(el, errorCard('the sale report'));
  }
  const state = {
    date: latest?.business_date ?? todayPkt(),
    day: null,
    lines: [],
    till: '',
    patty: '',
    target: null,
    collected: 0,
    loading: false,
  };

  const figures = () => dayFigures(state.day, state.lines, methods);
  const report = () => buildReport(figures(), { till: parseAmount(state.till) || 0, patty: parseAmount(state.patty) || 0, hidden });
  const rctx = () => ({ branch: BRAND.branch, date: state.date });

  async function loadDay() {
    state.loading = true;
    draw();
    try {
      const { day, lines } = await api.getDay(state.date);
      state.day = day;
      state.lines = lines;
      [state.target, state.collected] = await Promise.all([api.getTarget(state.date), api.monthTotal(state.date)]);
    } catch {
      toast('Could not load that day.', 'error');
    }
    state.loading = false;
    draw();
  }

  function targetCard() {
    const p = targetProgress(state.target, state.collected);
    return html`<section class="card">
      <h2>Monthly target</h2>
      <p class="small muted">${monthLabel(`${state.date.slice(0, 7)}-01`)}</p>
      ${
        p
          ? html`<p>Target: <strong>₨${money(state.target)}</strong></p>
              <p>Collected: <strong>₨${money(state.collected)}</strong></p>
              <p class="tg tg-${p.tone}">${p.pct}% achieved</p>
              <div class="kpbar"><div class="kpfill ${p.tone}" data-w="${p.pct}"></div></div>
              <p class="small muted">Remaining: ₨${money(p.remaining)}</p>`
          : html`<p class="muted">No target set for this month.</p>`
      }
      ${canTarget ? html`<button class="btn btn-ghost btn-sm" data-act="target">${p ? 'Change target' : 'Set target'}</button>` : ''}
    </section>`;
  }

  function draw() {
    const have = Boolean(state.day);
    render(
      el,
      html` ${hero({ label: 'Daily sale report', title: 'Auto-Fill Report Generator', sub: 'Pick a date from the calendar — every field fills in by itself. Add Till Short and Patty Cash, then print.' })}
        <div class="sr-layout">
          <div class="sr-side">
            <section class="card">
              <h2>Select date</h2>
              <label class="field"
                ><span>Select date (Apr 2020 – present)</span
                ><input type="date" id="sr-date" value="${state.date}" min="2020-04-01" max="${todayPkt()}"
              /></label>
              <label class="field"
                ><span>Till short (manual entry)</span><input id="sr-till" inputmode="decimal" placeholder="0" value="${state.till}"
              /></label>
              <label class="field"
                ><span>Patty cash (manual entry)</span><input id="sr-patty" inputmode="decimal" placeholder="0" value="${state.patty}"
              /></label>
              <div class="sr-buttons">
                <button class="btn btn-primary" data-act="print" ${have ? '' : 'disabled'}>🖶 Print Report</button>
                <button class="btn" data-act="copy" ${have ? '' : 'disabled'}>⧉ Copy</button>
                <button class="btn" data-act="gmail" ${have ? '' : 'disabled'}>✉ Send via Gmail</button>
                <button class="btn" data-act="rows">⚙ Customize Rows</button>
              </div>
            </section>
            ${targetCard()}
          </div>
          <section class="card sr-card" id="sr-card">
            ${state.loading ? html`<p class="muted">Loading…</p>` : have ? saleReportView(report(), rctx()) : html`<p class="note note-error">Record not found for this date.</p>`}
          </section>
        </div>`,
    );
    // The page's security policy blocks inline style attributes, so the bar widths are set from here.
    el.querySelectorAll('.kpfill[data-w]').forEach((b) => (b.style.width = `${b.dataset.w}%`));
  }

  function sendReport() {
    const rep = report();
    openMailDialog({
      subject: reportSubject(BRAND.branch, state.date),
      html: buildEmailHtml(rep, rctx()),
      text: buildPlainText(rep, rctx()),
      openDialog,
      toast,
    });
  }

  async function copyReport() {
    const rep = report();
    const htmlText = buildEmailHtml(rep, rctx());
    const text = buildPlainText(rep, rctx());
    if (window.ClipboardItem && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlText], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
        return toast('Copied — paste keeps the formatting');
      } catch {
        /* fall through to plain text */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied as plain text');
    } catch {
      toast('Copy failed.', 'error');
    }
  }

  function rowManager() {
    const custom = methods.filter((m) => m.code.startsWith('c_') && m.sign !== 'none');
    const groups = {
      'Cash Sale': [...ROW_CATALOG['Cash Sale'], ...custom.filter((m) => m.section !== 'Credit Clients').map((m) => [m.code, m.label])],
      'Credit Sale': [...ROW_CATALOG['Credit Sale'], ...custom.filter((m) => m.section === 'Credit Clients').map((m) => [m.code, m.label])],
      Other: ROW_CATALOG.Other,
    };
    const dlg = openDialog(
      html`<h2>Customize rows</h2>
        <p class="muted small">
          Untick a row to hide it from the report, print and copy. Totals are never affected, only what is shown. Saved for you on every
          device.
        </p>
        ${Object.entries(groups).map(
          ([title, rows]) =>
            html`<h3>${title}</h3>
              ${rows.map(([id, label]) => html`<label class="rm-row"><span>${label}</span><input type="checkbox" data-row="${id}" ${hidden.has(id) ? '' : 'checked'} /></label>`)}`,
        )}
        <div class="actions-bar">
          <button class="btn" data-reset>Show all rows</button><button class="btn btn-primary" data-close>Done</button>
        </div>`,
      { label: 'Customize rows' },
    );
    const persist = async () => {
      const { error } = await api.setPref(HIDDEN_PREF, [...hidden]);
      if (error) toast('Could not save this choice.', 'error');
    };
    dlg.addEventListener('change', (e) => {
      const c = e.target.closest('input[data-row]');
      if (!c) return;
      if (c.checked) hidden.delete(c.dataset.row);
      else hidden.add(c.dataset.row);
      draw();
      persist();
    });
    dlg.addEventListener('click', (e) => {
      if (!e.target.closest('[data-reset]')) return;
      hidden.clear();
      dlg.querySelectorAll('input[data-row]').forEach((c) => (c.checked = true));
      draw();
      persist();
    });
  }

  function targetDialog() {
    const dlg = openDialog(
      html`<h2>Monthly target</h2>
        <p class="muted small">${monthLabel(`${state.date.slice(0, 7)}-01`)}</p>
        <label class="field"><span>Target (rupees)</span><input id="tg-input" inputmode="numeric" value="${state.target ?? ''}" /></label>
        <div class="actions-bar">
          <button class="btn btn-primary" data-tg-save>Save</button
          >${state.target ? html`<button class="btn" data-tg-clear>Remove</button>` : ''}<button class="btn" data-close>Cancel</button>
        </div>`,
      { label: 'Monthly target' },
    );
    dlg.addEventListener('click', async (e) => {
      const save = e.target.closest('[data-tg-save]');
      const clear = e.target.closest('[data-tg-clear]');
      if (!save && !clear) return;
      const v = clear ? null : parseAmount(dlg.querySelector('#tg-input').value);
      if (save && (v === null || Number.isNaN(v) || v <= 0)) return toast('Enter a target above zero.', 'error');
      const { error } = await api.setTarget(state.date, v);
      if (error) return toast('Could not save the target.', 'error');
      dlg.close();
      state.target = v;
      draw();
      toast('Target saved');
    });
  }

  el.addEventListener('input', (e) => {
    if (e.target.id === 'sr-till') state.till = e.target.value;
    else if (e.target.id === 'sr-patty') state.patty = e.target.value;
    else return;
    // only the report card changes while typing, so the cursor stays in the box
    render(
      el.querySelector('#sr-card'),
      state.day ? saleReportView(report(), rctx()) : html`<p class="note note-error">Record not found for this date.</p>`,
    );
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'sr-date' && e.target.value) {
      state.date = e.target.value;
      loadDay();
    }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'print') printSaleReport(report(), rctx());
    else if (b.dataset.act === 'copy') copyReport();
    else if (b.dataset.act === 'gmail') sendReport();
    else if (b.dataset.act === 'rows') rowManager();
    else if (b.dataset.act === 'target') targetDialog();
  });

  await loadDay();
}

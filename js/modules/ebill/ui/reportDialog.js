// Reports and exports (managers and people given the export right): date-wise totals on screen, then CSV, Excel or PDF to take away.
// Honest by design: invoices that are still only on this device (waiting or failed) are NOT on the server, so they are not in the
// report. The window says so in words, offers to upload them, and the exported files carry the same warning.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { csvOf, dailyTable, invoiceTable, pdfOf, reportFileName, xlsxOf } from '../domain/reportFile.js';

const m2 = (v) => money(v, { decimals: true });
const pkDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(iso));

function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Invoices on this device, in the date range, that the server does not have yet. */
export async function unsentOnDevice(store, from, to) {
  const all = await store.allInvoices().catch(() => []);
  const here = all.filter((r) => r.status !== 'synced' && (!from || pkDay(r.created_at) >= from) && (!to || pkDay(r.created_at) <= to));
  return { waiting: here.filter((r) => r.status === 'pending').length, failed: here.filter((r) => r.status === 'failed').length };
}

/** The warning sentences for a report (shown on screen, and written into the Excel notes and the PDF). */
export function reportWarnings({ unsent, report }) {
  const out = [];
  const n = unsent.waiting + unsent.failed;
  if (n)
    out.push(
      `${n} invoice${n === 1 ? '' : 's'} on this device ${n === 1 ? 'has' : 'have'} not reached the server (${unsent.waiting} waiting, ${unsent.failed} failed) and ${n === 1 ? 'is' : 'are'} NOT included. Upload ${n === 1 ? 'it' : 'them'} first for complete figures.`,
    );
  if (report?.truncated)
    out.push(
      `Only the first ${report.rows.length} of ${report.total_invoices} invoices are listed in the files. The totals cover all ${report.total_invoices}.`,
    );
  return out;
}

/**
 * @param {{ host: HTMLElement, api: { report: Function }, store: { allInvoices: Function }, sync: { syncNow: Function },
 *           filters: { from: string, to: string, text?: string, status?: string, mode?: string }, onClose?: () => void }} o
 */
export function openReport({ host, api, store, sync, filters, onClose }) {
  let report = null;
  let unsent = { waiting: 0, failed: 0 };
  let error = '';
  let loading = true;
  let uploading = false;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    host.replaceChildren();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const filterWords = () =>
    [filters.status && `status ${filters.status}`, filters.mode && `payment ${filters.mode}`, filters.text && `search “${filters.text}”`]
      .filter(Boolean)
      .join(', ');

  async function load() {
    loading = true;
    error = '';
    draw();
    if (!filters.from || !filters.to) {
      error = 'Choose both a From and a To date first.';
      loading = false;
      return draw();
    }
    try {
      [report, unsent] = await Promise.all([api.report(filters), unsentOnDevice(store, filters.from, filters.to)]);
    } catch (e) {
      report = null;
      error = /400 days/.test(e?.message || '')
        ? 'Choose a date range of up to 400 days.'
        : navigator.onLine === false
          ? 'Reports need a connection to the server.'
          : e?.message || 'The report could not be made. Try again.';
    }
    loading = false;
    draw();
  }

  const warnings = () => (report ? reportWarnings({ unsent, report }) : []);
  const incomplete = () => unsent.waiting + unsent.failed > 0;

  function download(kind) {
    const { from, to } = filters;
    const tag = incomplete() ? '-INCOMPLETE' : '';
    if (kind === 'csv-daily') saveBlob(reportFileName(`daily-totals${tag}`, from, to, 'csv'), csvOf(dailyTable(report)));
    else if (kind === 'csv-invoices') saveBlob(reportFileName(`invoices${tag}`, from, to, 'csv'), csvOf(invoiceTable(report)));
    else if (kind === 'xlsx') saveBlob(reportFileName(`report${tag}`, from, to, 'xlsx'), xlsxOf(report, warnings()));
    else if (kind === 'pdf') {
      const printedAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(),
      );
      saveBlob(
        reportFileName(`report${tag}`, from, to, 'pdf'),
        pdfOf(report, { from, to, filters: filterWords(), printedAt, warning: warnings()[0] }),
      );
    }
  }

  async function uploadNow() {
    uploading = true;
    draw();
    try {
      await sync.syncNow();
    } catch {
      /* the counts below say what is still waiting */
    }
    uploading = false;
    await load();
  }

  function draw() {
    const w = warnings();
    render(
      host,
      html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Report and export">
        <div class="eb-dlg eb-detail eb-report">
          <div class="eb-dlg-head">
            <h2>Report and export</h2>
            <span class="eb-grow"></span><button type="button" class="btn btn-sm" data-rp="close">Close</button>
          </div>
          <p class="muted">
            ${filters.from || '…'} to ${filters.to || '…'}${filterWords() ? ` · ${filterWords()}` : ''}. Uses the dates and filters chosen
            on the History page.
          </p>
          ${loading ? html`<p class="muted" role="status">${uploading ? 'Uploading…' : 'Making the report…'}</p>` : ''}
          ${error ? html`<p class="note note-error" role="alert">${error}</p>` : ''}
          ${
            w.length
              ? html`<div class="note note-error eb-report-warn" role="alert">
                  ${w.map((x) => html`<p><b>Warning:</b> ${x}</p>`)}
                  ${
                    unsent.waiting + unsent.failed && navigator.onLine !== false
                      ? html`<button type="button" class="btn btn-sm" data-rp="upload" ${uploading ? 'disabled' : ''}>Upload now</button>`
                      : ''
                  }
                  <p class="muted">Invoices still waiting on other devices are not included either.</p>
                </div>`
              : ''
          }
          ${
            report && !loading
              ? html`<dl class="eb-totals eb-report-totals">
                    <div>
                      <dt>Invoices</dt>
                      <dd>${report.totals.count}</dd>
                    </div>
                    <div>
                      <dt>Gross</dt>
                      <dd>${m2(report.totals.gross)}</dd>
                    </div>
                    <div>
                      <dt>Discounts</dt>
                      <dd>${m2(report.totals.discounts)}</dd>
                    </div>
                    <div>
                      <dt>Net</dt>
                      <dd>${m2(report.totals.net)}</dd>
                    </div>
                    <div>
                      <dt>Refunded</dt>
                      <dd>${m2(report.totals.refunded)}</dd>
                    </div>
                    <div>
                      <dt><b>Net after refunds</b></dt>
                      <dd><b>${m2(report.totals.net_after_refunds)}</b></dd>
                    </div>
                  </dl>
                  <div class="eb-table-wrap">
                    <table class="eb-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th class="num">Invoices</th>
                          <th class="num">Net</th>
                          <th class="num">Refunded</th>
                          <th class="num">After refunds</th>
                          <th class="num">Cash</th>
                          <th class="num">Card</th>
                          <th class="num">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${
                          report.days.length
                            ? report.days.map(
                                (d) =>
                                  html`<tr data-day="${d.date}">
                                    <td>${d.date}</td>
                                    <td class="num">${d.count}</td>
                                    <td class="num">${m2(d.net)}</td>
                                    <td class="num">${m2(d.refunded)}</td>
                                    <td class="num">${m2(d.net_after_refunds)}</td>
                                    <td class="num">${m2(d.by_mode?.Cash || 0)}</td>
                                    <td class="num">${m2(d.by_mode?.Card || 0)}</td>
                                    <td class="num">${m2(d.by_mode?.Credit || 0)}</td>
                                  </tr>`,
                              )
                            : html`<tr>
                                <td colspan="8" class="muted eb-empty">No invoices in this range.</td>
                              </tr>`
                        }
                      </tbody>
                    </table>
                  </div>
                  <div class="eb-ask-actions eb-report-actions">
                    <button type="button" class="btn" data-dl="csv-daily">CSV: daily totals</button>
                    <button type="button" class="btn" data-dl="csv-invoices">CSV: invoices</button>
                    <button type="button" class="btn" data-dl="xlsx">Excel</button>
                    <button type="button" class="btn btn-primary" data-dl="pdf">PDF</button>
                  </div>`
              : ''
          }
        </div>
      </div>`,
    );
    host.querySelector('.eb-modal').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.rp === 'close') close();
      else if (b.dataset.rp === 'upload') uploadNow();
      else if (b.dataset.dl && report) download(b.dataset.dl);
    });
  }

  load();
  return close;
}

// The receipt settings form (managers): shop name, address and licence, tax number, POS number, terms, paper width, how many copies,
// what is shown, and an optional logo. A live preview shows the slip as it will print, and a test slip can be printed.
// Saving is one database call that checks the right again and keeps the reason and the old values.
import { html, render } from '../../../shared/html.js';
import { buildReceipt, DEFAULT_RECEIPT, normalizeReceiptSettings, RECEIPT_TYPES } from '../domain/receipt.js';
import { printReceipts, receiptHtml } from './receiptPrint.js';

const SAMPLE = {
  no: 'EB-261119-00001',
  time: '2026-11-19T17:26:19Z',
  staff: 'Sample Staff',
  customer: '',
  mode: 'Cash',
  local: false,
  lines: [{ code: 'P1', name: 'Panadol 500mg Tab 200’s', generic: 'Paracetamol', unit: 'unit', qty: 7, rate: 3.81, total: 26.67 }],
  gross: 26.67,
  customerDiscount: 0,
  receiptDiscount: 0,
  tax: 0,
  adjustment: 0,
  net: 26.67,
  cash: 30,
  refunded: 0,
};
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const LOGO_MAX = 100 * 1024;
const msg = (e) => e?.message || 'Something went wrong. Try again.';

const TEXT = [
  ['slip_title', 'Slip title', 40, 'Purchase Slip'],
  ['shop_name', 'Shop name', 80, "FAZAL DIN'S PHARMA PLUS"],
  ['tax_no', 'STN / NTN number', 40, '0870213-3'],
  ['pos_no', 'POS number', 40, 'shown as POS NO on the slip'],
  ['phone', 'Phone (optional)', 40, ''],
];

/**
 * @param {HTMLElement} host
 * @param {{ api: { getReceipt: Function, setReceipt: Function }, say: (text: string, kind?: string) => void }} deps
 */
export async function mountReceiptForm(host, { api, say }) {
  let rc = normalizeReceiptSettings(null);
  let reason = 'Receipt details updated';
  let busy = false;
  let loadError = '';
  try {
    rc = normalizeReceiptSettings(await api.getReceipt());
  } catch (e) {
    loadError = msg(e);
  }

  const model = () => buildReceipt(SAMPLE, rc, { type: rc.receipt_type });
  const drawPreview = () => {
    const box = host.querySelector('#rc-preview');
    if (box) render(box, receiptHtml(model()));
  };

  function draw() {
    render(
      host,
      html`<section class="ebs-rc">
        <h2>Receipt</h2>
        <p class="muted">
          What is printed on the customer’s slip. Billing staff only read these; changes are kept with a reason. The preview shows a sample
          bill.
        </p>
        ${loadError ? html`<p class="note note-error" role="alert">Could not load the current receipt settings: ${loadError}</p>` : ''}
        <div class="ebs-rc-grid">
          <div class="ebs-rc-form">
            ${TEXT.map(
              ([k, label, max, hint]) =>
                html`<label class="field"
                  ><span>${label}</span
                  ><input data-k="${k}" type="text" maxlength="${max}" value="${rc[k]}" placeholder="${hint}" autocomplete="off"
                /></label>`,
            )}
            <label class="field"
              ><span>Address and licence (one line per row)</span
              ><textarea data-k="address" rows="3" maxlength="200" placeholder="Shop address&#10;Drug Sales Licence No. ...">
${rc.address}</textarea>
            </label>
            <label class="field"
              ><span>Terms at the bottom (one line per row)</span
              ><textarea data-k="footer" rows="5" maxlength="400" placeholder="Thank you for your visit">${rc.footer}</textarea>
            </label>
            <div class="ebs-rc-row">
              <label class="field"
                ><span>Paper width</span
                ><select data-k="width_mm">
                  <option value="80" ${rc.width_mm === 80 ? 'selected' : ''}>80 mm</option>
                  <option value="58" ${rc.width_mm === 58 ? 'selected' : ''}>58 mm</option>
                </select></label
              >
              <label class="field"
                ><span>Usual receipt type</span
                ><select data-k="receipt_type">
                  ${RECEIPT_TYPES.map((t) => html`<option ${t === rc.receipt_type ? 'selected' : ''}>${t}</option>`)}
                </select></label
              >
              <label class="field"
                ><span>Copies (1 to 5)</span
                ><input data-k="copies" type="number" min="1" max="5" step="1" value="${rc.copies}" inputmode="numeric"
              /></label>
            </div>
            <label class="eb-check"
              ><input data-k="auto_print" type="checkbox" ${rc.auto_print ? 'checked' : ''} /> Print automatically after saving a
              bill</label
            >
            <label class="eb-check"
              ><input data-k="show_customer" type="checkbox" ${rc.show_customer ? 'checked' : ''} /> Show the customer name</label
            >
            <label class="eb-check"
              ><input data-k="show_staff" type="checkbox" ${rc.show_staff ? 'checked' : ''} /> Show who served the customer</label
            >
            <label class="eb-check"
              ><input data-k="show_generic" type="checkbox" ${rc.show_generic ? 'checked' : ''} /> Show the generic name under each
              product</label
            >
            <div class="field">
              <span>Logo (optional, PNG, JPEG, WebP or GIF, up to 100 KB)</span>
              <div class="ebs-rc-logo">
                ${rc.logo ? html`<img src="${rc.logo}" alt="Current logo" /><button type="button" class="btn btn-sm" data-act="rm-logo">Remove logo</button>` : html`<span class="muted">No logo</span>`}
                <input data-act="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose a logo" />
              </div>
            </div>
            <label class="field"
              ><span>Reason for the change (required)</span><input data-f="reason" type="text" value="${reason}" autocomplete="off"
            /></label>
            <div class="ebs-rc-actions">
              <button type="button" class="btn btn-primary" data-act="save" ${busy ? 'disabled' : ''}>Save receipt settings</button>
              <button type="button" class="btn" data-act="test">Print a test slip</button>
              <button type="button" class="btn btn-sm" data-act="reset">Back to plain defaults</button>
            </div>
          </div>
          <div class="ebs-rc-side">
            <h3>Preview</h3>
            <div class="eb-rc-preview" id="rc-preview" aria-label="Receipt preview"></div>
          </div>
        </div>
      </section>`,
    );
    drawPreview();
  }

  const readField = (el) => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') rc[k] = el.checked;
    else if (k === 'width_mm' || k === 'copies') rc[k] = Number(el.value);
    else rc[k] = el.value;
  };
  host.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset?.f === 'reason') reason = t.value;
    else if (t.dataset?.k) {
      readField(t);
      drawPreview();
    }
  });
  host.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset?.k) {
      readField(t);
      drawPreview();
    } else if (t.dataset?.act === 'logo' && t.files?.[0]) {
      const f = t.files[0];
      if (!LOGO_TYPES.includes(f.type)) return say('The logo must be a PNG, JPEG, WebP or GIF picture.', 'error');
      if (f.size > LOGO_MAX) return say('That logo is too big. Use a picture under 100 KB.', 'error');
      const url = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      }).catch(() => '');
      if (!url) return say('That picture could not be read.', 'error');
      rc.logo = url;
      say('');
      draw();
    }
  });
  host.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'rm-logo') {
      rc.logo = '';
      draw();
    } else if (a === 'reset') {
      rc = { ...DEFAULT_RECEIPT, logo: rc.logo };
      draw();
    } else if (a === 'test') {
      await printReceipts([model()]);
    } else if (a === 'save') {
      if (busy) return;
      const why = reason.trim();
      if (why.length < 3) return say('Please give a reason for the change (at least 3 letters).', 'error');
      const c = Math.trunc(Number(rc.copies));
      if (!(c >= 1 && c <= 5)) return say('Copies must be a whole number from 1 to 5.', 'error');
      busy = true;
      say('');
      try {
        rc = normalizeReceiptSettings(await api.setReceipt(normalizeReceiptSettings(rc), why));
        say('Receipt settings saved.', 'info');
      } catch (err) {
        const m = msg(err);
        say(
          /unknown receipt setting/i.test(m)
            ? 'The database still needs its receipt update (migration 0642) before the slip fields can be saved. Ask the developer to apply it.'
            : m,
          'error',
        );
      }
      busy = false;
      draw();
    }
  });

  draw();
}

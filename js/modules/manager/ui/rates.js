// The dialog for changing a rate. Used by every page that shows a rate. A change needs the rates key and a reason, applies only to
// months that have not started saving yet, and is logged.
import { html } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { rateFromPercent } from '../domain/salary.js';
import { newKey, openDialog, toast } from './parts.js';

export function openRateDialog({ rateKey, label, current, onSaved }) {
  const dlg = openDialog(
    html`<h2>Change the ${label} rate</h2>
      <p class="muted small">
        Applies to months that have not started saving yet. A month already started keeps its own rate. The change is logged with your
        reason.
      </p>
      <label class="field"
        ><span>New rate (%)</span><input id="r-pct" inputmode="decimal" value="${Number((Number(current) * 100).toFixed(3))}"
      /></label>
      <label class="field"><span>Reason</span><input id="r-reason" maxlength="200" /></label>
      <small class="err" id="r-err" hidden></small>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button
        ><button type="button" class="btn btn-primary" data-ok>Save rate</button>
      </div>`,
    { label: `Change the ${label} rate` },
  );
  dlg.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-ok]')) return;
    const err = (t) => {
      const box = dlg.querySelector('#r-err');
      box.textContent = t;
      box.hidden = false;
    };
    const raw = dlg.querySelector('#r-pct').value.replace(/[%\s]/g, '');
    const pct = Number(raw);
    const reason = dlg.querySelector('#r-reason').value.trim();
    if (raw === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) return err('Enter a percentage from 0 to 100.');
    if (reason.length < 3) return err('Please give a short reason.');
    const { error } = await api.rateSet(rateKey, rateFromPercent(pct), reason, newKey());
    if (error) return err(error.message || 'Could not save.');
    dlg.close();
    toast('Rate saved');
    onSaved?.();
  });
  return dlg;
}

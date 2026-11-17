// Balance Tally: a daily count of the accounts, against what the "expense app" says. The Jazz Cash ledger balance (money held) is
// counted automatically. Counting a date again adds a revision and needs a reason; the old count stays.
import { html, render } from '../../../shared/html.js';
import { money, parseAmount, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { tallyDifference, tallyTotal } from '../domain/ledger.js';
import { askReason, askText, confirmDialog, errorCard, isBadNumber, loadingCard, newKey, toast, typedNumber } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });
const asText = (n) => (Number(n) ? String(n) : '');

export async function mountTally(host) {
  const today = todayPkt();
  const state = {
    date: today,
    accounts: null,
    snap: null,
    history: [],
    amounts: {},
    app: '',
    key: null,
    error: false,
    snapshotAmounts: {},
    snapshotApp: '',
  };

  async function load() {
    try {
      const [accounts, snap, history] = await Promise.all([api.tallyAccounts(), api.tallyGet(state.date), api.tallyList(30)]);
      state.accounts = accounts;
      state.snap = snap;
      state.history = history;
      state.amounts = Object.fromEntries(
        accounts.map((a) => [a.account_id, asText(snap.accounts.find((x) => x.account_id === a.account_id)?.amount)]),
      );
      state.app = asText(snap.app_total);
      state.snapshotAmounts = { ...state.amounts };
      state.snapshotApp = state.app;
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  const calc = () => {
    const total = tallyTotal(
      state.snap.ledger_balance,
      state.accounts.map((a) => typedNumber(parseAmount, state.amounts[a.account_id])),
    );
    return { total, diff: tallyDifference(total, typedNumber(parseAmount, state.app)) };
  };
  const isDirty = () =>
    state.accounts && (JSON.stringify(state.amounts) !== JSON.stringify(state.snapshotAmounts) || state.app !== state.snapshotApp);

  function paint() {
    if (state.error) return render(host, errorCard('the tally'));
    if (!state.accounts || !state.snap) return render(host, loadingCard());
    const { total, diff } = calc();
    const s = state.snap;
    render(
      host,
      html`<div class="card">
          <div class="fields">
            <label class="field"><span>Date</span><input type="date" data-date value="${state.date}" max="${today}" /></label>
          </div>
          <p class="small muted">
            ${s.has_snapshot ? `Counted before (revision ${s.revision}). Changing it adds a revision and needs a reason.` : 'Not counted yet for this date.'}
          </p>
        </div>
        <div class="card">
          <table class="table">
            <tbody>
              <tr>
                <td>Jazz Cash ledger (money held)</td>
                <td class="num">${m(s.ledger_balance)}</td>
              </tr>
            </tbody>
          </table>
          ${s.has_snapshot && Number(s.ledger_balance) !== Number(s.live_ledger_balance) ? html`<p class="small muted">The ledger now says ${m(s.live_ledger_balance)} for this date; the count keeps what it was.</p>` : ''}
          <div class="fields">
            ${state.accounts.map(
              (a) =>
                html`<label class="field"
                  ><span>${a.name}</span>
                  <input data-acc="${a.account_id}" value="${state.amounts[a.account_id]}" inputmode="decimal" placeholder="0" />
                  <button type="button" class="link" data-act="retire" data-id="${a.account_id}">stop using</button></label
                >`,
            )}
          </div>
          <p class="small"><button type="button" class="link" data-act="addacc">+ Add account</button></p>
        </div>
        <div class="card">
          <div class="fields">
            <label class="field"
              ><span>What the expense app says</span><input data-app value="${state.app}" inputmode="decimal" placeholder="0"
            /></label>
          </div>
          <table class="table">
            <tbody>
              <tr>
                <td><strong>Total counted</strong></td>
                <td class="num"><strong data-total>${m(total)}</strong></td>
              </tr>
              <tr>
                <td>Difference</td>
                <td class="num">
                  <span data-diff>${m(Math.abs(diff.amount))}</span>
                  <span class="chip ${diff.label === 'Balanced' ? '' : 'chip-warn'}" data-label>${diff.label}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="actions"><button type="button" class="btn btn-primary" data-act="save">Save count</button></div>
        </div>
        <div class="card">
          <h3 class="sec-label">Recent counts</h3>
          ${
            state.history.length
              ? state.history.map(
                  (h) =>
                    html`<p class="small">
                      <button type="button" class="link" data-act="open" data-date="${h.snap_date}">${shortDate(h.snap_date)}</button> ·
                      counted ${m(h.total)} · app ${m(h.app_total)} · ${m(Math.abs(h.difference))}
                      ${Number(h.difference) === 0 ? 'balanced' : Number(h.difference) > 0 ? 'extra' : 'short'}
                    </p>`,
                )
              : html`<p class="muted small">No counts yet.</p>`
          }
        </div>`,
    );
  }

  host.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.acc) state.amounts[t.dataset.acc] = t.value;
    else if (t.dataset.app !== undefined) state.app = t.value;
    else return;
    state.key = null; // an edited count is a new save, so it needs a new idempotency key
    const { total, diff } = calc();
    host.querySelector('[data-total]').textContent = m(total);
    host.querySelector('[data-diff]').textContent = m(Math.abs(diff.amount));
    const label = host.querySelector('[data-label]');
    label.textContent = diff.label;
    label.classList.toggle('chip-warn', diff.label !== 'Balanced');
  });
  host.addEventListener('change', async (e) => {
    if (e.target.dataset.date === undefined) return;
    if (
      isDirty() &&
      !(await confirmDialog({ title: 'Leave without saving?', body: 'You have a count that is not saved.', confirm: 'Leave' }))
    )
      return paint();
    state.date = e.target.value || today;
    await load();
  });
  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'open') {
      if (
        isDirty() &&
        !(await confirmDialog({ title: 'Leave without saving?', body: 'You have a count that is not saved.', confirm: 'Leave' }))
      )
        return;
      state.date = t.dataset.date;
      return load();
    }
    if (act === 'save') {
      const bad = state.accounts.find((a) => isBadNumber(parseAmount, state.amounts[a.account_id]));
      if (bad || isBadNumber(parseAmount, state.app))
        return toast(`Check the number${bad ? ` for ${bad.name}` : ' for the app total'}.`, 'error');
      let reason = '';
      if (state.snap.has_snapshot && isDirty()) {
        reason = await askReason({ title: 'Change this count', hint: 'The earlier count stays in the record.', confirm: 'Save revision' });
        if (reason === null) return;
      }
      state.key ??= newKey();
      const accounts = state.accounts.map((a) => ({
        account_id: a.account_id,
        amount: typedNumber(parseAmount, state.amounts[a.account_id]),
      }));
      const { data, error } = await api.tallySave(state.date, accounts, typedNumber(parseAmount, state.app), reason, state.key);
      if (error) return toast(error.message || 'Could not save the count.', 'error');
      toast(data.unchanged ? 'No change' : 'Count saved');
      state.key = null;
      return load();
    }
    if (act === 'addacc') {
      const name = await askText({ title: 'Add an account', label: 'Account name', confirm: 'Add account' });
      if (name === null) return;
      const { error } = await api.tallyAccountAdd(name, newKey());
      if (error) return toast(error.message || 'Could not add the account.', 'error');
      toast('Account added');
      return load();
    }
    if (act === 'retire') {
      const a = state.accounts.find((x) => x.account_id === t.dataset.id);
      const ok = await confirmDialog({
        title: `Stop counting “${a.name}”?`,
        body: 'Earlier counts keep it. It no longer appears for new counts.',
        confirm: 'Stop counting',
      });
      if (!ok) return;
      const { error } = await api.tallyAccountRetire(a.account_id, newKey());
      if (error) return toast(error.message || 'Could not stop the account.', 'error');
      toast('Account stopped');
      return load();
    }
  });

  render(host, loadingCard());
  await load();
}

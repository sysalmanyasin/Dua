// Emergency Billing settings for the owner and managers: finalize PINs, discount limits, shop defaults and devices.
// Nothing here is enforced in the browser: every change is a database function that checks the person's rights again.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { ask } from './dialog.js';
import * as api from '../data/api.js';
import { deviceLabel, getDeviceId } from '../data/device.js';
import { mountReceiptForm } from './receiptForm.js';

const when = (iso) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '–';
const msg = (e) => e?.message || 'Something went wrong. Try again.';

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions || []);
  const canPin = perms.has('ebill.set_pin');
  const canManage = perms.has('ebill.manage');
  let staff = [];
  let devices = [];
  let shop = { maxPct: 10, maxAmount: 1000, pinRequired: true };

  render(
    el,
    html`<div class="ebs">
      <h1>Emergency Billing settings</h1>
      <div id="ebs-note"></div>
      <div id="ebs-body"><p class="muted">Loading…</p></div>
      <div id="ebs-receipt"></div>
      <div id="ebs-dialog"></div>
    </div>`,
  );
  const body = el.querySelector('#ebs-body');
  const dlg = () => el.querySelector('#ebs-dialog');
  const say = (text, kind = 'info') =>
    render(el.querySelector('#ebs-note'), text ? html`<p class="note note-${kind}" role="status">${text}</p>` : html``);

  async function load() {
    try {
      [staff, devices, shop] = await Promise.all([
        api.listStaff().catch(() => []),
        canManage ? api.listDevices() : [],
        api.getShopSettings().catch(() => shop),
      ]);
    } catch (e) {
      say(msg(e), 'error');
    }
    draw();
  }

  function draw() {
    const here = getDeviceId();
    render(
      body,
      html` <section>
          <h2>Staff PINs and discount limits</h2>
          <p class="muted">
            A person needs the <b>Emergency Billing</b> right (Users &amp; Access) and a PIN set here before they can save an invoice. Only
            the owner can set a PIN.
          </p>
          <div class="eb-table-wrap">
            <table class="eb-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Login</th>
                  <th>May bill</th>
                  <th>PIN</th>
                  <th>Discount limit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${staff.map(
                  (s) =>
                    html`<tr data-user="${s.user_id}">
                      <td>${s.full_name}${s.disabled ? html` <span class="eb-tag">disabled</span>` : ''}</td>
                      <td>${s.username}</td>
                      <td>${s.can_bill ? 'Yes' : html`<span class="muted">No</span>`}</td>
                      <td>
                        ${s.has_pin ? html`Set ${s.locked ? html`<span class="eb-tag">locked</span>` : ''}` : html`<span class="muted">Not set</span>`}
                      </td>
                      <td>
                        ${s.max_discount_pct === null && s.max_discount_amount === null ? html`<span class="muted">Shop default</span>` : `${s.max_discount_pct ?? shop.maxPct}% / ${money(s.max_discount_amount ?? shop.maxAmount)}`}
                      </td>
                      <td>
                        ${canPin ? html`<button type="button" class="btn btn-sm" data-act="pin">${s.has_pin ? 'Change PIN' : 'Set PIN'}</button>${s.has_pin ? html`<button type="button" class="btn btn-sm" data-act="rmpin">Remove PIN</button>` : ''}` : ''}${canManage ? html`<button type="button" class="btn btn-sm" data-act="limits">Limits</button>` : ''}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>
        </section>
        ${
          canManage || canPin
            ? html`<section>
                <h2>Shop discount defaults and PIN rule</h2>
                <div class="ebs-form">
                  <div>
                    Maximum discount: <b>${shop.maxPct}%</b> and <b>${money(shop.maxAmount)}</b> per bill (applies to everyone without their
                    own limit).
                  </div>
                  <div>Saving needs a PIN: <b>${shop.pinRequired ? 'Yes' : 'No'}</b></div>
                  <button type="button" class="btn btn-sm" data-act="shop">Change</button>
                </div>
              </section>`
            : ''
        }
        ${
          canManage
            ? html`<section>
                <h2>Devices</h2>
                <p class="muted">
                  This device: <b>${deviceLabel(here)}</b> (id ${here.slice(0, 8)}). A switched-off device cannot save invoices.
                </p>
                <div class="eb-table-wrap">
                  <table class="eb-table">
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Status</th>
                        <th>Registered</th>
                        <th>Last seen</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        devices.length
                          ? devices.map(
                              (d) =>
                                html`<tr data-device="${d.device_id}">
                                  <td>${d.label}${d.device_id === here ? html` <span class="eb-tag">this device</span>` : ''}</td>
                                  <td>
                                    ${d.status === 'active' ? 'Active' : html`<span class="neg">Switched off</span>${d.deactivate_reason ? html` <span class="muted">(${d.deactivate_reason})</span>` : ''}`}
                                  </td>
                                  <td>${when(d.registered_at)}</td>
                                  <td>${when(d.last_seen_at)}</td>
                                  <td>
                                    ${d.status === 'active' ? html`<button type="button" class="btn btn-sm" data-act="off">Switch off</button>` : ''}
                                  </td>
                                </tr>`,
                            )
                          : html`<tr>
                              <td colspan="5" class="muted eb-empty">No device has registered yet.</td>
                            </tr>`
                      }
                    </tbody>
                  </table>
                </div>
              </section>`
            : ''
        }`,
    );
  }

  const userOf = (e) => staff.find((s) => s.user_id === e.target.closest('tr[data-user]')?.dataset.user);

  async function act(fn, done) {
    try {
      await fn();
      say(done, 'info');
      await load();
    } catch (e) {
      say(msg(e), 'error');
    }
  }

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'pin') {
      const u = userOf(e);
      const v = await ask(dlg(), {
        title: `PIN for ${u.full_name}`,
        intro: '6 digits. Not all the same, and not a run like 123456. Tell the person their PIN privately; it cannot be shown again.',
        confirm: 'Set PIN',
        fields: [{ id: 'pin', label: 'New PIN', type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'new-password' }],
      });
      if (v) await act(() => api.setPin(u.user_id, v.pin), `PIN set for ${u.full_name}.`);
    } else if (a === 'rmpin') {
      const u = userOf(e);
      if (window.confirm(`Remove ${u.full_name}'s PIN? They will not be able to save invoices until a new one is set.`))
        await act(() => api.removePin(u.user_id), `PIN removed for ${u.full_name}.`);
    } else if (a === 'limits') {
      const u = userOf(e);
      const v = await ask(dlg(), {
        title: `Discount limits for ${u.full_name}`,
        intro: 'Leave a box empty to use the shop default for it. Leave both empty to go back to the defaults.',
        confirm: 'Save limits',
        fields: [
          { id: 'pct', label: 'Maximum discount %', type: 'number', value: u.max_discount_pct ?? '', inputmode: 'decimal' },
          { id: 'amt', label: 'Maximum discount amount (Rs)', type: 'number', value: u.max_discount_amount ?? '', inputmode: 'decimal' },
          { id: 'why', label: 'Reason (required)', placeholder: 'e.g. trusted cashier' },
        ],
      });
      if (v)
        await act(
          () => api.setLimits(u.user_id, v.pct === '' ? null : Number(v.pct), v.amt === '' ? null : Number(v.amt), v.why),
          'Limits saved.',
        );
    } else if (a === 'shop') {
      const v = await ask(dlg(), {
        title: 'Shop discount defaults',
        confirm: 'Save',
        fields: [
          { id: 'pct', label: 'Maximum discount %', type: 'number', value: String(shop.maxPct), inputmode: 'decimal' },
          { id: 'amt', label: 'Maximum discount amount (Rs)', type: 'number', value: String(shop.maxAmount), inputmode: 'decimal' },
          { id: 'pin', label: 'Saving needs a PIN (yes / no)', value: shop.pinRequired ? 'yes' : 'no' },
          { id: 'why', label: 'Reason (required)' },
        ],
      });
      if (!v) return;
      await act(async () => {
        const jobs = [];
        if (Number(v.pct) !== shop.maxPct) jobs.push(['ebill.max_discount_pct', Number(v.pct)]);
        if (Number(v.amt) !== shop.maxAmount) jobs.push(['ebill.max_discount_amount', Number(v.amt)]);
        const need = !/^n/i.test(v.pin.trim());
        if (need !== shop.pinRequired) jobs.push(['ebill.pin_required', need]);
        for (const [k, val] of jobs) await api.setShopSetting(k, val, v.why);
      }, 'Settings saved.');
    } else if (a === 'off') {
      const id = e.target.closest('tr[data-device]')?.dataset.device;
      const v = await ask(dlg(), {
        title: 'Switch this device off?',
        intro: 'It will not be able to save invoices. Invoices already on the server stay.',
        confirm: 'Switch off',
        fields: [{ id: 'why', label: 'Reason (required)', placeholder: 'e.g. tablet lost' }],
      });
      if (v) await act(() => api.deactivateDevice(id, v.why), 'Device switched off.');
    }
  });

  await load();
  if (canManage) await mountReceiptForm(el.querySelector('#ebs-receipt'), { api, say });
}

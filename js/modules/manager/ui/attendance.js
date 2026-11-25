// Attendance. One page, three parts, each shown only to people who may use it (the database checks every call again):
//   attendance.check_in   the person's own Check in / Check out button and their last 24 hours
//   attendance.view_all   the owner's day view: who is in, first in, last out, and refused attempts
//   attendance.manage     the owner's places (geofence) and limits
// The phone only reports where it is. The server measures the distance and decides (migration 0110).
import { html, render } from '../../../shared/html.js';
import { hero, sectionLabel } from '../../../shared/ui.js';
import { shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/attendanceApi.js';
import {
  coordinateText,
  dayRows,
  metres,
  parseCoordinates,
  reasonText,
  refusedAttempts,
  resultMessage,
  timeLabel,
  validateAccuracy,
  validatePlace,
} from '../domain/attendance.js';
import { askReason, errorCard, loadingCard, newKey, openDialog, toast } from './parts.js';

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions;
  const has = (k) => (perms?.has ? perms.has(k) : (perms ?? []).includes(k));
  const can = { checkIn: has('attendance.check_in'), view: has('attendance.view_all'), manage: has('attendance.manage') };
  const state = { me: null, records: null, setup: null, date: todayPkt(), busy: false, message: null, key: null, error: false };

  async function load() {
    try {
      const jobs = [];
      if (can.checkIn) jobs.push(api.today().then((v) => (state.me = v)));
      if (can.view) jobs.push(api.list(state.date, state.date).then((v) => (state.records = v)));
      if (can.view || can.manage) jobs.push(api.setup().then((v) => (state.setup = v)));
      await Promise.all(jobs);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  // ── the person's own check-in ──
  async function punch() {
    if (state.busy || !state.me) return;
    const kind = state.me.state === 'in' ? 'out' : 'in';
    state.busy = true;
    state.message = { ok: true, text: 'Finding your location…' };
    paint();
    let fix;
    try {
      fix = await api.currentLocation();
    } catch (err) {
      state.busy = false;
      state.message = { ok: false, text: api.locationProblem(err) };
      return paint();
    }
    // The same key is kept while the server could not be reached, so pressing again never records twice.
    state.key ??= newKey();
    const { data, error } = await api.checkIn(kind, fix, state.key);
    state.busy = false;
    if (error) {
      state.message = { ok: false, text: 'Could not reach the server. Check your connection and press the button again.' };
      return paint();
    }
    state.key = null;
    state.message = resultMessage(data);
    await load();
  }

  const checkInCard = () => {
    const me = state.me;
    const needApp = me.require_app && !api.insideApp();
    return html`<section class="card at-card">
      <h2>My attendance</h2>
      <p class="at-state" role="status">${me.state === 'in' ? '✓ You are checked in.' : 'You are not checked in.'}</p>
      ${me.has_place ? '' : html`<p class="muted">The owner has not set up an attendance place yet.</p>`}
      ${needApp ? html`<p class="muted">Open Dua in the Android app to check in. The website cannot confirm where you are.</p>` : ''}
      <button type="button" class="btn btn-primary at-big" data-act="punch" ${state.busy ? 'disabled' : ''}>
        ${me.state === 'in' ? 'Check out' : 'Check in'}
      </button>
      ${state.message ? html`<p class="${state.message.ok ? 'muted' : 'err'}" role="alert">${state.message.text}</p>` : ''}
      ${
        me.events.length
          ? html`<ul class="at-events">
              ${me.events.map(
                (e) =>
                  html`<li>
                    <strong>${e.kind === 'in' ? 'In' : 'Out'}</strong> ${timeLabel(e.at)}
                    ${e.status === 'accepted' ? html`<span class="chip">Recorded</span>` : html`<span class="chip chip-warn">Refused</span> <small class="muted">${reasonText(e.reason)}</small>`}
                  </li>`,
              )}
            </ul>`
          : ''
      }
    </section>`;
  };

  // ── the owner's day view ──
  const dayCard = () => {
    const rows = dayRows(state.records, state.date);
    const refused = refusedAttempts(state.records, state.date);
    const nIn = rows.filter((r) => r.present).length;
    return html`<section class="card at-card">
      <h2>Attendance records</h2>
      <label class="field"><span>Day</span><input type="date" id="at-date" value="${state.date}" max="${todayPkt()}" /></label>
      <p class="muted">
        ${rows.length ? `${nIn} in now · ${rows.length} recorded on ${shortDate(state.date)}` : `Nobody recorded on ${shortDate(state.date)}.`}
      </p>
      ${
        rows.length
          ? html`<table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>First in</th>
                  <th>Last out</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (r) =>
                    html`<tr>
                      <td>${r.name}${r.refused ? html` <span class="chip chip-warn">${r.refused} refused</span>` : ''}</td>
                      <td>${timeLabel(r.firstIn)}</td>
                      <td>${timeLabel(r.lastOut)}</td>
                      <td>${r.present ? '✓ In' : 'Out'}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : ''
      }
      ${
        refused.length
          ? html`${sectionLabel('Refused attempts')}
              <ul class="at-events">
                ${refused.map(
                  (r) =>
                    html`<li>
                      <strong>${r.name}</strong> ${r.kind === 'in' ? 'in' : 'out'} at ${timeLabel(r.at)}
                      <small class="muted"
                        >${reasonText(r.reason)} (${metres(r.distance_m)} from the nearest
                        place${r.mock ? ', mock location flagged' : ''})</small
                      >
                    </li>`,
                )}
              </ul>`
          : ''
      }
    </section>`;
  };

  // ── places and limits ──
  const setupCard = () => {
    const { sites, config } = state.setup;
    return html`<section class="card at-card">
      <h2>Places and limits</h2>
      <p class="muted">
        A person can check in only within the distance of an active place. The server measures it; the app only reports where the phone is.
      </p>
      ${
        sites.length
          ? html`<ul class="at-events">
              ${sites.map(
                (s) =>
                  html`<li>
                    <strong>${s.name}</strong> · ${s.radius_m} m ${s.active ? '' : html`<span class="chip chip-warn">Off</span>`}
                    <small class="muted">${coordinateText(s.latitude, s.longitude)}</small>
                    ${can.manage ? html`<button type="button" class="btn btn-ghost" data-act="edit-site" data-id="${s.id}">Edit</button>` : ''}
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">No place yet. Add the pharmacy, standing inside it, to start.</p>`
      }
      ${
        can.manage
          ? html`<div class="actions"><button type="button" class="btn btn-primary" data-act="add-site">Add a place</button></div>
              ${sectionLabel('Limits')}
              <label class="field"
                ><span>Worst GPS accuracy allowed (metres)</span><input id="at-acc" inputmode="numeric" value="${config.max_accuracy_m}"
              /></label>
              <label class="field"
                ><span
                  ><input type="checkbox" id="at-app" ${config.require_app ? 'checked' : ''} /> Check-in only from the Android app</span
                ></label
              >
              <small class="err" id="at-cfg-err" hidden></small>
              <div class="actions"><button type="button" class="btn btn-ghost" data-act="save-config">Save limits</button></div>`
          : ''
      }
    </section>`;
  };

  function siteDialog(site) {
    const dlg = openDialog(
      html`<h2>${site ? 'Edit place' : 'Add a place'}</h2>
        <label class="field"><span>Name</span><input id="s-name" maxlength="60" value="${site?.name ?? ''}" /></label>
        <label class="field"
          ><span>Location (latitude, longitude)</span>
          <input id="s-loc" inputmode="decimal" value="${site ? coordinateText(site.latitude, site.longitude) : ''}"
        /></label>
        <div class="actions"><button type="button" class="btn btn-ghost" data-here>Use my location now</button></div>
        <label class="field"
          ><span>Allowed distance (metres)</span><input id="s-rad" inputmode="numeric" value="${site?.radius_m ?? 100}"
        /></label>
        <label class="field"
          ><span><input type="checkbox" id="s-on" ${site?.active === false ? '' : 'checked'} /> Active</span></label
        >
        <small class="err" id="s-err" hidden></small>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" data-ok>Save</button>
        </div>`,
      { label: site ? 'Edit place' : 'Add a place' },
    );
    const err = (t) => {
      const box = dlg.querySelector('#s-err');
      box.textContent = t;
      box.hidden = !t;
    };
    dlg.addEventListener('click', async (e) => {
      if (e.target.closest('[data-here]')) {
        try {
          const fix = await api.currentLocation();
          dlg.querySelector('#s-loc').value = coordinateText(fix.lat, fix.lng);
          err('');
        } catch (x) {
          err(api.locationProblem(x));
        }
        return;
      }
      if (!e.target.closest('[data-ok]')) return;
      const at = parseCoordinates(dlg.querySelector('#s-loc').value);
      const next = {
        id: site?.id ?? null,
        name: dlg.querySelector('#s-name').value.trim(),
        lat: at?.lat ?? NaN,
        lng: at?.lng ?? NaN,
        radius: Number(dlg.querySelector('#s-rad').value),
        active: dlg.querySelector('#s-on').checked,
      };
      const bad = validatePlace(next);
      if (bad) return err(bad);
      const reason = await askReason({ title: 'Why this change?', hint: 'Logged with the change.', confirm: 'Save place' });
      if (!reason) return;
      const { error } = await api.saveSite(next, reason, newKey());
      if (error) return err(error.message || 'Could not save.');
      dlg.close();
      toast('Place saved');
      load();
    });
  }

  async function saveConfig() {
    const box = el.querySelector('#at-cfg-err');
    const acc = Number(el.querySelector('#at-acc').value);
    const bad = validateAccuracy(acc);
    box.textContent = bad ?? '';
    box.hidden = !bad;
    if (bad) return;
    const reason = await askReason({ title: 'Why this change?', hint: 'Logged with the change.', confirm: 'Save limits' });
    if (!reason) return;
    const { error } = await api.setConfig(acc, el.querySelector('#at-app').checked, reason, newKey());
    if (error) return toast(error.message || 'Could not save.', 'error');
    toast('Limits saved');
    load();
  }

  function paint() {
    if (state.error) return render(el, errorCard('attendance'));
    if (can.checkIn && !state.me) return render(el, loadingCard());
    render(
      el,
      html`${hero({ label: 'Manager', title: 'Attendance', sub: 'Check in at the pharmacy. Your location is checked by the server.' })}
      ${can.checkIn && state.me ? checkInCard() : ''} ${can.view && state.records ? dayCard() : ''}
      ${(can.view || can.manage) && state.setup ? setupCard() : ''}`,
    );
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'punch') punch();
    else if (a === 'add-site') siteDialog(null);
    else if (a === 'edit-site') siteDialog(state.setup.sites.find((s) => s.id === b.dataset.id) ?? null);
    else if (a === 'save-config') saveConfig();
  });
  el.addEventListener('change', (e) => {
    if (e.target.id !== 'at-date' || !e.target.value) return;
    state.date = e.target.value;
    load();
  });

  render(el, loadingCard());
  await load();
}

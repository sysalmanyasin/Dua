// Attendance. One page, three parts, each shown only to people who may use it (the database checks every call again):
//   attendance.check_in   the person's own Check in / Check out button and their last 24 hours, and (in the Android app) whether
//                         automatic attendance works on this phone
//   attendance.view_all   the owner's day view: who is in, first in, last out, and refused attempts
//   attendance.manage     the owner's places (geofence) and limits
// The phone only reports where it is. The server measures the distance and decides (migration 0110).
import { html, render } from '../../../shared/html.js';
import { hero, sectionLabel } from '../../../shared/ui.js';
import { shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/attendanceApi.js';
import {
  addDays,
  autoChecklist,
  autoSummary,
  coordinateText,
  dayRows,
  dayState,
  journalLabel,
  metres,
  parseCoordinates,
  reasonText,
  refusedAttempts,
  resultMessage,
  timeLabel,
  validateAccuracy,
  validatePlace,
  validateStable,
  workedText,
} from '../domain/attendance.js';
import { askReason, errorCard, loadingCard, newKey, openDialog, toast } from './parts.js';

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions;
  const has = (k) => (perms?.has ? perms.has(k) : (perms ?? []).includes(k));
  const can = { checkIn: has('attendance.check_in'), view: has('attendance.view_all'), manage: has('attendance.manage') };
  const state = {
    me: null,
    mine: null,
    records: null,
    week: null,
    auto: null,
    autoBusy: false,
    setup: null,
    date: todayPkt(),
    busy: false,
    message: null,
    key: null,
    error: false,
  };

  // What the phone says about automatic attendance. A failure here only hides the card; it never breaks the rest of the page.
  async function readAuto() {
    try {
      state.auto = await api.autoStatus();
    } catch {
      state.auto = null;
    }
  }

  async function load() {
    try {
      const jobs = [];
      if (can.checkIn) {
        jobs.push(api.today().then((v) => (state.me = v)));
        jobs.push(api.myHistory(addDays(todayPkt(), -13), todayPkt()).then((v) => (state.mine = v)));
      }
      if (can.checkIn && api.autoSupported()) jobs.push(readAuto());
      if (can.view) {
        jobs.push(api.list(state.date, state.date).then((v) => (state.records = v)));
        jobs.push(api.summary(addDays(state.date, -6), state.date).then((v) => (state.week = v)));
      }
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

  // ── automatic attendance on this phone ──
  const autoCard = () => {
    const st = state.auto;
    const sum = autoSummary(st);
    const checks = autoChecklist(st);
    const broken = checks.filter((c) => !c.ok && !c.advisory);
    const journal = (st.journal ?? []).slice(0, 8);
    const place = (st.sites ?? [])[0];
    const mark = (c) =>
      c.ok
        ? html`<span class="chip">✓</span>`
        : c.advisory
          ? html`<span class="chip chip-warn">!</span>`
          : html`<span class="at-no">✗</span>`;
    return html`<section class="card at-card">
      <h2>Automatic attendance</h2>
      <p class="at-auto-summary ${sum.tone === 'ok' ? '' : 'at-no'}" role="status">${sum.text}</p>
      ${
        place
          ? html`<p class="muted">
              ${place.name}, ${place.radius} m. Counted after you stay
              ${st.stableSeconds >= 60 ? `${Math.round(st.stableSeconds / 60)} min` : `${st.stableSeconds} s`}.
            </p>`
          : ''
      }
      <ul class="at-auto-checks">
        ${checks.map((c) => html`<li>${mark(c)} <span>${c.label}</span></li>`)}
      </ul>
      <div class="actions">
        ${
          broken.some((c) => c.fix === 'background')
            ? html`<button type="button" class="btn btn-primary" data-act="auto-background" ${state.autoBusy ? 'disabled' : ''}>
                Allow location all the time
              </button>`
            : ''
        }
        ${
          broken.some((c) => c.fix === 'app')
            ? html`<button type="button" class="btn btn-primary" data-act="auto-app">Open phone settings</button>`
            : ''
        }
        ${
          checks.some((c) => !c.ok && c.fix === 'battery')
            ? html`<button type="button" class="btn btn-ghost" data-act="auto-battery">Battery settings</button>`
            : ''
        }
        <button type="button" class="btn btn-ghost" data-act="auto-refresh" ${state.autoBusy ? 'disabled' : ''}>Check again</button>
      </div>
      ${sectionLabel('Detected on this phone')}
      <p class="muted">Test mode: these are listed here only. They are not recorded as attendance yet.</p>
      ${
        journal.length
          ? html`<ul class="at-events">
              ${journal.map(
                (j) =>
                  html`<li>
                    <strong>${journalLabel(j, st.stableSeconds)}</strong> ${timeLabel(new Date(j.at).toISOString())}
                    ${j.accuracy ? html`<small class="muted">accuracy about ${Math.round(j.accuracy)} m</small>` : ''}
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">Nothing detected yet.</p>`
      }
    </section>`;
  };

  async function autoAction(act) {
    if (state.autoBusy) return;
    if (act === 'auto-battery') return api.openBatterySettings();
    if (act === 'auto-app') return api.openAppSettings();
    state.autoBusy = true;
    paint();
    try {
      if (act === 'auto-background') await api.askBackgroundLocation(); // on Android 11+ this opens the app's location settings
    } catch {
      // the person said no; the status below shows what is still missing
    }
    await readAuto();
    state.autoBusy = false;
    paint();
  }

  // ── the person's own last two weeks ──
  const historyCard = () => {
    const days = state.mine?.days ?? [];
    return html`<section class="card at-card">
      <h2>My last two weeks</h2>
      ${
        days.length
          ? html`<table class="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Time at work</th>
                </tr>
              </thead>
              <tbody>
                ${days.map(
                  (d) =>
                    html`<tr>
                      <td>${shortDate(d.date)}</td>
                      <td>${timeLabel(d.first_in)}</td>
                      <td>${d.open ? 'Still in' : timeLabel(d.last_out)}</td>
                      <td>
                        ${workedText(d.worked_minutes)}${d.refused ? html` <span class="chip chip-warn">${d.refused} refused</span>` : ''}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p class="muted">Nothing recorded in the last two weeks.</p>`
      }
    </section>`;
  };

  // ── the owner's week ending on the chosen day ──
  const weekCard = () => {
    const rows = state.week?.rows ?? [];
    const today = todayPkt();
    return html`<section class="card at-card">
      <h2>The week up to ${shortDate(state.date)}</h2>
      <p class="muted">One line per person per day. Time at work counts only completed in and out pairs.</p>
      ${
        rows.length
          ? html`<table class="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Name</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Time at work</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (r) =>
                    html`<tr>
                      <td>${shortDate(r.date)}</td>
                      <td>${r.name}</td>
                      <td>${timeLabel(r.first_in)}</td>
                      <td>${timeLabel(r.last_out)}</td>
                      <td>${workedText(r.worked_minutes)}</td>
                      <td>
                        ${r.refused ? html`<span class="chip chip-warn">${r.refused} refused</span> ` : ''}${
                          r.open && r.date < today ? html`<span class="chip chip-warn">No check-out</span>` : dayState(r)
                        }
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p class="muted">Nobody recorded in this week.</p>`
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
                ><span>Stay this long (seconds) before arrival or leaving counts</span
                ><input id="at-stable" inputmode="numeric" value="${config.stable_seconds ?? 120}"
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
    const stable = Number(el.querySelector('#at-stable')?.value ?? state.setup.config.stable_seconds ?? 120);
    const bad = validateAccuracy(acc) ?? validateStable(stable);
    box.textContent = bad ?? '';
    box.hidden = !bad;
    if (bad) return;
    const reason = await askReason({ title: 'Why this change?', hint: 'Logged with the change.', confirm: 'Save limits' });
    if (!reason) return;
    const { error } = await api.setConfig(acc, el.querySelector('#at-app').checked, reason, newKey());
    if (error) return toast(error.message || 'Could not save.', 'error');
    if (stable !== (state.setup.config.stable_seconds ?? 120)) {
      const res = await api.setStable(stable, reason, newKey());
      if (res.error) return toast(res.error.message || 'The stability period was not saved.', 'error');
    }
    toast('Limits saved');
    load();
  }

  function paint() {
    if (state.error) return render(el, errorCard('attendance'));
    if (can.checkIn && !state.me) return render(el, loadingCard());
    render(
      el,
      html`${hero({ label: 'Manager', title: 'Attendance', sub: 'Check in at the pharmacy. Your location is checked by the server.' })}
      ${can.checkIn && state.me ? checkInCard() : ''} ${can.checkIn && state.auto ? autoCard() : ''}
      ${can.checkIn && state.mine ? historyCard() : ''} ${can.view && state.records ? dayCard() : ''}
      ${can.view && state.week ? weekCard() : ''} ${(can.view || can.manage) && state.setup ? setupCard() : ''}`,
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
    else if (a.startsWith('auto-') && a !== 'auto-refresh') autoAction(a);
    else if (a === 'auto-refresh') autoAction('auto-refresh');
  });
  el.addEventListener('change', (e) => {
    if (e.target.id !== 'at-date' || !e.target.value) return;
    state.date = e.target.value;
    load();
  });

  // After the person fixes something in Android's settings and returns to Dua, look again.
  const onShown = async () => {
    if (!el.isConnected) return document.removeEventListener('visibilitychange', onShown);
    if (document.visibilityState !== 'visible' || !state.auto) return;
    await readAuto();
    paint();
  };
  document.addEventListener('visibilitychange', onShown);

  render(el, loadingCard());
  await load();
}

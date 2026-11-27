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
  groupByDay,
  journalDetail,
  journalLabel,
  journalTone,
  parseCoordinates,
  pendingText,
  reasonText,
  refusedDetail,
  refusedAttempts,
  resultMessage,
  spanText,
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
  async function readAuto(sync = false) {
    try {
      // The phone only learns about places when Dua starts; ask the server again so a place added since then is picked up here.
      if (sync) {
        try {
          await api.syncPlaces();
        } catch {
          // no connection: the phone keeps the places it already has
        }
      }
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
      if (can.checkIn && api.autoSupported()) jobs.push(readAuto(true));
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

  // A time with its day when it is not today (the phone's journal can hold yesterday).
  const when = (ms) => {
    const iso = new Date(ms).toISOString();
    const day = new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 10);
    return day === todayPkt() ? timeLabel(iso) : `${shortDate(day)} ${timeLabel(iso)}`;
  };

  // ── the person's own check-in card ──
  const checkInCard = () => {
    const me = state.me;
    const needApp = me.require_app && !api.insideApp();
    const checkedIn = me.state === 'in';
    return html`<section class="card at-card">
      <h2>My attendance</h2>
      <div class="at-status ${checkedIn ? 'at-status-ok' : ''}" role="status">
        <div><strong>${checkedIn ? '✓ You are checked in.' : 'You are not checked in.'}</strong></div>
      </div>
      ${me.has_place ? '' : html`<p class="muted">The owner has not set up an attendance place yet.</p>`}
      ${needApp ? html`<p class="muted">Open Dua in the Android app to check in. The website cannot confirm where you are.</p>` : ''}
      <button type="button" class="btn btn-primary at-big" data-act="punch" ${state.busy ? 'disabled' : ''}>
        ${checkedIn ? 'Check out' : 'Check in'}
      </button>
      ${state.message ? html`<p class="${state.message.ok ? 'muted' : 'err'}" role="alert">${state.message.text}</p>` : ''}
      ${
        me.events.length
          ? html`<ul class="at-list">
              ${me.events.map(
                (e) =>
                  html`<li class="at-row ${e.status === 'accepted' ? '' : 'at-row-warn'}">
                    <span class="at-main">
                      <span><span class="at-kind">${e.kind === 'in' ? 'In' : 'Out'}</span> <strong>${timeLabel(e.at)}</strong></span>
                      ${e.status === 'accepted' ? '' : html`<small>${reasonText(e.reason)}</small>`}
                    </span>
                    <span class="at-side">
                      ${e.status === 'accepted' ? html`<span class="chip chip-ok">Recorded</span>` : html`<span class="chip chip-warn">Refused</span>`}
                    </span>
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
    const waiting = pendingText(st);
    const mark = (c) =>
      c.ok
        ? html`<span class="at-tick">✓</span>`
        : c.advisory
          ? html`<span class="at-tick at-tick-warn">!</span>`
          : html`<span class="at-tick at-tick-no">✗</span>`;
    return html`<section class="card at-card">
      <h2>Automatic attendance</h2>
      <div class="at-status at-status-${sum.tone}" role="status">
        <span class="at-dot"></span>
        <div>
          <strong>${sum.text}</strong>
          ${waiting ? html`<small>${waiting}</small>` : ''}
        </div>
      </div>
      ${
        place
          ? html`<p class="muted at-place">
              ${place.name}, ${place.radius} m. Counted after you stay
              ${st.stableSeconds >= 60 ? `${Math.round(st.stableSeconds / 60)} min` : `${st.stableSeconds} s`}.
            </p>`
          : ''
      }
      <ul class="at-checks">
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
      <p class="muted">
        ${
          st.auto
            ? 'Automatic recording is on: what happened to each arrival and leaving is shown here.'
            : 'Test mode: these are listed here only. They are not recorded as attendance yet.'
        }
      </p>
      ${
        journal.length
          ? html`<ul class="at-list">
              ${journal.map((j) => {
                const detail = [journalDetail(j), j.accuracy ? `accuracy about ${Math.round(j.accuracy)} m` : '']
                  .filter(Boolean)
                  .join(' · ');
                return html`<li class="at-row at-row-${journalTone(j)}">
                  <span class="at-main"
                    ><strong>${journalLabel(j, st.stableSeconds)}</strong>${detail ? html`<small>${detail}</small>` : ''}</span
                  >
                  <span class="at-side"><b>${when(j.at)}</b></span>
                </li>`;
              })}
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
    await readAuto(act === 'auto-refresh' || act === 'auto-background');
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
          ? html`<ul class="at-list">
              ${days.map(
                (d) =>
                  html`<li class="at-row">
                    <span class="at-main"><strong>${shortDate(d.date)}</strong><small>${spanText(d)}</small></span>
                    <span class="at-side">
                      <b>${workedText(d.worked_minutes)}</b
                      >${d.refused ? html`<span class="chip chip-warn">${d.refused} refused</span>` : ''}
                    </span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">Nothing recorded in the last two weeks.</p>`
      }
    </section>`;
  };

  // ── the owner's week ending on the chosen day ──
  const weekCard = () => {
    const days = groupByDay(state.week?.rows);
    const today = todayPkt();
    return html`<section class="card at-card">
      <h2>The week up to ${shortDate(state.date)}</h2>
      <p class="muted">One line per person per day. Time at work counts only completed in and out pairs.</p>
      ${
        days.length
          ? days.map(
              (day) =>
                html`<h3 class="at-day">${shortDate(day.date)}</h3>
                  <ul class="at-list">
                    ${day.rows.map(
                      (r) =>
                        html`<li class="at-row">
                          <span class="at-main"><strong>${r.name}</strong><small>${spanText(r)}</small></span>
                          <span class="at-side">
                            <b>${workedText(r.worked_minutes)}</b
                            >${r.refused ? html`<span class="chip chip-warn">${r.refused} refused</span>` : ''}
                            ${
                              r.open && r.date < today
                                ? html`<span class="chip chip-warn">No check-out</span>`
                                : html`<span class="chip">${dayState(r)}</span>`
                            }
                          </span>
                        </li>`,
                    )}
                  </ul>`,
            )
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
          ? html`<ul class="at-list">
              ${rows.map(
                (r) =>
                  html`<li class="at-row">
                    <span class="at-main"
                      ><strong>${r.name}</strong
                      ><small>${spanText({ firstIn: r.firstIn, lastOut: r.lastOut, open: r.present })}</small></span
                    >
                    <span class="at-side">
                      ${r.refused ? html`<span class="chip chip-warn">${r.refused} refused</span>` : ''}
                      ${r.present ? html`<span class="chip chip-ok">In now</span>` : html`<span class="chip">Out</span>`}
                    </span>
                  </li>`,
              )}
            </ul>`
          : ''
      }
      ${
        refused.length
          ? html`${sectionLabel('Refused attempts')}
              <ul class="at-list">
                ${refused.map(
                  (r) =>
                    html`<li class="at-row at-row-warn">
                      <span class="at-main">
                        <span><strong>${r.name}</strong> ${r.kind === 'in' ? 'in' : 'out'} at ${timeLabel(r.at)}</span>
                        <small>${reasonText(r.reason)}${refusedDetail(r)}</small>
                      </span>
                      <span class="at-side">${r.source === 'auto' ? html`<span class="chip">Automatic</span>` : ''}</span>
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
          ? html`<ul class="at-list">
              ${sites.map(
                (s) =>
                  html`<li class="at-row">
                    <span class="at-main"
                      ><strong>${s.name}</strong> <small>${s.radius_m} m · ${coordinateText(s.latitude, s.longitude)}</small></span
                    >
                    <span class="at-side">
                      ${s.active ? '' : html`<span class="chip chip-warn">Off</span>`}
                      ${can.manage ? html`<button type="button" class="btn btn-ghost" data-act="edit-site" data-id="${s.id}">Edit</button>` : ''}
                    </span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">No place yet. Add the pharmacy, standing inside it, to start.</p>`
      }
      ${
        can.manage
          ? html`<div class="actions"><button type="button" class="btn btn-primary" data-act="add-site">Add a place</button></div>
              ${sectionLabel('Limits')}
              <div class="at-form">
                <label class="field"
                  ><span>Worst GPS accuracy allowed (metres)</span><input id="at-acc" inputmode="numeric" value="${config.max_accuracy_m}"
                /></label>
                <label class="field"
                  ><span>Stay this long (seconds) before arrival or leaving counts</span
                  ><input id="at-stable" inputmode="numeric" value="${config.stable_seconds ?? 120}"
                /></label>
              </div>
              <label class="at-check"
                ><input type="checkbox" id="at-app" ${config.require_app ? 'checked' : ''} />
                <span
                  ><strong>Check-in only from the Android app</strong><small>The website cannot prove where a person is.</small></span
                ></label
              >
              <label class="at-check"
                ><input type="checkbox" id="at-auto" ${config.auto_enabled ? 'checked' : ''} />
                <span
                  ><strong
                    >Record arrivals and leaving automatically
                    ${config.auto_enabled ? html`<span class="chip chip-ok">On</span>` : html`<span class="chip">Test mode</span>`}</strong
                  ><small
                    >On: phones with Dua record check-in and check-out by themselves, and the server checks each one. Off: phones only list
                    what they detect. Keep it off until a phone test has passed.</small
                  ></span
                ></label
              >
              <small class="err" id="at-cfg-err" hidden></small>
              <div class="actions"><button type="button" class="btn btn-primary" data-act="save-config">Save limits</button></div>`
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
    const auto = el.querySelector('#at-auto')?.checked === true;
    if (auto !== (state.setup.config.auto_enabled === true)) {
      const res = await api.setAuto(auto, reason, newKey());
      if (res.error) return toast(res.error.message || 'The automatic recording switch was not saved.', 'error');
    }
    toast('Limits saved');
    load();
  }

  function paint() {
    if (state.error) return render(el, errorCard('attendance'));
    if (can.checkIn && !state.me) return render(el, loadingCard());
    render(
      el,
      html`${hero({ label: 'Manager', title: 'Attendance', sub: 'Your arrival and leaving at the pharmacy. The server checks where you are.' })}
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

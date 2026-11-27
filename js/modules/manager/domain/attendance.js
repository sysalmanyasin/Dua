// Attendance: pure helpers (no screen, no network). The server decides every check-in; these only word the answer and
// shape the owner's records. Times are shown in Pakistan time (the business day, D-08).

export const REASON_TEXT = {
  app_required: 'Check in from the Dua Android app. The website cannot confirm where you are.',
  mock_location: 'Your phone says the location is being faked. Turn off any fake-location app and try again.',
  weak_signal: 'The GPS signal is too weak. Step outside or near a window, wait a few seconds and try again.',
  no_place_set: 'No attendance place has been set up yet. Please tell the owner.',
  outside: 'You are not at the pharmacy. Check in when you arrive.',
  already_in: 'You are already checked in.',
  not_in: 'You are not checked in, so there is nothing to check out of.',
  still_inside: 'You were still at the pharmacy, so the check-out was not recorded.',
};

export const reasonText = (reason) => REASON_TEXT[reason] ?? 'That could not be recorded. Try again.';

// The bracket after a refused attempt: how far from the nearest place (only when the server measured it) and the mock-location flag.
export function refusedDetail(r) {
  const parts = [];
  if (r.distance_m !== null && r.distance_m !== undefined && Number.isFinite(Number(r.distance_m)))
    parts.push(`${Math.round(Number(r.distance_m))} m from the nearest place`);
  if (r.mock) parts.push('mock location flagged');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false });
export const timeLabel = (iso) => (iso ? TIME.format(new Date(iso)) : '—');

export const metres = (m) => (m === null || m === undefined || !Number.isFinite(Number(m)) ? '—' : `${Math.round(Number(m))} m`);

// The sentence shown after pressing the button. `res` is what mgmt_attendance_check_in returned.
export function resultMessage(res) {
  if (!res) return { ok: false, text: 'No answer. Check your connection and try again.' };
  if (res.ok) {
    const where = res.place ? ` at ${res.place}` : '';
    return { ok: true, text: `${res.kind === 'in' ? 'Checked in' : 'Checked out'}${where} at ${timeLabel(res.at)}.` };
  }
  const away =
    res.reason === 'outside' && res.distance_m !== null && res.distance_m !== undefined
      ? ` You are about ${metres(res.distance_m)} away.`
      : '';
  return { ok: false, text: `${reasonText(res.reason)}${away}` };
}

// "10.5, 20.25" or "10.5 20.25" or two separate numbers. Returns { lat, lng } or null. Map apps paste "lat, lng".
export function parseCoordinates(text) {
  const parts = String(text ?? '')
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const [lat, lng] = parts.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export const coordinateText = (lat, lng) => `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;

// One line per person for one business day: first accepted "in", last accepted "out", and how many attempts were refused.
// `records` is the list from mgmt_attendance_list (newest first); order is not relied on.
export function dayRows(records, businessDate) {
  const by = new Map();
  for (const r of records ?? []) {
    if (r.business_date !== businessDate) continue;
    const row = by.get(r.staff_id) ?? { staffId: r.staff_id, name: r.name, firstIn: null, lastOut: null, refused: 0, present: false };
    if (r.status === 'rejected') row.refused += 1;
    else if (r.kind === 'in') {
      if (!row.firstIn || r.at < row.firstIn) row.firstIn = r.at;
    } else if (!row.lastOut || r.at > row.lastOut) row.lastOut = r.at;
    by.set(r.staff_id, row);
  }
  for (const row of by.values()) {
    const accepted = (records ?? []).filter((r) => r.staff_id === row.staffId && r.status === 'accepted');
    const last = accepted.sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    row.present = last?.kind === 'in';
  }
  return [...by.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export const refusedAttempts = (records, businessDate) =>
  (records ?? []).filter((r) => r.business_date === businessDate && r.status === 'rejected').sort((a, b) => (a.at < b.at ? 1 : -1));

// The limits form: whole metres inside the ranges the database enforces.
export function validatePlace({ name, lat, lng, radius }) {
  if (String(name ?? '').trim().length < 2) return 'Give the place a name.';
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return 'Enter the location as "latitude, longitude".';
  if (!Number.isInteger(radius) || radius < 20 || radius > 2000) return 'The distance must be a whole number from 20 to 2000 metres.';
  return null;
}
export const validateAccuracy = (m) =>
  Number.isInteger(m) && m >= 10 && m <= 500 ? null : 'The accuracy limit must be a whole number from 10 to 500 metres.';

export const validateStable = (s) =>
  Number.isInteger(s) && s >= 30 && s <= 600 ? null : 'The stay time must be a whole number of seconds from 30 to 600.';

// "7 h 30 min", "45 min", "—" for nothing. Whole minutes come from the database (migration 0111).
export function workedText(minutes) {
  const m = Math.floor(Number(minutes));
  if (!Number.isFinite(m) || m <= 0) return '—';
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

// A business date (YYYY-MM-DD) moved by whole days. Calendar maths in UTC, so the phone's time zone never shifts the date.
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// What the "Now" column and the staff list say about a day.
export const dayState = (day) => (day.open ? 'Still in' : day.last_out ? 'Done' : '—');

// ── automatic attendance on the phone (Phase 3: the phone watches the pharmacy and keeps a local journal) ──
const PROBLEMS = {
  no_precise_location: 'Allow precise location for Dua.',
  location_off: 'Location is switched off on this phone. Switch it on.',
  no_background_location:
    'Location must be allowed "all the time", otherwise Android stops Dua from seeing you arrive while the app is closed.',
  background_restricted: 'Android has restricted Dua in the background. Set Dua to "Unrestricted" in the battery settings.',
};
export const problemText = (code) => PROBLEMS[code] ?? 'Automatic attendance is not working on this phone.';

// What the status card says, from what the phone reports (DuaDevicePlugin.getAutoAttendanceStatus).
//   tone: ok = working, warn = needs a look, bad = not working
export function autoSummary(st) {
  if (!st) return null;
  if (!st.available)
    return { tone: 'bad', text: 'This phone cannot store the settings safely, so automatic attendance is not available on it.' };
  if (!st.enrolled) return { tone: 'warn', text: 'Not set up on this phone yet. Close Dua and open it again.' };
  if (!(st.sites ?? []).length) return { tone: 'warn', text: 'The owner has not added the pharmacy place yet.' };
  if (st.problem) return { tone: 'bad', text: problemText(st.problem) };
  if (!st.registered)
    return { tone: 'warn', text: `Starting up${st.lastError ? ` (${String(st.lastError).slice(0, 60)})` : ''}. Check again in a minute.` };
  if (st.auto && !st.hasKey)
    return { tone: 'warn', text: 'Automatic recording is on, but this phone has no key yet. Press "Check again" while you are online.' };
  if (st.auto)
    return {
      tone: 'ok',
      text: 'Watching the pharmacy. Your arrival and your leaving are recorded automatically, even when the app is closed.',
    };
  return { tone: 'ok', text: 'Watching the pharmacy. Dua notices when you arrive and when you leave, even when the app is closed.' };
}

// "3 waiting to send" when the phone had no network and still holds events (they are sent as soon as it can).
export const pendingText = (st) =>
  st?.pending > 0 ? `${st.pending} ${st.pending === 1 ? 'event is' : 'events are'} waiting to be sent.` : '';

// The checklist under the summary. fix says which button repairs the line; advisory lines never block.
export function autoChecklist(st) {
  if (!st) return [];
  return [
    { id: 'precise', ok: Boolean(st.precise), label: 'Precise location allowed', fix: 'background' },
    { id: 'on', ok: Boolean(st.locationOn), label: 'Location switched on', fix: 'app' },
    { id: 'background', ok: Boolean(st.background), label: 'Location allowed all the time', fix: 'background' },
    { id: 'restricted', ok: !st.backgroundRestricted, label: 'Not restricted in the background', fix: 'battery' },
    { id: 'battery', ok: Boolean(st.batteryUnrestricted), label: 'Battery use unrestricted (recommended)', fix: 'battery', advisory: true },
    { id: 'registered', ok: Boolean(st.registered), label: 'Pharmacy registered with this phone' },
  ];
}

// Short reasons for the phone's journal (the long, sentence-style ones are REASON_TEXT, shown after a manual check-in).
const SHORT_REASON = {
  mock_location: 'fake location flagged',
  weak_signal: 'GPS signal too weak',
  no_place_set: 'no place set up',
  outside: 'not at the place',
  still_inside: 'still at the place',
  already_in: 'already checked in',
  not_in: 'was not checked in',
  older: 'a later record exists',
  stale: 'too old to use',
  back_inside: 'you came back',
  bad_event: 'could not be sent',
};

const kindWord = (kind) => (kind === 'out' ? 'Check-out' : 'Check-in');

// One line of the local journal: { type, at (ms), lat, lng, accuracy, kind, reason }.
// Detections (dwell, exit) come from Android; the others say what happened to the event afterwards.
export function journalLabel(entry, stableSeconds = 120) {
  const type = entry?.type;
  if (type === 'dwell')
    return `Arrived (stayed inside ${stableSeconds >= 60 ? `${Math.round(stableSeconds / 60)} min` : `${stableSeconds} s`})`;
  if (type === 'exit') return 'Left';
  if (type === 'enter') return 'Entered';
  if (type === 'recorded') return `${kindWord(entry.kind)} recorded`;
  if (type === 'refused') return `${kindWord(entry.kind)} refused`;
  if (type === 'ignored') return `${kindWord(entry.kind)} not needed`;
  if (type === 'cancelled') return 'Leaving cancelled';
  if (type === 'dropped') return `${kindWord(entry.kind)} not accepted`;
  if (type === 'no_fix') return 'No GPS position, nothing sent';
  if (type === 'off') return 'Automatic recording is off';
  if (type === 'key_rejected') return 'This phone was not accepted';
  if (String(type ?? '').startsWith('error:')) return 'Location service problem';
  return 'Unknown';
}

// The grey words after a journal line: why, in a few words.
export function journalDetail(entry) {
  if (entry?.type === 'key_rejected') return 'open Dua again to fix it';
  if (entry?.type === 'off') return 'test mode: listed only';
  return SHORT_REASON[entry?.reason] ?? '';
}

// How the journal line is coloured: ok = recorded, warn = something to look at, plain = everything else.
export function journalTone(entry) {
  if (entry?.type === 'recorded') return 'ok';
  if (['refused', 'dropped', 'no_fix', 'key_rejected'].includes(entry?.type) || String(entry?.type ?? '').startsWith('error:'))
    return 'warn';
  return 'plain';
}

// "17:01 → 18:30", "17:01 → still in", "—": one person's day on one line.
export function spanText(day) {
  if (!day?.first_in && !day?.firstIn) return '—';
  const from = timeLabel(day.first_in ?? day.firstIn);
  const out = day.open ? 'Still in' : timeLabel(day.last_out ?? day.lastOut);
  return `${from} → ${out}`;
}

// The owner's week as days, newest first, each with its people: [{ date, rows }]. Rows keep the order they came in.
export function groupByDay(rows) {
  const days = new Map();
  for (const r of rows ?? []) {
    if (!days.has(r.date)) days.set(r.date, []);
    days.get(r.date).push(r);
  }
  return [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, list]) => ({ date, rows: list }));
}

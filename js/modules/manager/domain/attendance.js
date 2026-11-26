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
};

export const reasonText = (reason) => REASON_TEXT[reason] ?? 'That could not be recorded. Try again.';

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

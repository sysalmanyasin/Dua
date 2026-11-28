// One automatic-attendance event sent by an Android phone with its per-device secret (never the web login; see migration 1403).
// Pure helper so it is unit tested in Node. The phone reports what it saw; the database decides (distance, order, duplicates).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[0-9a-f]{64}$/;

export type AttendanceEventRequest = {
  deviceId: string;
  secret: string;
  eventId: string;
  kind: 'in' | 'out';
  at: string; // ISO time the phone saw the event
  latitude: number;
  longitude: number;
  accuracy: number;
  mock: boolean;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseAttendanceEvent(body: Record<string, unknown> | null): AttendanceEventRequest | null {
  const deviceId = body?.device_id;
  const secret = body?.secret;
  const eventId = body?.event_id;
  const kind = body?.kind;
  const at = num(body?.at); // epoch milliseconds
  const latitude = num(body?.latitude);
  const longitude = num(body?.longitude);
  const accuracy = num(body?.accuracy);
  if (
    typeof deviceId !== 'string' || !UUID.test(deviceId) ||
    typeof secret !== 'string' || !SECRET.test(secret) ||
    typeof eventId !== 'string' || !UUID.test(eventId) ||
    (kind !== 'in' && kind !== 'out') ||
    at === null || at < 1_600_000_000_000 || at > 4_000_000_000_000 ||
    latitude === null || latitude < -90 || latitude > 90 ||
    longitude === null || longitude < -180 || longitude > 180 ||
    accuracy === null || accuracy < 0 || accuracy > 100000
  ) return null;
  return {
    deviceId: deviceId.toLowerCase(),
    secret,
    eventId: eventId.toLowerCase(),
    kind,
    at: new Date(at).toISOString(),
    latitude,
    longitude,
    accuracy,
    mock: body?.mock === true,
  };
}

// ───────── iPhone (Apple Shortcuts), see migration 1406 and docs/IPHONE_ATTENDANCE_DESIGN.md ─────────
// A shortcut builds its request by hand, so this reader is more forgiving than the strict Android one above about HOW a value is
// written (a number as text, the time in seconds or as an ISO date with its zone, an event id without dashes, a missing accuracy).
// It is never forgiving about WHAT is allowed: the ranges are the same, the database checks them again, and nothing here decides who
// the person is (the server finds the employee from the device; the request carries no employee id and none is read).
const HEX32 = /^[0-9a-f]{32}$/i;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;

const looseNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && NUMERIC.test(v.trim())) return Number(v.trim());
  return null;
};

// epoch milliseconds, epoch seconds (anything below 1e11), or an ISO-8601 time that names its zone
function looseTime(v: unknown): number | null {
  let ms: number | null = null;
  if (typeof v === 'string' && !NUMERIC.test(v.trim())) {
    ms = ZONED.test(v.trim()) ? Date.parse(v.trim()) : NaN;
    if (!Number.isFinite(ms)) return null;
  } else {
    const n = looseNum(v);
    if (n === null) return null;
    ms = n < 1e11 ? n * 1000 : n;
  }
  return ms >= 1_600_000_000_000 && ms <= 4_000_000_000_000 ? Math.round(ms) : null;
}

const looseId = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (UUID.test(t)) return t.toLowerCase();
  if (HEX32.test(t)) {
    const h = t.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return null;
};

export type AttendanceRequest =
  | {
    type: 'event';
    deviceId: string;
    secret: string;
    eventId: string;
    kind: 'in' | 'out';
    at: string;
    latitude: number;
    longitude: number;
    accuracy: number | null; // an iPhone may not be able to report it
    mock: boolean;
  }
  | { type: 'test'; deviceId: string; secret: string; latitude: number; longitude: number; accuracy: number | null }
  | { type: 'confirm'; deviceId: string; secret: string };

export function parseAttendanceRequest(body: Record<string, unknown> | null): AttendanceRequest | null {
  // an Android event is read exactly as before
  const strict = parseAttendanceEvent(body);
  if (strict) return { type: 'event', ...strict };

  const deviceId = looseId(body?.device_id);
  const secret = body?.secret;
  if (deviceId === null || typeof secret !== 'string' || !SECRET.test(secret)) return null;
  const kind = typeof body?.kind === 'string' ? body.kind.trim().toLowerCase() : null;
  if (kind === 'confirm') return { type: 'confirm', deviceId, secret };

  const latitude = looseNum(body?.latitude);
  const longitude = looseNum(body?.longitude);
  const rawAccuracy = body?.accuracy;
  const missing = rawAccuracy === undefined || rawAccuracy === null || (typeof rawAccuracy === 'string' && rawAccuracy.trim() === '');
  const accuracy = missing ? null : looseNum(rawAccuracy);
  if (
    latitude === null || latitude < -90 || latitude > 90 ||
    longitude === null || longitude < -180 || longitude > 180 ||
    (!missing && (accuracy === null || accuracy < 0 || accuracy > 100000))
  ) return null;
  if (kind === 'test') return { type: 'test', deviceId, secret, latitude, longitude, accuracy };
  if (kind !== 'in' && kind !== 'out') return null;

  const eventId = looseId(body?.event_id);
  const at = looseTime(body?.at);
  if (eventId === null || at === null) return null;
  return { type: 'event', deviceId, secret, eventId, kind, at: new Date(at).toISOString(), latitude, longitude, accuracy, mock: false };
}

// Enrolment (the setup shortcut): look at a code, or swap it for the device secret. The code is 64 hex characters made by the database.
const TOKEN = /^[0-9a-f]{64}$/;
export type EnrolRequest = { action: 'peek'; token: string } | { action: 'consume'; token: string; deviceName: string | null };

export function parseEnrolRequest(body: Record<string, unknown> | null): EnrolRequest | null {
  const action = body?.action;
  const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : null;
  if (token === null || !TOKEN.test(token)) return null;
  if (action === 'peek') return { action, token };
  if (action !== 'consume') return null;
  const raw = body?.device_name;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return null;
  // a name for the owner's list only: control characters removed, kept short
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) : '';
  return { action, token, deviceName: name === '' ? null : name };
}

// The phone's own tracking report (see migration 1404): sent every 15 minutes with the same device secret as the events.
// It carries no location at all: only which problem the phone found (or none) and how many events are still waiting to be sent.
export const HEALTH_STATES = [
  'no_precise_location',
  'location_off',
  'no_background_location',
  'background_restricted',
  'not_registered',
] as const;

export type AttendanceHealthRequest = {
  deviceId: string;
  secret: string;
  state: (typeof HEALTH_STATES)[number] | null; // null = everything works
  pending: number;
};

export function parseAttendanceHealth(body: Record<string, unknown> | null): AttendanceHealthRequest | null {
  const deviceId = body?.device_id;
  const secret = body?.secret;
  const state = body?.state ?? null;
  const pending = body?.pending;
  if (
    typeof deviceId !== 'string' || !UUID.test(deviceId) ||
    typeof secret !== 'string' || !SECRET.test(secret) ||
    (state !== null && !(HEALTH_STATES as readonly unknown[]).includes(state)) ||
    typeof pending !== 'number' || !Number.isInteger(pending) || pending < 0 || pending > 1000
  ) return null;
  return { deviceId: deviceId.toLowerCase(), secret, state: state as AttendanceHealthRequest['state'], pending };
}

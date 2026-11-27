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

// What a device needs in order to bill without a connection, kept per person and per device:
//   * the offline GRANT: a secret the server issued after this person typed their PIN correctly online (the server keeps only its hash),
//     plus a local PBKDF2 verifier of that PIN so it can be checked offline;
//   * the person's discount limits and whether saving needs a PIN, as last downloaded.
// Wrong PINs are counted here too (5 wrong = 15 minutes locked), though a person with the device can clear browser data: the real
// protection is the server, which will not accept an invoice without the grant, and checks limits and the device again on sync.
import { checkVerifier, makeVerifier } from './localPin.js';

const MAX_WRONG = 5;
const LOCK_MS = 15 * 60_000;

export function createKit({ store, api, deviceId, userId, now = () => Date.now() }) {
  const gKey = () => `grant:${userId()}:${deviceId}`;
  const lKey = () => `limits:${userId()}`;
  const pKey = () => `pinlock:${userId()}`;

  const hasGrant = async () => !!(await store.kvGet(gKey()));
  const getLimits = () => store.kvGet(lKey());

  /** Online: download the person's limits and PIN rule. */
  async function refreshLimits() {
    const l = await api.myLimits();
    await store.kvSet(lKey(), { ...l, fetchedAt: new Date(now()).toISOString() });
    return l;
  }

  /** Online: prove the PIN to the server and keep the grant. Returns the server's answer ({ ok, code, message }). */
  async function earnGrant(pin) {
    const r = await api.offlineGrant(deviceId, pin);
    if (r?.ok)
      await store.kvSet(gKey(), {
        secret: r.secret,
        verifier: await makeVerifier(pin),
        pinSetAt: r.pin_set_at,
        savedAt: new Date(now()).toISOString(),
      });
    return r;
  }

  /** After a successful ONLINE save with the PIN: make sure the grant exists and still matches this PIN (the owner may have changed it). */
  async function afterOnlineSave(pin) {
    try {
      const g = await store.kvGet(gKey());
      if (!g || !(await checkVerifier(pin, g.verifier))) await earnGrant(pin);
      await refreshLimits();
    } catch {
      /* best effort: the save itself already succeeded */
    }
  }

  /** Is this device ready to take a bill offline for this person? */
  async function readiness() {
    const [limits, grant] = await Promise.all([getLimits(), store.kvGet(gKey())]);
    const pinNeeded = limits ? limits.pin_required !== false : true;
    if (!limits) return { ready: false, why: 'Limits not downloaded yet. Open this page online once and save a bill.' };
    if (limits.has_pin === false && pinNeeded) return { ready: false, why: 'No PIN has been set for you. Ask the owner.' };
    if (pinNeeded && !grant)
      return { ready: false, why: 'Offline billing is not set up on this device yet. Save one bill online, or press "Prepare offline".' };
    return { ready: true, limits, pinNeeded };
  }

  /** Offline PIN check. { ok:true, proof } (proof null when no PIN is needed) or { ok:false, code, message }. */
  async function verifyPinLocally(pin) {
    const r = await readiness();
    if (!r.ready) return { ok: false, code: 'not_ready', message: r.why };
    if (!r.pinNeeded) return { ok: true, proof: null, limits: r.limits };
    const lock = (await store.kvGet(pKey())) ?? { count: 0, until: 0 };
    if (lock.until > now()) return { ok: false, code: 'locked', message: 'Too many wrong PINs. Try again in 15 minutes.' };
    const g = await store.kvGet(gKey());
    if (await checkVerifier(pin, g.verifier)) {
      await store.kvSet(pKey(), { count: 0, until: 0 });
      return { ok: true, proof: g.secret, limits: r.limits };
    }
    const count = lock.count + 1;
    await store.kvSet(pKey(), count >= MAX_WRONG ? { count: 0, until: now() + LOCK_MS } : { count, until: 0 });
    return { ok: false, code: 'bad_pin', message: 'Wrong PIN.' };
  }

  return { hasGrant, getLimits, refreshLimits, earnGrant, afterOnlineSave, readiness, verifyPinLocally };
}

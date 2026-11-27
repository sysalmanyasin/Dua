// The bridge between the web app and the Dua Android app (Capacitor). In an ordinary browser every function here does nothing.
//
// The app shell injects window.Capacitor into the live site. We use only two native plugins, and only through that object (the CSP forbids
// loading anything else): Capacitor's PushNotifications (Firebase push) and our own DuaDevice (android/.../DuaDevicePlugin.java: install id,
// location with Android's mock flag, the home-screen widget's saved secret, the automatic-attendance geofence). If the shell is an older APK without a plugin, that part is
// skipped and the rest keeps working.
import { getConfig } from './config.js';
import { log } from './logger.js';
import { db } from './supabase.js';

export const inApp = (g = globalThis) => Boolean(g.Capacitor?.isNativePlatform?.());
const plugin = (name, g = globalThis) => g.Capacitor?.Plugins?.[name] ?? null;
const has = (ctx, key) => (ctx?.permissions?.has ? ctx.permissions.has(key) : (ctx?.permissions ?? []).includes(key));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

// Only a hash route of this very site, never a link typed by anybody else.
export const safeRoute = (href) => (typeof href === 'string' && /^#\/[a-z0-9/_-]*$/.test(href) ? href : null);

const wired = new WeakSet(); // push plugins that already have our listeners (so a second sign-in does not double them)

async function setupPush(push, deviceId, version, g) {
  await push.createChannel({
    id: 'dua_alerts',
    name: 'Dua alerts',
    description: 'Closings, audits and other updates',
    importance: 3,
    visibility: 0,
  });
  await push.createChannel({
    id: 'dua_urgent',
    name: 'Dua urgent alerts',
    description: 'Backup failures and other urgent problems',
    importance: 5,
    visibility: 0,
  });
  let perm = await push.checkPermissions();
  if (perm.receive !== 'granted') perm = await push.requestPermissions();
  if (perm.receive !== 'granted') return false;
  if (!wired.has(push)) {
    wired.add(push);
    // Firebase may issue a new address at any time; it is saved each time.
    push.addListener('registration', async (t) => {
      const { error } = await db().rpc('app_device_register', {
        p_device_id: deviceId,
        p_fcm_token: t?.value,
        p_app_version: version,
        p_want_widget: false,
      });
      if (error) log.error('push registration not saved', { code: error.code });
    });
    push.addListener('registrationError', (e) =>
      log.error('push registration failed', { message: String(e?.error ?? 'unknown').slice(0, 120) }),
    );
    push.addListener('pushNotificationActionPerformed', (a) => {
      const route = safeRoute(a?.notification?.data?.href);
      if (route) g.location.hash = route;
    });
  }
  await push.register();
  return true;
}

// The widget never uses the web login: it gets its own secret, once, and the phone keeps it in encrypted storage.
async function setupWidget(ctx, dev, deviceId, version) {
  if (!dev.getWidgetState) return;
  if (!(has(ctx, 'candela.today_total') || has(ctx, 'candela.view'))) {
    await dev.clearWidgetConfig();
    await db().rpc('app_widget_clear', { p_device_id: deviceId });
    return;
  }
  const { data } = await db().auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) return;
  const state = await dev.getWidgetState();
  if (state?.configured && state.userId === userId) return;
  const { data: res, error } = await db().rpc('app_device_register', {
    p_device_id: deviceId,
    p_fcm_token: null,
    p_app_version: version,
    p_want_widget: true,
  });
  if (error || !res?.widget_secret) return log.error('widget secret not issued', { code: error?.code });
  await dev.saveWidgetConfig({ userId, deviceId, secret: res.widget_secret, endpoint: `${getConfig().functionsUrl}/widget-today` });
}

// True when the phone already watches exactly what the server says, so nothing needs registering again
// (registering restarts the stability timer, so it is skipped when nothing changed).
export function sameWatch(st, data) {
  if (!st?.enrolled) return false;
  const want = data.sites ?? [];
  const have = st.sites ?? [];
  if (Number(st.stableSeconds) !== Number(data.stable_seconds) || have.length !== want.length) return false;
  if (want.length && !st.registered) return false;
  // the owner's switch, the accuracy limit, and (when the switch is on) the phone's own key
  if (Boolean(st.auto) !== Boolean(data.auto_enabled)) return false;
  if (data.auto_enabled && (!st.hasKey || Number(st.maxAccuracy) !== Number(data.max_accuracy_m))) return false;
  return want.every((w) =>
    have.some(
      (h) =>
        h.id === w.id &&
        Number(h.latitude) === Number(w.latitude) &&
        Number(h.longitude) === Number(w.longitude) &&
        Number(h.radius) === Number(w.radius_m),
    ),
  );
}

// Reads the places from the server and gives them to the phone. Used at start-up and by the Attendance page ("Check again", and after the
// owner changes a place), so a place added after Dua was opened reaches the phone without closing the app. Returns the phone's status.
export async function syncAttendance(g = globalThis) {
  const dev = plugin('DuaDevice', g);
  if (!inApp(g) || !dev?.startAutoAttendance) return null;
  const { data: session } = await db().auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return null;
  const { data, error } = await db().rpc('mgmt_attendance_my_site');
  // A network or server problem is not a reason to stop watching: keep what the phone already has.
  if (error || !data) {
    log.warn('attendance place not read', { code: error?.code });
    return null;
  }
  const st = await dev.getAutoAttendanceStatus();
  if (sameWatch(st, data)) return st;
  const settings = {
    userId,
    stableSeconds: Number(data.stable_seconds),
    maxAccuracy: Number(data.max_accuracy_m),
    auto: data.auto_enabled === true,
    sites: (data.sites ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      radius: Number(s.radius_m),
    })),
  };
  if (settings.auto) {
    // The owner switched automatic recording on: this phone reports arrivals and departures with a key of its own, because the web
    // login is not available while Dua is closed. The key works for that one purpose only; the server checks it on every event.
    const { deviceId, version } = await dev.getDeviceInfo();
    settings.deviceId = deviceId;
    settings.endpoint = `${getConfig().functionsUrl}/attendance-event`;
    if (!st?.hasKey) {
      // a phone that refused notifications has no device row yet
      await db().rpc('app_device_register', { p_device_id: deviceId, p_fcm_token: null, p_app_version: version, p_want_widget: false });
      const { data: key, error: keyError } = await db().rpc('app_device_attendance_enroll', { p_device_id: deviceId });
      if (keyError || !key?.secret) log.warn('attendance key not issued', { code: keyError?.code });
      else settings.secret = key.secret;
    }
  }
  return dev.startAutoAttendance(settings);
}

// Automatic attendance: the phone watches the pharmacy's geofence by itself (DuaDevicePlugin, AttendanceGeofence.java). The server only
// tells a phone about the places if the person holds attendance.check_in; a phone whose person lost that right forgets them.
async function setupAttendance(ctx, dev, g) {
  if (!dev.startAutoAttendance) return; // an older APK without the geofence code
  if (!has(ctx, 'attendance.check_in')) {
    await dev.stopAutoAttendance();
    return;
  }
  await syncAttendance(g);
}

// Called once the person is signed in and the shell has started. Never throws.
export async function startNative(ctx, g = globalThis) {
  if (!inApp(g)) return false;
  const dev = plugin('DuaDevice', g);
  if (!dev) return false;
  try {
    const { deviceId, version } = await dev.getDeviceInfo();
    await setupWidget(ctx, dev, deviceId, version);
    try {
      await setupAttendance(ctx, dev, g); // its own try: a problem here must not stop push registration
    } catch (e) {
      log.error('automatic attendance setup failed', { message: String(e?.message ?? e).slice(0, 120) });
    }
    const push = plugin('PushNotifications', g);
    if (push) await setupPush(push, deviceId, version, g);
    return true;
  } catch (e) {
    log.error('app setup failed', { message: String(e?.message ?? e).slice(0, 120) });
    return false;
  }
}

// Called at sign-out, BEFORE the session is cleared: this phone stops receiving this person's alerts and the widget stops. Never throws.
export async function stopNative(g = globalThis) {
  if (!inApp(g)) return;
  const dev = plugin('DuaDevice', g);
  if (!dev) return;
  try {
    const { deviceId } = await withTimeout(dev.getDeviceInfo(), 2000);
    await withTimeout(db().rpc('app_device_unregister', { p_device_id: deviceId }), 3000);
  } catch {
    // Offline sign-out: the server row is cleaned up the next time anyone signs in on this phone.
  }
  try {
    await dev.clearWidgetConfig();
  } catch {
    // nothing to clear
  }
  try {
    if (dev.stopAutoAttendance) await dev.stopAutoAttendance(); // this phone stops watching the pharmacy for this person
  } catch {
    // nothing to stop
  }
  try {
    await plugin('PushNotifications', g)?.unregister?.();
  } catch {
    // nothing to unregister
  }
}

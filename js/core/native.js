// The bridge between the web app and the Dua Android app (Capacitor). In an ordinary browser every function here does nothing.
//
// The app shell injects window.Capacitor into the live site. We use only two native plugins, and only through that object (the CSP forbids
// loading anything else): Capacitor's PushNotifications (Firebase push) and our own DuaDevice (android/.../DuaDevicePlugin.java: install id,
// location with Android's mock flag, the home-screen widget's saved secret). If the shell is an older APK without a plugin, that part is
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

// Called once the person is signed in and the shell has started. Never throws.
export async function startNative(ctx, g = globalThis) {
  if (!inApp(g)) return false;
  const dev = plugin('DuaDevice', g);
  if (!dev) return false;
  try {
    const { deviceId, version } = await dev.getDeviceInfo();
    await setupWidget(ctx, dev, deviceId, version);
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
    await plugin('PushNotifications', g)?.unregister?.();
  } catch {
    // nothing to unregister
  }
}

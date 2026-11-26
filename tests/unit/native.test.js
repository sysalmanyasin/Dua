import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const getSession = vi.fn();
vi.mock('../../js/core/supabase.js', () => ({ db: () => ({ rpc, auth: { getSession } }) }));
vi.mock('../../js/core/config.js', () => ({ getConfig: () => ({ functionsUrl: 'https://x.supabase.co/functions/v1' }) }));
vi.mock('../../js/core/logger.js', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const { inApp, safeRoute, startNative, stopNative } = await import('../../js/core/native.js');

const handlers = {};
const makeGlobal = ({ perm = 'granted', widget = { configured: false }, push = true, dua = true } = {}) => {
  const PushNotifications = {
    createChannel: vi.fn(async () => {}),
    checkPermissions: vi.fn(async () => ({ receive: perm })),
    requestPermissions: vi.fn(async () => ({ receive: perm === 'denied' ? 'denied' : 'granted' })),
    addListener: vi.fn((name, cb) => {
      handlers[name] = cb;
    }),
    register: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
  };
  const DuaDevice = {
    getDeviceInfo: vi.fn(async () => ({ deviceId: 'dev-1', version: '1.0.0' })),
    getWidgetState: vi.fn(async () => widget),
    saveWidgetConfig: vi.fn(async () => {}),
    clearWidgetConfig: vi.fn(async () => {}),
  };
  return {
    PushNotifications,
    DuaDevice,
    g: {
      location: { hash: '' },
      Capacitor: { isNativePlatform: () => true, Plugins: { ...(push ? { PushNotifications } : {}), ...(dua ? { DuaDevice } : {}) } },
    },
  };
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
});

describe('in a browser', () => {
  it('does nothing at all', async () => {
    expect(inApp({})).toBe(false);
    expect(await startNative({ permissions: [] }, {})).toBe(false);
    await stopNative({});
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('in the Android app', () => {
  it('registers push: channels first, permission asked, token saved when Firebase issues it', async () => {
    const { g, PushNotifications } = makeGlobal();
    expect(await startNative({ permissions: [] }, g)).toBe(true);
    expect(PushNotifications.createChannel.mock.calls.map((c) => c[0].id)).toEqual(['dua_alerts', 'dua_urgent']);
    expect(PushNotifications.register).toHaveBeenCalled();
    await handlers.registration({ value: 'FCM-TOKEN' });
    expect(rpc).toHaveBeenCalledWith('app_device_register', {
      p_device_id: 'dev-1',
      p_fcm_token: 'FCM-TOKEN',
      p_app_version: '1.0.0',
      p_want_widget: false,
    });
  });

  it('asks for notification permission and stops quietly when it is refused', async () => {
    const { g, PushNotifications } = makeGlobal({ perm: 'denied' });
    await startNative({ permissions: [] }, g);
    expect(PushNotifications.requestPermissions).toHaveBeenCalled();
    expect(PushNotifications.register).not.toHaveBeenCalled();
  });

  it('opens the screen named in a tapped notification, but only a route of this site', async () => {
    const { g } = makeGlobal();
    await startNative({ permissions: [] }, g);
    handlers.pushNotificationActionPerformed({ notification: { data: { href: '#/tools' } } });
    expect(g.location.hash).toBe('#/tools');
    handlers.pushNotificationActionPerformed({ notification: { data: { href: 'https://evil.example/' } } });
    handlers.pushNotificationActionPerformed({ notification: { data: { href: 'javascript:alert(1)' } } });
    expect(g.location.hash).toBe('#/tools');
    expect(safeRoute('#/manager/attendance')).toBe('#/manager/attendance');
    expect(safeRoute('#//evil')).toBe('#//evil'.match(/^#\/[a-z0-9/_-]*$/) ? '#//evil' : null);
    expect(safeRoute(undefined)).toBeNull();
  });

  it('gives the widget its own secret, once, for a person with the Candela permission', async () => {
    rpc.mockResolvedValue({ data: { widget_secret: 'S'.repeat(64) }, error: null });
    const { g, DuaDevice } = makeGlobal();
    await startNative({ permissions: ['candela.today_total'] }, g);
    expect(rpc).toHaveBeenCalledWith('app_device_register', {
      p_device_id: 'dev-1',
      p_fcm_token: null,
      p_app_version: '1.0.0',
      p_want_widget: true,
    });
    expect(DuaDevice.saveWidgetConfig).toHaveBeenCalledWith({
      userId: 'user-1',
      deviceId: 'dev-1',
      secret: 'S'.repeat(64),
      endpoint: 'https://x.supabase.co/functions/v1/widget-today',
    });
  });

  it('does not ask for a new secret when this person already has one on this phone', async () => {
    const { g, DuaDevice } = makeGlobal({ widget: { configured: true, userId: 'user-1' } });
    await startNative({ permissions: ['candela.view'] }, g);
    expect(rpc.mock.calls.some((c) => c[1]?.p_want_widget === true)).toBe(false);
    expect(DuaDevice.saveWidgetConfig).not.toHaveBeenCalled();
  });

  it("replaces another person's widget when someone else signs in on the same phone", async () => {
    rpc.mockResolvedValue({ data: { widget_secret: 'T'.repeat(64) }, error: null });
    const { g, DuaDevice } = makeGlobal({ widget: { configured: true, userId: 'someone-else' } });
    await startNative({ permissions: ['candela.view'] }, g);
    expect(DuaDevice.saveWidgetConfig).toHaveBeenCalledTimes(1);
  });

  it('switches the widget off for a person without the permission', async () => {
    const { g, DuaDevice } = makeGlobal();
    await startNative({ permissions: ['sales.enter'] }, g);
    expect(DuaDevice.clearWidgetConfig).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('app_widget_clear', { p_device_id: 'dev-1' });
    expect(DuaDevice.saveWidgetConfig).not.toHaveBeenCalled();
  });

  it('works with an older shell that lacks a plugin, and never throws', async () => {
    expect(await startNative({ permissions: [] }, makeGlobal({ dua: false }).g)).toBe(false);
    const { g, DuaDevice } = makeGlobal({ push: false });
    expect(await startNative({ permissions: [] }, g)).toBe(true);
    DuaDevice.getDeviceInfo.mockRejectedValue(new Error('boom'));
    expect(await startNative({ permissions: [] }, g)).toBe(false);
  });

  it('at sign-out removes the device, the widget and the push address', async () => {
    const { g, DuaDevice, PushNotifications } = makeGlobal();
    await stopNative(g);
    expect(rpc).toHaveBeenCalledWith('app_device_unregister', { p_device_id: 'dev-1' });
    expect(DuaDevice.clearWidgetConfig).toHaveBeenCalled();
    expect(PushNotifications.unregister).toHaveBeenCalled();
  });

  it('still clears the phone when the server cannot be reached at sign-out', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    const { g, DuaDevice, PushNotifications } = makeGlobal();
    await expect(stopNative(g)).resolves.toBeUndefined();
    expect(DuaDevice.clearWidgetConfig).toHaveBeenCalled();
    expect(PushNotifications.unregister).toHaveBeenCalled();
  });
});

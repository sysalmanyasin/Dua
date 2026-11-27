// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTrackingBanner } from '../../js/core/trackingBanner.js';
import { trackingProblem } from '../../js/core/native.js';

const ctx = { permissions: new Set(['attendance.check_in']) };
const shell = (status) => ({
  Capacitor: { isNativePlatform: () => true, Plugins: { DuaDevice: { getAutoAttendanceStatus: vi.fn(async () => status) } } },
});
const working = { enrolled: true, auto: true, hasKey: true, problem: null };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('trackingProblem', () => {
  it('is nothing when everything works', async () => {
    expect(await trackingProblem(ctx, shell(working))).toBeNull();
  });
  it('names the first problem the phone found, in plain words', async () => {
    const p = await trackingProblem(ctx, shell({ ...working, problem: 'no_background_location' }));
    expect(p.code).toBe('no_background_location');
    expect(p.text).toMatch(/all the time/);
    expect((await trackingProblem(ctx, shell({ ...working, problem: 'location_off' }))).text).toMatch(/switch it on/i);
    expect((await trackingProblem(ctx, shell({ ...working, problem: 'background_restricted' }))).text).toMatch(/Unrestricted/);
  });
  it('asks to finish the setup when the phone has no key yet', async () => {
    expect((await trackingProblem(ctx, shell({ ...working, hasKey: false }))).code).toBe('no_key');
  });
  it('says nothing when recording is off, the phone is not set up, or the app is older', async () => {
    expect(await trackingProblem(ctx, shell({ ...working, auto: false, problem: 'location_off' }))).toBeNull();
    expect(await trackingProblem(ctx, shell({ ...working, enrolled: false, problem: 'location_off' }))).toBeNull();
    expect(await trackingProblem(ctx, shell({ enrolled: true, auto: true, problem: 'location_off' }))).toBeNull(); // no hasKey: older app
  });
  it('says nothing for a person who may not check in, in a browser, or in an app without the plugin', async () => {
    const bad = shell({ ...working, problem: 'location_off' });
    expect(await trackingProblem({ permissions: new Set() }, bad)).toBeNull();
    expect(await trackingProblem(ctx, {})).toBeNull();
    expect(await trackingProblem(ctx, { Capacitor: { isNativePlatform: () => true, Plugins: {} } })).toBeNull();
  });
});

describe('the red strip', () => {
  let el;
  beforeEach(() => {
    vi.useRealTimers();
    el = document.createElement('div');
    el.hidden = true;
    document.body.append(el);
  });
  afterEach(() => el.remove());

  it('shows the problem with a link to Attendance, and nothing blocks', async () => {
    const stop = startTrackingBanner(el, ctx, shell({ ...working, problem: 'location_off' }));
    await flush();
    expect(el.hidden).toBe(false);
    expect(el.textContent).toMatch(/not being recorded/);
    expect(el.textContent).toMatch(/Location is switched off/);
    expect(el.querySelector('a').getAttribute('href')).toBe('#/manager/attendance');
    stop();
  });
  it('stays hidden when everything works', async () => {
    const stop = startTrackingBanner(el, ctx, shell(working));
    await flush();
    expect(el.hidden).toBe(true);
    stop();
  });
  it('goes away by itself when the phone is fixed (checked when Dua is shown again)', async () => {
    const g = shell({ ...working, problem: 'location_off' });
    const stop = startTrackingBanner(el, ctx, g);
    await flush();
    expect(el.hidden).toBe(false);
    g.Capacitor.Plugins.DuaDevice.getAutoAttendanceStatus.mockResolvedValue(working);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(el.hidden).toBe(true);
    expect(el.children.length).toBe(0);
    stop();
  });
  it('is quiet when the phone cannot be read, and does nothing in a browser', async () => {
    const g = shell(working);
    g.Capacitor.Plugins.DuaDevice.getAutoAttendanceStatus.mockRejectedValue(new Error('x'));
    const stop = startTrackingBanner(el, ctx, g);
    await flush();
    expect(el.hidden).toBe(true);
    stop();
    const stopBrowser = startTrackingBanner(el, ctx, {});
    expect(el.hidden).toBe(true);
    stopBrowser();
  });
  it('stops checking after it is stopped', async () => {
    const g = shell({ ...working, problem: 'location_off' });
    const stop = startTrackingBanner(el, ctx, g);
    await flush();
    stop();
    const calls = g.Capacitor.Plugins.DuaDevice.getAutoAttendanceStatus.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(g.Capacitor.Plugins.DuaDevice.getAutoAttendanceStatus.mock.calls.length).toBe(calls);
  });
});

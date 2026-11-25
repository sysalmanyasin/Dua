// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coordinateText,
  dayRows,
  parseCoordinates,
  reasonText,
  refusedAttempts,
  resultMessage,
  timeLabel,
  validateAccuracy,
  validatePlace,
} from '../../js/modules/manager/domain/attendance.js';

describe('attendance: wording', () => {
  it('gives every refusal reason a plain sentence', () => {
    for (const r of ['app_required', 'mock_location', 'weak_signal', 'no_place_set', 'outside', 'already_in', 'not_in'])
      expect(reasonText(r).length).toBeGreaterThan(20);
    expect(reasonText('something_new')).toMatch(/could not be recorded/);
  });
  it('words an accepted check-in with the place and the Pakistan time', () => {
    const m = resultMessage({ ok: true, kind: 'in', place: 'Test Shop', at: '2026-11-25T04:05:00Z' });
    expect(m).toEqual({ ok: true, text: 'Checked in at Test Shop at 09:05.' });
    expect(resultMessage({ ok: true, kind: 'out', at: '2026-11-25T04:05:00Z' }).text).toBe('Checked out at 09:05.');
  });
  it('tells a person how far away they were', () => {
    const m = resultMessage({ ok: false, reason: 'outside', distance_m: 222.4 });
    expect(m.ok).toBe(false);
    expect(m.text).toContain('about 222 m away');
    expect(resultMessage(null).ok).toBe(false);
  });
  it('shows times in Pakistan time', () => {
    expect(timeLabel('2026-11-25T19:30:00Z')).toBe('00:30');
    expect(timeLabel(null)).toBe('—');
  });
});

describe('attendance: coordinates and limits', () => {
  it('reads "lat, lng" however a map app pastes it', () => {
    expect(parseCoordinates('10.5, 20.25')).toEqual({ lat: 10.5, lng: 20.25 });
    expect(parseCoordinates('10.5 20.25')).toEqual({ lat: 10.5, lng: 20.25 });
    expect(parseCoordinates(' 10.1234567 ;20 ')).toEqual({ lat: 10.123457, lng: 20 });
  });
  it('rejects anything else', () => {
    for (const bad of ['', '10', '10,20,30', 'a, b', '95, 20', '10, 181', null]) expect(parseCoordinates(bad)).toBeNull();
  });
  it('writes six decimals', () => expect(coordinateText(10, 20.5)).toBe('10.000000, 20.500000'));
  it('checks a place the way the database does', () => {
    const ok = { name: 'Shop', lat: 10, lng: 20, radius: 100 };
    expect(validatePlace(ok)).toBeNull();
    expect(validatePlace({ ...ok, name: ' ' })).toMatch(/name/);
    expect(validatePlace({ ...ok, lat: NaN })).toMatch(/latitude/);
    expect(validatePlace({ ...ok, radius: 19 })).toMatch(/20 to 2000/);
    expect(validatePlace({ ...ok, radius: 100.5 })).toMatch(/whole number/);
    expect(validateAccuracy(100)).toBeNull();
    expect(validateAccuracy(9)).toMatch(/10 to 500/);
  });
});

const rec = (o) => ({
  staff_id: 's1',
  name: 'Test A',
  business_date: '2026-11-25',
  status: 'accepted',
  kind: 'in',
  at: '2026-11-25T04:00:00Z',
  ...o,
});
describe('attendance: the owner day view', () => {
  it('shows first in, last out and who is in now', () => {
    const rows = dayRows(
      [
        rec({ kind: 'out', at: '2026-11-25T12:00:00Z' }),
        rec({ kind: 'in', at: '2026-11-25T04:00:00Z' }),
        rec({ kind: 'in', at: '2026-11-25T08:00:00Z' }),
        rec({ staff_id: 's2', name: 'Test B', kind: 'in', at: '2026-11-25T05:00:00Z' }),
      ],
      '2026-11-25',
    );
    expect(rows.map((r) => r.name)).toEqual(['Test A', 'Test B']);
    expect(rows[0]).toMatchObject({ firstIn: '2026-11-25T04:00:00Z', lastOut: '2026-11-25T12:00:00Z', present: false });
    expect(rows[1]).toMatchObject({ present: true, lastOut: null });
  });
  it('counts refused attempts without treating them as a check-in', () => {
    const rows = dayRows(
      [rec({ status: 'rejected', reject: 'outside' }), rec({ staff_id: 's2', name: 'Test B', kind: 'in', status: 'rejected' })],
      '2026-11-25',
    );
    expect(rows.every((r) => r.firstIn === null && r.present === false && r.refused === 1)).toBe(true);
  });
  it('ignores other days and lists refused attempts newest first', () => {
    const list = [
      rec({ business_date: '2026-11-24' }),
      rec({ status: 'rejected', at: '2026-11-25T01:00:00Z' }),
      rec({ status: 'rejected', at: '2026-11-25T03:00:00Z' }),
    ];
    expect(dayRows(list, '2026-11-25')).toHaveLength(1);
    expect(refusedAttempts(list, '2026-11-25').map((r) => r.at)).toEqual(['2026-11-25T03:00:00Z', '2026-11-25T01:00:00Z']);
  });
});

// ── the page ──
const api = {
  today: vi.fn(),
  checkIn: vi.fn(),
  list: vi.fn(),
  setup: vi.fn(),
  saveSite: vi.fn(),
  setConfig: vi.fn(),
  insideApp: vi.fn(),
  currentLocation: vi.fn(),
  locationProblem: vi.fn(() => 'Location is switched off for Dua.'),
};
vi.mock('../../js/modules/manager/data/attendanceApi.js', () => api);

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

const tick = () => new Promise((r) => setTimeout(r, 15));
const me = (o = {}) => ({ state: 'out', has_place: true, require_app: true, max_accuracy_m: 100, events: [], ...o });
let el;
async function open(permissions) {
  const { mount } = await import('../../js/modules/manager/ui/attendance.js');
  await mount(el, { ctx: { permissions } });
  await tick();
}

beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  Object.values(api).forEach((f) => f.mockReset?.());
  api.locationProblem.mockImplementation(() => 'Location is switched off for Dua.');
  api.insideApp.mockReturnValue(true);
  api.today.mockResolvedValue(me());
  api.list.mockResolvedValue([]);
  api.setup.mockResolvedValue({ config: { max_accuracy_m: 100, require_app: true }, sites: [] });
});
afterEach(() => {
  el.remove();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('attendance page', () => {
  it('shows a staff member only their own check-in', async () => {
    await open(['attendance.check_in']);
    expect(el.textContent).toContain('My attendance');
    expect(el.textContent).not.toContain('Attendance records');
    expect(el.textContent).not.toContain('Places and limits');
    expect(api.list).not.toHaveBeenCalled();
    expect(api.setup).not.toHaveBeenCalled();
  });

  it('sends the phone position and shows the server answer', async () => {
    api.currentLocation.mockResolvedValue({ lat: 10, lng: 20, accuracy: 12, mock: false, source: 'app' });
    api.checkIn.mockResolvedValue({ data: { ok: true, kind: 'in', place: 'Test Shop', at: '2026-11-25T04:05:00Z' }, error: null });
    await open(['attendance.check_in']);
    el.querySelector('[data-act="punch"]').click();
    await tick();
    expect(api.checkIn).toHaveBeenCalledTimes(1);
    const [kind, fix, key] = api.checkIn.mock.calls[0];
    expect(kind).toBe('in');
    expect(fix).toEqual({ lat: 10, lng: 20, accuracy: 12, mock: false, source: 'app' });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(el.textContent).toContain('Checked in at Test Shop at 09:05.');
  });

  it('says plainly when the server refuses', async () => {
    api.currentLocation.mockResolvedValue({ lat: 10.002, lng: 20, accuracy: 12, mock: false, source: 'app' });
    api.checkIn.mockResolvedValue({ data: { ok: false, reason: 'outside', distance_m: 222 }, error: null });
    await open(['attendance.check_in']);
    el.querySelector('[data-act="punch"]').click();
    await tick();
    expect(el.textContent).toContain('You are not at the pharmacy');
    expect(el.textContent).toContain('about 222 m away');
  });

  it('keeps the same key when the server could not be reached, so a retry cannot record twice', async () => {
    api.currentLocation.mockResolvedValue({ lat: 10, lng: 20, accuracy: 12, mock: false, source: 'app' });
    api.checkIn
      .mockResolvedValueOnce({ data: null, error: { message: 'network' } })
      .mockResolvedValueOnce({ data: { ok: true, kind: 'in', at: '2026-11-25T04:05:00Z' }, error: null });
    await open(['attendance.check_in']);
    el.querySelector('[data-act="punch"]').click();
    await tick();
    expect(el.textContent).toContain('Could not reach the server');
    el.querySelector('[data-act="punch"]').click();
    await tick();
    expect(api.checkIn.mock.calls[0][2]).toBe(api.checkIn.mock.calls[1][2]);
  });

  it('shows a location problem in plain words and does not call the server', async () => {
    api.currentLocation.mockRejectedValue({ code: 1 });
    await open(['attendance.check_in']);
    el.querySelector('[data-act="punch"]').click();
    await tick();
    expect(api.checkIn).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Location is switched off');
  });

  it('offers Check out when already in, and tells website users to use the app', async () => {
    api.today.mockResolvedValue(me({ state: 'in' }));
    api.insideApp.mockReturnValue(false);
    await open(['attendance.check_in']);
    expect(el.querySelector('[data-act="punch"]').textContent.trim()).toBe('Check out');
    expect(el.textContent).toContain('Open Dua in the Android app');
  });

  it('gives the owner the day view and the places, but only what the keys allow', async () => {
    api.list.mockResolvedValue([rec({ name: 'Test A' }), rec({ name: 'Test A', status: 'rejected', reason: 'outside', distance_m: 300 })]);
    api.setup.mockResolvedValue({
      config: { max_accuracy_m: 100, require_app: true },
      sites: [{ id: 'p1', name: 'Test Shop', latitude: 10, longitude: 20, radius_m: 100, active: true }],
    });
    await open(['attendance.view_all']);
    expect(el.textContent).toContain('Test A');
    expect(el.textContent).toContain('Refused attempts');
    expect(el.textContent).toContain('Test Shop');
    expect(el.querySelector('[data-act="add-site"]')).toBeNull();
    expect(el.querySelector('#at-acc')).toBeNull();
    expect(el.querySelector('[data-act="punch"]')).toBeNull();
  });

  it('lets the owner add a place, asks why, and saves with a key', async () => {
    api.saveSite.mockResolvedValue({ data: { id: 'p1' }, error: null });
    await open(['attendance.view_all', 'attendance.manage']);
    el.querySelector('[data-act="add-site"]').click();
    const dlg = document.querySelector('dialog');
    dlg.querySelector('#s-name').value = 'Test Shop';
    dlg.querySelector('#s-loc').value = '10.5, 20.25';
    dlg.querySelector('#s-rad').value = '80';
    dlg.querySelector('[data-ok]').click();
    await tick();
    const ask = [...document.querySelectorAll('dialog')].pop();
    const box = ask.querySelector('input, textarea');
    box.value = 'first place';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    ask.querySelector('.btn-primary, [data-ok]').click();
    await tick();
    expect(api.saveSite).toHaveBeenCalledTimes(1);
    const [site, reason, key] = api.saveSite.mock.calls[0];
    expect(site).toMatchObject({ id: null, name: 'Test Shop', lat: 10.5, lng: 20.25, radius: 80, active: true });
    expect(reason).toBe('first place');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a bad place before asking for a reason', async () => {
    await open(['attendance.view_all', 'attendance.manage']);
    el.querySelector('[data-act="add-site"]').click();
    const dlg = document.querySelector('dialog');
    dlg.querySelector('#s-name').value = 'Test Shop';
    dlg.querySelector('#s-loc').value = 'not a place';
    dlg.querySelector('[data-ok]').click();
    await tick();
    expect(dlg.querySelector('#s-err').textContent).toMatch(/latitude, longitude/);
    expect(api.saveSite).not.toHaveBeenCalled();
  });
});

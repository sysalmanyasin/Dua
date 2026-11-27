// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayPkt } from '../../js/shared/format.js';
import {
  addDays,
  autoChecklist,
  autoSummary,
  coordinateText,
  dayRows,
  dayState,
  groupByDay,
  journalDetail,
  journalLabel,
  journalTone,
  pendingText,
  spanText,
  parseCoordinates,
  problemText,
  reasonText,
  refusedAttempts,
  refusedDetail,
  resultMessage,
  timeLabel,
  validateAccuracy,
  validatePlace,
  validateStable,
  workedText,
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

describe('attendance: refused attempt detail', () => {
  it('shows the distance only when the server measured one', () => {
    expect(refusedDetail({ distance_m: 1234.4 })).toBe(' (1234 m from the nearest place)');
    expect(refusedDetail({ distance_m: 50, mock: true })).toBe(' (50 m from the nearest place, mock location flagged)');
    expect(refusedDetail({ distance_m: null })).toBe('');
    expect(refusedDetail({ distance_m: null, mock: true })).toBe(' (mock location flagged)');
    expect(refusedDetail({})).toBe('');
  });
});

describe('attendance: time at work and dates', () => {
  it('words minutes the way a person reads them', () => {
    expect(workedText(510)).toBe('8 h 30 min');
    expect(workedText(480)).toBe('8 h');
    expect(workedText(45)).toBe('45 min');
    for (const none of [0, -5, null, undefined, 'x']) expect(workedText(none)).toBe('—');
  });
  it('moves a business date by whole days across month and year ends, whatever the phone time zone', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-26', -6)).toBe('2026-11-20');
  });
  it('says where a day stands', () => {
    expect(dayState({ open: true, last_out: null })).toBe('Still in');
    expect(dayState({ open: false, last_out: '2026-11-25T13:00:00Z' })).toBe('Done');
    expect(dayState({ open: false, last_out: null })).toBe('—');
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

describe('automatic attendance: what the card says', () => {
  const good = {
    available: true,
    enrolled: true,
    precise: true,
    background: true,
    locationOn: true,
    backgroundRestricted: false,
    batteryUnrestricted: true,
    problem: null,
    registered: true,
    stableSeconds: 120,
    sites: [{ id: 'a', name: 'Test Shop', radius: 100 }],
  };
  it('says working only when everything is in place', () => {
    expect(autoSummary(good).tone).toBe('ok');
    expect(autoSummary(null)).toBeNull();
  });
  it('explains each way it can fail, most basic first', () => {
    expect(autoSummary({ ...good, available: false }).tone).toBe('bad');
    expect(autoSummary({ ...good, enrolled: false }).text).toMatch(/open it again/);
    expect(autoSummary({ ...good, sites: [] }).text).toMatch(/owner has not added/);
    expect(autoSummary({ ...good, problem: 'no_background_location' }).text).toMatch(/all the time/);
    expect(autoSummary({ ...good, problem: 'location_off' }).tone).toBe('bad');
    expect(autoSummary({ ...good, registered: false, lastError: 'register_failed:x' }).tone).toBe('warn');
  });
  it('has a plain sentence for every problem code, and a safe one for an unknown code', () => {
    for (const c of ['no_precise_location', 'location_off', 'no_background_location', 'background_restricted'])
      expect(problemText(c).length).toBeGreaterThan(20);
    expect(problemText('something_new')).toMatch(/not working/);
  });
  it('lists what is wrong and points each line at its repair', () => {
    expect(autoChecklist(good).every((c) => c.ok)).toBe(true);
    const bad = autoChecklist({ ...good, background: false, backgroundRestricted: true, batteryUnrestricted: false, registered: false });
    const fails = Object.fromEntries(bad.filter((c) => !c.ok).map((c) => [c.id, c]));
    expect(Object.keys(fails).sort()).toEqual(['background', 'battery', 'registered', 'restricted']);
    expect(fails.background.fix).toBe('background');
    expect(fails.restricted.fix).toBe('battery');
    expect(fails.battery.advisory).toBe(true);
    expect(autoChecklist(null)).toEqual([]);
  });
  it('words the journal', () => {
    expect(journalLabel({ type: 'dwell' }, 120)).toBe('Arrived (stayed inside 2 min)');
    expect(journalLabel({ type: 'dwell' }, 45)).toBe('Arrived (stayed inside 45 s)');
    expect(journalLabel({ type: 'exit' })).toBe('Left');
    expect(journalLabel({ type: 'enter' })).toBe('Entered');
    expect(journalLabel({ type: 'error:1000' })).toBe('Location service problem');
    expect(journalLabel({ type: 'x' })).toBe('Unknown');
    expect(journalLabel(null)).toBe('Unknown');
  });
  it('keeps the stay time inside the database range', () => {
    for (const ok of [30, 120, 600]) expect(validateStable(ok)).toBeNull();
    for (const bad of [29, 601, 1.5, NaN, 0]) expect(validateStable(bad)).toMatch(/30 to 600/);
  });
});

// ── the page ──
const api = {
  today: vi.fn(),
  myHistory: vi.fn(),
  summary: vi.fn(),
  checkIn: vi.fn(),
  list: vi.fn(),
  setup: vi.fn(),
  saveSite: vi.fn(),
  setConfig: vi.fn(),
  setStable: vi.fn(),
  setAuto: vi.fn(),
  autoSupported: vi.fn(),
  autoStatus: vi.fn(),
  syncPlaces: vi.fn(),
  askBackgroundLocation: vi.fn(),
  openBatterySettings: vi.fn(),
  openAppSettings: vi.fn(),
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
  api.myHistory.mockResolvedValue({ days: [], events: [] });
  api.summary.mockResolvedValue({ rows: [] });
  api.setup.mockResolvedValue({ config: { max_accuracy_m: 100, require_app: true, stable_seconds: 120 }, sites: [] });
});
afterEach(() => {
  el.remove();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe("automatic recording: the phone's story", () => {
  const base = {
    available: true,
    enrolled: true,
    problem: null,
    registered: true,
    stableSeconds: 120,
    sites: [{ id: 'a', name: 'Test Shop', radius: 100 }],
  };
  it("says what the owner's switch means for this phone", () => {
    expect(autoSummary({ ...base, auto: false }).text).toMatch(/notices when you arrive/);
    expect(autoSummary({ ...base, auto: true, hasKey: true })).toMatchObject({ tone: 'ok' });
    expect(autoSummary({ ...base, auto: true, hasKey: true }).text).toMatch(/recorded automatically/);
    expect(autoSummary({ ...base, auto: true, hasKey: false })).toMatchObject({ tone: 'warn' });
    expect(autoSummary({ ...base, auto: true, hasKey: false }).text).toMatch(/no key yet/);
    // a problem on the phone still comes first
    expect(autoSummary({ ...base, auto: true, hasKey: true, problem: 'location_off' }).tone).toBe('bad');
  });
  it('counts events waiting to be sent', () => {
    expect(pendingText({ pending: 0 })).toBe('');
    expect(pendingText(null)).toBe('');
    expect(pendingText({ pending: 1 })).toBe('1 event is waiting to be sent.');
    expect(pendingText({ pending: 3 })).toBe('3 events are waiting to be sent.');
  });
  it('words what happened to each event', () => {
    expect(journalLabel({ type: 'recorded', kind: 'in' })).toBe('Check-in recorded');
    expect(journalLabel({ type: 'recorded', kind: 'out' })).toBe('Check-out recorded');
    expect(journalLabel({ type: 'refused', kind: 'in', reason: 'weak_signal' })).toBe('Check-in refused');
    expect(journalLabel({ type: 'ignored', kind: 'in', reason: 'already_in' })).toBe('Check-in not needed');
    expect(journalLabel({ type: 'cancelled', kind: 'out', reason: 'back_inside' })).toBe('Leaving cancelled');
    expect(journalLabel({ type: 'no_fix', kind: 'in' })).toMatch(/No GPS position/);
    expect(journalLabel({ type: 'off' })).toBe('Automatic recording is off');
    expect(journalLabel({ type: 'key_rejected' })).toBe('This phone was not accepted');
    expect(journalLabel({ type: 'dropped', kind: 'out' })).toBe('Check-out not accepted');
  });
  it('gives the reason in a few words and colours the line', () => {
    expect(journalDetail({ type: 'refused', reason: 'weak_signal' })).toBe('GPS signal too weak');
    expect(journalDetail({ type: 'cancelled', reason: 'back_inside' })).toBe('you came back');
    expect(journalDetail({ type: 'ignored', reason: 'already_in' })).toBe('already checked in');
    expect(journalDetail({ type: 'key_rejected' })).toMatch(/open Dua/);
    expect(journalDetail({ type: 'off' })).toBe('test mode: listed only');
    expect(journalDetail({ type: 'dwell' })).toBe('');
    expect(journalTone({ type: 'recorded' })).toBe('ok');
    for (const type of ['refused', 'dropped', 'no_fix', 'key_rejected', 'error:1000']) expect(journalTone({ type })).toBe('warn');
    for (const type of ['dwell', 'exit', 'ignored', 'cancelled', 'off']) expect(journalTone({ type })).toBe('plain');
  });
  it('words a refused check-out while still inside', () => {
    expect(reasonText('still_inside')).toMatch(/still at the pharmacy/);
  });
});

describe('attendance: one line per person', () => {
  it('writes the span of a day', () => {
    expect(spanText({ first_in: '2026-11-26T12:01:00Z', open: true })).toBe('17:01 → Still in');
    expect(spanText({ first_in: '2026-11-26T03:00:00Z', last_out: '2026-11-26T12:30:00Z', open: false })).toBe('08:00 → 17:30');
    expect(spanText({ firstIn: '2026-11-26T03:00:00Z', lastOut: null, open: false })).toBe('08:00 → —');
    expect(spanText({ first_in: null })).toBe('—');
    expect(spanText(null)).toBe('—');
  });
  it("groups the owner's week by day, newest first, keeping the order inside a day", () => {
    const rows = [
      { date: '2026-11-25', name: 'B' },
      { date: '2026-11-26', name: 'A' },
      { date: '2026-11-25', name: 'C' },
    ];
    expect(groupByDay(rows)).toEqual([
      { date: '2026-11-26', rows: [rows[1]] },
      { date: '2026-11-25', rows: [rows[0], rows[2]] },
    ]);
    expect(groupByDay(null)).toEqual([]);
  });
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
    const day = todayPkt(); // the page opens on today, so the fixture must be today (a fixed date made this fail from the next day on)
    api.list.mockResolvedValue([
      rec({ name: 'Test A', business_date: day }),
      rec({ name: 'Test A', business_date: day, status: 'rejected', reason: 'outside', distance_m: 300 }),
    ]);
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

  it("shows a staff member their own last two weeks and never asks for everyone's summary", async () => {
    api.myHistory.mockResolvedValue({
      days: [
        {
          date: '2026-11-25',
          first_in: '2026-11-25T04:00:00Z',
          last_out: '2026-11-25T12:30:00Z',
          worked_minutes: 510,
          accepted: 2,
          refused: 1,
          open: false,
        },
        { date: '2026-11-24', first_in: '2026-11-24T04:00:00Z', last_out: null, worked_minutes: 0, accepted: 1, refused: 0, open: true },
      ],
      events: [],
    });
    await open(['attendance.check_in']);
    expect(api.myHistory).toHaveBeenCalledTimes(1);
    const [from, to] = api.myHistory.mock.calls[0];
    expect(to).toBe(todayPkt());
    expect(from).toBe(addDays(todayPkt(), -13));
    expect(el.textContent).toContain('My last two weeks');
    expect(el.textContent).toContain('8 h 30 min');
    expect(el.textContent).toContain('1 refused');
    expect(el.textContent).toContain('Still in');
    expect(api.summary).not.toHaveBeenCalled();
  });

  it('says so when a staff member has nothing recorded in two weeks', async () => {
    await open(['attendance.check_in']);
    expect(el.textContent).toContain('Nothing recorded in the last two weeks.');
  });

  it('gives the owner the week summary with a flag on a forgotten check-out, and not the staff history', async () => {
    const day = todayPkt();
    api.summary.mockResolvedValue({
      rows: [
        {
          staff_id: 's1',
          name: 'Test A',
          date: day,
          first_in: '2026-11-25T04:00:00Z',
          last_out: '2026-11-25T12:00:00Z',
          worked_minutes: 480,
          accepted: 2,
          refused: 0,
          open: false,
        },
        {
          staff_id: 's2',
          name: 'Test B',
          date: addDays(day, -1),
          first_in: '2026-11-24T04:00:00Z',
          last_out: null,
          worked_minutes: 0,
          accepted: 1,
          refused: 0,
          open: true,
        },
      ],
    });
    await open(['attendance.view_all']);
    expect(api.summary).toHaveBeenCalledWith(addDays(day, -6), day);
    expect(el.textContent).toContain('8 h');
    expect(el.textContent).toContain('Test B');
    expect(el.textContent).toContain('No check-out');
    expect(api.myHistory).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain('My last two weeks');
  });

  it('reloads the week when the owner picks another day', async () => {
    await open(['attendance.view_all']);
    const input = el.querySelector('#at-date');
    input.value = '2026-11-10';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.summary).toHaveBeenLastCalledWith('2026-11-04', '2026-11-10');
  });

  it('shows a failure card when the history cannot be loaded', async () => {
    api.myHistory.mockRejectedValue(new Error('offline'));
    await open(['attendance.check_in']);
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

  describe('automatic attendance card', () => {
    const phone = (o = {}) => ({
      available: true,
      enrolled: true,
      precise: true,
      background: true,
      locationOn: true,
      backgroundRestricted: false,
      batteryUnrestricted: true,
      problem: null,
      registered: true,
      stableSeconds: 120,
      sites: [{ id: 'a', name: 'Test Shop', radius: 100 }],
      journal: [],
      ...o,
    });
    beforeEach(() => api.autoSupported.mockReturnValue(true));

    it('is not shown in a browser or in an older app', async () => {
      api.autoSupported.mockReturnValue(false);
      await open(['attendance.check_in']);
      expect(el.textContent).not.toContain('Automatic attendance');
      expect(api.autoStatus).not.toHaveBeenCalled();
    });

    it('is not shown to someone who may only look at the records', async () => {
      await open(['attendance.view_all']);
      expect(el.textContent).not.toContain('Automatic attendance');
      expect(api.autoStatus).not.toHaveBeenCalled();
    });

    it('says the phone is watching, and lists what it detected, in test mode', async () => {
      api.autoStatus.mockResolvedValue(
        phone({
          journal: [
            { type: 'exit', at: Date.parse('2026-11-25T13:00:00Z'), accuracy: 18 },
            { type: 'dwell', at: Date.parse('2026-11-25T04:00:00Z'), accuracy: 12.4 },
          ],
        }),
      );
      await open(['attendance.check_in']);
      expect(el.textContent).toContain('Automatic attendance');
      expect(el.textContent).toContain('Watching the pharmacy');
      expect(el.textContent.replace(/\s+/g, ' ')).toContain('Test Shop, 100 m. Counted after you stay 2 min.');
      expect(el.textContent).toContain('Arrived (stayed inside 2 min)');
      expect(el.textContent).toContain('Left');
      expect(el.textContent).toContain('Test mode');
      expect(el.querySelector('[data-act="auto-background"]')).toBeNull();
    });

    it('shows what is missing and the button that repairs it; after the person allows it, the status is read again', async () => {
      api.autoStatus.mockResolvedValueOnce(phone({ background: false, problem: 'no_background_location', registered: false }));
      api.autoStatus.mockResolvedValue(phone());
      await open(['attendance.check_in']);
      expect(el.textContent).toContain('all the time');
      const fix = el.querySelector('[data-act="auto-background"]');
      expect(fix).not.toBeNull();
      fix.click();
      await tick();
      expect(api.askBackgroundLocation).toHaveBeenCalledTimes(1);
      expect(api.autoStatus).toHaveBeenCalledTimes(2);
      expect(el.textContent).toContain('Watching the pharmacy');
      expect(el.querySelector('[data-act="auto-background"]')).toBeNull();
    });

    it('asks the server for the places when the page opens, and again on "Check again" (a place added after Dua started)', async () => {
      api.autoStatus.mockResolvedValue(phone());
      await open(['attendance.check_in']);
      expect(api.syncPlaces).toHaveBeenCalledTimes(1);
      el.querySelector('[data-act="auto-refresh"]').click();
      await tick();
      expect(api.syncPlaces).toHaveBeenCalledTimes(2);
      expect(api.autoStatus).toHaveBeenCalledTimes(2);
    });

    it('still shows the status when the server cannot be reached for the places', async () => {
      api.syncPlaces.mockRejectedValue(new Error('offline'));
      api.autoStatus.mockResolvedValue(phone());
      await open(['attendance.check_in']);
      expect(el.textContent).toContain('Watching the pharmacy');
    });

    it('opens the battery and phone settings', async () => {
      api.autoStatus.mockResolvedValue(phone({ backgroundRestricted: true, problem: 'background_restricted', locationOn: false }));
      await open(['attendance.check_in']);
      el.querySelector('[data-act="auto-battery"]').click();
      el.querySelector('[data-act="auto-app"]').click();
      await tick();
      expect(api.openBatterySettings).toHaveBeenCalledTimes(1);
      expect(api.openAppSettings).toHaveBeenCalledTimes(1);
    });

    it('asks again when the person comes back from the phone settings', async () => {
      api.autoStatus.mockResolvedValueOnce(phone({ locationOn: false, problem: 'location_off' }));
      api.autoStatus.mockResolvedValue(phone());
      await open(['attendance.check_in']);
      expect(el.textContent).toContain('switched off');
      document.dispatchEvent(new Event('visibilitychange'));
      await tick();
      expect(el.textContent).toContain('Watching the pharmacy');
    });

    it('shows what happened to each event, and what is waiting to be sent', async () => {
      api.autoStatus.mockResolvedValue({
        ...phone(),
        auto: true,
        hasKey: true,
        pending: 2,
        journal: [
          { type: 'recorded', kind: 'in', at: Date.now() },
          { type: 'refused', kind: 'out', reason: 'weak_signal', at: Date.now() - 60000 },
          { type: 'dwell', at: Date.now() - 120000, accuracy: 100 },
        ],
      });
      await open(['attendance.check_in']);
      const text = el.textContent.replace(/\s+/g, ' ');
      expect(text).toContain('recorded automatically');
      expect(text).toContain('2 events are waiting to be sent.');
      expect(text).toContain('Check-in recorded');
      expect(text).toContain('Check-out refused');
      expect(text).toContain('GPS signal too weak');
      expect(text).toContain('Automatic recording is on');
      expect(text).not.toContain('Test mode');
      expect(el.querySelectorAll('.at-row-ok').length).toBe(1);
    });

    it('never breaks the rest of the page when the phone cannot answer', async () => {
      api.autoStatus.mockRejectedValue(new Error('boom'));
      await open(['attendance.check_in']);
      expect(el.textContent).toContain('My attendance');
      expect(el.textContent).not.toContain('Automatic attendance');
    });
  });

  describe('automatic recording (owner)', () => {
    const ask = async (reason) => {
      await tick();
      const dlg = [...document.querySelectorAll('dialog')].pop();
      const box = dlg.querySelector('input, textarea');
      box.value = reason;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      dlg.querySelector('.btn-primary, [data-ok]').click();
      await tick();
    };
    it('starts in test mode and the switch is a normal-sized checkbox', async () => {
      await open(['attendance.view_all', 'attendance.manage']);
      const box = el.querySelector('#at-auto');
      expect(box.checked).toBe(false);
      expect(el.textContent).toContain('Test mode');
      expect(box.closest('.at-check')).not.toBeNull();
    });
    it('switches it on with a reason, through its own function', async () => {
      api.setConfig.mockResolvedValue({ error: null });
      api.setAuto.mockResolvedValue({ error: null });
      await open(['attendance.view_all', 'attendance.manage']);
      el.querySelector('#at-auto').checked = true;
      el.querySelector('[data-act="save-config"]').click();
      await ask('phone test passed');
      expect(api.setAuto).toHaveBeenCalledTimes(1);
      const [enabled, reason, key] = api.setAuto.mock.calls[0];
      expect([enabled, reason]).toEqual([true, 'phone test passed']);
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
    });
    it('does not call the switch when it did not change', async () => {
      api.setConfig.mockResolvedValue({ error: null });
      await open(['attendance.view_all', 'attendance.manage']);
      el.querySelector('[data-act="save-config"]').click();
      await ask('just checking');
      expect(api.setAuto).not.toHaveBeenCalled();
    });
    it('shows it is on, and switches it off again when unticked', async () => {
      api.setup.mockResolvedValue({
        config: { max_accuracy_m: 100, require_app: true, stable_seconds: 120, auto_enabled: true },
        sites: [],
      });
      api.setConfig.mockResolvedValue({ error: null });
      api.setAuto.mockResolvedValue({ error: null });
      await open(['attendance.view_all', 'attendance.manage']);
      expect(el.querySelector('#at-auto').checked).toBe(true);
      el.querySelector('#at-auto').checked = false;
      el.querySelector('[data-act="save-config"]').click();
      await ask('pausing');
      expect(api.setAuto.mock.calls[0][0]).toBe(false);
    });
    it('tells the owner when the switch could not be saved', async () => {
      api.setConfig.mockResolvedValue({ error: null });
      api.setAuto.mockResolvedValue({ error: { message: 'not allowed' } });
      await open(['attendance.view_all', 'attendance.manage']);
      el.querySelector('#at-auto').checked = true;
      el.querySelector('[data-act="save-config"]').click();
      await ask('try');
      expect(document.body.textContent).toContain('not allowed');
    });
    it('marks refused attempts that came from a phone', async () => {
      api.list.mockResolvedValue([
        {
          staff_id: 's1',
          name: 'Test A',
          business_date: todayPkt(),
          at: `${todayPkt()}T05:00:00Z`,
          kind: 'in',
          status: 'rejected',
          reason: 'weak_signal',
          distance_m: 40,
          source: 'auto',
        },
        {
          staff_id: 's1',
          name: 'Test A',
          business_date: todayPkt(),
          at: `${todayPkt()}T06:00:00Z`,
          kind: 'in',
          status: 'rejected',
          reason: 'outside',
          distance_m: 900,
          source: 'app',
        },
      ]);
      await open(['attendance.view_all']);
      expect(el.querySelectorAll('.at-row-warn .chip').length).toBe(1);
      expect(el.textContent).toContain('Automatic');
    });
  });

  describe('the stay time (owner)', () => {
    const ask = async (reason) => {
      await tick();
      const dlg = [...document.querySelectorAll('dialog')].pop();
      const box = dlg.querySelector('input, textarea');
      box.value = reason;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      dlg.querySelector('.btn-primary, [data-ok]').click();
      await tick();
    };
    it('shows the current value and saves a change with the same reason, through its own function', async () => {
      api.setConfig.mockResolvedValue({ error: null });
      api.setStable.mockResolvedValue({ error: null });
      await open(['attendance.view_all', 'attendance.manage']);
      expect(el.querySelector('#at-stable').value).toBe('120');
      el.querySelector('#at-stable').value = '90';
      el.querySelector('[data-act="save-config"]').click();
      await ask('faster arrivals');
      expect(api.setConfig).toHaveBeenCalledTimes(1);
      expect(api.setStable).toHaveBeenCalledTimes(1);
      const [seconds, reason, key] = api.setStable.mock.calls[0];
      expect([seconds, reason]).toEqual([90, 'faster arrivals']);
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
    });
    it('does not call the stay-time function when it did not change', async () => {
      api.setConfig.mockResolvedValue({ error: null });
      await open(['attendance.view_all', 'attendance.manage']);
      el.querySelector('[data-act="save-config"]').click();
      await ask('just checking');
      expect(api.setConfig).toHaveBeenCalledTimes(1);
      expect(api.setStable).not.toHaveBeenCalled();
    });
    it('refuses a stay time outside 30 to 600 seconds before asking for a reason', async () => {
      await open(['attendance.view_all', 'attendance.manage']);
      el.querySelector('#at-stable').value = '10';
      el.querySelector('[data-act="save-config"]').click();
      await tick();
      expect(el.querySelector('#at-cfg-err').textContent).toMatch(/30 to 600/);
      expect(api.setConfig).not.toHaveBeenCalled();
    });
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

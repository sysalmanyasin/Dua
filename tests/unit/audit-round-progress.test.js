// @vitest-environment jsdom
// The live progress popup: numbers from the round, a refresh while it is open, and a clean stop.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  individualOverview: vi.fn(),
  myAssignments: vi.fn(async () => []),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { openRoundProgress, progressFrom } = await import('../../js/modules/audit/ui/roundProgress.js');
const { mount: mountIndividuals } = await import('../../js/modules/audit/ui/individuals.js');

const overview = (counted, state = 'counting', extra = []) => ({
  round: { id: 'r1', state },
  assignments: [
    { id: 'a1', name: 'Mian Waqas', status: 'assigned', items: 40, counted },
    { id: 'a2', name: 'Dr Salman', status: 'submitted', items: 60, counted: 60 },
    { id: 'a3', name: 'Gone', status: 'revoked', items: 99, counted: 0 },
    ...extra,
  ],
});
const pop = () => document.querySelector('.aud-pop');
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Live progress</button>';
  document.getElementById('opener').focus();
  vi.clearAllMocks();
});

describe('progressFrom', () => {
  it('adds up the people on the round, leaves out revoked ones, and never counts past the total', () => {
    const p = progressFrom(overview(10));
    expect(p).toMatchObject({ items: 100, counted: 70, remaining: 30, percent: 70, state: 'counting' });
    expect(p.people.map((x) => [x.name, x.done, x.total, x.submitted])).toEqual([
      ['Mian Waqas', 10, 40, false],
      ['Dr Salman', 60, 60, true],
    ]);
    expect(progressFrom(overview(99)).counted).toBe(100);
    expect(progressFrom(null)).toMatchObject({ items: 0, percent: 0 });
  });
});

describe('the popup', () => {
  it('shows the live numbers and each person, then closes with Escape and returns focus', async () => {
    const read = vi.fn(async () => overview(10));
    const timers = [];
    const c = openRoundProgress({
      roundId: 'r1',
      title: 'Round 10 · Mian Waqas',
      deps: { read, timer: (fn) => timers.push(fn) || 1, clear: vi.fn() },
    });
    await flush();
    expect(pop().getAttribute('role')).toBe('dialog');
    expect(pop().textContent).toContain('Round 10 · Mian Waqas');
    expect(pop().querySelector('[data-counted]').textContent).toBe('70 of 100 counted');
    expect(pop().querySelector('[data-remaining]').textContent).toBe('30 remaining');
    expect(pop().querySelector('[data-percent]').textContent).toBe('70%');
    expect(pop().querySelector('[data-live-state]')).not.toBeNull();
    expect(pop().querySelectorAll('[data-person]')).toHaveLength(2);
    expect(read).toHaveBeenCalledWith('r1');
    pop().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop()).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('opener'));
    c.close(); // closing twice is harmless
  });

  it('reads again on its timer and when Refresh now is pressed, and the numbers move', async () => {
    let counted = 10;
    const read = vi.fn(async () => overview(counted));
    const timers = [];
    openRoundProgress({ roundId: 'r1', deps: { read, timer: (fn) => timers.push(fn) || 1, clear: vi.fn() } });
    await flush();
    expect(timers).toHaveLength(1);
    counted = 25;
    timers[0]();
    await flush();
    expect(pop().querySelector('[data-counted]').textContent).toBe('85 of 100 counted');
    counted = 40;
    pop().querySelector('button[data-s="refresh"]').click();
    await flush();
    expect(pop().querySelector('[data-counted]').textContent).toBe('100 of 100 counted');
  });

  it('stops reading when counting has finished, and says so', async () => {
    const read = vi.fn(async () => overview(40, 'compiled'));
    const timers = [];
    openRoundProgress({ roundId: 'r1', deps: { read, timer: (fn) => timers.push(fn) || 1, clear: vi.fn() } });
    await flush();
    expect(pop().querySelector('[data-finished]').textContent).toContain('counting has finished');
    expect(timers).toHaveLength(0);
  });

  it('says when it cannot read, and a failed refresh keeps the last numbers', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline'));
    openRoundProgress({ roundId: 'r1', deps: { read, timer: () => 1, clear: vi.fn() } });
    await flush();
    expect(pop().querySelector('[role="alert"]')).not.toBeNull();
    read.mockResolvedValueOnce(overview(10)).mockRejectedValueOnce(new Error('offline'));
    pop().querySelector('button[data-s="refresh"]').click();
    await flush();
    pop().querySelector('button[data-s="refresh"]').click();
    await flush();
    expect(pop().querySelector('[data-counted]').textContent).toBe('70 of 100 counted');
    expect(pop().querySelector('[role="alert"]')).toBeNull();
  });

  it('closes when the page is left', async () => {
    openRoundProgress({ roundId: 'r1', deps: { read: async () => overview(1), timer: () => 1, clear: vi.fn() } });
    await flush();
    window.dispatchEvent(new Event('hashchange'));
    expect(pop()).toBeNull();
  });
});

describe('Individual audits screens', () => {
  const row = (x) => ({
    person_id: 'p1',
    person_name: 'Count One',
    engagement_id: 'e1',
    round_id: 'r1',
    round_label: '1',
    state: 'counting',
    started_at: '2026-11-02T05:00:00Z',
    item_count: null,
    variance_count: null,
    variance_value: null,
    template_name: null,
    companies: ['Acme'],
    ...x,
  });
  let el;
  beforeEach(() => {
    sessionStorage.clear();
    el = document.createElement('div');
    document.body.replaceChildren(el);
    api.individualOverview.mockResolvedValue([
      row({}),
      row({ round_id: 'r2', round_label: '2', state: 'compiled', item_count: 3, variance_count: 1, variance_value: -5 }),
    ]);
    api.compileOverview.mockResolvedValue(overview(10));
  });

  it('Monthly Overview has the start card; Rounds & Progress does not', async () => {
    await mountIndividuals(el, { ctx: { permissions: ['audit.view', 'audit.individual'] }, screen: 'overview' });
    expect(el.querySelector('[data-start-card="start"] a[data-start]')).not.toBeNull();
    expect(el.querySelector('[data-start-card="start"] a').getAttribute('href')).toBe('#/audit/individual');
    // it comes before the month picker, not buried under the lists
    const card = el.querySelector('[data-start-card]');
    const month = el.querySelector('select[data-s="month"]');
    expect(card.compareDocumentPosition(month) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await mountIndividuals(el, { ctx: { permissions: ['audit.view', 'audit.individual'] }, screen: 'rounds' });
    expect(el.querySelector('[data-start]')).toBeNull();
    expect(el.querySelector('[data-start-card]')).toBeNull();
  });

  it('Monthly Overview shows no start card to someone who cannot start one', async () => {
    await mountIndividuals(el, { ctx: { permissions: ['audit.view'] }, screen: 'overview' });
    expect(el.querySelector('[data-start-card]')).toBeNull();
  });

  it('with a round already open the card leads back into it', async () => {
    api.myAssignments.mockResolvedValue([{ method: 'individual-self-pick', status: 'assigned', round_id: 'r1' }]);
    await mountIndividuals(el, { ctx: { permissions: ['audit.view', 'audit.individual'] }, screen: 'overview' });
    expect(el.querySelector('[data-start-card="continue"] a[data-continue]')).not.toBeNull();
    expect(el.querySelector('[data-start-card="start"]')).toBeNull();
  });

  it('a round still counting has a Live progress button that opens the popup; a finished one does not', async () => {
    await mountIndividuals(el, { ctx: { permissions: ['audit.view'] }, screen: 'rounds' });
    const buttons = el.querySelectorAll('button[data-live-progress]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].dataset.title).toContain('Round 1');
    buttons[0].click();
    await flush();
    expect(pop()).not.toBeNull();
    expect(api.compileOverview).toHaveBeenCalledWith('r1');
    pop().querySelector('button[data-s="close"]').click();
  });
});

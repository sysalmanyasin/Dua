// @vitest-environment jsdom
// The live progress popup: numbers from the round, a refresh while it is open, and a clean stop.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  roundLive: vi.fn(),
  compileOverview: vi.fn(),
  forceSubmit: vi.fn(),
  individualOverview: vi.fn(),
  myAssignments: vi.fn(async () => []),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { openRoundProgress } = await import('../../js/modules/audit/ui/roundProgress.js');
const { mount: mountIndividuals } = await import('../../js/modules/audit/ui/individuals.js');

// audit_compile_overview, which the rounds list still uses for its "Counting: x of y" lines
const overview = (counted) => ({
  round: { id: 'r1', state: 'counting' },
  assignments: [{ id: 'a1', name: 'Mian Waqas', status: 'assigned', items: 40, counted }],
});

// audit_round_live for a round with two counters: Mian Waqas (4 items, 2 counted) and Dr Salman (2 items, submitted)
const item = (o) => ({
  round_item_id: `i-${o.code}`,
  assignment_id: 'a1',
  person: 'Mian Waqas',
  company: 'Acme',
  system_qty: 10,
  counted: false,
  qty: null,
  auto_matched: false,
  note: '',
  difference: null,
  difference_value: null,
  ...o,
});
const live = (counted = 2, state = 'counting') => ({
  round: { id: 'r1', state },
  assignments: [
    { id: 'a1', name: 'Mian Waqas', status: 'assigned', items: 4, counted, differences: 1, forced: false },
    { id: 'a2', name: 'Dr Salman', status: 'submitted', items: 2, counted: 2, differences: 0, forced: true },
  ],
  items: [
    item({ code: 'Z9', name: 'Zinc tablets', counted: true, qty: 9, difference: -1, difference_value: -100.5 }),
    item({ code: 'A1', name: 'Alpha syrup', counted: true, qty: 10, difference: 0, difference_value: 0 }),
    item({ code: 'B2', name: 'beta drops' }),
    item({ code: 'C3', name: 'Cura cream' }),
    item({
      code: 'D4',
      name: 'Dova gel',
      assignment_id: 'a2',
      person: 'Dr Salman',
      counted: true,
      qty: 10,
      difference: 0,
      difference_value: 0,
      auto_matched: true,
    }),
    item({
      code: 'E5',
      name: 'Ever balm',
      assignment_id: 'a2',
      person: 'Dr Salman',
      counted: true,
      qty: 10,
      difference: 0,
      difference_value: 0,
    }),
  ],
});
const txt = (el) => el.textContent.replace(/\s+/g, ' ');
const pop = () => document.querySelector('.aud-pop');
const flush = () => new Promise((r) => setTimeout(r, 0));
const names = () => [...pop().querySelectorAll('[data-item] > strong')].map((n) => n.textContent);
const timerDeps = (extra = {}) => ({ timer: () => 1, clear: vi.fn(), ...extra });

beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Live progress</button>';
  document.getElementById('opener').focus();
  vi.clearAllMocks();
});

describe('the popup', () => {
  it('shows the live numbers and each person, then closes with Escape and returns focus', async () => {
    const read = vi.fn(async () => live());
    const c = openRoundProgress({ roundId: 'r1', title: 'Round 10 · Mian Waqas', deps: timerDeps({ read }) });
    await flush();
    expect(pop().getAttribute('role')).toBe('dialog');
    expect(pop().textContent).toContain('Round 10 · Mian Waqas');
    expect(pop().querySelector('[data-counted]').textContent).toBe('4 of 6 counted');
    expect(pop().querySelector('[data-remaining]').textContent).toBe('2 remaining');
    expect(pop().querySelector('[data-percent]').textContent).toBe('67%');
    expect(txt(pop().querySelector('[data-differences]'))).toContain('1 difference');
    expect(pop().querySelector('[data-live-state]')).not.toBeNull();
    expect(pop().querySelectorAll('[data-person]')).toHaveLength(2);
    expect(read).toHaveBeenCalledWith('r1');
    pop().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop()).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('opener'));
    c.close(); // closing twice is harmless
  });

  it('lists the products A to Z with count, system quantity and difference', async () => {
    openRoundProgress({ roundId: 'r1', deps: timerDeps({ read: async () => live() }) });
    await flush();
    expect(names()).toEqual(['Alpha syrup', 'beta drops', 'Cura cream', 'Dova gel', 'Ever balm', 'Zinc tablets']);
    const zinc = [...pop().querySelectorAll('[data-item]')].find((li) => li.textContent.includes('Zinc'));
    expect(txt(zinc)).toContain('Counted 9');
    expect(txt(zinc)).toContain('System 10');
    expect(txt(zinc)).toContain('Difference −1');
    expect(txt(zinc)).toContain('100.50');
    const dova = [...pop().querySelectorAll('[data-item]')].find((li) => li.textContent.includes('Dova'));
    expect(txt(dova)).toContain('assumed to match');
    expect(txt(dova)).toContain('Dr Salman'); // with two counters, each row names its counter
    const beta = [...pop().querySelectorAll('[data-item]')].find((li) => li.textContent.includes('beta'));
    expect(beta.querySelector('[data-not-counted]').textContent).toBe('Not counted');
    expect(txt(beta)).not.toContain('Difference');
  });

  it('filters: Differences, Counted, Not counted, with counts on the chips', async () => {
    openRoundProgress({ roundId: 'r1', deps: timerDeps({ read: async () => live() }) });
    await flush();
    const chip = (k) => pop().querySelector(`button[data-f="${k}"]`);
    expect(['all', 'diff', 'counted', 'left'].map((k) => chip(k).textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'All (6)',
      'Differences (1)',
      'Counted (4)',
      'Not counted (2)',
    ]);
    chip('diff').click();
    expect(names()).toEqual(['Zinc tablets']);
    expect(chip('diff').getAttribute('aria-pressed')).toBe('true');
    chip('left').click();
    expect(names()).toEqual(['beta drops', 'Cura cream']);
    chip('counted').click();
    expect(names()).toEqual(['Alpha syrup', 'Dova gel', 'Ever balm', 'Zinc tablets']);
    chip('all').click();
    expect(names()).toHaveLength(6);
  });

  it('keeps the chosen filter when it reads again', async () => {
    let calls = 0;
    const timers = [];
    openRoundProgress({
      roundId: 'r1',
      deps: { read: async () => live(2 + calls++), timer: (fn) => timers.push(fn) || 1, clear: vi.fn() },
    });
    await flush();
    pop().querySelector('button[data-f="left"]').click();
    timers[0]();
    await flush();
    expect(pop().querySelector('button[data-f="left"]').getAttribute('aria-pressed')).toBe('true');
    expect(names()).toEqual(['beta drops', 'Cura cream']);
  });

  it('says so when a view has no products', async () => {
    const r = live();
    r.items = r.items.filter((i) => i.counted);
    openRoundProgress({ roundId: 'r1', deps: timerDeps({ read: async () => r }) });
    await flush();
    pop().querySelector('button[data-f="left"]').click();
    expect(pop().querySelector('[data-empty]')).not.toBeNull();
  });

  it('draws the progress bar fill (the bar is not left empty)', async () => {
    openRoundProgress({ roundId: 'r1', deps: timerDeps({ read: async () => live() }) });
    await flush();
    expect(pop().querySelector('.aud-progress span').style.width).toBe('67%');
  });

  it('reads again on its timer and when Refresh now is pressed, and the numbers move', async () => {
    let counted = 2;
    const read = vi.fn(async () => {
      const r = live(counted);
      r.items.find((i) => i.code === 'B2').counted = counted > 2;
      return r;
    });
    const timers = [];
    openRoundProgress({ roundId: 'r1', deps: { read, timer: (fn) => timers.push(fn) || 1, clear: vi.fn() } });
    await flush();
    expect(timers).toHaveLength(1);
    counted = 3;
    timers[0]();
    await flush();
    expect(pop().querySelector('[data-counted]').textContent).toBe('5 of 6 counted');
    pop().querySelector('button[data-s="refresh"]').click();
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('stops reading when counting has finished, and says so', async () => {
    const timers = [];
    openRoundProgress({
      roundId: 'r1',
      deps: { read: async () => live(4, 'compiled'), timer: (fn) => timers.push(fn) || 1, clear: vi.fn() },
    });
    await flush();
    expect(pop().querySelector('[data-finished]').textContent).toContain('counting has finished');
    expect(timers).toHaveLength(0);
  });

  it('says when it cannot read, and a failed refresh keeps the last numbers', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline'));
    openRoundProgress({ roundId: 'r1', deps: timerDeps({ read }) });
    await flush();
    expect(pop().querySelector('[role="alert"]')).not.toBeNull();
    read.mockResolvedValueOnce(live()).mockRejectedValueOnce(new Error('offline'));
    pop().querySelector('button[data-s="refresh"]').click();
    await flush();
    pop().querySelector('button[data-s="refresh"]').click();
    await flush();
    expect(pop().querySelector('[data-counted]').textContent).toBe('4 of 6 counted');
    expect(pop().querySelector('[role="alert"]')).toBeNull();
  });

  it('closes when the page is left', async () => {
    openRoundProgress({ roundId: 'r1', deps: timerDeps({ read: async () => live() }) });
    await flush();
    window.dispatchEvent(new Event('hashchange'));
    expect(pop()).toBeNull();
  });
});

describe('Force submit in the popup', () => {
  const open = (extra = {}) => {
    const submit = vi.fn(async () => ({}));
    const onChange = vi.fn();
    openRoundProgress({ roundId: 'r1', canForce: true, onChange, deps: timerDeps({ read: async () => live(), submit, ...extra }) });
    return { submit, onChange };
  };
  const type = (text) => {
    const input = pop().querySelector('[data-force-form] input[type="text"]');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('is offered only to someone who may force, only for a counter who has not submitted, only while counting', async () => {
    open();
    await flush();
    const buttons = pop().querySelectorAll('button[data-s="force"]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].dataset.name).toBe('Mian Waqas');
    pop().querySelector('[data-s="close"]').click();

    openRoundProgress({ roundId: 'r1', canForce: false, deps: timerDeps({ read: async () => live() }) });
    await flush();
    expect(pop().querySelector('button[data-s="force"]')).toBeNull();
    pop().querySelector('[data-s="close"]').click();

    openRoundProgress({ roundId: 'r1', canForce: true, deps: timerDeps({ read: async () => live(4, 'compiled') }) });
    await flush();
    expect(pop().querySelector('button[data-s="force"]')).toBeNull();
  });

  it('shows who was submitted for by the owner', async () => {
    open();
    await flush();
    expect(pop().textContent).toContain('Submitted by owner');
  });

  it('asks what to do with the uncounted products and why, and refuses an empty reason', async () => {
    const { submit } = open();
    await flush();
    pop().querySelector('button[data-s="force"]').click();
    expect(pop().querySelector('[data-force-form]')).not.toBeNull();
    expect(pop().querySelector('input[name="aud-fmode"][value="as_counted"]').checked).toBe(true);
    pop().querySelector('button[data-s="force-yes"]').click();
    await flush();
    expect(pop().querySelector('[data-force-error]').textContent).toContain('reason');
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits with the chosen mode and reason, then reads again and tells the page behind', async () => {
    const { submit, onChange } = open();
    await flush();
    pop().querySelector('button[data-s="force"]').click();
    const match = pop().querySelector('input[name="aud-fmode"][value="match"]');
    match.checked = true;
    match.dispatchEvent(new Event('change', { bubbles: true }));
    type('counter went home');
    pop().querySelector('button[data-s="force-yes"]').click();
    await flush();
    await flush();
    expect(submit).toHaveBeenCalledWith({ assignmentId: 'a1', mode: 'match', reason: 'counter went home' });
    expect(pop().querySelector('[data-notice]').textContent).toContain('Submitted for Mian Waqas');
    expect(pop().querySelector('[data-force-form]')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows the database refusal inside the form and keeps what was typed', async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('the assignment is already submitted'), { hint: 'assignment_submitted' }));
    openRoundProgress({ roundId: 'r1', canForce: true, deps: timerDeps({ read: async () => live(), submit }) });
    await flush();
    pop().querySelector('button[data-s="force"]').click();
    type('too late');
    pop().querySelector('button[data-s="force-yes"]').click();
    await flush();
    await flush();
    expect(pop().querySelector('[data-force-error]')).not.toBeNull();
    expect(pop().querySelector('[data-force-form] input[type="text"]').value).toBe('too late');
  });

  it('does not redraw over the form when the timer reads again', async () => {
    const timers = [];
    openRoundProgress({
      roundId: 'r1',
      canForce: true,
      deps: { read: async () => live(), submit: vi.fn(), timer: (fn) => timers.push(fn) || 1, clear: vi.fn() },
    });
    await flush();
    pop().querySelector('button[data-s="force"]').click();
    type('half typed');
    const form = pop().querySelector('[data-force-form]');
    timers[0]();
    await flush();
    expect(pop().querySelector('[data-force-form]')).toBe(form);
    expect(pop().querySelector('[data-force-form] input[type="text"]').value).toBe('half typed');
  });

  it('Cancel closes the form without submitting', async () => {
    const { submit } = open();
    await flush();
    pop().querySelector('button[data-s="force"]').click();
    pop().querySelector('button[data-s="force-cancel"]').click();
    expect(pop().querySelector('[data-force-form]')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
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
    api.roundLive.mockResolvedValue(live());
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
    expect(api.roundLive).toHaveBeenCalledWith('r1');
    pop().querySelector('button[data-s="close"]').click();
  });

  it('the popup offers Force submit only to someone with audit.compile, and reloads the list after one', async () => {
    api.roundLive.mockResolvedValue(live());
    await mountIndividuals(el, { ctx: { permissions: ['audit.view'] }, screen: 'rounds' });
    el.querySelector('button[data-live-progress]').click();
    await flush();
    expect(pop().querySelector('button[data-s="force"]')).toBeNull();
    pop().querySelector('button[data-s="close"]').click();

    await mountIndividuals(el, { ctx: { permissions: ['audit.view', 'audit.compile'] }, screen: 'rounds' });
    el.querySelector('button[data-live-progress]').click();
    await flush();
    expect(pop().querySelector('button[data-s="force"]')).not.toBeNull();
    api.forceSubmit.mockResolvedValue({});
    const before = api.individualOverview.mock.calls.length;
    pop().querySelector('button[data-s="force"]').click();
    const input = pop().querySelector('[data-force-form] input[type="text"]');
    input.value = 'person left';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    pop().querySelector('button[data-s="force-yes"]').click();
    await flush();
    await flush();
    expect(api.forceSubmit).toHaveBeenCalledWith({ assignmentId: 'a1', mode: 'as_counted', reason: 'person left' });
    expect(api.individualOverview.mock.calls.length).toBeGreaterThan(before);
    pop()?.querySelector('button[data-s="close"]')?.click();
  });
});

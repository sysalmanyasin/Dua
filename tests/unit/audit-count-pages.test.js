// @vitest-environment jsdom
// Opens the counting, Individual Audit and templates pages in a DOM with the database layer replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  myAssignments: vi.fn(),
  myItems: vi.fn(),
  countBatch: vi.fn(async (_a, events) => ({ accepted: events.length, duplicates: 0 })),
  submitCount: vi.fn(async () => ({ revision: 1 })),
  startIndividual: vi.fn(),
  myCompilation: vi.fn(async () => null),
  listCompanies: vi.fn(async () => {
    throw new Error('not loaded');
  }),
  listTemplates: vi.fn(async () => []),
  saveTemplate: vi.fn(async () => 'tpl-1'),
  deleteTemplate: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount: mountCount } = await import('../../js/modules/audit/ui/count.js');
const { mount: mountIndividual } = await import('../../js/modules/audit/ui/individual.js');
const { mount: mountTemplates } = await import('../../js/modules/audit/ui/templates.js');
const { installSignOutGuard } = await import('../../js/modules/audit/ui/signoutGuard.js');
const { createMemoryStore, useStore } = await import('../../js/modules/audit/data/outboxStore.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');
const { timing } = await import('../../js/modules/audit/domain/outbox.js');
timing.flushDelayMs = 10;

const asg = (over = {}) => ({
  assignment_id: 'asg1',
  engagement_id: 'e1',
  engagement_name: 'Spring audit',
  round_id: 'r1',
  round_number: 1,
  round_suffix: null,
  round_state: 'counting',
  status: 'assigned',
  method: 'auto-company',
  template_name: null,
  items: 3,
  counted: 0,
  ...over,
});
const items = () => [
  {
    round_item_id: 'i1',
    item_position: 1,
    code: 'A1',
    company: 'Acme',
    name: 'Alpha one',
    system_qty: 10,
    retail_price: 100.5,
    counted_qty: null,
    auto_matched: false,
    note: '',
    confirmed_same: false,
  },
  {
    round_item_id: 'i2',
    item_position: 2,
    code: 'A2',
    company: 'Acme',
    name: 'Alpha two',
    system_qty: 5,
    retail_price: 20,
    counted_qty: null,
    auto_matched: false,
    note: '',
    confirmed_same: false,
  },
  {
    round_item_id: 'i3',
    item_position: 3,
    code: 'B1',
    company: 'Beta',
    name: 'Beta one',
    system_qty: 8,
    retail_price: 55,
    counted_qty: null,
    auto_matched: false,
    note: '',
    confirmed_same: false,
  },
];
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await tick(25);
  }
  throw new Error('timed out waiting');
};
const root = () => document.getElementById('root');
const type = (id, value) => {
  const input = root().querySelector(`input[data-qty="${id}"]`);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = (sel) => root().querySelector(sel).click();

let store;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  vi.clearAllMocks();
  store = createMemoryStore();
  useStore(store);
  setView({ assignment: 'asg1' });
  api.myAssignments.mockResolvedValue([asg()]);
  api.myItems.mockResolvedValue(items());
  api.countBatch.mockImplementation(async (_a, events) => ({ accepted: events.length, duplicates: 0 }));
});

describe('counting screen', () => {
  it('shows what the counter needs: system quantity, price, and no difference before counting', async () => {
    await mountCount(root(), { ctx: { permissions: ['audit.count'] } });
    expect(root().textContent).toContain('Alpha one');
    expect(root().querySelector('[data-item="i1"] .aud-sys').textContent).toBe('10');
    expect(root().textContent).toContain('A1 · Rs 100.5');
    expect(root().textContent).toContain('0 of 3 counted');
    // uncounted items read as zero in stock: the full shortage shows, marked as assumed, and the company total starts there
    expect(root().querySelector('[data-diff="i1"]').textContent).toBe('-10-Rs 1,005assumed');
    expect(root().querySelector('[data-impact="Acme"]').textContent).toBe('-Rs 1,105');
    expect(root().querySelector('[data-impact="Beta"]').textContent).toBe('-Rs 440');
  });

  it('shows the difference and its value at once, and sends the count in the background', async () => {
    await mountCount(root(), { ctx: {} });
    type('i1', '7');
    expect(root().querySelector('[data-diff="i1"]').textContent).toBe('-3-Rs 301.50');
    expect(root().querySelector('[data-impact="Acme"]').textContent).toBe('-Rs 401.50'); // i1 counted, i2 still assumed
    expect(root().textContent).toContain('1 of 3 counted');
    expect(await store.count('asg1')).toBe(1); // saved on the device before anything is sent
    await until(() => api.countBatch.mock.calls.length === 1);
    const [assignment, events] = api.countBatch.mock.calls[0];
    expect(assignment).toBe('asg1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ item: 'i1', qty: 7, auto: false });
    expect(events[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
    await until(() => root().textContent.includes('Everything is sent'));
    expect(await store.count('asg1')).toBe(0);
  });

  it('refuses text that is not a quantity and leaves the row alone', async () => {
    await mountCount(root(), { ctx: {} });
    type('i1', 'abc');
    expect(await store.count('asg1')).toBe(0);
    expect(root().querySelector('input[data-qty="i1"]').value).toBe('');
    expect(document.getElementById('toasts').textContent).toContain('Enter a number');
  });

  it('keeps counts on the device with no signal, blocks submit, and sends after reconnecting', async () => {
    api.countBatch.mockRejectedValue(new TypeError('Failed to fetch'));
    await mountCount(root(), { ctx: {} });
    type('i1', '10');
    type('i2', '4');
    await until(() => root().textContent.includes('No connection'));
    expect(root().textContent).toContain('2 counts waiting to send');
    type('i3', '8');
    click('button[data-act="ask-submit"], button[data-act="submit"]');
    await tick(50);
    expect(api.submitCount).not.toHaveBeenCalled();
    // signal returns
    api.countBatch.mockImplementation(async (_a, events) => ({ accepted: events.length }));
    click('button[data-act="send"]');
    await until(() => root().textContent.includes('Everything is sent'));
    expect(await store.count('asg1')).toBe(0);
  });

  it('marks an item as matching and sends it as an automatic count', async () => {
    await mountCount(root(), { ctx: {} });
    click('button[data-match="i2"]');
    expect(root().querySelector('[data-diff="i2"]').textContent).toBe('0auto-matched');
    await until(() => api.countBatch.mock.calls.length === 1);
    expect(api.countBatch.mock.calls[0][1][0]).toMatchObject({ item: 'i2', auto: true, qty: null });
  });

  it('counts still waiting on the device show again after the screen is reopened', async () => {
    api.countBatch.mockRejectedValue(new TypeError('Failed to fetch'));
    await mountCount(root(), { ctx: {} });
    type('i1', '6');
    await until(() => root().textContent.includes('1 count waiting to send'));
    document.body.innerHTML = '<div id="root"></div>';
    await mountCount(root(), { ctx: {} });
    expect(root().querySelector('input[data-qty="i1"]').value).toBe('6');
    expect(root().textContent).toContain('1 count waiting to send');
  });

  it('opens from the copy on the device when the database cannot be reached', async () => {
    await mountCount(root(), { ctx: {} });
    document.body.innerHTML = '<div id="root"></div>';
    api.myAssignments.mockRejectedValue(new TypeError('Failed to fetch'));
    api.myItems.mockRejectedValue(new TypeError('Failed to fetch'));
    await mountCount(root(), { ctx: {} });
    expect(root().textContent).toContain('Alpha one');
    expect(root().textContent).toContain('saved on this device');
  });

  it('submits after warning about uncounted items; the rest can be marked as matching first', async () => {
    await mountCount(root(), { ctx: {} });
    type('i1', '10');
    click('button[data-act="ask-submit"]');
    expect(root().textContent).toContain('2 items are not counted');
    click('button[data-act="mark-rest"]');
    await until(() => root().textContent.includes('3 of 3 counted'));
    click('button[data-act="submit"]');
    await until(() => api.submitCount.mock.calls.length === 1);
    expect(api.submitCount).toHaveBeenCalledWith('asg1', '');
    await until(() => root().textContent.includes('You submitted this count'));
    expect(await store.count('asg1')).toBe(0);
    expect(root().querySelector('input[data-qty="i1"]').disabled).toBe(true);
  });

  it('is read-only when the round is not counting', async () => {
    api.myAssignments.mockResolvedValue([asg({ round_state: 'locked' })]);
    await mountCount(root(), { ctx: {} });
    expect(root().textContent).toContain('Counting is not open');
    expect(root().querySelector('input[data-qty="i1"]').disabled).toBe(true);
  });

  it('with no assignment chosen and several open, lists the assignments and opens one', async () => {
    setView({});
    api.myAssignments.mockResolvedValue([asg(), asg({ assignment_id: 'asg2', engagement_name: 'Autumn audit' })]);
    await mountCount(root(), { ctx: { permissions: ['audit.count', 'audit.individual'] } });
    expect(root().textContent).toContain('Spring audit · Round 1');
    expect(root().textContent).toContain('Autumn audit · Round 1');
    expect(root().textContent).toContain('Start an Individual Audit');
    root().querySelector('button[data-open="asg1"]').click();
    await until(() => root().querySelector('input[data-qty="i1"]'));
  });
});

describe('getting into counting quickly', () => {
  it('with exactly one open assignment, opens it straight away, and "All assignments" still shows the list', async () => {
    setView({});
    await mountCount(root(), { ctx: { permissions: ['audit.count'] } });
    expect(root().querySelector('input[data-qty="i1"]')).not.toBeNull();
    expect(api.myItems).toHaveBeenCalledWith('asg1');
    click('button[data-act="back"]');
    await until(() => root().textContent.includes('Your assignments'));
    expect(root().querySelector('input[data-qty="i1"]')).toBeNull(); // the list stays; it does not jump back in
    expect(root().querySelector('button[data-open="asg1"]')).not.toBeNull();
  });

  it('a submitted assignment is not "open": the one that is still open is chosen', async () => {
    setView({});
    api.myAssignments.mockResolvedValue([asg({ assignment_id: 'old', status: 'submitted' }), asg({ assignment_id: 'asg1' })]);
    await mountCount(root(), { ctx: {} });
    expect(api.myItems).toHaveBeenCalledWith('asg1');
  });

  it('keeps a "N left" bar and a Submit shortcut in reach, and the shortcut asks about uncounted items', async () => {
    await mountCount(root(), { ctx: {} });
    const bar = () => root().querySelector('#aud-sticky-text').textContent;
    expect(bar()).toBe('3 left');
    type('i1', '10');
    expect(bar()).toBe('2 left');
    click('button[data-act="sticky-submit"]');
    expect(root().textContent).toContain('2 items are not counted');
    expect(api.submitCount).not.toHaveBeenCalled(); // the shortcut never submits past the warning
  });

  it('the Submit shortcut submits at once when every item is counted, and the bar is gone afterwards', async () => {
    await mountCount(root(), { ctx: {} });
    type('i1', '10');
    type('i2', '5');
    type('i3', '8');
    expect(root().querySelector('#aud-sticky-text').textContent).toBe('All counted');
    click('button[data-act="sticky-submit"]');
    await until(() => api.submitCount.mock.calls.length === 1);
    await until(() => root().textContent.includes('You submitted this count'));
    expect(root().querySelector('.aud-sticky')).toBeNull();
  });

  it('after submitting, offers the next open assignment and opens it in one tap', async () => {
    api.myAssignments.mockResolvedValue([asg(), asg({ assignment_id: 'asg2', engagement_name: 'Autumn audit', items: 3 })]);
    await mountCount(root(), { ctx: {} });
    expect(root().textContent).not.toContain('Your next assignment'); // not while this one is still being counted
    type('i1', '10');
    type('i2', '5');
    type('i3', '8');
    click('button[data-act="ask-submit"]'); // drawn while items were uncounted; with all counted it submits at once
    await until(() => root().textContent.includes('Your next assignment'));
    expect(root().textContent).toContain('Autumn audit · Round 1');
    click('button[data-open-next="asg2"]');
    await until(() => api.myItems.mock.calls.some(([id]) => id === 'asg2'));
  });
});

describe('recount my differences', () => {
  const individual = (over = {}) => asg({ method: 'individual-self-pick', ...over });
  const finish = async () => {
    await mountCount(root(), { ctx: { permissions: ['audit.count', 'audit.individual'] } });
    type('i1', '7'); // 3 short on A1; the other two match
    type('i2', '5');
    type('i3', '8');
    click('button[data-act="ask-submit"]');
    await until(() => root().textContent.includes('Your result'));
  };
  beforeEach(() => {
    api.myAssignments.mockResolvedValue([individual(), individual({ assignment_id: 'asg9' })]);
    api.myCompilation.mockResolvedValue({ item_count: 3, variance_count: 1, variance_value: -3.015 });
  });

  it('starts a new Individual Audit on only the items that differed and opens it', async () => {
    api.startIndividual.mockResolvedValue({ assignment_id: 'asg9', items: 1, requested: 1 });
    await finish();
    click('button[data-act="recount"]');
    await until(() => api.myItems.mock.calls.some(([id]) => id === 'asg9'));
    expect(api.startIndividual).toHaveBeenCalledWith({ key: expect.any(String), codes: ['A1'], companies: [], templateId: null });
  });

  it('keeps one key across a retry after a lost connection, so two audits are never started', async () => {
    api.startIndividual
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ assignment_id: 'asg9', items: 1, requested: 1 });
    await finish();
    click('button[data-act="recount"]');
    await until(() => root().querySelector('button[data-act="recount"]') && !root().querySelector('button[data-act="recount"]').disabled);
    expect(root().querySelector('[role="alert"]')).not.toBeNull();
    click('button[data-act="recount"]');
    await until(() => api.startIndividual.mock.calls.length === 2);
    expect(api.startIndividual.mock.calls[1][0].key).toBe(api.startIndividual.mock.calls[0][0].key);
  });

  it('is not offered when nothing differed', async () => {
    api.myCompilation.mockResolvedValue({ item_count: 3, variance_count: 0, variance_value: 0 });
    await finish();
    expect(root().querySelector('button[data-act="recount"]')).toBeNull();
    expect(root().querySelector('a[href="#/audit/individual"]')).not.toBeNull();
  });
});

describe('follow-up round items', () => {
  it('shows last round’s count and a new-product flag, and "Same as last" counts that number as confirmed', async () => {
    const list = items();
    list[0] = { ...list[0], prev_counted: 7, prev_variance: -3 };
    list[1] = { ...list[1], is_new: true };
    api.myItems.mockResolvedValue(list);
    await mountCount(root(), { ctx: {} });
    expect(root().textContent).toContain('Last round: Var -3');
    expect(root().textContent).toContain('New product since the last round');
    expect(root().querySelector('button[data-same="i2"]')).toBeNull(); // nothing to repeat for a new product
    click('button[data-same="i1"]');
    expect(root().querySelector('input[data-qty="i1"]').value).toBe('7');
    await until(() => api.countBatch.mock.calls.length === 1);
    expect(api.countBatch.mock.calls[0][1][0]).toMatchObject({ item: 'i1', qty: 7, auto: false, confirmed: true });
  });
});

describe('sign-out guard (AUD-9)', () => {
  it('blocks signing out while counts are unsent; discarding clears them and lets it through', async () => {
    document.body.innerHTML = '<div id="root"></div><button data-action="signout">Sign out</button>';
    await store.add({ event_id: 'e1', assignment: 'asg1', item: 'i1', qty: 1 });
    const answers = [false, true];
    vi.spyOn(window, 'confirm').mockImplementation(() => answers.shift());
    installSignOutGuard();
    const reached = vi.fn();
    document.body.addEventListener('click', (e) => e.target.closest('[data-action="signout"]') && reached());
    document.querySelector('[data-action="signout"]').click();
    await tick(20);
    expect(reached).not.toHaveBeenCalled(); // cancelled: stays signed in
    expect(await store.count()).toBe(1);
    document.querySelector('[data-action="signout"]').click();
    await tick(20);
    expect(reached).toHaveBeenCalledTimes(1); // discarded: goes through
    expect(await store.count()).toBe(0);
  });
});

describe('individual audit page', () => {
  it('lists the saved templates, starts from the chosen one with one key reused on retry, and goes to counting', async () => {
    api.myAssignments.mockResolvedValue([]);
    api.listTemplates.mockResolvedValueOnce([
      { id: 't1', name: 'Narcotics Random', codes: ['A1', 'A2', 'A3'] },
      { id: 't2', name: 'strips', codes: ['B1'] },
    ]);
    api.startIndividual
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ assignment_id: 'asgX', items: 3, requested: 3 });
    await mountIndividual(root(), { ctx: {} });
    expect(root().querySelector('textarea[data-f="codes"]')).toBeNull(); // no typing of product codes any more
    expect(root().textContent).toContain('Narcotics Random');
    expect(root().textContent).toContain('3 codes');
    expect(root().textContent).toContain('1 code');
    expect(root().querySelector('button[data-act="start"]').disabled).toBe(true);
    const pick = root().querySelector('input[name="aud-template"][value="t1"]');
    pick.checked = true;
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root().querySelector('button[data-act="start"]').disabled).toBe(false);
    click('button[data-act="start"]');
    await until(() => root().textContent.includes('No connection'));
    click('button[data-act="start"]');
    await until(() => api.startIndividual.mock.calls.length === 2);
    const [first, second] = api.startIndividual.mock.calls.map((c) => c[0]);
    expect(first.key).toBe(second.key);
    expect(second).toMatchObject({ codes: [], companies: [], templateId: 't1' });
    await until(() => location.hash === '#/audit/count');
    expect(JSON.parse(sessionStorage.getItem('dua.audit.view')).assignment).toBe('asgX');
  });

  it('says so when there are no templates yet, and points to Templates for people who can add one', async () => {
    api.myAssignments.mockResolvedValue([]);
    await mountIndividual(root(), { ctx: { permissions: ['audit.templates', 'audit.individual'] } });
    expect(root().textContent.replace(/\s+/g, ' ')).toContain('No saved templates yet.');
    expect(root().querySelector('a[href="#/audit/templates"]')).not.toBeNull();
    expect(root().querySelector('textarea[data-f="codes"]')).toBeNull();
    expect(root().querySelector('button[data-act="start"]').disabled).toBe(true);
  });

  it('starts from whole companies typed one per line when the company list cannot load', async () => {
    api.myAssignments.mockResolvedValue([]);
    api.startIndividual.mockResolvedValueOnce({ assignment_id: 'asgC', items: 9, requested: null });
    await mountIndividual(root(), { ctx: {} });
    click('button[data-by="companies"]');
    const box = root().querySelector('textarea[data-f="companies"]');
    box.value = 'Acme Pharma\nBeta Ltd; Acme Pharma';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root().querySelector('[data-count]').textContent).toBe('2 companies');
    click('button[data-act="start"]');
    await until(() => api.startIndividual.mock.calls.length === 1);
    expect(api.startIndividual.mock.calls[0][0]).toMatchObject({ codes: [], companies: ['Acme Pharma', 'Beta Ltd'], templateId: null });
  });

  it('shows a searchable company list with SKU count and value, and starts from the ticked ones', async () => {
    api.myAssignments.mockResolvedValue([]);
    api.listCompanies.mockResolvedValueOnce([
      { company: '3m Riker', skus: 1, value: 1130 },
      { company: 'A.Feroz & Company', skus: 10, value: 115769 },
      { company: "A'raf Pharma", skus: 4, value: 13796 },
    ]);
    api.startIndividual.mockResolvedValueOnce({ assignment_id: 'asgP', items: 5, requested: null });
    await mountIndividual(root(), { ctx: {} });
    click('button[data-by="companies"]');
    expect(root().querySelector('textarea[data-f="companies"]')).toBeNull();
    expect(root().querySelectorAll('input[data-company]').length).toBe(3);
    expect(root().textContent).toContain('10 SKUs · Rs 115,769');
    expect(root().textContent).toContain('1 SKU · Rs 1,130');
    expect(root().querySelector('button[data-act="start"]').disabled).toBe(true);
    const q = root().querySelector('input[data-pq]');
    q.value = 'feroz';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root().querySelectorAll('input[data-company]').length).toBe(1);
    const tick = root().querySelector('input[data-company]');
    tick.checked = true;
    tick.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root().textContent).toContain('1 company selected');
    expect(root().querySelector('button[data-act="start"]').disabled).toBe(false);
    click('button[data-act="start"]');
    await until(() => api.startIndividual.mock.calls.length === 1);
    expect(api.startIndividual.mock.calls[0][0]).toMatchObject({ codes: [], companies: ['A.Feroz & Company'], templateId: null });
  });

  it('will not tick more companies than an Individual Audit allows', async () => {
    api.myAssignments.mockResolvedValue([]);
    api.listCompanies.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({ company: `Co ${String(i).padStart(2, '0')}`, skus: 1, value: 10 })),
    );
    await mountIndividual(root(), { ctx: {} });
    click('button[data-by="companies"]');
    root().querySelector('button[data-pa="all"]').click();
    expect(root().textContent).toContain('20 companies selected — 20 at most');
  });

  it('offers to continue an open one instead of starting another', async () => {
    api.myAssignments.mockResolvedValue([asg({ method: 'individual-self-pick' })]);
    await mountIndividual(root(), { ctx: {} });
    expect(root().textContent).toContain('You have one open');
    expect(root().querySelector('button[data-act="start"]')).toBeNull();
  });
});

describe('templates page', () => {
  it('saves a new template from typed codes; readers cannot edit', async () => {
    await mountTemplates(root(), { ctx: { permissions: ['audit.templates'] } });
    const name = root().querySelector('input[data-f="name"]');
    name.value = 'Weekly';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const codes = root().querySelector('textarea[data-f="codes"]');
    codes.value = 'A1 A2 A1';
    codes.dispatchEvent(new Event('input', { bubbles: true }));
    click('button[data-act="save"]');
    await until(() => api.saveTemplate.mock.calls.length === 1);
    expect(api.saveTemplate).toHaveBeenCalledWith({ id: null, name: 'Weekly', codes: ['A1', 'A2'] });
    document.body.innerHTML = '<div id="root"></div>';
    await mountTemplates(root(), { ctx: { permissions: ['audit.individual'] } });
    expect(root().querySelector('button[data-act="save"]')).toBeNull();
  });
});

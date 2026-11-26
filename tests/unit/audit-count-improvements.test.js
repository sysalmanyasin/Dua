// @vitest-environment jsdom
// Counting screen: a count box selects its contents on focus, companies can be grouped or listed flat,
// and a follow-up round shows last round's count and difference with a "Matched" button.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupByCompany } from '../../js/modules/audit/domain/count.js';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  myAssignments: vi.fn(),
  myItems: vi.fn(),
  countBatch: vi.fn(async (_a, events) => ({ accepted: events.length, duplicates: 0 })),
  submitCount: vi.fn(async () => ({ revision: 1 })),
  startIndividual: vi.fn(),
  myCompilation: vi.fn(async () => null),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount } = await import('../../js/modules/audit/ui/count.js');
const { createMemoryStore, useStore } = await import('../../js/modules/audit/data/outboxStore.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');

const row = (id, company, name, over = {}) => ({
  round_item_id: id,
  item_position: 1,
  code: id.toUpperCase(),
  company,
  name,
  system_qty: 10,
  retail_price: 10,
  counted_qty: null,
  auto_matched: false,
  note: '',
  confirmed_same: false,
  ...over,
});
const list = () => [row('i1', 'Acme', 'Alpha'), row('i2', 'Beta', 'Bravo'), row('i3', 'Acme', 'Charlie', { counted_qty: 4 })];
const root = () => document.getElementById('root');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  useStore(createMemoryStore());
  setView({ assignment: 'asg1' });
  api.myAssignments.mockResolvedValue([
    {
      assignment_id: 'asg1',
      engagement_name: 'Audit',
      round_id: 'r1',
      round_number: 1,
      round_suffix: null,
      round_state: 'counting',
      status: 'assigned',
      items: 3,
      counted: 1,
    },
  ]);
  api.myItems.mockResolvedValue(list());
});

describe('groupByCompany', () => {
  it('can be turned off: one flat list in name order, even with several companies', () => {
    const items = list();
    expect(groupByCompany(items).map((g) => g.company)).toEqual(['Acme', 'Beta']);
    const flat = groupByCompany(items, false);
    expect(flat).toHaveLength(1);
    expect(flat[0].company).toBeNull();
    expect(flat[0].items.map((i) => i.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});

describe('company grouping switch', () => {
  it('is shown with more than one company, groups by default, and flattens the list when turned off', async () => {
    await mount(root(), { ctx: {} });
    const sw = root().querySelector('input[data-f="group"]');
    expect(sw).not.toBeNull();
    expect(sw.checked).toBe(true);
    expect(root().querySelectorAll('button[data-group]')).toHaveLength(2);
    sw.checked = false;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root().querySelectorAll('button[data-group]')).toHaveLength(0);
    expect(root().querySelectorAll('.aud-row')).toHaveLength(3); // every item is still there
    expect(root().querySelector('[data-item="i2"]').textContent).toContain('Beta'); // the company is named on the row instead
    sw.checked = true;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root().querySelectorAll('button[data-group]')).toHaveLength(2);
  });

  it('is not shown when the list has one company', async () => {
    api.myItems.mockResolvedValue(list().map((i) => ({ ...i, company: 'Acme' })));
    await mount(root(), { ctx: {} });
    expect(root().querySelector('input[data-f="group"]')).toBeNull();
  });
});

describe('count box focus', () => {
  it('selects what is in the box, filled or empty, so the next key replaces it', async () => {
    await mount(root(), { ctx: {} });
    const filled = root().querySelector('input[data-qty="i3"]');
    expect(filled.value).toBe('4');
    const select = vi.spyOn(filled, 'select');
    filled.focus();
    await tick(5);
    expect(select).toHaveBeenCalled();
    const empty = root().querySelector('input[data-qty="i1"]');
    const selectEmpty = vi.spyOn(empty, 'select');
    empty.focus();
    await tick(5);
    expect(selectEmpty).toHaveBeenCalled();
  });

  it('selects the next box after Enter', async () => {
    await mount(root(), { ctx: {} });
    const first = root().querySelector('input[data-qty="i1"]');
    first.focus();
    first.value = '9';
    const nextBox = [...root().querySelectorAll('input[data-qty]')][1];
    const select = vi.spyOn(nextBox, 'select');
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(5);
    expect(document.activeElement).toBe(nextBox);
    expect(select).toHaveBeenCalled();
  });
});

describe('follow-up round: last round and "Matched"', () => {
  it('shows last count and difference, and Matched counts the same number as confirmed', async () => {
    api.myItems.mockResolvedValue([
      row('i1', 'Acme', 'Alpha', { prev_counted: 6, prev_variance: -4 }),
      row('i2', 'Acme', 'Bravo', { prev_counted: 10, prev_variance: 0 }),
    ]);
    await mount(root(), { ctx: {} });
    expect(root().querySelector('[data-prev="i1"]').textContent).toBe('Last round: counted 6 · difference -4');
    expect(root().querySelector('[data-prev="i2"]').textContent).toBe('Last round: counted 10 · difference 0');
    const btn = root().querySelector('button[data-same="i1"]');
    expect(btn.textContent.replace(/\s+/g, ' ').trim()).toBe('Matched: same as last (6)');
    btn.click();
    expect(root().querySelector('input[data-qty="i1"]').value).toBe('6');
    await vi.waitFor(() => expect(api.countBatch).toHaveBeenCalled());
    expect(api.countBatch.mock.calls[0][1][0]).toMatchObject({ item: 'i1', qty: 6, auto: false, confirmed: true });
  });
});

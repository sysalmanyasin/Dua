// @vitest-environment jsdom
// The Expiry screen and the Racks screen, with the database layer mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  expiryOverview: vi.fn(),
  expiryProducts: vi.fn(),
  logExpiry: vi.fn(async () => 'e1'),
  searchExpiry: vi.fn(),
  reopenExpiry: vi.fn(async () => {}),
  updateExpiry: vi.fn(async () => {}),
  deleteExpiry: vi.fn(async () => {}),
  saveRack: vi.fn(async () => 'r9'),
  expiryPeople: vi.fn(),
  assignRack: vi.fn(async () => 'a1'),
  unassignRack: vi.fn(async () => {}),
}));
const api = await import('../../js/modules/audit/data/api.js');
const expiry = await import('../../js/modules/audit/ui/expiry.js');
const racks = await import('../../js/modules/audit/ui/racks.js');

const logger = { ctx: { permissions: ['audit.expiry_log'] } };
const owner = { ctx: { permissions: ['audit.manage', 'audit.expiry_manage'] } };
const overview = (over = {}) => ({
  month: '2026-11',
  current_month: '2026-11',
  racks: [
    { id: 'k1', name: 'Rack A2', active: true },
    { id: 'k2', name: 'Cold Chain 1', active: false },
  ],
  assignments: [{ id: 'a1', rack_id: 'k1', rack_name: 'Rack A2', user_id: 'u1', staff_name: 'Count One' }],
  my_racks: ['Rack A2'],
  ...over,
});
const entry = (over = {}) => ({
  total: 1,
  id: 'e1',
  product_code: 'A1',
  product_name: 'Alpha one',
  quantity: 12,
  expiry_month: '2027-01',
  rack_location: 'Rack A2',
  status: 'Near Expiry',
  locked: true,
  staff_name: 'Count One',
  logged_at: '2026-11-18T08:00:00Z',
  reopened_at: null,
  ...over,
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await tick(15);
  }
  throw new Error('timed out waiting');
};
const root = () => document.getElementById('root');
const click = (sel) => root().querySelector(sel).click();
const type = (sel, value, event = 'input') => {
  const i = root().querySelector(sel);
  i.value = value;
  i.dispatchEvent(new Event(event, { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  api.expiryOverview.mockResolvedValue(overview());
  api.searchExpiry.mockResolvedValue([entry()]);
  api.expiryProducts.mockResolvedValue([{ id: 'p1', code: 'A1', name: 'Alpha one', company: 'Acme' }]);
});

describe('Expiry: logging', () => {
  async function fillAndSave() {
    type('[data-field="pq"]', 'alp');
    await until(() => root().querySelector('[data-act="pick"]'));
    click('[data-act="pick"]');
    await until(() => root().querySelector('[data-field="qty"]'));
    type('[data-field="qty"]', '12');
    type('[data-field="month"]', '2027-01', 'change');
    type('[data-field="rack"]', 'Rack A2', 'change');
    click('[data-act="save"]');
  }
  it('opens on the log form for someone who may log, with only their racks on offer', async () => {
    await expiry.mount(root(), logger);
    expect(root().textContent).toContain('Log near-expiry stock');
    const racksOffered = [...root().querySelectorAll('[data-field="rack"] option')].map((o) => o.value).filter(Boolean);
    expect(racksOffered).toEqual(['Rack A2']);
  });
  it('searches for a product, then saves with a key, and a fresh key for the next entry', async () => {
    await expiry.mount(root(), logger);
    await fillAndSave();
    await until(() => api.logExpiry.mock.calls.length === 1);
    const first = api.logExpiry.mock.calls[0][0];
    expect(first).toMatchObject({ productId: 'p1', qty: 12, month: '2027-01', rack: 'Rack A2', status: 'Near Expiry' });
    expect(first.key).toMatch(/^[0-9a-f-]{36}$/);
    await until(() => root().textContent.includes('Search') || root().querySelector('[data-field="pq"]'));
    await fillAndSave();
    await until(() => api.logExpiry.mock.calls.length === 2);
    expect(api.logExpiry.mock.calls[1][0].key).not.toBe(first.key);
  });
  it('keeps the same key when a save fails and is tried again', async () => {
    api.logExpiry.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expiry.mount(root(), logger);
    await fillAndSave();
    await until(() => root().textContent.includes('connection') || root().querySelector('.note-error'));
    click('[data-act="save"]');
    await until(() => api.logExpiry.mock.calls.length === 2);
    expect(api.logExpiry.mock.calls[1][0].key).toBe(api.logExpiry.mock.calls[0][0].key);
  });
  it('says what is missing before sending anything', async () => {
    await expiry.mount(root(), logger);
    click('[data-act="save"]');
    await until(() => root().textContent.includes('Search for a product'));
    expect(api.logExpiry).not.toHaveBeenCalled();
  });
  it('shows the database refusal in words', async () => {
    api.logExpiry.mockRejectedValueOnce(Object.assign(new Error('x'), { hint: 'rack_not_yours' }));
    await expiry.mount(root(), logger);
    await fillAndSave();
    await until(() => root().textContent.includes('not yours this month'));
  });
  it('tells a logger when no racks exist yet', async () => {
    api.expiryOverview.mockResolvedValue(overview({ my_racks: [] }));
    await expiry.mount(root(), logger);
    expect(root().textContent).toContain('No racks have been set up yet');
  });
});

describe('Expiry: register', () => {
  it('shows every entry and no owner buttons to a logger', async () => {
    await expiry.mount(root(), logger);
    click('[data-tab="register"]');
    await until(() => root().textContent.includes('Alpha one'));
    expect(root().textContent).toContain('January 2027');
    expect(root().querySelector('[data-act="reopen"]')).toBeNull();
    expect(root().querySelector('[data-act="delete"]')).toBeNull();
  });
  it('filters by month and status through the database', async () => {
    await expiry.mount(root(), logger);
    click('[data-tab="register"]');
    await until(() => api.searchExpiry.mock.calls.length === 1);
    type('[data-field="rmonth"]', '2027-01', 'change');
    await until(() => api.searchExpiry.mock.calls.length === 2);
    expect(api.searchExpiry.mock.calls[1][0]).toMatchObject({ month: '2027-01', offset: 0 });
    type('[data-field="rstatus"]', 'Sold', 'change');
    await until(() => api.searchExpiry.mock.calls.length === 3);
    expect(api.searchExpiry.mock.calls[2][0]).toMatchObject({ month: '2027-01', status: 'Sold' });
  });
  it('asks for the next page', async () => {
    api.searchExpiry.mockResolvedValue(Array.from({ length: 50 }, (_, i) => entry({ total: 120, id: `e${i}` })));
    await expiry.mount(root(), logger);
    click('[data-tab="register"]');
    await until(() => root().querySelector('[data-act="next"]:not([disabled])'));
    click('[data-act="next"]');
    await until(() => api.searchExpiry.mock.calls.length === 2);
    expect(api.searchExpiry.mock.calls[1][0]).toMatchObject({ offset: 50, limit: 50 });
  });
});

describe('Expiry: owner', () => {
  it('reopens a locked entry, then edits and saves it', async () => {
    await expiry.mount(root(), owner);
    click('[data-tab="register"]');
    await until(() => root().querySelector('[data-act="reopen"]'));
    api.searchExpiry.mockResolvedValue([entry({ locked: false })]);
    click('[data-act="reopen"]');
    await until(() => root().querySelector('[data-act="edit"]'));
    expect(api.reopenExpiry).toHaveBeenCalledWith('e1');
    click('[data-act="edit"]');
    await until(() => root().querySelector('[data-edit="qty"]'));
    type('[data-edit="qty"]', '10');
    type('[data-edit="status"]', 'Discarded', 'change');
    click('[data-act="save-edit"]');
    await until(() => api.updateExpiry.mock.calls.length === 1);
    expect(api.updateExpiry.mock.calls[0][0]).toMatchObject({ id: 'e1', qty: 10, status: 'Discarded', rack: 'Rack A2', month: '2027-01' });
  });
  it('deletes only with a reason', async () => {
    await expiry.mount(root(), owner);
    click('[data-tab="register"]');
    await until(() => root().querySelector('[data-act="delete"]'));
    click('[data-act="delete"]');
    await until(() => root().querySelector('[data-act="delete-yes"]'));
    expect(api.deleteExpiry).not.toHaveBeenCalled();
    type('[data-field="reason"]', 'entered twice');
    click('[data-act="delete-yes"]');
    await until(() => api.deleteExpiry.mock.calls.length === 1);
    expect(api.deleteExpiry).toHaveBeenCalledWith('e1', 'entered twice');
  });
  it('links to the racks page', async () => {
    await expiry.mount(root(), owner);
    expect(root().querySelector('a[href="#/audit/expiry/racks"]')).not.toBeNull();
    document.body.innerHTML = '<div id="root"></div>';
    await expiry.mount(root(), logger);
    expect(root().querySelector('a[href="#/audit/expiry/racks"]')).toBeNull();
  });
  it('refuses to open the register for a database refusal, in words', async () => {
    api.expiryOverview.mockRejectedValue(Object.assign(new Error('x'), { hint: 'not_allowed' }));
    await expiry.mount(root(), logger);
    expect(root().textContent).toContain('not allowed');
  });
});

describe('Racks screen', () => {
  const people = [
    { user_id: 'u1', full_name: 'Count One', can_log: true },
    { user_id: 'u2', full_name: 'Dep Two', can_log: false },
  ];
  beforeEach(() => api.expiryPeople.mockResolvedValue(people));
  it('lists racks with who has them this month', async () => {
    await racks.mount(root());
    const t = root().textContent;
    expect(t).toContain('Rack A2');
    expect(t).toContain('Checked by Count One');
    expect(t).toContain('Cold Chain 1');
    expect(t).toContain('(off)');
    expect(t).toContain('Dep Two (no logging key)');
  });
  it('adds a rack by name', async () => {
    await racks.mount(root());
    type('[data-field="name"]', 'Rack B1');
    click('[data-act="add"]');
    await until(() => api.saveRack.mock.calls.length === 1);
    expect(api.saveRack).toHaveBeenCalledWith({ name: 'Rack B1' });
  });
  it('gives a rack to a person for the month shown', async () => {
    await racks.mount(root());
    type('[data-rack="k1"]', 'u2', 'change');
    await until(() => api.assignRack.mock.calls.length === 1);
    expect(api.assignRack).toHaveBeenCalledWith({ rackId: 'k1', userId: 'u2', month: '2026-11' });
  });
  it('takes a rack back and switches one off', async () => {
    await racks.mount(root());
    click('[data-act="unassign"]');
    await until(() => api.unassignRack.mock.calls.length === 1);
    expect(api.unassignRack).toHaveBeenCalledWith('a1');
    click('[data-act="toggle"][data-id="k1"]');
    await until(() => api.saveRack.mock.calls.length === 1);
    expect(api.saveRack).toHaveBeenCalledWith({ id: 'k1', name: 'Rack A2', active: false });
  });
  it('loads another month when it is chosen', async () => {
    await racks.mount(root());
    type('[data-field="month"]', '2026-12', 'change');
    await until(() => api.expiryOverview.mock.calls.length === 2);
    expect(api.expiryOverview.mock.calls[1][0]).toBe('2026-12');
  });
  it('shows a duplicate-rack refusal in words', async () => {
    api.saveRack.mockRejectedValueOnce(Object.assign(new Error('x'), { hint: 'rack_exists' }));
    await racks.mount(root());
    type('[data-field="name"]', 'Rack A2');
    click('[data-act="add"]');
    await until(() => root().textContent.includes('already exists'));
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mkH = (o) => ({
  str_id: 1,
  str_number: 'T-1',
  master_str_id: 'M-1',
  ref_no: '',
  media: 'Van',
  str_status: 'Open',
  str_date: '2026-11-12',
  issued_by: 'Tester',
  dispatched_date: '2026-11-12',
  dispatch_status: 'Dispatched',
  dispatched_by: 'Packer',
  receive_date: null,
  receive_status: '',
  received_by: '',
  comments: '',
  dispatch_branch: 'Warehouse',
  receive_branch: 'Test Branch',
  direction: 'in',
  no_of_boxes: '4',
  stage: 'dispatched',
  line_count: 2,
  ...o,
});
const FEED = [
  mkH({ str_id: 3, str_number: 'T-3', stage: 'received', direction: 'in', str_date: '2026-11-12', comments: 'Urgent' }),
  mkH({
    str_id: 2,
    str_number: 'T-2',
    stage: 'awaited',
    direction: 'out',
    dispatch_branch: 'Test Branch',
    receive_branch: 'Warehouse',
    str_date: '2026-11-11',
  }),
  mkH({ str_id: 1, str_number: 'T-1', stage: 'dispatched', direction: 'in', str_date: '2026-11-10' }),
];
const LINES = [
  {
    str_id: 1,
    str_item_id: 1,
    product_code: 'P10',
    product_name: 'Test Syrup',
    str_qty: 30,
    dispatch_qty: 30,
    receive_qty: 20,
    product_price: 100,
  },
  {
    str_id: 1,
    str_item_id: 2,
    product_code: 'P2',
    product_name: 'Test Tablet',
    str_qty: 12,
    dispatch_qty: 12,
    receive_qty: null,
    product_price: 50,
  },
  {
    str_id: 1,
    str_item_id: 3,
    product_code: 'ZZ',
    product_name: 'Gone Product',
    str_qty: 8,
    dispatch_qty: null,
    receive_qty: null,
    product_price: 7,
  },
];
const api = {
  feedHeaders: vi.fn(async () => FEED),
  linesFor: vi.fn(async () => []),
  searchHeaders: vi.fn(async () => []),
  headerById: vi.fn(async (id) => FEED.find((h) => h.str_id === id) ?? null),
  lines: vi.fn(async () => LINES),
  dataAsOf: vi.fn(async () => '2026-11-12T08:00:00Z'),
};
const inventory = {
  productMeta: vi.fn(async () => ({ P10: { supplier: 'Beta Supplies', factor: 10 }, P2: { supplier: 'Alpha Supplies', factor: 4 } })),
};
vi.mock('../../js/modules/str/data/api.js', () => api);
vi.mock('../../js/modules/str/data/inventory.js', () => inventory);

const { state, resetFilters } = await import('../../js/modules/str/ui/state.js');
const list = await import('../../js/modules/str/ui/list.js');
const detail = await import('../../js/modules/str/ui/detail.js');

const tick = () => vi.advanceTimersByTimeAsync(400);
let el;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockClear());
  api.feedHeaders.mockImplementation(async () => FEED);
  api.searchHeaders.mockImplementation(async () => []);
  inventory.productMeta.mockClear();
  resetFilters();
  Object.assign(state, { selectedId: null, orderedIds: [] });
  location.hash = '';
  window.print = vi.fn();
});
const rows = () => [...el.querySelectorAll('.str-row')].map((b) => b.dataset.id);
const press = (sel) => el.querySelector(sel).click();

describe('STR list', () => {
  it('shows the feed newest first, with stage words and a status line', async () => {
    await list.mount(el);
    await tick();
    expect(rows()).toEqual(['3', '2', '1']);
    expect(el.querySelector('.str-status').textContent).toMatch(/3 STRs in the current feed/);
    expect(el.querySelector('.str-status').textContent).toMatch(/data as of/);
    expect(el.textContent).toMatch(/Received/);
    expect(el.textContent).toMatch(/Awaited/);
    expect(api.searchHeaders).not.toHaveBeenCalled();
  });
  it('filters by stage on the phone, without asking the server', async () => {
    await list.mount(el);
    await tick();
    press('[data-stage="awaited"]');
    await tick();
    expect(rows()).toEqual(['2']);
    expect(el.querySelector('[data-stage="awaited"]').getAttribute('aria-pressed')).toBe('true');
    expect(api.searchHeaders).not.toHaveBeenCalled();
  });
  it('filters by branch chip and shows counts', async () => {
    await list.mount(el);
    await tick();
    expect(el.querySelector('[data-branch="dispatched"]').textContent).toMatch(/1/);
    expect(el.querySelector('[data-branch="received"]').textContent).toMatch(/2/);
    press('[data-branch="received"]');
    await tick();
    expect(rows()).toEqual(['3', '1']);
  });
  it('searches on the server after a short pause, and shows its rows', async () => {
    api.searchHeaders.mockImplementation(async () => [
      mkH({ str_id: 50, str_number: 'OLD-50', stage: 'received', str_date: '2026-10-20' }),
    ]);
    await list.mount(el);
    await tick();
    const input = el.querySelector('#str-search');
    input.value = 'gel';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(api.searchHeaders).not.toHaveBeenCalled(); // waits for a pause in typing
    await tick();
    expect(api.searchHeaders).toHaveBeenCalledWith(expect.objectContaining({ text: 'gel', offset: 0, limit: 50 }));
    expect(rows()).toEqual(['50']);
    expect(el.querySelector('.str-status').textContent).toMatch(/including recent history/);
  });
  it('asks the server for a date range, with stage and direction', async () => {
    await list.mount(el);
    await tick();
    press('[data-stage="received"]');
    press('[data-branch="dispatched"]');
    const from = el.querySelector('#str-from');
    from.value = '2026-10-01';
    from.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.searchHeaders).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-01', stage: 'received', direction: 'out' }),
    );
  });
  it('loads more when a full page came back', async () => {
    const page = Array.from({ length: 50 }, (_, i) => mkH({ str_id: 1000 - i, str_number: `B-${i}` }));
    api.searchHeaders.mockImplementationOnce(async () => page).mockImplementationOnce(async () => [mkH({ str_id: 5, str_number: 'LAST' })]);
    state.search = 'b';
    await list.mount(el);
    await tick();
    expect(rows()).toHaveLength(50);
    press('#str-more');
    await tick();
    expect(api.searchHeaders).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
    expect(rows()).toHaveLength(51);
    expect(el.querySelector('#str-more')).toBeNull();
  });
  it('clear returns to the feed', async () => {
    state.search = 'x';
    await list.mount(el);
    await tick();
    press('#str-clear');
    await tick();
    expect(rows()).toEqual(['3', '2', '1']);
    expect(el.querySelector('#str-search').value).toBe('');
  });
  it('says so when nothing matches, and when the search fails', async () => {
    state.search = 'nothing';
    await list.mount(el);
    await tick();
    expect(el.textContent).toMatch(/No transfers match/);
    api.searchHeaders.mockImplementation(async () => {
      throw new Error('down');
    });
    press('#str-clear');
    state.search = 'again';
    el.querySelector('#str-search').value = 'again';
    el.querySelector('#str-search').dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(el.textContent).toMatch(/Search failed/);
  });
  it('shows a plain message when the feed cannot be read', async () => {
    api.feedHeaders.mockImplementation(async () => {
      throw new Error('down');
    });
    await list.mount(el);
    await tick();
    expect(el.textContent).toMatch(/Could not load transfers/);
    expect(el.textContent).not.toMatch(/down/);
  });
  it('opens the detail of a tapped row and remembers the list for Prev/Next', async () => {
    await list.mount(el);
    await tick();
    press('[data-stage="all"]');
    el.querySelector('.str-row[data-id="2"]').click();
    expect(state.selectedId).toBe(2);
    expect(state.orderedIds).toEqual([3, 2, 1]);
    expect(location.hash).toBe('#/str/detail');
  });
  it('shows comments as plain text', async () => {
    api.feedHeaders.mockImplementation(async () => [mkH({ str_id: 9, comments: '<img src=x onerror=alert(1)>' })]);
    await list.mount(el);
    await tick();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x');
  });
});

describe('STR detail', () => {
  const open = async (id = 1, ids = [3, 2, 1]) => {
    state.selectedId = id;
    state.orderedIds = ids;
    await detail.mount(el);
    await tick();
  };
  it('goes back to the list when there is nothing selected (a reload)', async () => {
    await detail.mount(el);
    expect(location.hash).toBe('#/str');
  });
  it('shows the old header fields', async () => {
    await open();
    for (const label of [
      'From',
      'To',
      'Master STR #',
      'STR #',
      'Media',
      'Ref #',
      'STR Date',
      'STR Status',
      'Issued By',
      'Dispatched Date',
      'Dispatch Status',
      'Dispatched By',
      'Receive Date',
      'Receive Status',
      'Received By',
      'Cartons',
    ])
      expect(el.querySelector('.str-fields').textContent).toContain(label);
    expect(el.querySelector('.str-fields').textContent).toContain('Warehouse');
    expect(el.querySelector('.str-title').textContent).toContain('STR #T-1');
  });
  it('groups by supplier with pack quantities, subtotals and a grand total', async () => {
    await open();
    const text = el.querySelector('.str-table').textContent;
    expect(text.indexOf('Alpha Supplies')).toBeLessThan(text.indexOf('Beta Supplies'));
    expect(text.indexOf('Beta Supplies')).toBeLessThan(text.indexOf('Unassigned Supplier'));
    const group = [...el.querySelectorAll('.str-table tbody tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    expect(group.some((r) => r.includes('[P10] Test Syrup') && r.includes('3 3 2'))).toBe(true); // 30/10, 30/10, 20/10
    expect(group.some((r) => r.includes('[P2] Test Tablet') && r.includes('3 3'))).toBe(true); // 12/4
    expect(el.querySelector('.str-table tfoot').textContent).toMatch(/Grand total — 3 items/);
    expect(el.querySelector('.str-table tfoot').textContent).toMatch(/14/); // STR: 3 + 3 + 8
  });
  it('shows a short or extra difference in words as well as colour', async () => {
    await open();
    expect(el.querySelector('.str-diff-over').textContent).toMatch(/\+1/);
    expect(el.querySelector('.str-diff-over').textContent).toMatch(/extra/);
  });
  it('says so and falls back to loose units when Inventory cannot give pack sizes', async () => {
    inventory.productMeta.mockImplementationOnce(async () => null);
    await open();
    expect(el.textContent).toMatch(/not available yet/);
    expect(el.querySelector('.str-table').textContent).toContain('Unassigned Supplier');
    expect(el.querySelectorAll('.str-group').length).toBe(1);
  });
  it('walks the list with Previous and Next, and disables the ends', async () => {
    await open(2);
    expect(el.querySelector('#str-prev').disabled).toBe(false);
    el.querySelector('#str-next').click();
    await tick();
    expect(state.selectedId).toBe(1);
    expect(el.querySelector('#str-next').disabled).toBe(true);
    el.querySelector('#str-prev').click();
    await tick();
    expect(state.selectedId).toBe(2);
    el.querySelector('#str-prev').click();
    await tick();
    expect(el.querySelector('#str-prev').disabled).toBe(true);
  });
  it('prints a clean copy and removes it afterwards', async () => {
    await open();
    el.querySelector('#str-print').click();
    const root = document.getElementById('str-print-root');
    expect(root).not.toBeNull();
    expect(root.textContent).toContain('STOCK TRANSFER REPORT');
    expect(root.textContent).toContain('Grand total');
    expect(document.body.classList.contains('str-printing')).toBe(true);
    expect(window.print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('str-print-root')).toBeNull();
    expect(document.body.classList.contains('str-printing')).toBe(false);
  });
  it('explains an STR that cannot be found', async () => {
    await open(999);
    expect(el.textContent).toMatch(/Transfer not found/);
    expect(el.querySelector('a[href="#/str"]')).not.toBeNull();
  });
  it('shows a plain message when loading fails', async () => {
    api.lines.mockImplementationOnce(async () => {
      throw new Error('secret db detail');
    });
    await open();
    expect(el.textContent).toMatch(/Could not load this transfer/);
    expect(el.textContent).not.toMatch(/secret db detail/);
  });
  it('shows comments as plain text', async () => {
    api.headerById.mockImplementationOnce(async () => mkH({ comments: '<script>alert(1)</script>' }));
    await open();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });
  it('never asks for cost', async () => {
    await open();
    expect(JSON.stringify(api.lines.mock.calls)).not.toMatch(/cost/i);
    expect(el.textContent).not.toMatch(/cost/i);
  });
});

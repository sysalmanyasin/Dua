// @vitest-environment jsdom
// Hybrid counting and the Barcode Center, in a DOM with the database layer and the camera replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanner = vi.hoisted(() => ({ opts: null }));
vi.mock('../../js/modules/audit/ui/scanner.js', () => ({
  openScanner: vi.fn((opts) => {
    scanner.opts = opts;
    return { close() {} };
  }),
}));
vi.mock('../../js/modules/audit/ui/scanEngine.js', () => ({ warmEngine: vi.fn(async () => 'native') }));
vi.mock('../../js/modules/audit/data/api.js', () => ({
  myAssignments: vi.fn(),
  myItems: vi.fn(),
  countBatch: vi.fn(async (_a, events) => ({ accepted: events.length, duplicates: 0 })),
  submitCount: vi.fn(async () => ({ revision: 1 })),
  scanBatch: vi.fn(async (events) => ({ saved: events.length, duplicates: 0, rejected: 0 })),
  barcodeMirrorPage: vi.fn(async () => []),
  listBarcodes: vi.fn(async () => []),
  barcodeProducts: vi.fn(async () => []),
  registerBarcode: vi.fn(),
  verifyBarcode: vi.fn(async () => 'verified'),
  resolveBarcodeConflict: vi.fn(async () => 'verified'),
  changeBarcode: vi.fn(async () => {}),
  disableBarcode: vi.fn(async () => {}),
  enableBarcode: vi.fn(async () => 'verified'),
  barcodeHistory: vi.fn(async () => []),
  scanHistory: vi.fn(async () => []),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount: mountCount } = await import('../../js/modules/audit/ui/count.js');
const { mount: mountCenter } = await import('../../js/modules/audit/ui/barcode.js');
const { createMemoryStore, useStore } = await import('../../js/modules/audit/data/outboxStore.js');
const { createMemoryBarcodeStore, useBarcodeStore } = await import('../../js/modules/audit/data/barcodeStore.js');
const { resetAdminTab } = await import('../../js/modules/audit/ui/barcodeAdmin.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');
const { timing } = await import('../../js/modules/audit/domain/outbox.js');
timing.flushDelayMs = 10;

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await tick(15);
  }
  throw new Error('timed out waiting');
};
const root = () => document.getElementById('root');
const text = () => root().textContent.replace(/\s+/g, ' ');
const click = (sel) => root().querySelector(sel).click();
const has = (sel) => root().querySelector(sel) !== null;
const type = (id, value) => {
  const input = root().querySelector(`input[data-qty="${id}"]`);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const typeField = (sel, value) => {
  const input = root().querySelector(sel);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

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
  counting_method: 'hybrid',
  ...over,
});
const item = (n, code, name, company = 'Acme') => ({
  round_item_id: `i${n}`,
  item_position: n,
  code,
  company,
  name,
  system_qty: 10,
  retail_price: 10,
  counted_qty: null,
  auto_matched: false,
  note: '',
  confirmed_same: false,
});
const items = () => [item(1, 'A1', 'Alpha one'), item(2, 'A2', 'Alpha two'), item(3, 'B1', 'Beta one', 'Beta')];
const bc = (barcode, product_code, status = 'verified', over = {}) => ({
  id: `id-${barcode}`,
  barcode,
  product_code,
  product_name: `Name ${product_code}`,
  status,
  conflict_product_code: status === 'conflict' ? 'Z9' : null,
  updated_at: '2026-11-19T10:00:00.000Z',
  ...over,
});
const MIRROR = [
  bc('5901234123457', 'A1'),
  bc('4006381333931', 'C1'),
  bc('1111111111116', 'A2', 'unverified'),
  bc('2222222222222', 'A1', 'conflict'),
  bc('3333333333333', 'A2', 'disabled'),
  bc('4444444444444', 'B1'),
];

let outbox;
let barcodes;
const seedMirror = (rows) =>
  barcodes.setKv('mirror', { rows, cursor: { since: rows.at(-1)?.updated_at ?? null, after: rows.at(-1)?.id ?? null } });

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  vi.clearAllMocks();
  scanner.opts = null;
  resetAdminTab();
  outbox = createMemoryStore();
  useStore(outbox);
  barcodes = createMemoryBarcodeStore();
  useBarcodeStore(barcodes);
  await seedMirror(MIRROR);
  setView({ assignment: 'asg1' });
  api.myAssignments.mockResolvedValue([asg()]);
  api.myItems.mockResolvedValue(items());
  api.barcodeMirrorPage.mockResolvedValue([]);
});

describe('hybrid counting', () => {
  const COUNTER = { permissions: ['audit.count', 'audit.barcode_scan'] };
  const scan = async (code) => {
    await scanner.opts.onCode({ code, format: 'ean13', type: 'ean13' });
    await tick(20);
  };

  it('offers Scan only when the audit is barcode or hybrid and the person may scan', async () => {
    await mountCount(root(), { ctx: COUNTER });
    expect(has('[data-act="scan"]')).toBe(true);
    document.body.innerHTML = '<div id="root"></div>';
    api.myAssignments.mockResolvedValue([asg({ counting_method: 'manual' })]);
    await mountCount(root(), { ctx: COUNTER });
    expect(has('[data-act="scan"]')).toBe(false);
    document.body.innerHTML = '<div id="root"></div>';
    api.myAssignments.mockResolvedValue([asg()]);
    await mountCount(root(), { ctx: { permissions: ['audit.count'] } });
    expect(has('[data-act="scan"]')).toBe(false);
  });

  it('works with an assignment from before barcodes existed (no counting_method): manual', async () => {
    api.myAssignments.mockResolvedValue([{ ...asg(), counting_method: undefined }]);
    await mountCount(root(), { ctx: COUNTER });
    expect(has('[data-act="scan"]')).toBe(false);
  });

  it('a scan finds the item, puts it first and focuses its quantity, but counts nothing', async () => {
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan('5901234123457');
    const first = root().querySelector('[data-item]');
    expect(first.dataset.item).toBe('i1');
    expect(first.className).toContain('aud-row-scanned');
    expect(document.activeElement.dataset.qty).toBe('i1');
    expect(text()).toContain('Alpha one: enter the quantity.');
    expect(await outbox.count('asg1')).toBe(0); // AUD-4: only a typed quantity counts
    expect(root().textContent).toContain('0 of 3 counted');
    type('i1', '7');
    expect(await outbox.count('asg1')).toBe(1);
  });

  it('moves an item found further down to the top, and Show the whole list releases it', async () => {
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan('4444444444444'); // B1 is the third item
    expect(root().querySelector('[data-item]').dataset.item).toBe('i3');
    click('[data-act="unpin"]');
    expect(root().querySelector('[data-item]').dataset.item).toBe('i1');
  });

  it('saves the scan on the device and sends it with the right assignment and result', async () => {
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan('5901234123457');
    await until(() => api.scanBatch.mock.calls.length > 0);
    const [events] = api.scanBatch.mock.calls[0];
    expect(events[0]).toMatchObject({ type: 'count', barcode: '5901234123457', result: 'matched', assignment: 'asg1', code: 'A1' });
    expect(events[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await until(async () => (await barcodes.count('scan')) === 0);
  });

  it.each([
    ['4006381333931', 'not_in_assignment', /Name C1 \(C1\) is not in the list given to you/],
    ['1111111111116', 'unverified', /not verified yet/],
    ['2222222222222', 'conflict', /in conflict/],
    ['3333333333333', 'disabled', /switched off/],
    ['9999999999994', 'not_found', /not in the barcode list/],
  ])('%s: says %s, and finds nothing to count', async (code, result, message) => {
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan(code);
    expect(text()).toMatch(message);
    expect(has('.aud-row-scanned')).toBe(false);
    expect(await outbox.count('asg1')).toBe(0);
    await until(() => api.scanBatch.mock.calls.length > 0);
    expect(api.scanBatch.mock.calls[0][0][0].result).toBe(result);
  });

  it("never shows an item from outside the counter's list", async () => {
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan('4006381333931');
    expect(text()).not.toContain('C1 ·');
    expect(root().querySelectorAll('[data-item]')).toHaveLength(3);
  });

  it('lets the counter choose when two items share a code, and guesses nothing', async () => {
    api.myItems.mockResolvedValue([...items(), item(4, 'B1', 'Beta one (second pack)', 'Beta')]);
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan('4444444444444');
    expect(text()).toMatch(/2 items in your list share the code B1/);
    expect(has('.aud-row-scanned')).toBe(false);
    click('[data-choose="i4"]');
    expect(root().querySelector('[data-item]').dataset.item).toBe('i4');
  });

  it('says to connect once when this phone has no barcode list yet', async () => {
    await barcodes.reset();
    await mountCount(root(), { ctx: COUNTER });
    click('[data-act="scan"]');
    await scan('5901234123457');
    expect(text()).toMatch(/No barcode list is saved on this phone yet/);
  });

  describe('the scan-first (barcode) method', () => {
    beforeEach(() => api.myAssignments.mockResolvedValue([asg({ counting_method: 'barcode' })]));

    it('starts with rows locked and no shortcut buttons', async () => {
      await mountCount(root(), { ctx: COUNTER });
      expect(root().querySelector('input[data-qty="i1"]').disabled).toBe(true);
      expect(has('[data-match]')).toBe(false);
      expect(has('[data-hand="i1"]')).toBe(true);
    });
    it('a scan unlocks that item only', async () => {
      await mountCount(root(), { ctx: COUNTER });
      click('[data-act="scan"]');
      await scan('5901234123457');
      expect(root().querySelector('input[data-qty="i1"]').disabled).toBe(false);
      expect(root().querySelector('input[data-qty="i2"]').disabled).toBe(true);
      type('i1', '3');
      expect(await outbox.count('asg1')).toBe(1);
    });
    it('Count by hand unlocks a single row for a label that cannot be scanned', async () => {
      await mountCount(root(), { ctx: COUNTER });
      click('[data-hand="i2"]');
      expect(root().querySelector('input[data-qty="i2"]').disabled).toBe(false);
      expect(root().querySelector('input[data-qty="i1"]').disabled).toBe(true);
    });
    it('keeps a row open once it already has a count', async () => {
      api.myItems.mockResolvedValue([{ ...items()[0], counted_qty: 4 }, ...items().slice(1)]);
      await mountCount(root(), { ctx: COUNTER });
      expect(root().querySelector('input[data-qty="i1"]').disabled).toBe(false);
    });
  });
});

describe('Barcode Center', () => {
  const SCANNER = { permissions: ['audit.barcode_scan'] };
  const REGISTRAR = { permissions: ['audit.barcode_scan', 'audit.barcode_register'] };
  const ADMIN = { permissions: ['audit.barcode_scan', 'audit.barcode_register', 'audit.barcode_admin'] };
  const tabs = () => [...root().querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim());
  const open = (name) => [...root().querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === name).click();
  const listRow = (over) => ({
    id: 'b1',
    barcode: '5901234123457',
    product_id: 'p1',
    product_code: 'A1',
    product_name: 'Alpha one',
    barcode_type: 'ean13',
    status: 'verified',
    conflict_product_code: null,
    conflict_product_name: null,
    conflict_note: null,
    notes: null,
    registered_by_name: 'Reg One',
    verified_by_name: null,
    verified_at: null,
    created_at: '2026-11-19T10:00:00Z',
    updated_at: '2026-11-19T10:00:00Z',
    total: 1,
    ...over,
  });

  it('shows each person only the sections they can use', async () => {
    await mountCenter(root(), { ctx: SCANNER });
    expect(tabs()).toEqual(['Find', 'My scans']);
    document.body.innerHTML = '<div id="root"></div>';
    await mountCenter(root(), { ctx: REGISTRAR });
    expect(tabs()).toEqual(['Find', 'Register', 'To verify', 'Conflicts', 'All barcodes', 'My scans']);
    document.body.innerHTML = '<div id="root"></div>';
    await mountCenter(root(), { ctx: ADMIN });
    expect(tabs().at(-1)).toBe('Scan history');
  });

  it('says how many barcodes are on this phone and works from the saved copy with no signal', async () => {
    api.barcodeMirrorPage.mockRejectedValue(new TypeError('Failed to fetch'));
    await mountCenter(root(), { ctx: SCANNER });
    await until(() => text().includes('no connection'));
    expect(text()).toContain('6 barcodes saved on this phone');
    click('[data-act="scan"]');
    await scanner.opts.onCode({ code: '5901234123457' });
    await tick(20);
    expect(text()).toContain('Name A1');
    expect(text()).toContain('Verified');
  });

  it('a scanner who meets an unknown barcode is told to ask a deputy, not offered registration', async () => {
    await mountCenter(root(), { ctx: SCANNER });
    click('[data-act="scan"]');
    await scanner.opts.onCode({ code: '9999999999994' });
    await tick(20);
    expect(text()).toContain('This barcode is not registered.');
    expect(has('[data-act="register-this"]')).toBe(false);
    expect(text()).toContain('Ask a deputy');
  });

  it('keeps scans on the device while offline, shows them waiting, and sends them when asked', async () => {
    api.scanBatch.mockRejectedValue(new TypeError('Failed to fetch'));
    await mountCenter(root(), { ctx: SCANNER });
    click('[data-act="scan"]');
    await scanner.opts.onCode({ code: '5901234123457' });
    await until(() => text().includes('1 scan waiting to send'));
    expect(await barcodes.count('scan')).toBe(1);
    api.scanBatch.mockImplementation(async (e) => ({ saved: e.length, duplicates: 0, rejected: 0 }));
    click('[data-act="send"]');
    await until(() => !text().includes('waiting to send'));
    expect(await barcodes.count('scan')).toBe(0);
  });

  it('hands a scanned unknown barcode to Register, then registers it and reports a conflict honestly', async () => {
    api.barcodeProducts.mockResolvedValue([{ id: 'p9', code: 'A2', name: 'Alpha two', company: 'Acme', barcodes: 0 }]);
    api.registerBarcode.mockResolvedValue({ outcome: 'conflict', id: 'x', status: 'conflict' });
    await mountCenter(root(), { ctx: REGISTRAR });
    click('[data-act="scan"]');
    await scanner.opts.onCode({ code: ' 9999 999999994 ' });
    await tick(20);
    click('[data-act="register-this"]');
    await until(() => has('input[data-f="barcode"]'));
    expect(root().querySelector('input[data-f="barcode"]').value).toBe('9999999999994');
    expect(root().querySelector('select[data-f="type"]').value).toBe('ean13');
    typeField('input[data-f="pq"]', 'alp');
    await until(() => has('[data-act="pick"]'));
    click('[data-act="pick"]');
    click('[data-act="register"]');
    await until(() => api.registerBarcode.mock.calls.length === 1);
    expect(api.registerBarcode).toHaveBeenCalledWith({ barcode: '9999999999994', productId: 'p9', type: 'ean13', notes: null });
    await until(() => text().includes('Nothing was changed'));
    expect(text()).toContain('listed under Conflicts');
    expect(root().querySelector('input[data-f="barcode"]').value).toBe('');
  });

  it('will not register without a valid barcode and a product', async () => {
    await mountCenter(root(), { ctx: REGISTRAR });
    open('Register');
    await until(() => has('[data-act="register"]'));
    click('[data-act="register"]');
    expect(text()).toContain('Enter the barcode');
    typeField('input[data-f="barcode"]', 'ABCD1234');
    click('[data-act="register"]');
    expect(text()).toContain('Choose the product');
    expect(api.registerBarcode).not.toHaveBeenCalled();
  });

  it('states what each registration outcome means', async () => {
    const { OUTCOME } = await import('../../js/modules/audit/ui/barcodeAdmin.js');
    expect(OUTCOME.created('X1234', 'Alpha')).toMatch(/not verified yet/);
    expect(OUTCOME.exists()).toMatch(/Nothing changed/);
    expect(OUTCOME.disabled()).toMatch(/switched off/);
  });

  it('lists barcodes to verify and verifies one', async () => {
    api.listBarcodes.mockResolvedValue([listRow({ status: 'unverified' })]);
    await mountCenter(root(), { ctx: REGISTRAR });
    open('To verify');
    await until(() => has('[data-act="verify"][data-id="b1"]'));
    expect(api.listBarcodes).toHaveBeenCalledWith(expect.objectContaining({ status: 'unverified' }));
    api.listBarcodes.mockResolvedValue([]);
    click('[data-act="verify"][data-id="b1"]');
    await until(() => api.verifyBarcode.mock.calls.length === 1);
    expect(api.verifyBarcode).toHaveBeenCalledWith('b1');
    await until(() => text().includes('Nothing is waiting to be verified'));
  });

  describe('conflicts', () => {
    const conflict = () =>
      listRow({ status: 'conflict', conflict_product_code: 'A2', conflict_product_name: 'Alpha two', conflict_note: 'seen on the A2 box' });
    it('a registrar can read a conflict but not decide it', async () => {
      api.listBarcodes.mockResolvedValue([conflict()]);
      await mountCenter(root(), { ctx: REGISTRAR });
      open('Conflicts');
      await until(() => text().includes('Also claimed: Alpha two (A2)'));
      expect(text()).toContain('Kept: Alpha one (A1)');
      expect(text()).toContain('seen on the A2 box');
      expect(text()).toContain('Waiting for a decision');
      expect(has('[data-act="open-decide"]')).toBe(false);
    });
    it('an administrator must give a reason, and the choice is sent as made', async () => {
      api.listBarcodes.mockResolvedValue([conflict()]);
      await mountCenter(root(), { ctx: ADMIN });
      open('Conflicts');
      await until(() => has('[data-act="open-decide"]'));
      click('[data-act="open-decide"]');
      click('[data-d="reassign"]');
      expect(text()).toContain('Write a short reason');
      expect(api.resolveBarcodeConflict).not.toHaveBeenCalled();
      typeField('input[data-f="reason"]', 'The A2 box carries it');
      api.listBarcodes.mockResolvedValue([]);
      click('[data-d="reassign"]');
      await until(() => api.resolveBarcodeConflict.mock.calls.length === 1);
      expect(api.resolveBarcodeConflict).toHaveBeenCalledWith({ id: 'b1', decision: 'reassign', reason: 'The A2 box carries it' });
      await until(() => text().includes('No conflicts'));
    });
    it('shows the plain error when the database refuses', async () => {
      api.listBarcodes.mockResolvedValue([conflict()]);
      api.resolveBarcodeConflict.mockRejectedValueOnce(Object.assign(new Error('x'), { hint: 'conflict_resolved' }));
      await mountCenter(root(), { ctx: ADMIN });
      open('Conflicts');
      await until(() => has('[data-act="open-decide"]'));
      click('[data-act="open-decide"]');
      typeField('input[data-f="reason"]', 'because');
      click('[data-d="keep"]');
      await until(() => has('.note-error'));
      expect(root().querySelector('.note-error').textContent.length).toBeGreaterThan(10);
    });
  });

  describe('all barcodes', () => {
    it('searches and filters through the database', async () => {
      api.listBarcodes.mockResolvedValue([listRow()]);
      await mountCenter(root(), { ctx: REGISTRAR });
      open('All barcodes');
      await until(() => text().includes('Alpha one'));
      typeField('input[data-f="q"]', 'alp');
      await until(() => api.listBarcodes.mock.calls.some(([a]) => a.query === 'alp'));
      const sel = root().querySelector('select[data-f="status"]');
      sel.value = 'conflict';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => api.listBarcodes.mock.calls.some(([a]) => a.status === 'conflict'));
    });
    it('only an administrator sees change, switch off and history', async () => {
      api.listBarcodes.mockResolvedValue([listRow()]);
      await mountCenter(root(), { ctx: REGISTRAR });
      open('All barcodes');
      await until(() => text().includes('Alpha one'));
      expect(has('[data-act="open"]')).toBe(false);
    });
    it('switching off needs a reason; switching on a disabled one asks for it too', async () => {
      api.listBarcodes.mockResolvedValue([listRow()]);
      await mountCenter(root(), { ctx: ADMIN });
      open('All barcodes');
      await until(() => has('[data-k="disable"]'));
      click('[data-k="disable"]');
      click('[data-act="apply"]');
      expect(text()).toContain('Write a short reason');
      expect(api.disableBarcode).not.toHaveBeenCalled();
      typeField('input[data-f="reason"]', 'Printed wrong');
      click('[data-act="apply"]');
      await until(() => api.disableBarcode.mock.calls.length === 1);
      expect(api.disableBarcode).toHaveBeenCalledWith('b1', 'Printed wrong');
    });
    it('moving a barcode needs a product and a reason', async () => {
      api.listBarcodes.mockResolvedValue([listRow()]);
      api.barcodeProducts.mockResolvedValue([{ id: 'p2', code: 'A2', name: 'Alpha two', company: 'Acme', barcodes: 1 }]);
      await mountCenter(root(), { ctx: ADMIN });
      open('All barcodes');
      await until(() => has('[data-k="change"]'));
      click('[data-k="change"]');
      typeField('input[data-f="reason"]', 'Wrong label');
      click('[data-act="apply"]');
      expect(text()).toContain('Choose the product');
      typeField('input[data-f="pq"]', 'alp');
      await until(() => has('[data-act="pick"]'));
      click('[data-act="pick"]');
      click('[data-act="apply"]');
      await until(() => api.changeBarcode.mock.calls.length === 1);
      expect(api.changeBarcode).toHaveBeenCalledWith({ id: 'b1', productId: 'p2', reason: 'Wrong label' });
    });
    it("shows one barcode's history to an administrator", async () => {
      api.listBarcodes.mockResolvedValue([listRow()]);
      api.barcodeHistory.mockResolvedValue([
        {
          id: 'h1',
          action: 'conflict_kept',
          from_status: 'conflict',
          to_status: 'verified',
          reason: 'Looks right',
          actor_name: 'Adm One',
          created_at: '2026-11-19T10:00:00Z',
        },
      ]);
      await mountCenter(root(), { ctx: ADMIN });
      open('All barcodes');
      await until(() => has('[data-k="history"]'));
      click('[data-k="history"]');
      await until(() => text().includes('conflict kept'));
      expect(text()).toContain('Looks right');
    });
  });

  it("shows an administrator everyone's scans, and a scanner only theirs, in a table with a caption", async () => {
    api.scanHistory.mockResolvedValue([
      {
        id: 's1',
        scan_type: 'count',
        barcode: '5901234123457',
        product_code: 'A1',
        result: 'matched',
        assignment_id: null,
        user_name: 'Scan One',
        scanned_at: '2026-11-19T10:00:00Z',
        total: 1,
      },
    ]);
    await mountCenter(root(), { ctx: ADMIN });
    open('Scan history');
    await until(() => text().includes('Scan One'));
    expect(root().querySelector('caption')).toBeTruthy();
    expect(root().querySelectorAll('th[scope="col"]').length).toBe(5);
    document.body.innerHTML = '<div id="root"></div>';
    await mountCenter(root(), { ctx: SCANNER });
    open('My scans');
    await until(() => has('table'));
    expect(root().querySelectorAll('th[scope="col"]').length).toBe(4);
  });
});

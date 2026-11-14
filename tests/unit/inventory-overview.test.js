// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STOCK_COLS = ['code', 'name', 'qty', 'price', 'company', 'generic', 'supplier', 'pack', 'created', 'received', 'sold'];
const SALES_COLS = ['code', 'n0', 'n30', 'n60', 'n90', 'vi0', 'vi30', 'vi60', 'vi90', 've0', 've30', 've60', 've90', 'tax', 'taxable'];

const server = vi.hoisted(() => ({ products: [], calls: [], mode: 'ok' }));

vi.mock('../../js/modules/inventory/data/feed.js', () => {
  const page = (cols, rows) => ({
    reset: false,
    cols,
    rows,
    removed: [],
    next: rows.length,
    done: true,
    seq: rows.length,
    activeCount: server.products.length,
  });
  return {
    PAGE: 1000,
    latestSync: async () => {
      server.calls.push('latest');
      if (server.mode === 'down') throw new TypeError('Failed to fetch');
      if (server.mode === 'denied') throw Object.assign(new Error('not allowed'), { code: '42501' });
      if (server.mode === 'empty') return null;
      const n = server.products.length;
      return {
        synced_at: '2026-11-12T12:00:00Z',
        item_count: n,
        source: 'dropbox',
        seq_stock: n,
        seq_sales: n,
        active_count: n,
        schema_version: 1,
      };
    },
    changesStock: async () => {
      server.calls.push('stock');
      return page(
        STOCK_COLS,
        server.products.map((p) => STOCK_COLS.map((c) => p[c])),
      );
    },
    changesSales: async () => {
      server.calls.push('sales');
      return page(
        SALES_COLS,
        server.products.map((p) => SALES_COLS.map((c) => (c === 'code' ? p.code : (p[c] ?? 0)))),
      );
    },
  };
});

const product = (code, name, over = {}) => ({
  code,
  name,
  qty: 10,
  price: 25,
  company: 'Acme',
  generic: '',
  supplier: 'Sup One',
  pack: 10,
  created: '2025-01-01',
  received: '2026-10-01',
  sold: '2026-11-01',
  n30: 4,
  n90: 12,
  ...over,
});

const OWNER = { user_id: 'u-owner', permissions: ['inventory.search', 'inventory.view'] };
const STAFF = { user_id: 'u-staff', permissions: ['inventory.search'] };

async function open(ctx) {
  const { mount } = await import('../../js/modules/inventory/ui/overview.js');
  const el = document.createElement('div');
  document.body.append(el);
  await mount(el, { ctx, route: {}, modules: [] });
  return el;
}
const type = (el, text) => {
  const input = el.querySelector('#inv-q');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const names = (el) => [...el.querySelectorAll('.inv-row strong')].map((n) => n.textContent);

beforeEach(() => {
  vi.resetModules(); // a fresh local copy for every test
  document.body.innerHTML = '';
  server.calls = [];
  server.mode = 'ok';
  server.products = [
    product('P1', 'Panadol Tablet'),
    product('P2', 'Brufen Syrup <script>alert(1)</script>'),
    product('P3', 'Zinc Drops', { qty: 0 }),
    product('P4', 'Pana Cream', { qty: 7, pack: 10 }),
  ];
});

describe('overview', () => {
  it('loads the product list on first open and says how many products and when', async () => {
    const el = await open(OWNER);
    expect(el.querySelector('#inv-status').textContent).toContain('4 products');
    expect(el.querySelector('#inv-status').textContent).toContain('as of 05:00 pm'); // 12:00 UTC is 17:00 in Karachi
    expect(el.querySelector('.inv-hint').textContent).toContain('Type a name');
  });

  it('typing searches the phone’s copy: best match first, and no network call per keystroke', async () => {
    const el = await open(OWNER);
    server.calls.length = 0;
    type(el, 'pana');
    expect(names(el)).toEqual(['Panadol Tablet', 'Pana Cream']); // “starts with” both; stable order
    type(el, 'zinc');
    expect(names(el)).toEqual(['Zinc Drops']);
    type(el, 'nothing like this');
    expect(el.querySelector('#inv-results').textContent).toContain('Nothing matches');
    expect(server.calls).toEqual([]);
  });

  it('shows stock, price and whole packs with loose units', async () => {
    const el = await open(OWNER);
    type(el, 'pana cream');
    const row = el.querySelector('.inv-row').textContent;
    expect(row).toContain('7'); // in stock
    expect(row).toContain('0 packs + 7'); // 7 units of a pack of 10
    type(el, 'panadol');
    expect(el.querySelector('.inv-row').textContent).toContain('1 pack (pack of 10)');
  });

  it('a person with inventory.view sees sales figures and stock value; one without never does, and never downloads them', async () => {
    const owner = await open(OWNER);
    expect(owner.querySelector('#inv-status').textContent).toContain('stock worth');
    type(owner, 'zinc');
    expect(owner.querySelector('.inv-row').textContent).toContain('Sold: 4 in 30 days · 12 in 90 days');
    expect(server.calls).toContain('sales');

    vi.resetModules();
    document.body.innerHTML = '';
    server.calls = [];
    const staff = await open(STAFF);
    expect(staff.querySelector('#inv-status').textContent).not.toContain('stock worth');
    type(staff, 'zinc');
    expect(staff.querySelector('.inv-row').textContent).not.toContain('Sold');
    expect(server.calls).not.toContain('sales');
  });

  it('product names are shown as text, never as markup', async () => {
    const el = await open(OWNER);
    type(el, 'brufen');
    expect(el.querySelector('.inv-row strong').textContent).toBe('Brufen Syrup <script>alert(1)</script>');
    expect(el.querySelector('#inv-results script')).toBeNull();
  });

  it('shows 100 at a time and adds 100 on "Show more"', async () => {
    server.products = Array.from({ length: 250 }, (_, i) => product(`C${String(i).padStart(3, '0')}`, `Cough ${i}`));
    const el = await open(OWNER);
    type(el, 'cough');
    expect(el.querySelectorAll('.inv-row')).toHaveLength(100);
    expect(el.querySelector('.inv-hint').textContent).toContain('250 found');
    el.querySelector('[data-act="more"]').click();
    expect(el.querySelectorAll('.inv-row')).toHaveLength(200);
  });

  it('Refresh with the connection down keeps the copy and says so', async () => {
    const el = await open(OWNER);
    server.mode = 'down';
    el.querySelector('[data-act="refresh"]').click();
    await vi.waitFor(() => expect(el.querySelector('#inv-status').textContent).toContain('Offline'));
    type(el, 'zinc');
    expect(names(el)).toEqual(['Zinc Drops']); // still searchable
  });

  it('when access is withdrawn the copy is removed and the person is told', async () => {
    const el = await open(OWNER);
    server.mode = 'denied';
    el.querySelector('[data-act="refresh"]').click();
    await vi.waitFor(() => expect(el.querySelector('#inv-status').textContent).toContain('no longer have access'));
    expect(el.querySelector('#inv-status').textContent).toContain('No products yet');
  });

  it('says so when nothing has ever been synced', async () => {
    server.mode = 'empty';
    const el = await open(OWNER);
    expect(el.textContent).toContain('No stock data has been synced yet');
  });

  it('a second visit makes one small call, no data call', async () => {
    await open(OWNER);
    document.body.innerHTML = '';
    server.calls = [];
    await open(OWNER);
    expect(server.calls).toEqual(['latest']);
  });

  it('another person opening on the same phone never sees the first person’s copy', async () => {
    await open(OWNER);
    document.body.innerHTML = '';
    server.mode = 'down'; // offline, so nothing can be re-downloaded for the new person
    const el = await open(STAFF);
    expect(el.querySelector('#inv-status').textContent).toContain('No products yet');
  });
});

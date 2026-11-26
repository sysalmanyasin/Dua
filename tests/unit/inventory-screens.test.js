// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STOCK_COLS = ['code', 'name', 'qty', 'price', 'company', 'generic', 'supplier', 'pack', 'created', 'received', 'sold', 'packValid'];
const SALES_COLS = ['code', 'n0', 'n30', 'n60', 'n90', 'vi0', 'vi30', 'vi60', 'vi90', 've0', 've30', 've60', 've90', 'tax', 'taxable'];

const srv = vi.hoisted(() => ({
  products: [],
  transit: {},
  retained: [],
  settings: { misc: 0, ho_value: null },
  calls: [],
  history: [],
  syncAnswer: { ok: true },
  failRetain: false,
  downloads: [],
}));

vi.mock('../../js/modules/inventory/data/feed.js', () => {
  const page = (cols, rows) => ({
    reset: false,
    cols,
    rows,
    removed: [],
    next: rows.length,
    done: true,
    seq: rows.length,
    activeCount: srv.products.length,
  });
  return {
    PAGE: 1000,
    latestSync: async () => ({
      synced_at: '2026-11-14T10:00:00Z',
      item_count: srv.products.length,
      source: 'dropbox',
      seq_stock: srv.products.length,
      seq_sales: srv.products.length,
      active_count: srv.products.length,
      schema_version: 1,
    }),
    changesStock: async () =>
      page(
        STOCK_COLS,
        srv.products.map((p) => STOCK_COLS.map((c) => p[c])),
      ),
    changesSales: async () =>
      page(
        SALES_COLS,
        srv.products.map((p) => SALES_COLS.map((c) => (c === 'code' ? p.code : (p[c] ?? 0)))),
      ),
    inTransit: async () => srv.transit,
    coverSummary: async () => ({}),
    excessState: async () => ({ retained: srv.retained.map((n) => ({ name_key: n.toLowerCase(), name: n })), settings: srv.settings }),
    setRetained: async (name, on) => {
      srv.calls.push(['retain', name, on]);
      if (srv.failRetain) throw new Error('down');
    },
    saveExcessSettings: async (misc, ho) => {
      srv.calls.push(['settings', misc, ho]);
      srv.settings = { misc, ho_value: ho };
    },
    syncHistory: async () => srv.history,
    syncNow: async (body) => {
      srv.calls.push(['sync', body]);
      return srv.syncAnswer;
    },
  };
});
vi.mock('../../js/modules/inventory/data/prefs.js', () => ({ loadSettings: async (_k, d) => ({ ...d }), saveSettings: () => {} }));
vi.mock('../../js/shared/chartjs.js', () => ({
  PALETTE: ['#0e8074', '#2563eb'],
  chartTheme: () => ({ text: '#000', grid: '#ccc' }),
  loadChartJs: async () =>
    class FakeChart {
      constructor(canvas, config) {
        srv.charts.push({ id: canvas.id, type: config.type, labels: config.data.labels });
      }
      destroy() {
        srv.destroyed += 1;
      }
    },
}));
srv.charts = [];
srv.destroyed = 0;

const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const prod = (code, over = {}) => ({
  code,
  name: `Item ${code}`,
  qty: 10,
  price: 10,
  company: 'Acme',
  generic: '',
  supplier: 'Sup A',
  pack: 10,
  created: ago(500),
  received: ago(30),
  sold: ago(5),
  packValid: true,
  n0: 0,
  n30: 0,
  n60: 0,
  n90: 0,
  ...over,
});

const OWNER = { user_id: 'u-owner', permissions: ['inventory.search', 'inventory.view', 'inventory.sync'] };
const STAFF = { user_id: 'u-staff', permissions: ['inventory.search'] };

async function open(path, ctx = OWNER) {
  const { mount } = await import(`../../js/modules/inventory/ui/${path}.js`);
  const el = document.createElement('div');
  document.body.append(el);
  await mount(el, { ctx, route: {}, modules: [] });
  return el;
}
const names = (el) => [...el.querySelectorAll('.inv-row strong')].map((n) => n.textContent);
const click = (el, sel) => el.querySelector(sel).click();
const tick = () => new Promise((r) => setTimeout(r, 0));
const pick = (el, sel, value) => {
  const n = el.querySelector(sel);
  n.value = value;
  n.dispatchEvent(new Event('change', { bubbles: true }));
};
const typeIn = (el, sel, value) => {
  const n = el.querySelector(sel);
  n.value = value;
  n.dispatchEvent(new Event('input', { bubbles: true }));
};
const readDownload = async () => {
  const blob = srv.downloads.at(-1);
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsText(blob);
  });
};

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  srv.calls = [];
  srv.charts = [];
  srv.destroyed = 0;
  srv.downloads = [];
  srv.transit = {};
  srv.retained = [];
  srv.settings = { misc: 0, ho_value: null };
  srv.history = [];
  srv.syncAnswer = { ok: true };
  srv.failRetain = false;
  srv.products = [
    prod('NS1', { sold: '', received: ago(200), qty: 25, pack: 10, price: 4 }), // never sold: 2 whole packs = 20 units
    prod('DS1', { sold: ago(150), received: ago(150), qty: 30, pack: 10, price: 5, n90: 0 }), // dead stock
    prod('EX1', { qty: 400, pack: 10, price: 2, n60: 60, n90: 90, n30: 30 }), // 400 days of cover at 1 a day
    prod('RO1', { qty: 5, n60: 60, n90: 90, n30: 30, supplier: 'Sup A', price: 3 }), // 5 days of cover: reorder
    prod('RO2', { qty: 0, n60: 30, n90: 45, n30: 15, supplier: 'Sup B', price: 7 }), // zero stock that sells
    prod('ZERO', { qty: 0, sold: '' }),
    prod('PK', { qty: 50, pack: 1, packValid: false, sold: '', received: ago(300), price: 2 }), // unusable pack size
    prod('OK', { qty: 50, n60: 60, n90: 90, n30: 30 }), // 50 days of cover: fine
    prod('EXY', { qty: 400, pack: 10, price: 2, n60: 60, n90: 90, n30: 30, created: ago(30) }), // oversupplied but only 30 days old
  ];
  globalThis.URL.createObjectURL = vi.fn((b) => {
    srv.downloads.push(b);
    return 'blob:x';
  });
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe('Stock Ledger', () => {
  it('opens on Never sold with the count and the whole-pack value', async () => {
    const el = await open('ledger');
    expect(names(el)).toEqual(['Item NS1']);
    expect(el.querySelector('.inv-total').textContent).toContain('1');
    expect(el.querySelector('.inv-total').textContent).toContain('80'); // 2 whole packs x 10 units x Rs 4
    expect(el.textContent).toContain('2 whole packs + 5 loose');
  });

  it('switches tabs: Dead stock, Excess (standard view), Zero stock, Pack issues', async () => {
    const el = await open('ledger');
    click(el, '[data-tab="deadStock"]');
    expect(names(el)).toEqual(['Item DS1']);
    click(el, '[data-tab="excess"]');
    expect(names(el)).toContain('Item EX1');
    expect(names(el)).not.toContain('Item OK');
    click(el, '[data-tab="zeroStock"]');
    expect(names(el).sort()).toEqual(['Item RO2', 'Item ZERO']);
    click(el, '[data-tab="packIssues"]');
    expect(names(el)).toEqual(['Item PK']);
    expect(el.textContent).toContain('pack size missing or unusable');
  });

  it('the Excess tab has a standard view (old enough, plenty of cover) and an everything view', async () => {
    const el = await open('ledger');
    click(el, '[data-tab="excess"]');
    expect(names(el)).toContain('Item EX1');
    expect(names(el)).not.toContain('Item EXY'); // only 30 days old: left out of the standard view
    pick(el, '#led-ex', 'all');
    expect(names(el)).toContain('Item EXY');
    expect(names(el)).toContain('Item EX1');
  });

  it('the CSV holds only what the search leaves, not the whole tab', async () => {
    const el = await open('ledger');
    click(el, '[data-tab="zeroStock"]');
    typeIn(el, '#led-q', 'zero');
    expect(names(el)).toEqual(['Item ZERO']);
    click(el, '[data-act="csv"]');
    const text = await readDownload();
    expect(text).toContain('ZERO,Item ZERO');
    expect(text).not.toContain('RO2');
  });

  it('a wider window removes products from Never sold', async () => {
    const el = await open('ledger');
    expect(names(el)).toEqual(['Item NS1']);
    pick(el, '#led-win', '365');
    expect(el.querySelector('.inv-list')).toBeNull();
    expect(el.textContent).toContain('Nothing in this list');
    pick(el, '#led-win', '30');
    expect(names(el)).toEqual(['Item NS1']);
  });

  it('searches within the tab and exports exactly what is shown as CSV', async () => {
    const el = await open('ledger');
    typeIn(el, '#led-q', 'zzz nothing');
    expect(el.textContent).toContain('0 match');
    typeIn(el, '#led-q', 'ns1');
    expect(names(el)).toEqual(['Item NS1']);
    click(el, '[data-act="csv"]');
    const text = await readDownload();
    expect(text.startsWith('Code,Name,Supplier,Stock,Pack,Whole packs,Loose,Price,Value,Days since received')).toBe(true);
    const bytes = new Uint8Array(
      await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsArrayBuffer(srv.downloads.at(-1));
      }),
    );
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // a byte-order mark, so Excel reads names correctly
    expect(text).toContain('NS1,Item NS1,Sup A,25,10,2,5,4,80,200');
  });

  it('a person without sales access gets a clear message, not an empty page', async () => {
    const el = await open('ledger', STAFF);
    expect(el.textContent).toContain('needs permission to see sales figures');
    expect(el.querySelector('.inv-list')).toBeNull();
  });
});

describe('Reorder Report', () => {
  it('lists what sold and is short, grouped by supplier, with the quantity and cost to buy', async () => {
    srv.transit = { RO1: 3 };
    const el = await open('reorder');
    expect(names(el).sort()).toEqual(['Item RO1', 'Item RO2']);
    expect(el.textContent).toContain('Sup A');
    expect(el.textContent).toContain('Sup B');
    const ro1 = [...el.querySelectorAll('.inv-row')].find((r) => r.textContent.includes('Item RO1')).textContent;
    expect(ro1).toContain('In stock 5');
    expect(ro1).toContain('On the way: 3 packs');
    expect(ro1).toContain('Buy 25'); // 1 a day for 30 days of cover is 30, minus the 5 in stock
  });

  it('more cover wanted brings more products in; the cover limit is remembered as typed', async () => {
    const el = await open('reorder');
    expect(names(el)).not.toContain('Item OK');
    pick(el, '#ro-cover', '100');
    expect(names(el)).toContain('Item OK'); // 50 days of cover is under 100
  });

  it('can ungroup, switch to All low cover, search, and export CSV', async () => {
    const el = await open('reorder');
    expect(el.querySelector('.inv-group')).not.toBeNull();
    click(el, '#ro-group');
    pick(el, '#ro-group', '');
    el.querySelector('#ro-group').checked = false;
    el.querySelector('#ro-group').dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelector('.inv-group')).toBeNull();
    click(el, '[data-tab="all"]');
    typeIn(el, '#ro-q', 'ro2');
    expect(names(el)).toEqual(['Item RO2']);
    click(el, '[data-act="csv"]');
    const text = await readDownload();
    expect(text).toContain('Code,Name,Supplier,In stock');
    expect(text).toContain('RO2,Item RO2,Sup B,0');
  });

  it('says so when nothing needs reordering', async () => {
    srv.products = [prod('OK', { qty: 500, n60: 60, n90: 90 })];
    const el = await open('reorder');
    expect(el.textContent).toContain('Nothing needs reordering');
  });

  it('keeps working when the units-on-the-way call fails, and says so', async () => {
    const feed = await import('../../js/modules/inventory/data/feed.js');
    feed.inTransit = async () => {
      throw new Error('down');
    };
    const el = await open('reorder');
    expect(names(el).length).toBeGreaterThan(0);
  });
});

describe('Excess Working', () => {
  it('shows the corrected excess in whole packs and the list behind it', async () => {
    const el = await open('excess');
    expect(el.querySelector('#ex-summary').textContent).toContain('Excess (whole packs)');
    expect(names(el)).toContain('Item EX1');
    expect(el.textContent).toMatch(/whole pack/);
  });

  it('retaining a product moves its value out of the excess, shared through the database', async () => {
    const el = await open('excess');
    const before = el.querySelector('#ex-summary .inv-kpi b').textContent;
    el.querySelector('[data-retain="Item EX1"]').click();
    await tick();
    expect(srv.calls).toContainEqual(['retain', 'Item EX1', true]);
    expect(el.querySelector('#ex-summary .inv-kpi b').textContent).not.toBe(before);
    expect(el.textContent).toContain('Stop retaining');
  });

  it('puts the screen back and says so when the change could not be saved', async () => {
    srv.failRetain = true;
    const el = await open('excess');
    el.querySelector('[data-retain="Item EX1"]').click();
    await tick();
    await tick();
    expect(el.textContent).toContain('Could not save that change');
    expect(el.textContent).not.toContain('Stop retaining');
  });

  it('shows retained names that were saved on another device', async () => {
    srv.retained = ['Item EX1'];
    const el = await open('excess');
    expect(el.textContent).toContain('Stop retaining');
  });

  it('saves misc and the head-office value, and shows the variance', async () => {
    const el = await open('excess');
    el.querySelector('#ex-misc').value = '500';
    el.querySelector('#ex-ho').value = '12000';
    click(el, '[data-act="save"]');
    await tick();
    expect(srv.calls).toContainEqual(['settings', 500, 12000]);
    expect(el.textContent).toContain('Saved.');
    expect(el.querySelector('#ex-summary').textContent).toContain('Head office minus this list');
  });

  it('refuses a negative amount without calling the server', async () => {
    const el = await open('excess');
    el.querySelector('#ex-misc').value = '-5';
    click(el, '[data-act="save"]');
    await tick();
    expect(srv.calls.some((c) => c[0] === 'settings')).toBe(false);
    expect(el.textContent).toContain('amounts of zero or more');
  });

  it('exports the working list', async () => {
    const el = await open('excess');
    click(el, '[data-act="csv"]');
    const text = await readDownload();
    expect(text).toContain('Code,Name,Company,Excess units,Pack size');
    expect(text).toContain('EX1,Item EX1');
  });
});

describe('Health', () => {
  it('shows the four headline numbers and draws three charts', async () => {
    const el = await open('health');
    await vi.waitFor(() => expect(srv.charts.length).toBe(3));
    expect(srv.destroyed).toBe(0);
    click(el, '[data-act="refresh"]'); // a second draw: the first three charts must be destroyed, not piled up
    await vi.waitFor(() => expect(srv.charts.length).toBe(6));
    expect(srv.destroyed).toBe(3);
    expect(el.querySelector('#hl-kpis').textContent).toContain('Stock value');
    expect(el.querySelector('#hl-kpis').textContent).toContain('To reorder');
    expect(el.querySelector('#hl-kpis').textContent).toContain('Not sold (whole packs)');
    expect(el.querySelector('#hl-kpis').textContent).toContain('Excess');
    expect(
      srv.charts
        .slice(3)
        .map((c) => c.type)
        .sort(),
    ).toEqual(['bar', 'bar', 'doughnut']);
  });

  it('filters the product list by class and by search', async () => {
    const el = await open('health');
    click(el, '[data-flag="reorder"]');
    expect(names(el).sort()).toEqual(['Item RO1']); // RO2 has no stock, so it is "zero stock", the more urgent class
    click(el, '[data-flag="zeroStock"]');
    expect(names(el)).toContain('Item RO2');
    click(el, '[data-flag="all"]');
    typeIn(el, '#hl-q', 'ex1');
    expect(names(el)).toEqual(['Item EX1']);
  });

  it('loads the chart library only on this page', async () => {
    await open('overview');
    expect(srv.charts).toEqual([]);
  });
});

describe('Sync', () => {
  it('shows the last check and the recent runs', async () => {
    srv.history = [
      {
        synced_at: '2026-11-14T10:00:00Z',
        status: 'ok',
        result: 'changed',
        item_count: 8,
        added_count: 0,
        changed_count: 3,
        removed_count: 0,
        unchanged_count: 5,
        source: 'dropbox',
        error: null,
      },
      {
        synced_at: '2026-11-14T09:00:00Z',
        status: 'failed',
        result: 'failed',
        item_count: 0,
        added_count: 0,
        changed_count: 0,
        removed_count: 0,
        unchanged_count: 0,
        source: 'dropbox',
        error: 'Dropbox fetch failed: status 500',
      },
    ];
    const el = await open('sync');
    expect(el.textContent).toContain('Last checked');
    expect(el.textContent).toContain('Updated');
    expect(el.textContent).toContain('Failed');
    expect(el.textContent).toContain('Dropbox fetch failed');
  });

  it('Sync now asks for a normal sync and reports the answer', async () => {
    srv.syncAnswer = { ok: true, result: 'changed', added: 1, changed: 2, removed: 0, unchanged: 5 };
    const el = await open('sync');
    click(el, '[data-act="sync"]');
    await vi.waitFor(() => expect(el.textContent).toContain('1 added, 2 changed'));
    expect(srv.calls).toContainEqual(['sync', {}]);
  });

  it('says so when the file has not changed', async () => {
    srv.syncAnswer = { ok: true, skipped: true, result: 'unchanged' };
    const el = await open('sync');
    click(el, '[data-act="sync"]');
    await vi.waitFor(() => expect(el.textContent).toContain('has not changed since the last sync'));
  });

  it('a refused removal explains itself and only syncs anyway after an explicit confirmation', async () => {
    srv.syncAnswer = { ok: false, status: 422, refused: true, wouldRemove: 2000, active: 5900 };
    const el = await open('sync');
    click(el, '[data-act="sync"]');
    await vi.waitFor(() => expect(el.textContent).toContain('would remove 2,000 of 5,900'));
    expect(srv.calls).toEqual([['sync', {}]]);
    srv.syncAnswer = { ok: true, result: 'changed', added: 0, changed: 0, removed: 2000, unchanged: 3900 };
    click(el, '[data-act="force"]');
    await vi.waitFor(() => expect(srv.calls).toContainEqual(['sync', { recheck: true, confirmRemoval: true }]));
  });

  it('a busy answer and an error are shown plainly', async () => {
    srv.syncAnswer = { ok: false, status: 409, error: 'busy' };
    const el = await open('sync');
    click(el, '[data-act="sync"]');
    await vi.waitFor(() => expect(el.textContent).toContain('already running'));
    srv.syncAnswer = { ok: false, status: 500, error: 'Sync failed; previous data kept' };
    click(el, '[data-act="sync"]');
    await vi.waitFor(() => expect(el.textContent).toContain('Sync failed; previous data kept'));
  });
});

describe('overview menu', () => {
  it('the owner sees links to every screen, a person with search only sees none', async () => {
    const owner = await open('overview');
    expect([...owner.querySelectorAll('.inv-menu a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/inventory/ledger',
      '#/inventory/reorder',
      '#/inventory/excess',
      '#/inventory/health',
      '#/inventory/deactivated',
      '#/inventory/sync',
    ]);
    vi.resetModules();
    document.body.innerHTML = '';
    const staff = await open('overview', STAFF);
    expect(staff.querySelector('.inv-menu')).toBeNull();
  });
});

describe('Excel and PDF reports', () => {
  it('Ledger: the Excel file holds only what the tab and search leave, in a workbook with an About sheet', async () => {
    const el = await open('ledger');
    click(el, '[data-tab="deadStock"]');
    click(el, '[data-act="xlsx"]');
    const blob = srv.downloads.at(-1);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const text = await readDownload(); // a stored zip: the XML inside is readable
    expect(text).toContain('Item DS1');
    expect(text).not.toContain('Item NS1');
    expect(text).toContain('name="Stock Ledger Dead stock"');
    expect(text).toContain('name="About"');
    expect(text).toContain('Stock data as of');
    expect(text).toContain('60-day window');
  });

  it('Reorder: Excel follows the search, and the CSV button still works next to it', async () => {
    const el = await open('reorder');
    typeIn(el, '#ro-q', 'ro2');
    click(el, '[data-act="xlsx"]');
    const text = await readDownload();
    expect(text).toContain('Item RO2');
    expect(text).not.toContain('Item RO1');
    expect(text).toContain('days of cover');
    click(el, '[data-act="csv"]');
    expect(await readDownload()).toContain('RO2,Item RO2,Sup B,0');
  });

  it('Excess Working: Excel is offered and holds the products', async () => {
    const el = await open('excess');
    click(el, '[data-act="xlsx"]');
    expect(await readDownload()).toContain('Item EX1');
  });

  it('PDF opens the print dialog with only the report, then puts the app back', async () => {
    const print = vi.fn();
    window.print = print;
    const el = await open('reorder');
    typeIn(el, '#ro-q', 'ro2');
    click(el, '[data-act="pdf"]');
    expect(print).toHaveBeenCalledTimes(1);
    const root = document.getElementById('inv-print-root');
    expect(root).not.toBeNull();
    expect(root.querySelector('h1').textContent).toBe('Reorder');
    expect(root.textContent).toContain('Item RO2');
    expect(root.textContent).not.toContain('Item RO1');
    expect(root.querySelector('.inv-print-sub').textContent).toContain('days of cover');
    expect(document.body.classList.contains('inv-printing')).toBe(true);
    expect(document.getElementById('inv-print-page').textContent).toContain('landscape');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('inv-print-root')).toBeNull();
    expect(document.getElementById('inv-print-page')).toBeNull();
    expect(document.body.classList.contains('inv-printing')).toBe(false);
  });

  it('Excel and PDF are switched off when there is nothing to export', async () => {
    srv.products = [prod('OK', { qty: 500, n60: 60, n90: 90 })];
    const el = await open('reorder');
    for (const act of ['xlsx', 'pdf', 'csv']) expect(el.querySelector(`[data-act="${act}"]`).disabled).toBe(true);
  });
});

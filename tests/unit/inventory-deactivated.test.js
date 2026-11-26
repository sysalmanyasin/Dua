// @vitest-environment jsdom
// Inventory > Deactivated: the products the stock file no longer lists, with a search box.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/inventory/data/feed.js', () => ({ deactivatedProducts: vi.fn() }));
const feed = await import('../../js/modules/inventory/data/feed.js');
const { mount } = await import('../../js/modules/inventory/ui/deactivated.js');

const rows = () => [
  {
    code: '003941270141',
    name: 'Oxicut Tab 60s',
    company: 'Herbiotics Health Care',
    qty: 3,
    price: 2090,
    deactivated_at: '2026-11-21T08:00:15Z',
    last_sale_date: null,
    last_receive_date: '2026-08-19',
  },
  {
    code: 'Z9',
    name: 'Zeta',
    company: 'Other',
    qty: 0,
    price: 10,
    deactivated_at: '2026-11-01T00:00:00Z',
    last_sale_date: '2026-10-01',
    last_receive_date: null,
  },
];
const root = () => document.getElementById('root');

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  feed.deactivatedProducts.mockResolvedValue(rows());
});

describe('deactivated products screen', () => {
  it('lists them with the last known quantity and dates, and searches by name, code or company', async () => {
    await mount(root());
    expect(root().querySelectorAll('.inv-row')).toHaveLength(2);
    const ox = root().querySelector('[data-code="003941270141"]').textContent;
    expect(ox).toContain('Oxicut Tab 60s');
    expect(ox).toContain('Deactivated 2026-11-21');
    expect(ox).toContain('last sale —');
    const box = root().querySelector('input[data-f="text"]');
    box.value = 'herbiotics';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root().querySelectorAll('.inv-row')).toHaveLength(1);
    box.value = 'nothing like this';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root().textContent).toContain('Nothing matches');
  });

  it('says so when nothing is deactivated, and shows an error card when the call fails', async () => {
    feed.deactivatedProducts.mockResolvedValue([]);
    await mount(root());
    expect(root().textContent).toContain('No product has been deactivated');
    feed.deactivatedProducts.mockRejectedValue(new Error('x'));
    await mount(root());
    expect(root().textContent).toContain('Could not load the deactivated products');
  });
});

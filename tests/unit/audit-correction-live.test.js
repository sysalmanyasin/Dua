// @vitest-environment jsdom
// Correction form: the live system quantity is shown for reading only, and is read fresh when the form opens.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  compiledRows: vi.fn(),
  liveBalances: vi.fn(),
  proposeCorrection: vi.fn(async () => 'c1'),
  decideCorrection: vi.fn(async () => ({})),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount } = await import('../../js/modules/audit/ui/compile.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');

const overview = (corrections = []) => ({
  round: {
    id: 'r1',
    engagement_id: 'e1',
    round_number: 1,
    round_suffix: null,
    unit: 'item',
    state: 'compiled',
    version: 3,
    items: 1,
    created_at: '2026-11-20T00:00:00Z',
  },
  assignments: [],
  compilation: {
    id: 'c1',
    revision: 1,
    compiled_at: '2026-11-21T00:00:00Z',
    with_missing: false,
    missing_assignment_ids: [],
    item_count: 1,
    variance_count: 1,
    variance_value: -40,
    auditor_notes: [],
  },
  history: [{ revision: 1, compiled_at: '2026-11-21T00:00:00Z', with_missing: false, variance_count: 1, variance_value: -40 }],
  corrections,
  conflicts: [],
});
const rows = () => ({
  rows: [
    {
      round_item_id: 'i1',
      code: 'A1',
      name: 'Alpha',
      company: 'Acme',
      system_qty: 10,
      counted_qty: 6,
      variance: -4,
      variance_value: -40,
      missing: false,
      auto_matched: false,
      auditor_id: 'u1',
      note: '',
      corrected_by: null,
    },
  ],
  total: 1,
});
const root = () => document.getElementById('root');
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timed out waiting');
};

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  setView({ round: 'r1' });
  api.compileOverview.mockResolvedValue(overview());
  api.compiledRows.mockResolvedValue(rows());
  api.liveBalances.mockResolvedValue([{ code: 'A1', qty: 7, active: true, found: true }]);
});

describe('correction form', () => {
  it('shows today’s quantity as a read-only box, and says when stock moved since the count', async () => {
    await mount(root(), { ctx: { permissions: ['audit.view', 'audit.suggest'] } });
    root().querySelector('button[data-form="suggest"]').click();
    await until(() => root().querySelector('[data-live="A1"]'));
    const box = root().querySelector('input[data-live-qty="A1"]');
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe('7');
    expect(root().querySelector('[data-live="A1"]').textContent).toContain('changed since the count (was 10)');
    expect(api.liveBalances).toHaveBeenCalledWith('r1', ['A1']);
  });

  it('still opens when the live quantity cannot be read', async () => {
    api.liveBalances.mockRejectedValue(new Error('offline'));
    await mount(root(), { ctx: { permissions: ['audit.view', 'audit.suggest'] } });
    root().querySelector('button[data-form="suggest"]').click();
    await until(() => root().textContent.includes('Live quantity is not available'));
    expect(root().querySelector('input[data-field="qty"]')).not.toBeNull();
  });

  it('also shows it beside a correction that is waiting for a decision', async () => {
    api.compileOverview.mockResolvedValue(
      overview([
        {
          id: 'k1',
          status: 'proposed',
          code: 'A1',
          name: 'Alpha',
          system_qty: 10,
          counted_qty: 5,
          proposed_by: 'Sam',
          reason: 'recounted',
          round_item_id: 'i1',
        },
      ]),
    );
    await mount(root(), { ctx: { permissions: ['audit.review'] } });
    await until(() => root().querySelector('[data-live="A1"]'));
    expect(root().querySelector('[data-live="A1"]').textContent).toContain('Live system quantity now 7');
  });
});

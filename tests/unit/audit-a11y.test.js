// @vitest-environment jsdom
// Keyboard and screen-reader basics for the screens added in Audit 3.0: every control has a name, nothing jumps the tab order,
// filter buttons say whether they are pressed, and results are announced.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  productHistory: vi.fn(async () => [
    {
      engagement_id: 'e1',
      engagement_name: 'Annual',
      round_id: 'r1',
      round_label: '1',
      state: 'compiled',
      at: '2026-11-20T10:00:00Z',
      code: 'A1',
      name: 'Alpha one',
      company: 'Acme',
      system_qty: 10,
      counted_qty: 9,
      variance: -1,
      variance_value: -100.5,
      not_counted: false,
      assumed_to_match: false,
      corrected: false,
      total: 1,
    },
  ]),
  individualOverview: vi.fn(async () => [
    {
      month: '2026-11',
      person_id: 'p1',
      person_name: 'Count One',
      engagement_id: 'e1',
      round_id: 'r1',
      round_label: '1',
      state: 'compiled',
      started_at: '2026-11-02T05:00:00Z',
      compiled_at: null,
      item_count: 2,
      variance_count: 1,
      variance_value: -5,
    },
  ]),
  attentionSummary: vi.fn(async () => ({
    ready: [{ engagement_id: 'e1', engagement_name: 'Annual', round_id: 'r1', round_label: '1', n: 1 }],
    conflicts: [],
    corrections: [],
  })),
  assignmentProgress: vi.fn(async () => ({
    assignment: { id: 'a1', name: 'Count One', status: 'counting', round_state: 'counting' },
    items: [
      { round_item_id: 'i1', code: 'A1', name: 'Alpha one', company: 'Acme', counted: false, qty: null, auto_matched: false, note: '' },
    ],
  })),
}));
const { mountProductSearch } = await import('../../js/modules/audit/ui/productSearch.js');
const { mount: mountIndividuals } = await import('../../js/modules/audit/ui/individuals.js');
const { mount: mountAttention } = await import('../../js/modules/audit/ui/attention.js');
const { progressPanel, progressState, openProgress } = await import('../../js/modules/audit/ui/progress.js');
const { render, html } = await import('../../js/shared/html.js');

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const nameOf = (el) => {
  const labelled = el.getAttribute('aria-label');
  if (labelled) return labelled.trim();
  if (el.id) {
    const l = document.querySelector(`label[for="${el.id}"]`);
    if (l) return l.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap) return wrap.textContent.trim();
  return el.textContent.trim();
};
const controls = (root) => [...root.querySelectorAll('button, a[href], input, select, textarea')];

function checkBasics(root) {
  const list = controls(root);
  expect(list.length).toBeGreaterThan(0);
  for (const c of list) {
    expect(nameOf(c), `${c.tagName} has no accessible name: ${c.outerHTML.slice(0, 80)}`).not.toBe('');
    expect(Number(c.getAttribute('tabindex') ?? 0), 'positive tabindex').toBeLessThanOrEqual(0);
    expect(c.getAttribute('style')).toBeNull();
  }
  for (const b of root.querySelectorAll('button')) expect(['button', 'submit']).toContain(b.type);
}

describe('Audit 3.0 screens: names, tab order, announcements', () => {
  let el;
  beforeEach(() => {
    sessionStorage.clear();
    el = document.createElement('div');
    document.body.replaceChildren(el);
  });

  it('Find a product', async () => {
    mountProductSearch(el);
    el.querySelector('[data-s="hist-q"]').value = 'alpha';
    el.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    checkBasics(el);
    expect(el.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(el.querySelector('input[type="search"]').getAttribute('aria-label')).toBeTruthy();
  });
  it('Individual audits by person', async () => {
    await mountIndividuals(el);
    checkBasics(el);
    expect(el.querySelector('select[data-s="month"]').closest('label').textContent).toContain('Month');
    expect(el.querySelectorAll('section[aria-label]').length).toBeGreaterThan(0);
  });
  it('Needs attention', async () => {
    await mountAttention(el);
    checkBasics(el);
    expect(el.querySelector('section[aria-label]')).not.toBeNull();
  });
  it('the person panel: pressed state on filters, and a name for each', async () => {
    const p = progressState();
    const redraw = () => render(el, html`<div>${progressPanel(p)}</div>`);
    await openProgress(p, 'a1', redraw);
    checkBasics(el);
    const pressed = [...el.querySelectorAll('button[data-pf]')].filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(el.querySelector('[role="group"]').getAttribute('aria-label')).toBe('Show items');
  });
});

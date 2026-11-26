// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listVariance } from '../../js/modules/closing/domain/book.js';
import { finalAggregate } from '../../js/modules/closing/domain/snapshot.js';
import { friendlyError } from '../../js/modules/closing/domain/errors.js';

describe('the variance shown beside a record', () => {
  it('a Shift shows its own variance, a Final shows its Final variance', () => {
    expect(listVariance({ status: 'submitted', mode: 'shift', shift_variance: -250, final_variance: 7 })).toBe(-250);
    expect(listVariance({ status: 'submitted', mode: 'final', shift_variance: -999, final_variance: 40 })).toBe(40);
    expect(listVariance({ status: 'submitted', mode: 'final', shift_variance: 12, final_variance: null })).toBe(12);
  });
  it('a numeric string from the database is read as a number, and zero is still a variance', () => {
    expect(listVariance({ status: 'submitted', mode: 'shift', shift_variance: '584.00' })).toBe(584);
    expect(listVariance({ status: 'submitted', mode: 'shift', shift_variance: 0 })).toBe(0);
  });
  it('a draft, or a list without the figure, shows none', () => {
    expect(listVariance({ status: 'draft', mode: 'shift', shift_variance: 5 })).toBeNull();
    expect(listVariance({ status: 'submitted', mode: 'shift' })).toBeNull();
    expect(listVariance({ status: 'submitted', mode: 'shift', shift_variance: 'abc' })).toBeNull();
    expect(listVariance(null)).toBeNull();
  });
});

describe('the Aggregated Final Closing card of a saved closing', () => {
  const page = (results, extra = {}) => ({ is_opening: false, mode: 'shift', results, ...extra });
  it('is the target, the cash available and the signed difference for the whole period', () => {
    // the figures of the Evening closing in the owner's screenshot (25 Nov 2026)
    expect(finalAggregate(page({ final_net_sale: -1777, final_net_cash: -43321 }))).toEqual({ target: -1777, cash: -45098, diff: -43321 });
  });
  it('is the same for a Shift and a Final', () => {
    const r = { final_net_sale: 500, final_net_cash: 25 };
    expect(finalAggregate(page(r, { mode: 'final' }))).toEqual(finalAggregate(page(r)));
  });
  it('reads numbers that arrive as text', () => {
    expect(finalAggregate(page({ final_net_sale: '500.00', final_net_cash: '25.50' }))).toEqual({ target: 500, cash: 525.5, diff: 25.5 });
  });
  it('is left out for the opening closing and for a page with no stored results', () => {
    expect(finalAggregate(page({ final_net_sale: 1, final_net_cash: 1 }, { is_opening: true }))).toBeNull();
    expect(finalAggregate(page({}))).toBeNull();
    expect(finalAggregate(page({ final_net_sale: null, final_net_cash: null }))).toBeNull();
    expect(finalAggregate({ is_opening: false })).toBeNull();
    expect(finalAggregate(null)).toBeNull();
  });
});

describe('offline detection', () => {
  it('a message about the network is offline', () => {
    for (const m of [
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
      'network error',
      'The Internet connection appears to be offline.',
    ])
      expect(friendlyError(new TypeError(m)).kind, m).toBe('offline');
  });
  it('a mistake in the code is not called "No connection"', () => {
    const e = friendlyError(new TypeError("Cannot read properties of undefined (reading 'misc')"));
    expect(e.kind).toBe('unknown');
    expect(e.message).not.toContain('No connection');
  });
  it('is offline when the browser says it is, whatever the message', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(friendlyError(new Error('anything')).kind).toBe('offline');
    spy.mockRestore();
  });
  it('a refusal from the database keeps its own words even when the browser says offline', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(friendlyError(Object.assign(new Error('x'), { hint: 'slot_taken' })).code).toBe('slot_taken');
    spy.mockRestore();
  });
});

// the saved-closing page
const api = { ownBook: vi.fn() };
vi.mock('../../js/modules/closing/data/api.js', () => api);
describe('the saved closing page', () => {
  let el;
  beforeEach(() => {
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    sessionStorage.setItem('dua.closing.view', JSON.stringify({ id: 'c1' }));
  });
  const base = {
    closing_id: 'c1',
    business_date: '2026-11-25',
    kind: 'evening',
    seq: 9999,
    mode: 'shift',
    is_opening: false,
    staff: 'Ali',
    inputs: {},
    results: { net_sale: 100, net_cash: 90, shift_variance: -10, final_net_sale: -1777, final_net_cash: -43321 },
  };
  const open = async (page) => {
    api.ownBook.mockResolvedValue([page]);
    const { mount } = await import('../../js/modules/closing/ui/view.js');
    await mount(el);
  };
  it('ends with the Aggregated Final Closing card: target, cash available and Less', async () => {
    await open(base);
    const card = el.querySelector('[aria-label="Aggregated Final Closing"]');
    expect(card).not.toBeNull();
    const t = card.textContent.replace(/\s+/g, ' ');
    expect(t).toContain('Always the full period since the last Final Closing');
    expect(t).toMatch(/Target Net Sales\s*[−-]1,777\.00/);
    expect(t).toMatch(/Net Cash Available\s*[−-]45,098\.00/);
    expect(t).toMatch(/▼ Less\s*43,321\.00/);
    expect(card.closest('.cls-grid').lastElementChild).toBe(card); // the last thing on the page
  });
  it('shows it for a Final too, but not for the opening closing', async () => {
    await open({ ...base, mode: 'final' });
    expect(el.querySelector('[aria-label="Aggregated Final Closing"]')).not.toBeNull();
    await open({ ...base, is_opening: true });
    expect(el.querySelector('[aria-label="Aggregated Final Closing"]')).toBeNull();
  });
});

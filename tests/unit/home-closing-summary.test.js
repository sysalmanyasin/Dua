// @vitest-environment jsdom
// The Owner's Latest closing summary on Home: the words and boxes (pure), and the section with the database mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildClosingSummary, rs, slotName } from '../../js/modules/home/domain/closing-summary.js';

vi.mock('../../js/modules/home/data/api.js', () => ({
  opsClosingSummary: vi.fn(),
  watchClosings: vi.fn(),
}));
const api = await import('../../js/modules/home/data/api.js');
const { startClosingSummary } = await import('../../js/modules/home/ui/closing-summary.js');

const raw = (o = {}) => ({
  has_closing: true,
  closing_id: 'c1',
  business_date: '2026-11-22',
  day_no: 1,
  kind: 'night',
  seq: 10,
  mode: 'shift',
  revision: 1,
  is_opening: false,
  period_start: '2026-11-20',
  period_closings: 4,
  book_bills: 27725,
  manual_returns: 69648,
  mediq_collected: 0,
  deposits: 455000,
  carried_cc: 19872,
  ...o,
});

describe('slot names and amounts', () => {
  it('names the slots as Closing does', () => {
    expect([slotName('night', 10), slotName('morning', 20), slotName('evening', 9999)]).toEqual(['Night', 'Morning', 'Evening']);
    expect([slotName('handover', 30), slotName('handover', 40)]).toEqual(['Handover 1', 'Handover 2']);
  });
  it('writes amounts as Rs. with commas, paisa only when there are some', () => {
    expect(rs(19872)).toBe('Rs. 19,872');
    expect(rs('455000.00')).toBe('Rs. 455,000');
    expect(rs(1234.5)).toBe('Rs. 1,234.50');
    expect(rs(0)).toBe('Rs. 0');
    expect(rs(null)).toBe('Rs. 0');
    expect(rs(-250)).toBe('−Rs. 250');
  });
});

describe('buildClosingSummary', () => {
  it('is hidden for null (not for this person) and empty when nothing was submitted', () => {
    expect(buildClosingSummary(null).state).toBe('hidden');
    expect(buildClosingSummary(undefined).state).toBe('hidden');
    expect(buildClosingSummary({ has_closing: false }).state).toBe('empty');
  });
  it('gives the title and the five boxes in the agreed order', () => {
    const v = buildClosingSummary(raw());
    expect(v.state).toBe('ready');
    expect(v.title).toBe('2026-11-22 — Closing 1 — Night');
    expect(v.cards.map((c) => [c.label, c.value])).toEqual([
      ['Carried CC', 'Rs. 19,872'],
      ['Total Deposits', 'Rs. 455,000'],
      ['Book Bills', 'Rs. 27,725'],
      ['Manual Returns', 'Rs. 69,648'],
      ['MEDIQ Collected', 'Rs. 0'],
    ]);
  });
  it('says which period the totals cover', () => {
    expect(buildClosingSummary(raw()).note).toContain('since the last Final Closing (2026-11-20): 4 closings');
    expect(buildClosingSummary(raw({ period_closings: 1 })).note).toContain('1 closing.');
    expect(buildClosingSummary(raw({ mode: 'final', period_start: '2026-11-22', period_closings: 1 })).note).toContain(
      'This is a Final Closing',
    );
    expect(buildClosingSummary(raw({ period_start: null })).note).toContain('No Final Closing yet');
  });
  it('labels the mode', () => {
    expect(buildClosingSummary(raw()).mode).toBe('Shift');
    expect(buildClosingSummary(raw({ mode: 'final' })).mode).toBe('Final');
    expect(buildClosingSummary(raw({ is_opening: true })).mode).toBe('Opening');
  });
  it('treats odd values as zero instead of showing NaN', () => {
    const v = buildClosingSummary(raw({ book_bills: 'abc', deposits: null }));
    expect(v.cards.find((c) => c.id === 'book-bills').value).toBe('Rs. 0');
    expect(v.cards.find((c) => c.id === 'deposits').value).toBe('Rs. 0');
  });
});

describe('the section on Home', () => {
  let host, refresher, closingsChanged;
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  };
  const start = async () => {
    refresher = startClosingSummary({ host });
    await flush();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="h"></div>';
    host = document.getElementById('h');
    Object.values(api).forEach((f) => f.mockReset());
    api.opsClosingSummary.mockResolvedValue(raw());
    closingsChanged = null;
    api.watchClosings.mockImplementation((cb) => {
      closingsChanged = cb;
      return () => {};
    });
  });
  afterEach(() => {
    refresher?.stop();
    vi.useRealTimers();
  });

  it('shows the title, the five boxes and the period note', async () => {
    await start();
    const t = host.textContent;
    expect(t).toContain('Latest closing summary');
    expect(t).toContain('2026-11-22 — Closing 1 — Night');
    expect(t).toContain('Carried CC');
    expect(t).toContain('Rs. 19,872');
    expect(t).toContain('Book Bills');
    expect(t).toContain('Rs. 27,725');
    expect(host.querySelectorAll('.cs-cell')).toHaveLength(5);
    expect(host.querySelector('a[href="#/closing"]')).not.toBeNull();
  });

  it('shows nothing for a person the database does not allow', async () => {
    api.opsClosingSummary.mockResolvedValue(null);
    await start();
    expect(host.querySelector('.ops-section')).toBeNull();
  });

  it('says so when nothing has been submitted', async () => {
    api.opsClosingSummary.mockResolvedValue({ has_closing: false });
    await start();
    expect(host.textContent).toContain('No closing has been submitted yet');
    expect(host.querySelector('.cs-grid')).toBeNull();
  });

  it('says so when it cannot load, and does not break the page', async () => {
    api.opsClosingSummary.mockRejectedValue(new Error('network'));
    await start();
    expect(host.textContent).toContain('could not be loaded');
  });

  it('keeps the last figures and warns when a refresh fails', async () => {
    await start();
    api.opsClosingSummary.mockRejectedValue(new Error('network'));
    await refresher.refresh();
    await flush();
    expect(host.textContent).toContain('Rs. 455,000');
    expect(host.textContent).toContain('Could not refresh');
  });

  it('refreshes at once when a closing changes, with its own realtime channel', async () => {
    await start();
    expect(api.watchClosings).toHaveBeenCalledWith(expect.any(Function), 'home-closing-summary');
    expect(api.opsClosingSummary).toHaveBeenCalledTimes(1);
    api.opsClosingSummary.mockResolvedValue(raw({ deposits: 500000 }));
    closingsChanged();
    closingsChanged();
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(api.opsClosingSummary).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Rs. 500,000');
  });

  it('escapes what it shows', async () => {
    api.opsClosingSummary.mockResolvedValue(raw({ business_date: '<img src=x onerror=alert(1)>' }));
    await start();
    expect(host.querySelector('img')).toBeNull();
  });
});

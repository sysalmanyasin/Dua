// @vitest-environment jsdom
// The round-wise combined variance report and the Individual reports screen, with the database and the download replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ list: [] }));
vi.mock('../../js/modules/audit/ui/print.js', () => ({
  downloadText: vi.fn((name, text) => files.list.push({ name, text })),
  downloadBytes: vi.fn((name, bytes, type) => files.list.push({ name, bytes, type })),
}));
vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  compiledRowsAll: vi.fn(),
  finalLinesAll: vi.fn(),
  individualOverview: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mountCombinedReport } = await import('../../js/modules/audit/ui/combinedReport.js');
const { mount: mountReports } = await import('../../js/modules/audit/ui/individualReports.js');
const { getView, getGroup, setGroup } = await import('../../js/modules/audit/domain/nav.js');

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ');
const line = (over = {}) => ({
  company: 'Acme',
  code: 'A1',
  name: 'Alpha one',
  system_qty: 10,
  retail_price: 50,
  counted_qty: 8,
  variance: -2,
  variance_value: -100,
  missing: false,
  auto_matched: false,
  auditor_id: 'u1',
  note: null,
  corrected_by: null,
  ...over,
});
const overview = () => ({
  assignments: [{ auditor_id: 'u1', name: 'Count One' }],
  compilation: { id: 'c1', auditor_notes: [] },
  conflicts: [],
});
const rounds = [
  { id: 'r1', label: '1', state: 'compiled', items: 6, who: 'Count One' },
  { id: 'r2', label: '1A', state: 'compiled', items: 2, who: 'Count One' },
  { id: 'r3', label: '2', state: 'counting', items: 0, who: 'Count Two' },
];

let host;
beforeEach(() => {
  vi.clearAllMocks();
  files.list = [];
  sessionStorage.clear();
  location.hash = '';
  host = document.createElement('div');
  document.body.replaceChildren(host);
  api.compileOverview.mockResolvedValue(overview());
  // the same item differs in both rounds: a repeated round
  api.compiledRowsAll.mockImplementation(async () => [line()]);
});

describe('combined variance report', () => {
  it('offers every compiled round, none that is still counting, and says rounds are not added together', () => {
    mountCombinedReport(host, { auditName: 'Annual', rounds });
    const boxes = [...host.querySelectorAll('input[data-pick]')];
    expect(boxes.map((b) => [b.dataset.pick, b.checked, b.disabled])).toEqual([
      ['r1', true, false],
      ['r2', true, false],
      ['r3', false, true],
    ]);
    expect(host.querySelector('[data-no-sum]').textContent).toContain('not added together');
  });

  it('shows each selected round on its own, labelled, with its own totals and no total across rounds', async () => {
    mountCombinedReport(host, { auditName: 'Annual', rounds });
    host.querySelector('[data-show]').click();
    await flush();
    const sections = [...host.querySelectorAll('[data-round-report]')];
    expect(sections.map((s) => s.dataset.roundReport)).toEqual(['1', '1A']);
    // the same item repeated in two rounds is shown in both, and never summed to -200
    for (const s of sections) expect(text(s.querySelector('[data-round-totals]'))).toContain('1 line differs');
    expect(text(host)).not.toMatch(/-200|2 lines differ|all rounds/i);
  });

  it('shows only the rounds picked', async () => {
    mountCombinedReport(host, { auditName: 'Annual', rounds });
    const box = host.querySelector('input[data-pick="r1"]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    host.querySelector('[data-show]').click();
    await flush();
    expect([...host.querySelectorAll('[data-round-report]')].map((s) => s.dataset.roundReport)).toEqual(['1A']);
    expect(api.compileOverview).toHaveBeenCalledTimes(1);
  });

  it('cannot be shown or downloaded with nothing picked', () => {
    mountCombinedReport(host, { auditName: 'Annual', rounds });
    host.querySelector('[data-none]').click();
    expect(host.querySelector('[data-show]').disabled).toBe(true);
    expect(host.querySelector('[data-download="combined"]').disabled).toBe(true);
  });

  it('downloads the picked rounds with the round on every line and no all-rounds row', async () => {
    mountCombinedReport(host, { auditName: 'Annual', rounds });
    host.querySelector('[data-download="combined"]').click();
    await flush();
    const rows = files.list[0].text.trim().split('\r\n');
    expect(rows[0].startsWith('Round,Code,Product')).toBe(true);
    expect(rows.slice(1).map((r) => r.split(',')[0])).toEqual(['1', '1A']);
    host.querySelector('[data-download="summary"]').click();
    await flush();
    expect(files.list[1].text).not.toContain('All rounds');
  });

  it('shows an error when a round cannot be read, and recovers', async () => {
    api.compileOverview.mockRejectedValueOnce({ hint: 'not_allowed', message: 'not allowed' });
    mountCombinedReport(host, { auditName: 'Annual', rounds });
    host.querySelector('[data-show]').click();
    await flush();
    expect(host.querySelector('.note-error')).not.toBeNull();
    expect(host.querySelector('[data-show]').disabled).toBe(false);
  });

  it('says so when no round has been compiled, or there are no rounds', () => {
    mountCombinedReport(host, { auditName: 'Annual', rounds: [rounds[2]] });
    expect(text(host)).toContain('No round has been compiled yet');
    mountCombinedReport(host, { auditName: 'Annual', rounds: [] });
    expect(text(host)).toContain('no rounds to report on');
  });

  it('shows 100 lines per round on screen and says the download holds the rest', async () => {
    api.compiledRowsAll.mockImplementation(async () => Array.from({ length: 130 }, (_, i) => line({ code: `C${i}` })));
    mountCombinedReport(host, { auditName: 'Annual', rounds: [rounds[0]] });
    host.querySelector('[data-show]').click();
    await flush();
    expect(host.querySelectorAll('[data-round-report] tbody tr')).toHaveLength(100);
    expect(text(host)).toContain('first 100 of 130');
  });
});

describe('Individual reports screen', () => {
  const o = (x = {}) => ({
    person_id: 'p1',
    person_name: 'Count One',
    engagement_id: 'e2',
    round_id: 'r1',
    round_label: '1',
    state: 'compiled',
    started_at: '2026-11-02T05:00:00Z',
    item_count: 6,
    variance_count: 1,
    variance_value: -100,
    ...x,
  });
  let el;
  beforeEach(() => {
    el = document.createElement('div');
    document.body.replaceChildren(el);
    api.individualOverview.mockResolvedValue([
      o(),
      o({ round_id: 'r2', round_label: '2' }),
      o({ person_id: 'p2', person_name: 'Count Two', round_id: 'r3', state: 'counting', item_count: null, variance_count: null }),
    ]);
  });

  it('shows each person with their rounds, round by round, and the combined month report', async () => {
    setGroup(true);
    await mountReports(el);
    expect(el.querySelectorAll('[data-person]')).toHaveLength(2);
    expect(el.querySelector('[data-sec="combined"]')).not.toBeNull();
    expect([...el.querySelectorAll('[data-sec="combined"] input[data-pick]')].map((b) => b.disabled)).toEqual([false, false, true]);
    expect(text(el)).toContain('Not compiled yet');
  });

  it('starts as one list, newest first, each row naming its person and what it was started from', async () => {
    api.individualOverview.mockResolvedValue([
      o({ started_at: '2026-11-02T05:00:00Z', companies: ['Acme'] }),
      o({ round_id: 'r2', round_label: '2', started_at: '2026-11-21T05:00:00Z', template_name: 'Morning shelf', companies: ['Cura'] }),
      o({
        person_id: 'p2',
        person_name: 'Count Two',
        round_id: 'r3',
        round_label: '3',
        started_at: '2026-11-23T05:00:00Z',
        companies: ['Acme', 'Beta', 'Cura'],
      }),
    ]);
    await mountReports(el);
    expect(el.querySelector('input[data-group]').checked).toBe(false);
    expect(el.querySelectorAll('section[data-person]')).toHaveLength(0);
    expect([...el.querySelectorAll('[data-sec="rounds-flat"] [data-round] strong')].map((x) => x.textContent)).toEqual([
      'Round 3',
      'Round 2',
      'Round 1',
    ]);
    expect([...el.querySelectorAll('[data-sec="rounds-flat"] [data-round-person]')].map((x) => x.textContent)).toEqual([
      '· Count Two',
      '· Count One',
      '· Count One',
    ]);
    expect([...el.querySelectorAll('[data-sec="rounds-flat"] [data-round-scope]')].map((x) => x.textContent)).toEqual([
      'Acme, Beta +1 more',
      'Template: Morning shelf',
      'Acme',
    ]);
  });

  it('puts the combined variance report first, ahead of the rounds', async () => {
    await mountReports(el);
    const order = [...el.querySelectorAll('[data-sec="combined"], [data-sec="rounds-flat"]')].map((x) => x.dataset.sec);
    expect(order).toEqual(['combined', 'rounds-flat']);
    const names = [...el.querySelectorAll('[data-sec="combined"] .aud-check span')].map((x) => x.textContent);
    expect(names[0]).toContain('Round 1');
    expect(names[0]).toContain('Count One');
  });

  it('keeps what was picked in the combined report when the page redraws, and when the grouping changes', async () => {
    await mountReports(el);
    const box = el.querySelector('[data-sec="combined"] input[data-pick="r1"]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    el.querySelector('button[data-round-file="r2"]').click(); // a download redraws the page
    await flush();
    expect(el.querySelector('[data-sec="combined"] input[data-pick="r1"]').checked).toBe(false);
    const toggle = el.querySelector('input[data-group]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelectorAll('section[data-person]')).toHaveLength(2);
    expect(el.querySelector('[data-sec="combined"] input[data-pick="r1"]').checked).toBe(false);
    expect(getGroup()).toBe(true);
  });

  it('downloads one round’s variance report', async () => {
    await mountReports(el);
    el.querySelector('button[data-round-file="r1"]').click();
    await flush();
    expect(files.list).toHaveLength(1);
    expect(files.list[0].name).toContain('round-1-variance');
  });

  it('downloads one person’s rounds, round-labelled', async () => {
    setGroup(true);
    await mountReports(el);
    el.querySelector('button[data-person-file="p1"]').click();
    await flush();
    const rows = files.list[0].text.trim().split('\r\n');
    expect(rows.slice(1).map((r) => r.split(',')[0])).toEqual(['1', '2']);
  });

  it('offers no download for a person with nothing compiled', async () => {
    setGroup(true);
    await mountReports(el);
    const two = [...el.querySelectorAll('[data-person]')].find((s) => s.textContent.includes('Count Two'));
    expect(two.querySelector('[data-person-file]')).toBeNull();
  });

  it('opens a round in the Individual review screen', async () => {
    await mountReports(el);
    el.querySelector('button[data-open]').click();
    expect(location.hash).toBe('#/audit/individual-review');
    expect(getView()).toEqual({ engagement: 'e2', round: 'r1' });
  });

  it('shows an error card when the month cannot load, and an empty state for an empty month', async () => {
    api.individualOverview.mockRejectedValueOnce({ hint: 'not_allowed', message: 'not allowed' });
    await mountReports(el);
    expect(text(el)).toContain('Could not load');
    api.individualOverview.mockResolvedValue([]);
    el = document.createElement('div');
    document.body.replaceChildren(el);
    await mountReports(el);
    expect(el.querySelector('[data-empty]')).not.toBeNull();
  });
});

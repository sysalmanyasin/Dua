// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  productHistory: vi.fn(),
  individualOverview: vi.fn(),
  compileOverview: vi.fn(async () => {
    throw new Error('not needed');
  }),
  myAssignments: vi.fn(async () => []),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mountProductSearch } = await import('../../js/modules/audit/ui/productSearch.js');
const { mount: mountIndividuals } = await import('../../js/modules/audit/ui/individuals.js');
const { getView, getMonth, getGroup, setGroup } = await import('../../js/modules/audit/domain/nav.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
const hist = (o = {}) => ({
  engagement_id: 'e1',
  engagement_name: 'Annual audit',
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
  ...o,
});
const search = async (host, text) => {
  host.querySelector('[data-s="hist-q"]').value = text;
  host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  await flush();
};

describe('Find a product', () => {
  let host;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    location.hash = '';
    host = document.createElement('div');
    document.body.replaceChildren(host);
  });

  it('does not ask the database for empty text', async () => {
    mountProductSearch(host);
    await search(host, '   ');
    expect(api.productHistory).not.toHaveBeenCalled();
  });
  it('shows each round the product was in, with its figures', async () => {
    api.productHistory.mockResolvedValue([
      hist(),
      hist({ round_id: 'r2', round_label: '2', state: 'final', variance: 0, counted_qty: 10 }),
    ]);
    mountProductSearch(host);
    await search(host, ' alpha ');
    expect(api.productHistory).toHaveBeenCalledWith('alpha', 50);
    const text = host.textContent;
    expect(text).toContain('Alpha one');
    expect(text).toContain('Annual audit · Round 1');
    expect(text).toContain('Counted 9');
    expect(text).toContain('−1');
    expect(text).toContain('Matches');
    expect(host.querySelectorAll('[data-product]')).toHaveLength(1);
  });
  it('says so when nothing matches', async () => {
    api.productHistory.mockResolvedValue([]);
    mountProductSearch(host);
    await search(host, 'zzz');
    expect(host.textContent).toContain('No compiled or final round holds that product');
  });
  it('tells the person when more matches exist', async () => {
    api.productHistory.mockResolvedValue([hist({ total: 120 })]);
    mountProductSearch(host);
    await search(host, 'a');
    expect(host.querySelector('[data-hist-more]')).not.toBeNull();
  });
  it('shows a friendly message when the call fails', async () => {
    api.productHistory.mockRejectedValue({ hint: 'not_allowed', message: 'not allowed' });
    mountProductSearch(host);
    await search(host, 'alpha');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('opens the compile page for a compiled round and the final page for a final one', async () => {
    api.productHistory.mockResolvedValue([hist(), hist({ round_id: 'r2', state: 'final' })]);
    mountProductSearch(host);
    await search(host, 'alpha');
    const [a, b] = host.querySelectorAll('button[data-hist-open]');
    a.click();
    expect(location.hash).toBe('#/audit/compile');
    expect(getView()).toEqual({ engagement: 'e1', round: 'r1' });
    b.click();
    expect(location.hash).toBe('#/audit/final');
  });
});

describe('Individual audits by person', () => {
  const o = (x) => ({
    month: '2026-11',
    person_id: 'p1',
    person_name: 'Count One',
    engagement_id: 'e1',
    round_id: 'r1',
    round_label: '1',
    state: 'compiled',
    started_at: '2026-11-02T05:00:00Z',
    compiled_at: '2026-11-02T06:00:00Z',
    item_count: 2,
    variance_count: 2,
    variance_value: -100,
    ...x,
  });
  let el;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    el = document.createElement('div');
    document.body.replaceChildren(el);
  });

  it('lists people with their rounds, unfinished ones marked', async () => {
    api.individualOverview.mockResolvedValue([
      o({}),
      o({ round_id: 'r2', state: 'counting', item_count: null, variance_count: null, variance_value: null }),
      o({ person_id: 'p2', person_name: 'Count Two', round_id: 'r3' }),
    ]);
    setGroup(true);
    await mountIndividuals(el);
    expect(el.querySelectorAll('section[data-person]')).toHaveLength(2);
    expect(el.textContent).toContain('Not compiled yet');
    expect(el.textContent).toContain('1 not finished');
    expect(el.textContent).toContain('2 items · 2 differences');
    // each round on its own: nothing is added across a person's rounds
    expect(el.textContent).not.toMatch(/\d+ audits? · .*· \d+ differences?$/m);
  });
  describe('Rounds & Progress: one list or grouped by people', () => {
    const row = (x) => ({
      person_id: 'p1',
      person_name: 'Count One',
      engagement_id: 'e1',
      round_id: 'r1',
      round_label: '1',
      state: 'compiled',
      started_at: '2026-11-02T05:00:00Z',
      item_count: 2,
      variance_count: 0,
      variance_value: 0,
      template_name: null,
      companies: ['Acme'],
      ...x,
    });
    const rows = [
      row({ round_id: 'r1', round_label: '1', started_at: '2026-11-02T05:00:00Z' }),
      row({
        round_id: 'r4',
        round_label: '4',
        person_id: 'p2',
        person_name: 'Count Two',
        started_at: '2026-11-23T09:00:00Z',
        companies: ['Acme', 'Beta', 'Cura', 'Delta'],
      }),
      row({
        round_id: 'r3',
        round_label: '3',
        person_id: 'p3',
        person_name: 'Count Three',
        started_at: '2026-11-22T09:00:00Z',
        template_name: 'Morning shelf',
        companies: ['Cura'],
      }),
      row({ round_id: 'r2', round_label: '2', started_at: '2026-11-21T09:00:00Z', companies: [] }),
    ];
    const opts = { ctx: { permissions: ['audit.view'] }, screen: 'rounds' };
    const labels = () => [...el.querySelectorAll('[data-round] strong')].map((x) => x.textContent);

    it('starts as one list, newest round first, each row naming its person', async () => {
      api.individualOverview.mockResolvedValue(rows);
      await mountIndividuals(el, opts);
      expect(el.querySelector('input[data-group]').checked).toBe(false);
      expect(el.querySelectorAll('section[data-person]')).toHaveLength(0);
      expect(labels()).toEqual(['Round 4', 'Round 3', 'Round 2', 'Round 1']);
      expect([...el.querySelectorAll('[data-round-person]')].map((x) => x.textContent)).toEqual([
        '· Count Two',
        '· Count Three',
        '· Count One',
        '· Count One',
      ]);
    });

    it('shows the template, or the companies, each round was started from', async () => {
      api.individualOverview.mockResolvedValue(rows);
      await mountIndividuals(el, opts);
      expect([...el.querySelectorAll('[data-round-scope]')].map((x) => x.textContent)).toEqual([
        'Acme, Beta +2 more',
        'Template: Morning shelf',
        'Acme',
      ]);
      // a round with no companies says nothing rather than something wrong
      expect(el.querySelectorAll('[data-round]')[2].querySelector('[data-round-scope]')).toBeNull();
    });

    it('groups by people when switched on, and remembers it', async () => {
      api.individualOverview.mockResolvedValue(rows);
      await mountIndividuals(el, opts);
      const box = el.querySelector('input[data-group]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      expect(el.querySelectorAll('section[data-person]')).toHaveLength(3);
      expect(el.querySelectorAll('[data-round-person]')).toHaveLength(0);
      expect(getGroup()).toBe(true);
      // each person's own rounds stay newest first, with the template or companies shown
      const one = [...el.querySelectorAll('section[data-person]')].find((x) => x.textContent.includes('Count One'));
      expect([...one.querySelectorAll('[data-round] strong')].map((x) => x.textContent)).toEqual(['Round 2', 'Round 1']);
      document.body.replaceChildren((el = document.createElement('div')));
      await mountIndividuals(el, opts);
      expect(el.querySelector('input[data-group]').checked).toBe(true);
      box.checked = false;
      el.querySelector('input[data-group]').checked = false;
      el.querySelector('input[data-group]').dispatchEvent(new Event('change', { bubbles: true }));
      expect(getGroup()).toBe(false);
      expect(el.querySelectorAll('section[data-person]')).toHaveLength(0);
    });

    it('keeps the toggle across a change of month', async () => {
      api.individualOverview.mockResolvedValue(rows);
      await mountIndividuals(el, opts);
      const sel = el.querySelector('select[data-s="month"]');
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
      expect(el.querySelector('input[data-group]').checked).toBe(false);
      expect(labels()).toEqual(['Round 4', 'Round 3', 'Round 2', 'Round 1']);
    });

    it('has no toggle on the Monthly Overview', async () => {
      api.individualOverview.mockResolvedValue(rows);
      await mountIndividuals(el, { ...opts, screen: 'overview' });
      expect(el.querySelector('input[data-group]')).toBeNull();
    });
  });
  it('says so when the month is empty', async () => {
    api.individualOverview.mockResolvedValue([]);
    await mountIndividuals(el);
    expect(el.querySelector('[data-empty]')).not.toBeNull();
  });
  it('reloads for the month picked and ignores a slow earlier answer', async () => {
    api.individualOverview.mockResolvedValue([]);
    await mountIndividuals(el);
    const sel = el.querySelector('select[data-s="month"]');
    const other = sel.options[1].value;
    let release;
    api.individualOverview.mockImplementationOnce(() => new Promise((r) => (release = r)));
    sel.value = other;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    api.individualOverview.mockResolvedValueOnce([o({ person_name: 'Newest' })]);
    const sel2 = el.querySelector('select[data-s="month"]');
    sel2.value = sel.options[2].value;
    sel2.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    release([o({ person_name: 'Stale' })]);
    await flush();
    await flush();
    expect(el.textContent).toContain('Newest');
    expect(el.textContent).not.toContain('Stale');
  });
  it('shows an error card when the call fails', async () => {
    api.individualOverview.mockRejectedValue({ hint: 'not_allowed', message: 'not allowed' });
    await mountIndividuals(el);
    expect(el.textContent).toContain('Could not load');
  });
  it('opens the round', async () => {
    api.individualOverview.mockResolvedValue([o({})]);
    await mountIndividuals(el);
    el.querySelector('button[data-open]').click();
    expect(location.hash).toBe('#/audit/individual-review');
    expect(getView()).toEqual({ engagement: 'e1', round: 'r1' });
  });

  it('rounds screen shows how far counting has got for a round still counting, and the person’s own way back to it', async () => {
    api.individualOverview.mockResolvedValue([
      o({ round_id: 'r2', state: 'counting', item_count: null, variance_count: null, variance_value: null }),
    ]);
    api.compileOverview.mockResolvedValue({
      assignments: [
        { status: 'assigned', counted: 12, items: 40 },
        { status: 'revoked', counted: 5, items: 9 },
      ],
    });
    api.myAssignments.mockResolvedValue([{ round_id: 'r2', method: 'individual-self-pick', status: 'assigned' }]);
    await mountIndividuals(el, { ctx: { permissions: ['audit.view', 'audit.individual'] }, screen: 'rounds' });
    expect(el.textContent).toContain('Counting: 12 of 40 counted');
    expect(el.querySelector('[data-continue]').getAttribute('href')).toBe('#/audit/individual');
    expect(el.querySelector('[data-own-open]')).not.toBeNull();
  });
  it('monthly overview shows who took part and what is outstanding, with no variance added up', async () => {
    api.individualOverview.mockResolvedValue([
      o({}),
      o({ round_id: 'r2', state: 'counting', item_count: null, variance_count: null, variance_value: null }),
      o({ person_id: 'p2', person_name: 'Count Two', round_id: 'r3' }),
    ]);
    await mountIndividuals(el, { ctx: { permissions: ['audit.view'] }, screen: 'overview' });
    expect(el.querySelector('[data-month-summary]').textContent.replace(/\s+/g, ' ')).toContain(
      '2 people · 3 rounds · 2 done · 1 still counting',
    );
    expect(el.querySelectorAll('[data-sec="staff"] [data-person]')).toHaveLength(2);
    expect(el.querySelectorAll('[data-outstanding]')).toHaveLength(1);
    expect(el.textContent).not.toContain('difference');
  });
  it('says nothing is outstanding when every round is finished', async () => {
    api.individualOverview.mockResolvedValue([o({})]);
    await mountIndividuals(el, { ctx: { permissions: ['audit.view'] }, screen: 'overview' });
    expect(el.querySelector('[data-nothing-outstanding]')).not.toBeNull();
  });
  it('keeps the month picked so the other Individual screens open on it', async () => {
    api.individualOverview.mockResolvedValue([]);
    await mountIndividuals(el, { screen: 'overview' });
    const sel = el.querySelector('select[data-s="month"]');
    const other = sel.options[1].value;
    sel.value = other;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(getMonth()).toBe(other);
    document.body.replaceChildren((el = document.createElement('div')));
    await mountIndividuals(el, { screen: 'rounds' });
    expect(el.querySelector('select[data-s="month"]').value).toBe(other);
  });
});

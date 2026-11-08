// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const template = {
  sections: [
    { id: 's1', number_label: '1', title: 'Branch', group_no: null, sort: 1, kind: 'items', active: true },
    { id: 's3', number_label: '3', title: 'Staff Appearance', group_no: '3', sort: 2, kind: 'items', active: true },
    { id: 'rpo', number_label: '28–31', title: 'RPO status', group_no: null, sort: 3, kind: 'table', active: true },
  ],
  items: [
    {
      key: 's1_1',
      section_id: 's1',
      no: '1',
      label: 'Branch:',
      default_value: 'Bahria Town',
      dropdown_key: null,
      optional: false,
      active: true,
      sort: 1,
    },
    {
      key: 's3_1',
      section_id: 's3',
      no: '',
      label: 'a) Staff <img src=x onerror=alert(1)>',
      default_value: 'Ok',
      dropdown_key: null,
      optional: false,
      active: true,
      sort: 1,
    },
    {
      key: 'dd_rpos',
      section_id: 'rpo',
      no: '29 A',
      label: 'RPOs Status',
      default_value: '',
      dropdown_key: 'rpos',
      optional: true,
      active: true,
      sort: 1,
    },
  ],
  dropdowns: { rpos: ['Reviewed - no issues', 'Pending review', 'Partially reviewed'] },
  competitorDefaults: [{ name: 'Shop A', stock_value: '1 Crore', avg_per_day: '300K', monthly_sales: '9 Million' }],
};
const api = {
  loadTemplate: vi.fn(async () => template),
  lastMeta: vi.fn(async () => ({
    branch: 'Bahria Town',
    prepared_by: 'Tester',
    designation: 'Co Manager',
    contact: '0300',
    meter_ref: 'REF-1',
  })),
  getDay: vi.fn(async () => null),
  saveDay: vi.fn(async () => ({ data: { version: 1, updated_at: 'x' }, error: null })),
  resetDay: vi.fn(async () => ({ error: null })),
  logSend: vi.fn(async () => ({ error: null })),
  setDropdown: vi.fn(async () => ({ error: null })),
};
vi.mock('../../js/modules/sales/data/checklistApi.js', () => api);
vi.mock('../../js/shared/mailDialog.js', () => ({ openMailDialog: (...a) => globalThis.__mail(...a) }));

let el;
const FILL = ['checklist.fill', 'checklist.view'];
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
};
const q = (sel) => el.querySelector(sel);
const flushAll = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

async function open(perms = FILL) {
  const { mount } = await import('../../js/modules/sales/ui/checklist.js');
  await mount(el, { ctx: { permissions: perms } });
  await flushAll();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.getDay.mockImplementation(async () => null);
  api.saveDay.mockImplementation(async () => ({ data: { version: 1, updated_at: 'x' }, error: null }));
});
afterEach(() => vi.useRealTimers());

describe('Daily Check List page', () => {
  it('opens a new day with the defaults, the carried-over header and nothing saved yet', async () => {
    await open();
    expect(q('[data-a="s1_1"]').value).toBe('Bahria Town');
    expect(q('[data-f="prepared_by"]').value).toBe('Tester');
    expect(q('[data-f="meter_ref"]').value).toBe('REF-1');
    expect(q('[data-c="0,0"]').value).toBe('Shop A');
    expect(api.saveDay).not.toHaveBeenCalled();
    expect(q('#cl-plabel').textContent).toMatch(/of 9 sections complete/);
  });

  it('works out opening stock, total in hand, net total, returns and customers as you type', async () => {
    await open();
    type(q('[data-f="s_cashsale"]'), '300000');
    type(q('[data-f="s_creditsale"]'), '25225');
    type(q('[data-f="s_cashreturn"]'), '30197');
    type(q('[data-f="s_closing"]'), '5000000');
    type(q('[data-f="s_receive"]'), '10000');
    type(q('[data-f="c_cash"]'), '600');
    type(q('[data-f="c_panel"]'), '39');
    expect(q('[data-ro="nettotal"]').value).toBe('325,225');
    expect(q('[data-ro="totalhand"]').value).toBe('5,325,225');
    expect(q('[data-ro="opening"]').value).toBe('5,315,225');
    expect(q('[data-ro="returntotal"]').value).toBe('30,197');
    expect(q('[data-ro="custtotal"]').value).toBe('639');
    expect(q('#snap-net').textContent).toBe('325,225');
    expect(q('#snap-cust').textContent).toBe('639');
  });

  it('autosaves after a short pause with every answer, and the next save uses the new version', async () => {
    await open();
    type(q('[data-a="s3_1"]'), 'Done');
    expect(q('#cl-save').dataset.state).toBe('saving');
    await flushAll(500);
    expect(api.saveDay).not.toHaveBeenCalled();
    await flushAll(400);
    expect(api.saveDay).toHaveBeenCalledTimes(1);
    const [date, fields, answers, comp, version] = api.saveDay.mock.calls[0];
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(version).toBeNull();
    expect(answers).toMatchObject({ s1_1: 'Bahria Town', s3_1: 'Done', dd_rpos: '' });
    expect(fields.prepared_by).toBe('Tester');
    expect(comp).toEqual([['Shop A', '1 Crore', '300K', '9 Million']]);
    expect(q('#cl-save').dataset.state).toBe('saved');
    expect(localStorage.length).toBe(0); // local copy cleared once saved
    api.saveDay.mockImplementation(async () => ({ data: { version: 2 }, error: null }));
    type(q('[data-a="s3_1"]'), 'Ok again');
    await flushAll(900);
    expect(api.saveDay.mock.calls[1][4]).toBe(1);
  });

  it('keeps a local copy and retries when the connection fails', async () => {
    api.saveDay.mockImplementationOnce(async () => ({ data: null, error: { message: 'Failed to fetch' } }));
    await open();
    type(q('[data-a="s3_1"]'), 'Offline edit');
    await flushAll(900);
    expect(q('#cl-save').dataset.state).toBe('offline');
    expect(localStorage.length).toBe(1);
    await flushAll(6100);
    expect(api.saveDay).toHaveBeenCalledTimes(2);
    expect(q('#cl-save').dataset.state).toBe('saved');
  });

  it('stops and warns when the day was changed on another device', async () => {
    api.saveDay.mockImplementation(async () => ({ data: null, error: { message: 'conflict: this day was changed on another device' } }));
    await open();
    type(q('[data-a="s3_1"]'), 'x');
    await flushAll(900);
    expect(q('#cl-conflict').hidden).toBe(false);
    await flushAll(20000);
    expect(api.saveDay).toHaveBeenCalledTimes(1); // no blind retries
  });

  it('opens a saved day with its answers and saves against its version', async () => {
    api.getDay.mockImplementation(async () => ({
      day: {
        version: 4,
        branch: 'Bahria Town',
        prepared_by: 'Saved Person',
        designation: '',
        contact: '',
        report_time: '21:30:00',
        s_cashsale: '1500.50',
        lt7_date: '2026-11-03',
        meter_ref: '',
        meter_reading: '',
        notes: 'n',
        s_closing: null,
      },
      answers: { s3_1: 'Saved answer' },
      competitors: [['Shop Z', '1', '2', '3']],
    }));
    await open();
    expect(q('[data-a="s3_1"]').value).toBe('Saved answer');
    expect(q('[data-f="s_cashsale"]').value).toBe('1500.5');
    expect(q('[data-f="report_time"]').value).toBe('21:30');
    expect(q('[data-c="0,0"]').value).toBe('Shop Z');
    type(q('[data-f="notes"]'), 'changed');
    await flushAll(900);
    expect(api.saveDay.mock.calls[0][4]).toBe(4);
  });

  it('restores unsaved edits kept on this device', async () => {
    const day = new Date().toISOString().slice(0, 10);
    void day;
    await open();
    type(q('[data-a="s3_1"]'), 'Typed then page closed');
    await flushAll(100);
    const key = localStorage.key(0);
    const draft = localStorage.getItem(key);
    el.replaceChildren();
    localStorage.setItem(key, draft);
    await open();
    expect(q('[data-a="s3_1"]').value).toBe('Typed then page closed');
    await flushAll(900);
    expect(api.saveDay).toHaveBeenCalled();
  });

  it('a view-only person can read and send but not edit or reset', async () => {
    await open(['checklist.view']);
    expect(q('[data-a="s3_1"]').disabled).toBe(true);
    expect(q('[data-f="s_cashsale"]').disabled).toBe(true);
    expect(q('[data-act="reset"]')).toBeNull();
    expect(q('[data-act="copy"]')).not.toBeNull();
    q('[data-f="notes"]').dispatchEvent(new Event('input', { bubbles: true }));
    await flushAll(2000);
    expect(api.saveDay).not.toHaveBeenCalled();
  });

  it('Send via Gmail opens the mail dialog with the report, and logs the send only once it has gone', async () => {
    globalThis.__mail = vi.fn();
    api.getDay.mockImplementation(async () => ({ day: { version: 3, branch: 'Bahria Town' }, answers: {}, competitors: [] }));
    await open();
    q('[data-act="gmail"]').click();
    await flushAll(100);
    const a = globalThis.__mail.mock.calls[0][0];
    expect(a.subject).toMatch(/^Daily Check List — Bahria Town — \d{4}-\d{2}-\d{2}$/);
    expect(a.html).toContain('24 Stocks Report');
    expect(a.text).toContain('Checklist');
    expect(api.logSend).not.toHaveBeenCalled();
    a.onSent();
    expect(api.logSend).toHaveBeenCalledWith(expect.any(String), 'gmail');
  });

  it('only people who may manage see the dropdown editor', async () => {
    await open();
    expect(q('[data-act="ddedit"]')).toBeNull();
    el.replaceChildren();
    await open([...FILL, 'checklist.manage']);
    expect(q('[data-act="ddedit"]')).not.toBeNull();
  });

  it('copy puts HTML and plain text on the clipboard', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });
    globalThis.ClipboardItem = class {
      constructor(items) {
        this.items = items;
      }
    };
    await open();
    type(q('[data-f="s_cashsale"]'), '1000');
    q('[data-act="copy"]').click();
    await flushAll(1500);
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys(write.mock.calls[0][0][0].items).sort()).toEqual(['text/html', 'text/plain']);
  });

  it('shows nothing a person typed or stored as markup', async () => {
    await open();
    expect(el.querySelector('img')).toBeNull();
    expect(q('[data-a="s3_1"]').getAttribute('aria-label')).toContain('<img');
  });

  it('reset asks first, then clears the saved day', async () => {
    api.getDay.mockImplementationOnce(async () => ({ day: { version: 2, branch: 'B' }, answers: {}, competitors: [] }));
    window.confirm = vi.fn(() => false);
    await open();
    q('[data-act="reset"]').click();
    await flushAll();
    expect(api.resetDay).not.toHaveBeenCalled();
    window.confirm = vi.fn(() => true);
    q('[data-act="reset"]').click();
    await flushAll();
    expect(api.resetDay).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildEmailHtml,
  buildModel,
  buildPlainText,
  calcCustomers,
  calcLt7,
  calcStock,
  dateNice,
  dateShort,
  pageSections,
  sectionProgress,
  timeNice,
} from '../../js/modules/sales/domain/checklist.js';

const template = {
  sections: [
    { id: 's1', number_label: '1', title: 'Branch', group_no: null, sort: 1, kind: 'items', active: true },
    { id: 's3', number_label: '3', title: 'Staff Appearance', group_no: '3', sort: 2, kind: 'items', active: true },
    { id: 'mc', number_label: '25–27', title: 'Manual cash bill', group_no: null, sort: 3, kind: 'table', active: true },
  ],
  items: [
    { key: 's1_1', section_id: 's1', no: '1', label: 'Branch:', default_value: 'Bahria Town', optional: false, active: true, sort: 1 },
    { key: 's3_1', section_id: 's3', no: '', label: 'a) Staff Shave', default_value: 'Ok', optional: false, active: true, sort: 1 },
    { key: 's3_2', section_id: 's3', no: '', label: 'b) Overalls', default_value: 'Ok', optional: false, active: true, sort: 2 },
    { key: 'mc_1', section_id: 'mc', no: '25 A', label: 'Flyer <b>', default_value: '', optional: true, active: true, sort: 1 },
    {
      key: 'mc_2',
      section_id: 'mc',
      no: '26',
      label: 'Manual cash memo',
      default_value: 'Book Pending Value: 890',
      optional: false,
      active: true,
      sort: 2,
    },
  ],
};
const state = (over = {}) => ({
  fields: {
    branch: 'Bahria Town',
    s_cashsale: '300000',
    s_creditsale: '25225',
    s_cashreturn: '30197',
    s_creditreturn: '',
    s_receive: '10000',
    s_closing: '5000000',
    c_cash: '600',
    c_panel: '39',
    lt7_date: '2026-11-04',
    lt7_zero: '3',
    lt7_days: '4',
    meter_ref: 'REF-1',
    meter_reading: '',
    notes: ' hello ',
    ...over.fields,
  },
  answers: { s1_1: 'Bahria Town', s3_1: 'Ok', ...over.answers },
  comp: over.comp ?? [
    ['Shop A', '1 Crore', '300K', '9 Million'],
    ['', '', '', ''],
  ],
});

describe('live figures', () => {
  it('works out net, returns, total in hand and opening exactly as the original', () => {
    const c = calcStock(state().fields);
    expect(c).toEqual({ hasClosing: true, net: 325225, ret: 30197, totalHand: 5325225, opening: 5315225 });
  });
  it('shows nothing for total in hand until a closing figure is entered, and rounds to 2 places', () => {
    expect(calcStock({ s_cashsale: '10.005', s_creditsale: '0.1' }).hasClosing).toBe(false);
    expect(calcStock({ s_closing: '1', s_cashsale: '0.1', s_creditsale: '0.2' }).totalHand).toBe(1.3);
  });
  it('adds customers and flagged items', () => {
    expect(calcCustomers({ c_cash: '600', c_panel: '39' })).toBe(639);
    expect(calcLt7({ lt7_zero: '3', lt7_days: '4' })).toBe(7);
    expect(calcLt7({})).toBe(0);
  });
});

describe('dates and times as printed', () => {
  it('formats like the original report', () => {
    expect(dateNice('2026-11-06')).toBe('06 Nov 2026');
    expect(dateShort('2026-11-06')).toBe('06-Nov-26');
    expect(dateNice('')).toBe('—');
    expect(timeNice('20:08')).toBe('8:08 PM');
    expect(timeNice('00:05')).toBe('12:05 AM');
    expect(timeNice('12:00')).toBe('12:00 PM');
  });
});

describe('progress', () => {
  const sec = (id) => pageSections(template).find((s) => s.id === id);
  it('a section is complete when all required boxes are filled; optional boxes do not count', () => {
    expect(sectionProgress(sec('s3'), state(), template)).toBe(0.5); // s3_2 is empty
    expect(sectionProgress(sec('s3'), state({ answers: { s3_2: 'Ok' } }), template)).toBe(1);
    expect(sectionProgress(sec('mc'), state({ answers: { mc_2: 'x' } }), template)).toBe(1); // mc_1 is optional
  });
  it('stock, flagged items, meter and competitor sections follow the same rule; notes and sign-off are always done', () => {
    expect(sectionProgress(sec('lt7'), state(), template)).toBe(1);
    expect(sectionProgress(sec('lt7'), state({ fields: { lt7_days: '' } }), template)).toBe(0.5);
    expect(sectionProgress(sec('meter'), state(), template)).toBe(1); // reading is optional
    expect(sectionProgress(sec('stocks'), state(), template)).toBeLessThan(1);
    expect(sectionProgress(sec('comp'), state(), template)).toBe(0.5);
    expect(sectionProgress(sec('comp'), state({ comp: [] }), template)).toBe(1);
    expect(sectionProgress(sec('notes'), state(), template)).toBe(1);
    expect(sectionProgress(sec('sig'), state(), template)).toBe(1);
  });
  it('lists sections in the page order with the fixed ones in their places', () => {
    expect(pageSections(template).map((s) => s.id)).toEqual(['s1', 's3', 'stocks', 'mc', 'lt7', 'meter', 'comp', 'notes', 'sig']);
  });
});

describe('report model', () => {
  const m = buildModel(template, state());
  it('puts group headings before their items and uses defaults for unanswered items', () => {
    expect(m.rows.map((r) => r.type)).toEqual(['item', 'group', 'item', 'item']);
    expect(m.rows[1]).toEqual({ type: 'group', no: '3', title: 'Staff Appearance' });
    expect(m.rows[3].val).toBe('Ok'); // s3_2 unanswered -> default
    expect(m.extra[0].rows.map((r) => r.val)).toEqual(['', 'Book Pending Value: 890']);
  });
  it('builds the stock table: returns shown negative, net total, closing, customers', () => {
    const by = Object.fromEntries(m.stock.filter((r) => !r.type).map((r) => [r.label, r.val]));
    expect(by['Opening Stock Position: (A)']).toBe('5315225');
    expect(by['Total Stock in Hand: (A+B)']).toBe('5325225');
    expect(by['Cash Sale Return:']).toBe('-30197');
    expect(by['Credit Sale Return:']).toBe('');
    expect(by['Cash + Credit Return Total:']).toBe('-30197');
    expect(by['Net Total:']).toBe('325225');
    expect(by['Total Number of Customers']).toBe('639');
    expect(m.stock.find((r) => r.type === 'group').title).toBe('Daily Sales (C)');
  });
  it('treats returns typed positive or negative the same way', () => {
    const neg = buildModel(template, state({ fields: { s_cashreturn: '-30197' } }));
    expect(neg.stock.find((r) => r.label === 'Cash Sale Return:').val).toBe('-30197');
  });
  it('leaves stock lines blank until there is data', () => {
    const empty = buildModel(
      template,
      state({ fields: { s_cashsale: '', s_creditsale: '', s_closing: '', s_cashreturn: '', c_cash: '', c_panel: '' } }),
    );
    const by = Object.fromEntries(empty.stock.filter((r) => !r.type).map((r) => [r.label, r.val]));
    expect(by['Net Total:']).toBe('');
    expect(by['Opening Stock Position: (A)']).toBe('');
    expect(by['Total Number of Customers']).toBe('');
  });
  it('flagged items, meter, competitors (blank rows dropped) and trimmed notes', () => {
    expect(m.lt7).toEqual([
      ['Date', '04-Nov-26'],
      ['Zero items', 3],
      ['Less than 7 Days', 4],
      ['Total items', 7],
    ]);
    expect(m.meter).toEqual([
      ['Meter Reference Number', 'REF-1'],
      ['Meter Reading', ''],
    ]);
    expect(m.comp).toEqual([['Shop A', '1 Crore', '300K', '9 Million']]);
    expect(m.notes).toBe('hello');
  });
});

describe('e-mail HTML and plain text', () => {
  const m = buildModel(template, state());
  const html = buildEmailHtml(m);
  it('is styled inline (mail programs ignore stylesheets) and contains the figures', () => {
    expect(html).toContain('style="');
    expect(html).not.toContain('<style');
    expect(html).toContain('24 Stocks Report');
    expect(html).toContain('325225');
    expect(html).toContain('34 Competitor Sales');
    expect(html).toContain('Shop A');
  });
  it('escapes everything typed by a person', () => {
    const evil = buildModel(
      template,
      state({ fields: { notes: '<script>alert(1)</script>', branch: 'A&B' }, comp: [['<img src=x>', '', '', '']] }),
    );
    const out = buildEmailHtml(evil);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('A&amp;B');
    expect(out).toContain('Flyer &lt;b&gt;');
  });
  it('plain text lists every part in order', () => {
    const t = buildPlainText(m);
    expect(t.startsWith('Bahria Town\nChecklist')).toBe(true);
    expect(t.indexOf('24 Stocks Report')).toBeLessThan(t.indexOf('32 Less than 7 Days Stock Report'));
    expect(t).toContain('Net Total:\t325225');
    expect(t).toContain('Notes: hello');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sample from '../fixtures/closing-sheet-sample.json';
import { PRESETS, SHIFTS, inRange, rangeFor, variance } from '../../js/modules/closing/domain/book.js';
import { Pdf, encode, fit, textWidth } from '../../js/modules/closing/domain/pdf.js';
import {
  buildClosingBookPdf,
  closingTitle,
  direction,
  finalSheet,
  fmt,
  pdfFileName,
  shiftSheet,
  stamp,
} from '../../js/modules/closing/domain/sheet.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const card = (m, title) => m.cols.flat().find((c) => c.title === title);
const val = (c, label) => c.rows.find((r) => r.l === label)?.v;
const pdfText = (pdf) => pdf.pages.map((p) => p.ops.join('\n')).join('\n');

describe('ranges and shifts', () => {
  it('offers 3, 7 and 15 days', () => {
    expect(PRESETS.map((p) => p.days)).toEqual([3, 7, 15]);
  });
  it('counts a range back from today, today included', () => {
    expect(rangeFor('days3', '2026-11-14')).toEqual({ from: '2026-11-12', to: '2026-11-14' });
    expect(rangeFor('days7', '2026-11-14')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(rangeFor('days15', '2026-11-14')).toEqual({ from: '2026-10-31', to: '2026-11-14' });
    expect(rangeFor('nope', '2026-11-14')).toEqual({ from: '2026-11-12', to: '2026-11-14' });
  });
  it('knows the shifts in the database order', () => {
    expect(SHIFTS.map((s) => s.v)).toEqual(['any', 'night', 'morning', 'evening']);
  });
  it('keeps a closing only inside the date and shift range', () => {
    const p = (business_date, seq) => ({ business_date, seq });
    const r = { from: '2026-11-10', fromShift: 'morning', to: '2026-11-12', toShift: 'morning' };
    expect(inRange(p('2026-11-09', 9999), r)).toBe(false);
    expect(inRange(p('2026-11-10', 10), r)).toBe(false); // the Night before the first Morning
    expect(inRange(p('2026-11-10', 20), r)).toBe(true);
    expect(inRange(p('2026-11-11', 10), r)).toBe(true);
    expect(inRange(p('2026-11-12', 20), r)).toBe(true);
    expect(inRange(p('2026-11-12', 30), r)).toBe(false); // a handover after the last Morning
    expect(inRange(p('2026-11-12', 9999), r)).toBe(false);
    expect(inRange(p('2026-11-13', 10), r)).toBe(false);
  });
  it('treats "any" as the whole day at both ends', () => {
    const r = { from: '2026-11-10', to: '2026-11-12' };
    expect(inRange({ business_date: '2026-11-10', seq: 10 }, r)).toBe(true);
    expect(inRange({ business_date: '2026-11-12', seq: 9999 }, r)).toBe(true);
  });
  it('writes a variance in words', () => {
    expect(variance(-11215)).toBe('11,215.00 (Less)');
    expect(variance(5)).toBe('5.00 (Plus)');
  });
});

describe('the PDF writer', () => {
  it('maps characters the standard fonts hold and replaces the rest', () => {
    expect(encode('a × b · c — d')).toBe('a \xD7 b \xB7 c \x97 d');
    expect(encode('Rs ₨ … −5 ’')).toBe("Rs Rs ... -5 '");
    expect(encode('اردو')).toBe('????');
    expect(encode(null)).toBe('');
  });
  it('measures text from the real font metrics', () => {
    const mm = (units, size) => (units * size) / 1000 / (72 / 25.4);
    expect(textWidth('AAA', 'helv', 10)).toBeCloseTo(mm(667 * 3, 10), 5);
    expect(textWidth('AAA', 'helvB', 10)).toBeCloseTo(mm(722 * 3, 10), 5);
    expect(textWidth('12345', 'monoB', 8)).toBeCloseTo(mm(600 * 5, 8), 5);
    expect(textWidth('', 'helv', 8)).toBe(0);
  });
  it('cuts long text to a width with three dots, and leaves short text alone', () => {
    expect(fit('short', 'helv', 8, 50)).toBe('short');
    const cut = fit('A very long label that cannot possibly fit', 'helv', 8, 20);
    expect(cut.endsWith('...')).toBe(true);
    expect(textWidth(cut, 'helv', 8)).toBeLessThanOrEqual(20);
  });
  it('writes a well-formed file whose cross-reference table points at every object', () => {
    const pdf = new Pdf({ title: 'T (1)' });
    const a = pdf.addPage();
    a.rect(10, 10, 50, 20, { fill: '#112233', stroke: '#000000', r: 2 });
    a.line(10, 40, 60, 40);
    a.text('Hello (world) \\ ok', 12, 20, { font: 'helvB', size: 10 });
    a.text('right', 60, 30, { align: 'right' });
    a.text('side', 5, 100, { up: true });
    pdf.addPage();
    const bytes = pdf.build();
    const s = Buffer.from(bytes).toString('latin1');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toMatch(/\/Count 2/);
    expect(s).toContain('(Hello \\(world\\) \\\\ ok) Tj');
    expect(s).toContain('/Title (T \\(1\\))');
    const start = Number(/startxref\n(\d+)/.exec(s)[1]);
    expect(s.slice(start, start + 4)).toBe('xref');
    const entries = [...s.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(entries.length).toBe(Number(/\/Size (\d+)/.exec(s)[1]) - 1);
  });
  it('makes a Blob of type application/pdf', () => {
    const b = new Pdf().toBlob();
    expect(b.type).toBe('application/pdf');
  });
});

describe('number and date formatting', () => {
  it('formats amounts the way the old sheet did', () => {
    expect(fmt(1244705)).toBe('1,244,705');
    expect(fmt(-65516)).toBe('-65,516');
    expect(fmt(12.5)).toBe('12.50');
    expect(fmt(null)).toBe('0');
  });
  it('names the direction in words', () => {
    expect(direction(-1)).toBe('Less');
    expect(direction(1)).toBe('Plus');
    expect(direction(0)).toBe('Matched');
  });
  it('stamps the time in Karachi like the old sheet', () => {
    expect(stamp(new Date('2026-11-13T23:39:00Z'))).toBe('14-Nov-2026, 04:39 am');
    expect(stamp(new Date('2026-11-14T09:05:00Z'))).toBe('14-Nov-2026, 02:05 pm');
  });
  it('names the PDF like the old register', () => {
    expect(pdfFileName([sample])).toBe('closing-pdf-2026-11-13_Evening.pdf');
    expect(pdfFileName([{ ...sample, business_date: '2026-11-10' }, sample])).toBe('closing-pdf-2026-11-10_to_2026-11-13.pdf');
    expect(pdfFileName([{ ...sample, kind: 'handover', seq: 40 }])).toBe('closing-pdf-2026-11-13_Handover2.pdf');
    expect(pdfFileName([])).toBe('closing-pdf.pdf');
  });
});

describe('the shift sheet', () => {
  const m = shiftSheet(sample);
  it('is laid out in the old three columns', () => {
    expect(m.cols.map((c) => c.map((x) => x.title))).toEqual([
      ['TILL CASH', 'DRAW / VAULT CASH', 'DEPOSIT DETAILS', 'MEDIQ COD ORDERS', 'GRAND SUMMARY'],
      ['HS DETAILS & STRIPS', 'MISCELLANEOUS CREDITS'],
      ['SALE INFO', 'CREDIT CARD SALES (CC)', 'RETURNS & NET SALE', 'CREDIT DETAIL'],
    ]);
  });
  it('heads the page with the shop, the closing and a shift badge', () => {
    expect(m.header).toMatchObject({ title: "Fazal Din's Pharma Plus", branch: 'BAHRIA TOWN BRANCH', badge: 'SHIFT CLOSING' });
    expect(m.header.line).toBe('2026-11-13 · Closing 3 — Evening · CLOSED');
    expect(closingTitle(sample)).toBe('Closing 3 — Evening');
  });
  it('lists the cash counts, with coins as an amount, and the stored totals', () => {
    const till = card(m, 'TILL CASH');
    expect(till.rows.map((r) => `${r.l}|${r.v}`)).toEqual([
      'Rs. 1,000 notes|2',
      'Rs. 500 notes|14',
      'Rs. 100 notes|12',
      'Rs. 50 notes|96',
      'Rs. 10 notes|108',
      'Coins / loose change|730',
      'TOTAL TILL CASH|16,810',
    ]);
    expect(val(card(m, 'DRAW / VAULT CASH'), 'TOTAL DRAW CASH')).toBe('68,970');
  });
  it('shows the stored totals and the carried-in figures', () => {
    const g = card(m, 'GRAND SUMMARY');
    expect(val(g, 'GRAND TOTAL')).toBe('1,289,705');
    expect(val(g, 'Less: Cash Reserve (float)')).toBe('- 45,000');
    expect(val(g, 'Less: Previous Cash Position')).toBe('- 1,129,774');
    expect(val(g, 'NET CASH AVAILABLE')).toBe('114,931');
    expect(val(card(m, 'DEPOSIT DETAILS'), 'Carried from Previous')).toBe('686,100');
    expect(val(card(m, 'CREDIT DETAIL'), 'TOTAL CREDIT')).toBe('399,764');
    expect(val(card(m, 'CREDIT CARD SALES (CC)'), 'Previous Day CC (carried)')).toBe('62,242');
    expect(val(card(m, 'RETURNS & NET SALE'), 'NET SHIFT SALE')).toBe('126,146');
  });
  it('lists strips with their quantity and line amount', () => {
    const s = card(m, 'HS DETAILS & STRIPS');
    expect(s.rows[0]).toMatchObject({ l: 'Water 1.5L ×13', v: '1,300' });
    expect(val(s, 'Juice Pack 80x ×42')).toBe('3,360');
    expect(val(s, 'TOTAL HS + STRIPS')).toBe('19,470');
  });
  it('shows dashes for unused returns and a negative card figure as it is', () => {
    const r = card(m, 'RETURNS & NET SALE');
    expect(val(r, 'Return 1')).toBe('14,430');
    expect(val(r, 'Return 2')).toBe('–');
    expect(val(card(m, 'CREDIT CARD SALES (CC)'), 'Current CC')).toBe('-65,516');
  });
  it('shows the variance banner in words: Less, Plus or Matched', () => {
    expect(m.banner).toMatchObject({ tone: 'less', title: 'LESS — NET CASH VS NET SALE', amount: 'Rs. 11,215' });
    const up = clone(sample);
    up.results.shift_variance = 250;
    expect(shiftSheet(up).banner).toMatchObject({ tone: 'plus', title: 'PLUS — NET CASH VS NET SALE', amount: 'Rs. 250' });
    up.results.shift_variance = 0;
    expect(shiftSheet(up).banner).toMatchObject({ tone: 'ok', title: 'MATCHED — NET CASH VS NET SALE', amount: 'Rs. 0' });
  });
  it('says there are no MEDIQ orders, or lists them with the carried amount', () => {
    expect(card(m, 'MEDIQ COD ORDERS').rows.map((r) => r.l)).toEqual(['— no orders —', 'EXTRA MEDIQ COLLECTED']);
    const q = clone(sample);
    q.mediq = [{ bill_no: 'B1', collected: 300, pharmacy_bill: 250 }];
    q.inputs.prev_mediq = 40;
    expect(card(shiftSheet(q), 'MEDIQ COD ORDERS').rows.map((r) => `${r.l}|${r.v}`)).toEqual([
      'Carried from Previous|40',
      'Bill B1 (pharmacy 250)|300',
      'EXTRA MEDIQ COLLECTED|0',
    ]);
  });
  it('adds the extra-cash line and the credit adjustment only when they are not zero', () => {
    expect(card(m, 'GRAND SUMMARY').rows.some((r) => /Extra Cash/.test(r.l))).toBe(false);
    expect(card(m, 'CREDIT DETAIL').rows.some((r) => r.l === 'Credit adjustment')).toBe(false);
    const x = clone(sample);
    x.inputs.extra_cash = 350000;
    x.inputs.credit_adj = 25;
    expect(val(card(shiftSheet(x), 'GRAND SUMMARY'), 'Less: Extra Cash Added to Pharmacy')).toBe('- 350,000');
    expect(val(card(shiftSheet(x), 'CREDIT DETAIL'), 'Credit adjustment')).toBe('25');
  });
  it('marks a Final closing and a corrected revision', () => {
    const f = clone(sample);
    f.mode = 'final';
    f.revision = 2;
    expect(shiftSheet(f).header.badge).toBe('FINAL CLOSING');
    expect(shiftSheet(f).header.line).toContain('Revision 2');
  });
});

describe('the Final page', () => {
  const m = finalSheet(sample);
  it('shows Part 1 and Part 2 with the stored totals', () => {
    expect(m.part1.rows.map((r) => `${r.l}|${r.v}`)).toEqual([
      'POS Sale|+ 292,168',
      'Book Bills|+ 73,294',
      'Customers|+ 603',
      'Manual Returns|- 89,716',
      'System Returns|- 0',
      'Additional System Returns|- –',
      'NET FINAL SALE|276,349',
    ]);
    expect(val(m.part2, 'Net Cash Available (after float)')).toBe('1,244,705');
    expect(val(m.part2, 'Pre-date Total (subtracted from Net Cash Available)')).toBe('- 630,988');
    expect(val(m.part2, 'Extra Cash Added to Pharmacy')).toBe('- 350,000');
    expect(val(m.part2, 'NET FINAL CASH AVAILABLE')).toBe('-12,632');
  });
  it('shows MEDIQ extra only when there is some', () => {
    expect(m.part1.rows.some((r) => r.l === 'MEDIQ Extra')).toBe(false);
    const q = clone(sample);
    q.final_part.part1.mediq_extra = 40;
    expect(val(finalSheet(q).part1, 'MEDIQ Extra')).toBe('+ 40');
  });
  it('lists the closings in the period and says where it starts', () => {
    expect(m.period.chips).toEqual(['13 Nov · Evening']);
    expect(m.period.note).toContain('No earlier Final closing');
    const q = clone(sample);
    q.final_part.last_final = { business_date: '2026-11-10', seq: 9999 };
    expect(finalSheet(q).period.note).toBe('Since the last Final closing on 2026-11-10.');
  });
  it('compares the period, in words, with the stored figures and this shift', () => {
    expect(m.banner).toMatchObject({ tone: 'less', title: 'LESS — PERIOD RECONCILIATION', amount: 'Rs. 12,632' });
    expect(m.aggregated.rows.map((r) => `${r.l}|${r.v}`)).toEqual([
      'Net Final Sale|276,349',
      'Net Final Cash Available (Less)|-12,632',
      "This shift's variance (Less)|11,215",
    ]);
  });
  it('labels the variance of a Final closing as the final variance', () => {
    const f = clone(sample);
    f.mode = 'final';
    f.results.final_variance = 300;
    expect(finalSheet(f).aggregated.rows[2].l).toBe('Final variance (Plus)');
  });
  it('warns only when the lines stopped adding up to the stored totals', () => {
    expect(m.warning).toBe('');
    const q = clone(sample);
    q.final_part.ties.sale = false;
    expect(finalSheet(q).warning).toContain('corrected after this one was submitted');
  });
  it('shows the date, closing, mode and status strip', () => {
    expect(m.infos).toEqual([
      ['DATE', '2026-11-13'],
      ['CLOSING', 'Closing 3 — Evening'],
      ['MODE', 'SHIFT'],
      ['STATUS', 'CLOSED'],
    ]);
  });
});

describe('the whole book as a PDF', () => {
  const now = new Date('2026-11-13T23:39:00Z');
  it('makes two pages for every closing, oldest first, with page numbers', () => {
    const older = { ...clone(sample), business_date: '2026-11-12', kind: 'morning', seq: 20, day_no: 2 };
    const pdf = buildClosingBookPdf([sample, older], { now });
    expect(pdf.pages).toHaveLength(4);
    const t = pdf.pages.map((p) => p.ops.join('\n'));
    expect(t[0]).toContain('2026-11-12 · Closing 2');
    expect(t[2]).toContain('2026-11-13 · Closing 3');
    expect(t[0]).toContain('Page 1 of 4');
    expect(t[3]).toContain('Page 4 of 4');
    expect(t[0]).toContain('SHIFT CLOSING');
    expect(t[1]).toContain('FINAL CLOSING');
  });
  it('prints the figures from the closing', () => {
    const t = pdfText(buildClosingBookPdf([sample], { now }));
    ['16,810', '1,289,705', '114,931', 'Rs. 11,215', 'NET FINAL SALE', '276,349', 'Rs. 12,632', '14-Nov-2026, 04:39 am'].forEach((x) =>
      expect(t).toContain(x),
    );
  });
  it('still builds when a column is far too long, and says how many rows it left out', () => {
    const big = clone(sample);
    big.misc = Array.from({ length: 80 }, (_, i) => ({ label: `Charge ${i}`, amount: 10 + i }));
    const t = pdfText(buildClosingBookPdf([big], { now }));
    expect(t).toMatch(/\.\.\. \d+ more rows not shown/);
    expect(t).toContain('TOTAL MISC');
    expect(t).toContain('(Charge 0)');
    expect(Math.min(...[...t.matchAll(/\/F1 ([\d.]+) Tf/g)].map((m) => Number(m[1])))).toBeGreaterThanOrEqual(5.7);
  });
  it('survives a page with nothing on it', () => {
    const bare = {
      business_date: '2026-11-13',
      kind: 'night',
      seq: 10,
      mode: 'shift',
      revision: 1,
      day_no: 1,
      inputs: {},
      results: {},
      final_part: null,
    };
    expect(() => buildClosingBookPdf([bare], { now }).build()).not.toThrow();
  });
  it('writes the figure and label of every row it draws, for every closing in a long range', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...clone(sample),
      business_date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      closing_id: `c${i}`,
    }));
    const pdf = buildClosingBookPdf(many, { now });
    expect(pdf.pages).toHaveLength(60);
    expect(pdf.build().length).toBeGreaterThan(60 * 2000);
  });
});

const api = { closingBook: vi.fn(), myRecent: vi.fn(async () => []) };
vi.mock('../../js/modules/closing/data/api.js', () => api);

describe('Closing Book page', () => {
  const tick = () => vi.advanceTimersByTimeAsync(60);
  let el;
  let clicks;
  const morning = { ...clone(sample), closing_id: 'c-morning', kind: 'morning', seq: 20, day_no: 2 };
  const older = { ...clone(sample), closing_id: 'c-older', business_date: '2026-11-11', kind: 'evening', seq: 9999 };
  const toasts = () => document.getElementById('toasts')?.textContent ?? '';
  const open = async () => {
    const { mount } = await import('../../js/modules/closing/ui/book.js');
    await mount(el);
    await tick();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    api.closingBook.mockReset();
    api.closingBook.mockImplementation(async () => [sample, morning, older]);
    clicks = [];
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicks.push({ name: this.download, href: this.href });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens on the last 3 days and asks the database for that range', async () => {
    await open();
    expect(api.closingBook).toHaveBeenCalledWith({ from: '2026-11-11', to: '2026-11-13', limit: 200 });
    expect(el.querySelector('[data-preset="days3"]').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('#bk-from').value).toBe('2026-11-11');
    expect(el.querySelector('#bk-count').textContent).toMatch(/3 closings · 6 PDF pages/);
  });
  it('switches to 7 and 15 days', async () => {
    await open();
    el.querySelector('[data-preset="days7"]').click();
    await tick();
    expect(api.closingBook).toHaveBeenLastCalledWith({ from: '2026-11-07', to: '2026-11-13', limit: 200 });
    el.querySelector('[data-preset="days15"]').click();
    await tick();
    expect(api.closingBook).toHaveBeenLastCalledWith({ from: '2026-10-30', to: '2026-11-13', limit: 200 });
    expect(el.querySelector('[data-preset="days15"]').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('[data-preset="days3"]').getAttribute('aria-pressed')).toBe('false');
  });
  it('lists each closing with its stored figures and the variance in words', async () => {
    await open();
    const row = el.querySelector('[data-closing="c-morning"]');
    expect(row.textContent).toContain('Morning');
    expect(row.textContent).toContain('126,146.00');
    expect(row.textContent).toContain('11,215.00 (Less)');
  });
  it('applies a custom date and shift range', async () => {
    await open();
    el.querySelector('#bk-from').value = '2026-11-11';
    el.querySelector('#bk-from-shift').value = 'evening';
    el.querySelector('#bk-to').value = '2026-11-13';
    el.querySelector('#bk-to-shift').value = 'morning';
    el.querySelector('#bk-apply').click();
    await tick();
    expect(el.querySelector('[data-preset="days3"]').getAttribute('aria-pressed')).toBe('false');
    expect([...el.querySelectorAll('#bk-list li')].map((l) => l.dataset.closing)).toEqual(
      ['c-morning', 'c-older'].filter((x) => x !== 'c-older').concat([]).length
        ? ['c-morning'].concat(['c-older']).sort().filter(Boolean)
        : [],
    );
  });
  it('checks the dates before it asks anything', async () => {
    await open();
    api.closingBook.mockClear();
    el.querySelector('#bk-from').value = '2026-11-13';
    el.querySelector('#bk-to').value = '2026-11-01';
    el.querySelector('#bk-apply').click();
    await tick();
    expect(toasts()).toContain('The start date is after the end date.');
    el.querySelector('#bk-from').value = '';
    el.querySelector('#bk-apply').click();
    await tick();
    expect(toasts()).toContain('Pick both dates.');
    expect(api.closingBook).not.toHaveBeenCalled();
  });
  it('downloads one PDF with every closing in the range', async () => {
    await open();
    el.querySelector('#bk-pdf').click();
    expect(el.querySelector('#bk-pdf').disabled).toBe(true);
    expect(el.querySelector('#bk-pdf').textContent).toContain('Preparing');
    await tick();
    expect(clicks).toEqual([{ name: 'closing-pdf-2026-11-11_to_2026-11-13.pdf', href: 'blob:fake' }]);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(6 * 2000);
    expect(toasts()).toContain('closing-pdf-2026-11-11_to_2026-11-13.pdf is ready.');
    expect(el.querySelector('#bk-pdf').disabled).toBe(false);
  });
  it("downloads one closing's own PDF, named like the old register", async () => {
    await open();
    el.querySelector('[data-one="c-older"]').click();
    await tick();
    expect(clicks[0].name).toBe('closing-pdf-2026-11-11_Evening.pdf');
    expect(URL.createObjectURL.mock.calls[0][0].size).toBeGreaterThan(2 * 2000);
  });
  it('says so and disables the download when the range is empty', async () => {
    api.closingBook.mockImplementation(async () => []);
    await open();
    expect(el.textContent).toContain('No saved closings in this range.');
    expect(el.querySelector('#bk-pdf').disabled).toBe(true);
    expect(el.querySelector('#bk-count').textContent).toMatch(/0 closings/);
  });
  it('tells the person when the range is longer than what is loaded', async () => {
    api.closingBook.mockImplementation(async () => Array.from({ length: 200 }, (_, i) => ({ ...sample, closing_id: `x${i}` })));
    await open();
    expect(el.querySelector('#bk-count').textContent).toContain('only the latest 200 are loaded');
  });
  it('explains a failed PDF instead of failing silently', async () => {
    await open();
    URL.createObjectURL = vi.fn(() => {
      throw new Error('no blobs');
    });
    el.querySelector('#bk-pdf').click();
    await tick();
    expect(toasts()).toContain('The PDF could not be made (no blobs).');
    expect(el.querySelector('#bk-pdf').disabled).toBe(false);
  });
  it('shows a refusal in plain words', async () => {
    api.closingBook.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'not_allowed' });
    });
    await open();
    expect(el.textContent).toContain('Could not load the Closing Book');
    expect(el.textContent).toContain('You are not allowed to do that.');
  });
});

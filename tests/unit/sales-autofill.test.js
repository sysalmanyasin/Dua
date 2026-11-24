import { describe, expect, it } from 'vitest';
import { applyAutofill, buildAutofill, isNotAllowed, matchClient, nameTokens } from '../../js/modules/sales/domain/autofill.js';

const M = (code, label, section, sign = 'add') => ({ code, label, section, sign, sort: 1, show_in_entry: true });
const METHODS = [
  M('cash_sale', 'Cash Sale', 'Cash'),
  M('cash_returns', 'Cash Returns', 'Cash', 'sub'),
  M('bank_alfalah', 'Bank Alfalah', 'Banks'),
  M('bank_al_habib', 'Bank Al Habib', 'Banks'),
  M('c_bank_alfalah_2', 'Bank Alfalah 2', 'Banks'),
  M('askari_bank', 'Askari', 'Credit Clients'),
  M('askari_returns', 'Askari Returns', 'Credit Clients', 'sub'),
  M('pso', 'PSO', 'Credit Clients'),
  M('parco', 'PARCO', 'Credit Clients'),
  M('lda', 'LDA', 'Credit Clients'),
  M('syed_babar_ali', 'Syed Babar Ali Foundation', 'Credit Clients'),
];
const CLOSING = { sys_cash: '207202.00', alfalah: '46451.00', keenu: '116020.00' };
const CANDELA = {
  payments: { cash_sale: '178128.42', card_sale: '255872.93', credit_sale: '11408.46', total_sale: '445409.81' },
  credit: [
    { name: 'Askari General Insurance Company Ltd.', amount: '7360.32', receipts: 2 },
    { name: 'PARCO', amount: '4048.14', receipts: 2 },
  ],
};
const build = (src, methods = METHODS, why) => buildAutofill(src, methods, why);

describe('auto-pull: the 23 Nov 2026 day', () => {
  const r = build({ closing: CLOSING, candela: CANDELA });
  it('takes cash and the two card machines from the evening closing', () => {
    expect(r.values.cash_sale).toBe('207202');
    expect(r.values.bank_alfalah).toBe('46451');
    expect(r.values.c_bank_alfalah_2).toBe('116020');
  });
  it('Cash Returns = system cash minus Candela cash rounded to the rupee (207202 − 178128 = 29074)', () => {
    expect(r.values.cash_returns).toBe('29074');
  });
  it('Comp Sale is Candela’s total rounded to the rupee', () => {
    expect(r.header.comp_sale).toBe('445410');
  });
  it('credit comes from Candela by customer, to the paisa', () => {
    expect(r.values.askari_bank).toBe('7360.32');
    expect(r.values.parco).toBe('4048.14');
  });
  it('leaves everything it has no figure for alone, and has nothing to warn about', () => {
    expect(Object.keys(r.values).sort()).toEqual(['askari_bank', 'bank_alfalah', 'c_bank_alfalah_2', 'cash_returns', 'cash_sale', 'parco']);
    expect(r.notes).toEqual([]);
    expect(r.unmatched).toEqual([]);
  });
});

describe('auto-pull: one source missing', () => {
  it('without the closing, fills credit and Comp Sale but no cash, banks or returns', () => {
    const r = build({ closing: null, candela: CANDELA });
    expect(r.values).toEqual({ askari_bank: '7360.32', parco: '4048.14' });
    expect(r.header.comp_sale).toBe('445410');
    expect(r.notes.join(' ')).toMatch(/No saved evening closing/);
  });
  it('without Candela, fills cash and card machines but no returns, credit or Comp Sale', () => {
    const r = build({ closing: CLOSING, candela: null });
    expect(r.values).toEqual({ cash_sale: '207202', bank_alfalah: '46451', c_bank_alfalah_2: '116020' });
    expect(r.header).toEqual({});
    expect(r.notes.join(' ')).toMatch(/Candela has sent nothing/);
  });
  it('says why a source could not be read instead of “nothing yet”', () => {
    const r = build({ closing: CLOSING, candela: null }, METHODS, { candela: 'You do not have access to Candela figures.' });
    expect(r.notes).toEqual(['You do not have access to Candela figures.']);
  });
  it('a Candela day with credit rows but no payment summary still fills credit', () => {
    const r = build({ closing: null, candela: { payments: null, credit: CANDELA.credit } });
    expect(r.values.parco).toBe('4048.14');
    expect(r.header).toEqual({});
  });
});

describe('auto-pull: cash returns', () => {
  it('is left empty, with a warning, when Candela’s cash is higher than the closing’s', () => {
    const r = build({ closing: { ...CLOSING, sys_cash: '100000' }, candela: CANDELA });
    expect(r.values.cash_returns).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/Candela’s cash is higher/);
  });
  it('is a real zero when the two agree', () => {
    const r = build({ closing: { ...CLOSING, sys_cash: '178128' }, candela: CANDELA });
    expect(r.values.cash_returns).toBe('0');
  });
});

describe('auto-pull: matching Candela customers to our fields', () => {
  const clients = METHODS.filter((m) => m.section === 'Credit Clients' && m.sign === 'add');
  it('ignores company words, case and punctuation', () => {
    expect(nameTokens('Askari General Insurance Company Ltd.')).toEqual(['askari', 'general', 'insurance']);
    expect(matchClient('PARCO', clients).code).toBe('parco');
    expect(matchClient('  parco  ', clients).code).toBe('parco');
    expect(matchClient('Syed Babar Ali Foundation', clients).code).toBe('syed_babar_ali');
  });
  it('a field whose words all appear in the customer name matches', () => {
    expect(matchClient('Askari General Insurance Company Ltd.', clients).code).toBe('askari_bank');
  });
  it('never targets a returns field', () => {
    expect(matchClient('Askari Returns Ltd', clients).code).toBe('askari_bank');
    expect(clients.some((c) => c.code === 'askari_returns')).toBe(false);
  });
  it('Lahore Development Authority is LDA and Pakistan State Oil is PSO', () => {
    expect(matchClient('Lahore Development Authority', clients).code).toBe('lda');
    expect(matchClient('LAHORE DEVELOPMENT AUTHORITY (LDA)', clients).code).toBe('lda');
    expect(matchClient('Pakistan State Oil Co. Ltd.', clients).code).toBe('pso');
    expect(matchClient('PSO', clients).code).toBe('pso');
    const r = build({
      closing: null,
      candela: {
        payments: null,
        credit: [
          { name: 'Pakistan State Oil Company Limited', amount: '2500' },
          { name: 'Lahore Development Authority', amount: '900.5' },
        ],
      },
    });
    expect(r.values).toMatchObject({ pso: '2500', lda: '900.5' });
    expect(r.unmatched).toEqual([]);
  });
  it('a name with no matching field is reported, not guessed', () => {
    const r = build({ closing: null, candela: { payments: null, credit: [{ name: 'Wapda Hospital Lahore', amount: '1500.5' }] } });
    expect(r.values).toEqual({});
    expect(r.unmatched).toEqual([{ name: 'Wapda Hospital Lahore', amount: 1500.5 }]);
    expect(r.notes.join(' ')).toMatch(/matched no field/);
  });
  it('an equally good pair of fields is ambiguous, so nothing is guessed', () => {
    const two = [M('a', 'Ali Traders', 'Credit Clients'), M('b', 'Ali Brothers', 'Credit Clients')];
    expect(matchClient('Ali Traders Brothers', two)).toBeNull();
  });
  it('the more specific field wins over a shorter one', () => {
    const two = [M('a', 'Askari', 'Credit Clients'), M('b', 'Askari Insurance', 'Credit Clients')];
    expect(matchClient('Askari General Insurance Ltd', two).code).toBe('b');
  });
  it('two Candela customers for one field are added together', () => {
    const r = build({
      closing: null,
      candela: {
        payments: null,
        credit: [
          { name: 'PARCO', amount: '100.10' },
          { name: 'PARCO Pearl Pvt Ltd', amount: '50.05' },
        ],
      },
    });
    expect(r.values.parco).toBe('150.15');
  });
  it('a zero or missing amount is skipped', () => {
    const r = build({
      closing: null,
      candela: {
        payments: null,
        credit: [
          { name: 'PARCO', amount: '0' },
          { name: 'PSO', amount: null },
        ],
      },
    });
    expect(r.values).toEqual({});
    expect(r.unmatched).toEqual([]);
  });
});

describe('auto-pull: fields that do not exist', () => {
  it('says so when there is no Bank Alfalah 2 field, and fills the rest', () => {
    const r = build(
      { closing: CLOSING, candela: CANDELA },
      METHODS.filter((m) => m.code !== 'c_bank_alfalah_2'),
    );
    expect(r.values.c_bank_alfalah_2).toBeUndefined();
    expect(r.values.bank_alfalah).toBe('46451');
    expect(r.notes.join(' ')).toMatch(/Bank Alfalah 2/);
  });
  it('finds Bank Alfalah 2 by its name whatever code it was given', () => {
    const r = build({ closing: CLOSING, candela: null }, [
      ...METHODS.filter((m) => m.code !== 'c_bank_alfalah_2'),
      M('whatever_code', 'bank  alfalah 2', 'Banks'),
    ]);
    expect(r.values.whatever_code).toBe('116020');
  });
});

describe('applying a result to the form', () => {
  const result = build({ closing: CLOSING, candela: CANDELA });
  it('a manual pull overwrites the fields it fills and leaves the others', () => {
    const form = { values: { cash_sale: '1', pso: '99' }, header: { comp_sale: '5' }, reason: '' };
    const n = applyAutofill(form, result, { overwrite: true });
    expect(form.values.cash_sale).toBe('207202');
    expect(form.values.pso).toBe('99');
    expect(form.header.comp_sale).toBe('445410');
    expect(n).toBe(7);
  });
  it('the automatic pull never replaces what the person already typed', () => {
    const form = { values: { cash_sale: '1' }, header: {}, reason: '' };
    applyAutofill(form, result, { overwrite: false });
    expect(form.values.cash_sale).toBe('1');
    expect(form.values.bank_alfalah).toBe('46451');
  });
});

describe('permission errors', () => {
  it('recognises the database refusal', () => {
    expect(isNotAllowed({ code: '42501' })).toBe(true);
    expect(isNotAllowed({ message: 'not allowed' })).toBe(true);
    expect(isNotAllowed({ message: 'network down' })).toBe(false);
    expect(isNotAllowed(null)).toBe(false);
  });
});

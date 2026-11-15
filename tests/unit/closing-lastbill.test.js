// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyForm, formFromRow, payloadFromForm } from '../../js/modules/closing/domain/form.js';
import { snapshotRows } from '../../js/modules/closing/domain/snapshot.js';

describe('Last Bill Amount', () => {
  it('is typed, sent to the database and read back', () => {
    const f = emptyForm();
    f.last_bill_amt = '1,250.50';
    expect(payloadFromForm(f).payload.last_bill_amt).toBe(1250.5);
    expect(formFromRow({ last_bill_amt: 980 }).last_bill_amt).toBe('980');
  });
  it('appears in the previous-shift POS rows', () => {
    const rows = snapshotRows('pos', { inputs: { last_bill_no: 12, last_bill_amt: 980 }, results: {} });
    expect(rows.find((r) => r[0] === 'Last Bill Amount')?.[1]).toContain('980');
  });
});

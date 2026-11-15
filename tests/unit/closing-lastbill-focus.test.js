// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { emptyForm, formFromRow, payloadFromForm } from '../../js/modules/closing/domain/form.js';
import { snapshotRows } from '../../js/modules/closing/domain/snapshot.js';
import { startShell } from '../../js/core/shell.js';

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

describe('Closing-only shell', () => {
  const mk = (id, title, path) => ({
    id,
    title,
    icon: 'shield',
    routes: [{ path, title, load: async () => ({ mount: () => {} }) }],
  });
  it('shows no other module tabs and lands inside Closing', () => {
    const root = document.createElement('div');
    location.hash = '';
    const stop = startShell(root, { permissions: [], modules_disabled: [], full_name: 'T', role: 'admin' }, [
      mk('home', 'Home', '/home'),
      mk('closing', 'Closing', '/closing'),
    ]);
    expect(root.querySelector('.tabs').hidden).toBe(true);
    expect(root.querySelector('.tabs').textContent).not.toContain('Home');
    expect(location.hash).toBe('#/closing');
    stop();
  });
});

import { describe, expect, it, vi } from 'vitest';

// Records the select string each read uses, so a section the form reads can never be left out of the query again.
const selects = [];
vi.mock('../../js/core/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: (cols) => {
        selects.push(cols);
        const q = { eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
        return q;
      },
    }),
  }),
}));

describe('closing draft query', () => {
  it('loads every child table that formFromRow reads, so a reopened draft is not blank', async () => {
    const api = await import('../../js/modules/closing/data/api.js');
    await api.loadById('c1');
    await api.loadByKey('k1');
    const form = await import('../../js/modules/closing/domain/form.js');
    const body = form.formFromRow.toString();
    const tables = [...new Set(body.match(/row\.(closing_[a-z_]+)/g) ?? [])].map((m) => m.slice(4));
    expect(tables.length).toBeGreaterThan(5);
    for (const sel of selects) for (const t of tables) expect(sel).toContain(`${t}(`);
    for (const t of ['closing_cash_counts', 'closing_credit_lines', 'closing_deposits']) expect(tables).toContain(t);
  });
});

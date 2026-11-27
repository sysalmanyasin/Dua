// KNOWN DEFECT KI-2 (docs/KNOWN_ISSUES.md). `it.fails` passes while the defect exists and turns red the day it is fixed, which is the
// signal to change `it.fails` to `it` and close KI-2. The database function public.invoice_desk_amount_words behaves the same way
// (supabase/tests/1002_invoice_desk_amount_words_fix_test.sql), and the two must be fixed together or the invoice guard trigger rejects saves.
import { describe, expect, it } from 'vitest';
import { amountInWords } from '../../js/modules/invoice-desk/domain/amount-in-words.js';

describe('KI-2: amount in words below one rupee', () => {
  it.fails('has no empty leading word (no leading or double space)', () => {
    for (const paisa of [1, 5, 50, 99]) expect(amountInWords(paisa)).not.toMatch(/^\s|\s\s/);
  });
  it('still ends with the paisa words and "Only" (this part is correct today)', () => {
    expect(amountInWords(50)).toMatch(/Fifty Paisa Only$/);
    expect(amountInWords(1)).toMatch(/One Paisa Only$/);
  });
  it('whole-rupee amounts are unaffected', () => {
    expect(amountInWords(0)).toBe('Zero Pakistani Rupees Only');
    expect(amountInWords(100)).toBe('One Pakistani Rupees Only');
    expect(amountInWords(150)).toBe('One Pakistani Rupees And Fifty Paisa Only');
  });
});

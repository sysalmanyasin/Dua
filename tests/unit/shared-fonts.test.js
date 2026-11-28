import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONTS, fontKeys, stack } from '../../js/shared/fonts.js';

const css = readFileSync('css/fonts.css', 'utf8');
describe('shared font library', () => {
  it('every registered bundled family is declared in fonts.css with files that exist', () => {
    const files = [...css.matchAll(/url\('\.\.\/(vendor\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(existsSync(f), f).toBe(true);
    for (const key of fontKeys()) {
      const first = FONTS[key].stack.split(',')[0].replace(/'/g, '').trim();
      expect(css, key).toContain(`font-family: '${first}'`);
    }
  });
  it('falls back to Inter for an unknown key', () => {
    expect(stack('nope')).toBe(FONTS.inter.stack);
  });
});

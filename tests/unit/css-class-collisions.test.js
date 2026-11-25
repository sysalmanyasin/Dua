import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A bare `.sr` rule in css/ebill.css (a clipped 1px "screen reader only" box) once collapsed the Sale Report,
// which uses `.sr` for its report container. Every stylesheet is loaded on every page, so a bare class is global.
describe('stylesheets', () => {
  it('define the bare .sr class only in sales.css (the Sale Report container)', () => {
    const owners = readdirSync('css')
      .filter((f) => f.endsWith('.css'))
      .filter((f) => /(^|\n)\.sr\s*[,{]/.test(readFileSync(`css/${f}`, 'utf8')));
    expect(owners).toEqual(['sales.css']);
  });
});

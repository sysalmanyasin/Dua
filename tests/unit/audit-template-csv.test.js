import { describe, expect, it } from 'vitest';
import { checkPlan, MAX_CODES, parseCodesCsv, planFromFile, templateNameFromFile } from '../../js/modules/audit/domain/templateCsv.js';

describe('parseCodesCsv', () => {
  it('reads one code per line and keeps leading zeros', () => {
    const r = parseCodesCsv('020855\n089103\n0590571\n');
    expect(r.codes).toEqual(['020855', '089103', '0590571']);
    expect(r.error).toBeUndefined();
  });

  it('skips a heading row, a BOM and Windows line ends', () => {
    const r = parseCodesCsv('\ufeffProduct Code\r\n001\r\n002\r\n');
    expect(r.heading).toBe(true);
    expect(r.codes).toEqual(['001', '002']);
  });

  it('does not treat a real code as a heading, and keeps codes that contain letters', () => {
    const r = parseCodesCsv('SE024\nC1170581\n');
    expect(r.heading).toBe(false);
    expect(r.codes).toEqual(['SE024', 'C1170581']);
  });

  it('reads several codes per row separated by commas, semicolons or tabs, and drops repeats', () => {
    expect(parseCodesCsv('A1,A2;A3\tA1\nA4,,\n').codes).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('reads quoted cells and strips spreadsheet wrappers', () => {
    expect(parseCodesCsv('"00123"\n="00456"\n\'00789\n').codes).toEqual(['00123', '00456', '00789']);
  });

  it('leaves out values a spreadsheet has turned into scientific notation, and says how many', () => {
    const r = parseCodesCsv('001\n1.23E+10\n002\n');
    expect(r.codes).toEqual(['001', '002']);
    expect(r.suspect).toBe(1);
  });

  it('reports an empty file, a file of only damaged numbers, and too many codes', () => {
    expect(parseCodesCsv('Code\n').error).toMatch(/No product codes/);
    expect(parseCodesCsv('1.2E+10\n3.4E+9\n').error).toMatch(/shortened/);
    const big = Array.from({ length: MAX_CODES + 1 }, (_, i) => `C${i}`).join('\n');
    expect(parseCodesCsv(big).error).toMatch(/up to 5000/);
  });
});

describe('templateNameFromFile', () => {
  it('turns a file name into a template name', () => {
    expect(templateNameFromFile('weekly_fridge.csv')).toBe('weekly fridge');
    expect(templateNameFromFile('C:\\fakepath\\Syrups.2026.CSV')).toBe('Syrups.2026');
    expect(templateNameFromFile('x'.repeat(120) + '.csv')).toHaveLength(80);
  });
});

describe('checkPlan', () => {
  const item = (name, over = {}) => ({ file: `${name}.csv`, name, codes: ['1'], ...over });
  it('passes good rows and names the problem on bad ones', () => {
    const plan = [item('Fresh'), item('syrups'), item('Dup'), item('dup'), item('A'), planFromFile({ name: 'big.csv', error: 'Too big.' })];
    expect(checkPlan(plan, ['Syrups'])).toEqual([
      null,
      'A template with this name already exists. Change the name.',
      'Two files have this name. Change one of them.',
      'Two files have this name. Change one of them.',
      'A template needs a name of 2 to 80 letters.',
      'Too big.',
    ]);
  });
  it('keeps a failed save visible until the name is changed', () => {
    expect(checkPlan([item('Fresh', { saveError: 'Try again.' })])).toEqual(['Try again.']);
  });
});

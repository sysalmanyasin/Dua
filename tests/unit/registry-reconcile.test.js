import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { compareRegistry, parseMigrationFile, renameSql } from '../../tools/check-registry.mjs';

const files = ['0001_core.sql', '0014_staff_logins_pin4.sql', '0215_closing_refresh_existing_drafts.sql', '1000_invoice_desk_core.sql'];

describe('registry comparison', () => {
  it('parses migration file names', () => {
    expect(parseMigrationFile('0215_closing_refresh_existing_drafts.sql')).toEqual({
      version: '0215',
      base: 'closing_refresh_existing_drafts',
      full: '0215_closing_refresh_existing_drafts',
    });
    expect(parseMigrationFile('notes.md')).toBeNull();
  });

  it('is clean when every file is registered under its own number', () => {
    const rows = [
      { version: '0001', name: 'core' },
      { version: '0014', name: '0014_staff_logins_pin4' },
      { version: '0215', name: 'closing_refresh_existing_drafts' },
      { version: '1000', name: '1000_invoice_desk_core' },
    ];
    expect(compareRegistry(files, rows).clean).toBe(true);
  });

  it('finds timestamp-versioned rows by name, with or without the number prefix', () => {
    const rows = [
      { version: '0001', name: 'core' },
      { version: '20261121032408', name: '0014_staff_logins_pin4' },
      { version: '20261118081315', name: 'closing_refresh_existing_drafts' },
      { version: '20261117135131', name: '1000_invoice_desk_core' },
    ];
    const r = compareRegistry(files, rows);
    expect(r.clean).toBe(false);
    expect(r.renames.map((t) => [t.from, t.to])).toEqual([
      ['20261121032408', '0014'],
      ['20261118081315', '0215'],
      ['20261117135131', '1000'],
    ]);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.clash).toEqual([]);
  });

  it('reports unregistered files and registry-only rows instead of guessing', () => {
    const r = compareRegistry(
      ['0001_core.sql', '0002_sales.sql'],
      [
        { version: '0001', name: 'core' },
        { version: '9999', name: 'mystery' },
      ],
    );
    expect(r.missing).toEqual(['0002_sales']);
    expect(r.extra).toEqual(['9999 mystery']);
  });

  it('does not match a timestamp row whose name differs', () => {
    const r = compareRegistry(['0014_staff_logins_pin4.sql'], [{ version: '20261121032408', name: 'something_else' }]);
    expect(r.renames).toEqual([]);
    expect(r.missing).toEqual(['0014_staff_logins_pin4']);
  });

  it('writes one guarded transaction per approved rename list', () => {
    const sql = renameSql([{ from: '20261121032408', to: '0014', name: '0014_staff_logins_pin4' }]);
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;$/);
    expect(sql).toContain("('20261121032408', '0014_staff_logins_pin4', '0014')");
    expect(sql).toContain('expected to rename exactly 1 row');
  });

  it('every real migration file has a four-digit number and a unique version', () => {
    const real = readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    const versions = real.map((f) => parseMigrationFile(f)?.version);
    expect(versions.every(Boolean)).toBe(true);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

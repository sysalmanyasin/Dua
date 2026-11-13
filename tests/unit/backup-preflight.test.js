import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// These checks stop before any connection is made, so they need no database.
function run(url, extra = {}) {
  const out = mkdtempSync(join(tmpdir(), 'bkp-'));
  const r = spawnSync('bash', ['tools/backup/backup.sh'], {
    env: { PATH: process.env.PATH, OUT_DIR: out, SUPABASE_DB_URL: url, BACKUP_PASSPHRASE: 'a-long-test-passphrase-123456', ...extra },
    encoding: 'utf8',
  });
  const file = join(out, 'error.txt');
  return { status: r.status, reason: existsSync(file) ? readFileSync(file, 'utf8').trim() : '' };
}

describe('backup connection checks', () => {
  it('refuses the Transaction pooler (port 6543)', () => {
    const r = run('postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres');
    expect(r.status).toBe(1);
    expect(r.reason).toMatch(/6543.*Session pooler/);
  });
  it('refuses the IPv6-only direct connection', () => {
    const r = run('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres');
    expect(r.status).toBe(1);
    expect(r.reason).toMatch(/Direct connection/);
  });
  it('explains an unencoded @ in the password', () => {
    const r = run('postgresql://postgres.abc:pa@ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres');
    expect(r.status).toBe(1);
    expect(r.reason).toMatch(/percent-encoded/);
  });
  it('never repeats the password in the reason', () => {
    const r = run('postgresql://postgres.abc:SuperSecret99@db.abcdefgh.supabase.co:5432/postgres');
    expect(r.reason).not.toContain('SuperSecret99');
  });
  it('refuses to run with no encryption configured, or a short passphrase', () => {
    expect(run('postgresql://u:p@h:5432/d', { BACKUP_PASSPHRASE: '' }).status).toBe(2);
    expect(run('postgresql://u:p@h:5432/d', { BACKUP_PASSPHRASE: 'short' }).status).toBe(2);
  });
});

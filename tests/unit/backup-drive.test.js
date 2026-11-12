import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupName, isSunday, selectForDeletion } from '../../tools/backup/retention.mjs';
import { runUpload } from '../../tools/backup/drive.mjs';

const files = (days) => days.map((d) => ({ id: `id-${d}`, name: backupName(d) }));
const days = (n, from = '2026-01-01') =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10));

describe('retention', () => {
  it('keeps the newest N and deletes the oldest', () => {
    const del = selectForDeletion(files(days(35)), 30);
    expect(del).toHaveLength(5);
    expect(del.map((f) => f.name)).toEqual(
      files(days(5))
        .map((f) => f.name)
        .reverse(),
    );
  });
  it('deletes nothing when at or under the limit', () => {
    expect(selectForDeletion(files(days(30)), 30)).toEqual([]);
    expect(selectForDeletion(files(days(3)), 30)).toEqual([]);
  });
  it('never touches files that are not ours', () => {
    const mixed = [...files(days(32)), { id: 'x', name: 'holiday-photos.zip' }, { id: 'y', name: 'dua-notes.txt' }];
    const del = selectForDeletion(mixed, 30);
    expect(del.map((f) => f.id)).not.toContain('x');
    expect(del.map((f) => f.id)).not.toContain('y');
    expect(del).toHaveLength(2);
  });
  it('never deletes the protected file, and ignores a bad keep', () => {
    expect(selectForDeletion(files(days(35)), 30, backupName('2026-01-01'))).toHaveLength(4);
    for (const bad of [0, -1, 1.5, NaN, undefined]) expect(selectForDeletion(files(days(35)), bad)).toEqual([]);
  });
  it('knows which days are Sundays', () => {
    expect(isSunday('2026-11-15')).toBe(true);
    expect(isSunday('2026-11-12')).toBe(false);
  });
});

// A small in-memory Drive: folders and files, resumable uploads, copy, delete, list.
function fakeDrive({ corruptUpload = false, tokenStatus = 200, existing = [] } = {}) {
  const items = [...existing];
  let n = 0;
  const log = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    log.push(`${method} ${u.pathname}`);
    if (u.host === 'oauth2.googleapis.com')
      return tokenStatus === 200 ? json({ access_token: 'tok' }) : json({ error: 'invalid_grant' }, tokenStatus);
    if (!init.headers?.Authorization) return json({}, 401);
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q');
      const inParent = q.match(/'([^']+)' in parents/)?.[1];
      const nm = q.match(/name = '([^']+)'/)?.[1];
      const isFolder = q.includes('google-apps.folder');
      return json({
        files: items
          .filter((i) => (!nm || i.name === nm) && (!inParent || i.parent === inParent) && (isFolder ? i.folder : !i.folder))
          .map(({ id, name, size, md5Checksum }) => ({ id, name, size, md5Checksum })),
      });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const b = JSON.parse(init.body);
      const id = `f${++n}`;
      items.push({ id, name: b.name, folder: true, parent: b.parents?.[0] });
      return json({ id });
    }
    if (u.pathname === '/upload/drive/v3/files') {
      const b = JSON.parse(init.body);
      return new Response('{}', {
        status: 200,
        headers: { location: `https://upload.test/${encodeURIComponent(b.name)}|${b.parents[0]}` },
      });
    }
    if (u.host === 'upload.test') {
      const [name, parent] = decodeURIComponent(u.pathname.slice(1)).split('|');
      const bytes = Buffer.from(init.body);
      const id = `f${++n}`;
      const md5 = corruptUpload ? 'deadbeef' : createHash('md5').update(bytes).digest('hex');
      items.push({ id, name, parent, size: String(bytes.length), md5Checksum: md5 });
      return json({ id, name, size: String(bytes.length), md5Checksum: md5 });
    }
    const copy = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/copy$/);
    if (copy) {
      const b = JSON.parse(init.body);
      const src = items.find((i) => i.id === copy[1]);
      const id = `f${++n}`;
      items.push({ ...src, id, name: b.name, parent: b.parents[0] });
      return json({ id });
    }
    const del = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (del && method === 'DELETE') {
      const i = items.findIndex((x) => x.id === del[1]);
      if (i >= 0) items.splice(i, 1);
      return new Response(null, { status: 204 });
    }
    return json({}, 404);
  };
  return { fetchFn, items, log };
}

function stage(day) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const bytes = Buffer.from(`encrypted-${day}`.repeat(50));
  writeFileSync(join(dir, backupName(day)), bytes);
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ day, file: backupName(day) }));
  return dir;
}
const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' };

describe('drive upload', () => {
  it('creates its folders, uploads, verifies, and records the result', async () => {
    const d = fakeDrive();
    const dir = stage('2026-11-12');
    const s = await runUpload({ fetchFn: d.fetchFn, env, outDir: dir });
    expect(s).toMatchObject({ uploaded: 'dua-2026-11-12.tar.age', weeklyCopied: false, pruned: 0 });
    expect(
      d.items
        .filter((i) => i.folder)
        .map((i) => i.name)
        .sort(),
    ).toEqual(['Dua Backups', 'daily', 'weekly']);
    expect(JSON.parse(readFileSync(join(dir, 'drive-result.json'), 'utf8')).uploaded).toBe('dua-2026-11-12.tar.age');
  });
  it('reuses folders and replaces the same day instead of duplicating', async () => {
    const d = fakeDrive();
    const dir = stage('2026-11-12');
    await runUpload({ fetchFn: d.fetchFn, env, outDir: dir });
    await runUpload({ fetchFn: d.fetchFn, env, outDir: dir });
    expect(d.items.filter((i) => i.folder)).toHaveLength(3);
    expect(d.items.filter((i) => i.name === 'dua-2026-11-12.tar.age')).toHaveLength(1);
  });
  it('copies Sunday backups to weekly', async () => {
    const d = fakeDrive();
    const dir = stage('2026-11-15');
    const s = await runUpload({ fetchFn: d.fetchFn, env, outDir: dir });
    expect(s.weeklyCopied).toBe(true);
    expect(d.items.filter((i) => i.name === 'dua-2026-11-15.tar.age')).toHaveLength(2);
  });
  it('prunes to 30 daily and 12 weekly, only after a verified upload', async () => {
    const d = fakeDrive();
    await runUpload({ fetchFn: d.fetchFn, env, outDir: stage('2026-06-01') }); // creates the folders
    const dailyId = d.items.find((i) => i.name === 'daily').id;
    const weeklyId = d.items.find((i) => i.name === 'weekly').id;
    days(35, '2026-07-01').forEach((day, i) =>
      d.items.push({ id: `old-d${i}`, name: backupName(day), parent: dailyId, size: '1', md5Checksum: 'x' }),
    );
    days(14, '2026-01-04').forEach((day, i) =>
      d.items.push({ id: `old-w${i}`, name: backupName(day), parent: weeklyId, size: '1', md5Checksum: 'x' }),
    );
    d.items.push({ id: 'keep-me', name: 'unrelated.txt', parent: dailyId });
    await runUpload({ fetchFn: d.fetchFn, env, outDir: stage('2026-11-12') });
    expect(d.items.filter((i) => i.parent === dailyId && i.name.startsWith('dua-'))).toHaveLength(30);
    expect(d.items.filter((i) => i.parent === weeklyId)).toHaveLength(12);
    expect(d.items.some((i) => i.id === 'keep-me')).toBe(true);
    expect(d.items.some((i) => i.name === 'dua-2026-11-12.tar.age')).toBe(true);
  });
  it('stops without pruning when the Drive copy does not match', async () => {
    const d = fakeDrive({ corruptUpload: true });
    await expect(runUpload({ fetchFn: d.fetchFn, env, outDir: stage('2026-11-12') })).rejects.toThrow(/does not match/);
    expect(d.log.filter((l) => l.startsWith('DELETE'))).toEqual([]);
  });
  it('explains a failed Google sign-in without exposing secrets', async () => {
    const d = fakeDrive({ tokenStatus: 400 });
    const secrets = { GOOGLE_CLIENT_ID: 'cid-VALUE-111', GOOGLE_CLIENT_SECRET: 'cs-VALUE-222', GOOGLE_REFRESH_TOKEN: 'rt-VALUE-333' };
    const err = await runUpload({ fetchFn: d.fetchFn, env: secrets, outDir: stage('2026-11-12') }).catch((e) => e);
    expect(err.message).toMatch(/sign-in failed \(400\)/);
    for (const v of Object.values(secrets)) expect(err.message).not.toContain(v);
  });
  it('refuses to run with a missing credential', async () => {
    await expect(
      runUpload({ fetchFn: fakeDrive().fetchFn, env: { ...env, GOOGLE_REFRESH_TOKEN: '' }, outDir: stage('2026-11-12') }),
    ).rejects.toThrow(/GOOGLE_REFRESH_TOKEN is not set/);
  });
});

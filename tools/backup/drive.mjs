// Uploads the encrypted backup to Google Drive, verifies it, copies Sunday's to weekly/, and prunes old copies (Foundation F7).
// Uses OAuth with the narrow drive.file scope: it can only see files and folders this app created, in a folder it creates itself.
// Environment: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, OUT_DIR (holds dua-<day>.tar.age and result.json)
// Nothing here prints a token or a response body that could contain one.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { BACKUP_NAME, KEEP_DAILY, KEEP_WEEKLY, isSunday, selectForDeletion } from './retention.mjs';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

export async function runUpload({ fetchFn = fetch, env = process.env, outDir = env.OUT_DIR } = {}) {
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) if (!env[k]) throw new Error(`${k} is not set`);
  const result = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
  const name = result.file;
  if (!BACKUP_NAME.test(name) || !name.includes(result.day)) throw new Error('result.json does not match the backup file name');
  const bytes = readFileSync(join(outDir, name));
  const md5 = createHash('md5').update(bytes).digest('hex');

  const tokenRes = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google sign-in failed (${tokenRes.status}). The refresh token may have expired or been revoked.`);
  const access = (await tokenRes.json()).access_token;
  if (!access) throw new Error('Google sign-in returned no access token');
  const auth = { Authorization: `Bearer ${access}` };

  const call = async (url, init = {}) => {
    const res = await fetchFn(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`Drive request failed (${res.status}) for ${init.method ?? 'GET'} ${new URL(url).pathname}`);
    return res;
  };
  const list = async (q) => {
    const files = [];
    let page = '';
    do {
      const url = `${API}/files?${new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,size,md5Checksum)', pageSize: '1000', ...(page ? { pageToken: page } : {}) })}`;
      const j = await (await call(url)).json();
      files.push(...(j.files ?? []));
      page = j.nextPageToken ?? '';
    } while (page);
    return files;
  };
  const ensureFolder = async (folderName, parent) => {
    const q = `name = '${folderName}' and mimeType = '${FOLDER}' and trashed = false${parent ? ` and '${parent}' in parents` : ''}`;
    const found = await list(q);
    if (found.length) return found[0].id;
    const res = await call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    });
    return (await res.json()).id;
  };

  const root = await ensureFolder('Dua Backups', null);
  const daily = await ensureFolder('daily', root);
  const weekly = await ensureFolder('weekly', root);

  // Re-running the same day replaces that day's file instead of piling up copies.
  for (const old of await list(`'${daily}' in parents and name = '${name}' and trashed = false`))
    await call(`${API}/files/${old.id}`, { method: 'DELETE' });

  const start = await call(`${UPLOAD}?uploadType=resumable&fields=id,name,size,md5Checksum`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': String(bytes.length),
    },
    body: JSON.stringify({ name, parents: [daily] }),
  });
  const where = start.headers.get('location');
  if (!where) throw new Error('Drive did not give an upload address');
  const up = await (await call(where, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json();
  if (String(up.size) !== String(bytes.length) || up.md5Checksum !== md5)
    throw new Error('Drive copy does not match the local file (size or checksum); nothing was pruned');

  let weeklyCopied = false;
  if (isSunday(result.day)) {
    for (const old of await list(`'${weekly}' in parents and name = '${name}' and trashed = false`))
      await call(`${API}/files/${old.id}`, { method: 'DELETE' });
    await call(`${API}/files/${up.id}/copy?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [weekly] }),
    });
    weeklyCopied = true;
  }

  // Prune only after the new copy is verified.
  let pruned = 0;
  for (const [folder, keep] of [
    [daily, KEEP_DAILY],
    [weekly, KEEP_WEEKLY],
  ]) {
    const files = await list(`'${folder}' in parents and trashed = false`);
    for (const f of selectForDeletion(files, keep, name)) {
      await call(`${API}/files/${f.id}`, { method: 'DELETE' });
      pruned++;
    }
  }
  const summary = { uploaded: name, size_bytes: bytes.length, weeklyCopied, pruned };
  writeFileSync(join(outDir, 'drive-result.json'), JSON.stringify(summary));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runUpload()
    .then((s) => console.log(`drive ok: ${s.uploaded}, weekly copy: ${s.weeklyCopied}, pruned: ${s.pruned}`))
    .catch((e) => {
      console.error(`drive failed: ${e.message}`);
      process.exit(1);
    });
}

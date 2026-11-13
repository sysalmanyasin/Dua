// Fails the build if anything secret-looking is committed. Publishable/anon keys are allowed; service-role keys are not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'coverage']);
const SKIP_FILES = /\.(png|jpe?g|gif|ico|woff2?|pdf)$/i;

const findings = [];
const patterns = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'age private key', re: /AGE-SECRET-KEY-1[A-Z0-9]{20,}/ },
  { name: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{16,}/ },
  { name: 'Google OAuth refresh token', re: /\b1\/\/[0-9A-Za-z_-]{40,}/ },
  { name: 'Postgres URL with password', re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@]{3,}@/ },
  { name: 'Google API/service key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
];

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role ?? null;
  } catch {
    return null;
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (!SKIP_FILES.test(name) && statSync(full).size < 2_000_000) scan(full);
  }
}

function scan(file) {
  const rel = relative(root, file);
  if (rel === 'tools/check-secrets.mjs' || rel.startsWith('tests/')) return;
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of patterns) if (re.test(text)) findings.push(`${rel}: ${name}`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    const role = jwtRole(m[0]);
    if (role !== 'anon') findings.push(`${rel}: JWT with role "${role}" (only role "anon" is allowed in Git)`);
  }
}

walk(root);
if (findings.length) {
  console.error('Secret check FAILED:\n' + findings.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('Secret check passed.');

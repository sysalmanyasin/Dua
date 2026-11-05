// Vendored third-party files must match their recorded hashes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXPECTED = {
  'vendor/supabase-js-2.45.4.umd.js': '8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7',
  'vendor/591.supabase.js': '9c305b77dab63dd79eb96efab9069366fb2255bd8731d6b862287558d2560406',
};
let bad = 0;
for (const [file, hash] of Object.entries(EXPECTED)) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== hash) {
    console.error(`Vendor check FAILED: ${file} does not match its recorded hash.`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log('Vendor check passed.');

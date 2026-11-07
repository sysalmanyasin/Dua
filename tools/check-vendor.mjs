// Vendored third-party files must match their recorded hashes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXPECTED = {
  'vendor/supabase-js-2.45.4.umd.js': '8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7',
  'vendor/fonts/ibm-plex-mono-latin-400-normal.woff2': '08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7',
  'vendor/fonts/ibm-plex-mono-latin-500-normal.woff2': '01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22',
  'vendor/fonts/ibm-plex-mono-latin-600-normal.woff2': '0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83',
  'vendor/fonts/inter-latin-400-normal.woff2': '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc',
  'vendor/fonts/inter-latin-500-normal.woff2': 'f3779f1efccc4bdcdf9c0a02ab95bf6bd092ed09c48c08cedc725889edd1d19f',
  'vendor/fonts/inter-latin-600-normal.woff2': 'f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a',
  'vendor/fonts/inter-latin-700-normal.woff2': '6f56409fd3d64bb85f7d070bce20749db2d66b6d63cec586cc22d1c761be2491',
  'vendor/fonts/inter-latin-800-normal.woff2': 'a7d0a50f15d389cad679238466bdb5fc9787aa0715719064ce25abaff042820d',
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

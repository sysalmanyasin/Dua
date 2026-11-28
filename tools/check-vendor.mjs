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
  'vendor/fonts/caladea-latin-400-normal.woff2': '367a4c4dd45c762f6f680ccedbbf18be9d10e13b068aad2813ece1dba881369b',
  'vendor/fonts/caladea-latin-700-normal.woff2': '6a6549b8ec8be5ad7db66f28dee13ea008710379e7bd992870eb2d7ac14c9c3a',
  'vendor/fonts/carlito-latin-400-normal.woff2': 'a29c4a4e61863753cf6a10831efaa05f849dcaa8f580422dbc41bc058c3b6b64',
  'vendor/fonts/carlito-latin-700-normal.woff2': 'af249cfe4107221070ff077c29a043004e8f2efea977dcbaaf217a24f3b7680e',
  'vendor/fonts/cousine-latin-400-normal.woff2': 'fb542bb367b20289e71b682dc45d8f01de5b0a0658464db9053801f30e7c13a8',
  'vendor/fonts/cousine-latin-700-normal.woff2': '63c3bc173bf483b579052da1a6532d84d65d0fbfdd081f1ce50d4fe895343625',
  'vendor/fonts/comic-neue-latin-400-normal.woff2': 'b7753f30f8bd4925cf48a2ffe936c52ff1f16fe441f8c0245acf046296ac590f',
  'vendor/fonts/comic-neue-latin-700-normal.woff2': '13e9f12e3a0239dcf740e1c7ff37be1cce9b87ead0ad9bce838da1202ac9f91c',
  'vendor/fonts/noto-naskh-arabic-arabic-400-normal.woff2': '9cc2d2e90f7b51904468558b4ed529de8a8206497c8edb5e33122bd077e0158c',
  'vendor/fonts/noto-naskh-arabic-arabic-700-normal.woff2': 'd2d8e6b155248d6706e2e9c6019e88d435873801efe3d5a3ed6f0ab69aa1511e',
  'vendor/fonts/LICENSES.txt': 'a1220057cd630538ea4fd2535cc7419d04326864ca4bdfadae6a4aa94dbd8a7b',
  'vendor/chart-4.4.7.umd.js': '2812cb8825fdc57469eb2f7bb055e9429244e599920511ee477e828499b632cb',
  'vendor/zxing-wasm-reader-3.1.7.iife.js': '1c61f43ac68da5c242f58c0d05763c295cd8a605d46d14bc31821eee7160e778',
  'vendor/zxing_reader-3.1.7.wasm': '33c8c50be17d0bb05454b4fd3ffb5b5ab9a8e8d1c0ebeb21a1adf4a89c1a8b59',
  'vendor/591.supabase.js': '9c305b77dab63dd79eb96efab9069366fb2255bd8731d6b862287558d2560406',
  'vendor/workspace/prosemirror-bundle-1.0.0.mjs': 'f6de61193d391398600993b08f2c1b6d5373f5ec71ca3b2a68978d66f906bccb',
  'vendor/workspace/LICENSES.txt': '9a9d215ea18f56cc14f7be8694b05e336960886e9cadc0c919ea534d00f1d00a',
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

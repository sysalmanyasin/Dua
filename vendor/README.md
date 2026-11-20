# vendor/
Third-party code copied into the repo so nothing is downloaded from another site at runtime.

| File | Source | SHA-256 |
|---|---|---|
| supabase-js-2.45.4.umd.js | `npm pack @supabase/supabase-js@2.45.4` → `dist/umd/supabase.js` | `8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7` |
| 591.supabase.js | same package, lazy chunk | see `tools/check-vendor.mjs` |

To upgrade: pack the new version, replace the files, update the hashes in `tools/check-vendor.mjs`, run the tests. CI fails if a file differs from its recorded hash.

| fonts/*.woff2 | `@fontsource/inter@5` and `@fontsource/ibm-plex-mono@5` (latin subset) | listed in `tools/check-vendor.mjs` |
| chart-4.4.7.umd.js | `npm pack chart.js@4.4.7` → `dist/chart.umd.js` (MIT), loaded only when the Dashboard opens | `2812cb8825fdc57469eb2f7bb055e9429244e599920511ee477e828499b632cb` |
| zxing-wasm-reader-3.1.7.iife.js | `npm pack zxing-wasm@3.1.7` → `dist/iife/reader/index.js` (MIT). Camera barcode reading for phones without the browser's own BarcodeDetector; loaded only when the Barcode scanner opens. Its built-in CDN address is never used: `js/modules/audit/ui/scanEngine.js` points it at the local .wasm file. | `1c61f43ac68da5c242f58c0d05763c295cd8a605d46d14bc31821eee7160e778` |
| zxing_reader-3.1.7.wasm | same package → `dist/reader/zxing_reader.wasm` (ZXing-C++, Apache-2.0, wrapped by zxing-wasm, MIT; see `ZXING-WASM-LICENSE.txt`). Needs `'wasm-unsafe-eval'` in the page's script-src. Not precached: the service worker keeps it after its first use. | `33c8c50be17d0bb05454b4fd3ffb5b5ab9a8e8d1c0ebeb21a1adf4a89c1a8b59` |
| workspace/prosemirror-bundle-1.0.0.mjs | Nine ProseMirror packages (MIT) bundled with esbuild; exact versions, licences and the rebuild recipe are in `vendor/workspace/build/BUILD.md` and `vendor/workspace/LICENSES.txt`. Loaded only when a Workspace note opens | `f6de61193d391398600993b08f2c1b6d5373f5ec71ca3b2a68978d66f906bccb` |

# vendor/
Third-party code copied into the repo so nothing is downloaded from another site at runtime.

| File | Source | SHA-256 |
|---|---|---|
| supabase-js-2.45.4.umd.js | `npm pack @supabase/supabase-js@2.45.4` → `dist/umd/supabase.js` | `8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7` |
| 591.supabase.js | same package, lazy chunk | see `tools/check-vendor.mjs` |

To upgrade: pack the new version, replace the files, update the hashes in `tools/check-vendor.mjs`, run the tests. CI fails if a file differs from its recorded hash.

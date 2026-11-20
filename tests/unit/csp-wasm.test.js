import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const csp =
  readFileSync(new URL('../../index.html', import.meta.url), 'utf8').match(/Content-Security-Policy"[^>]*content="([^"]+)"/s)?.[1] ?? '';
const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';

describe('Content-Security-Policy', () => {
  it('allows WebAssembly for the barcode reader, and still no eval', () => {
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});

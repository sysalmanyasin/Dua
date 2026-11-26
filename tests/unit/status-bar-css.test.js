import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../css/components.css', import.meta.url), 'utf8');
const block = (sel) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('status bar on a phone (D-71)', () => {
  it('scrolls inside its own bar instead of widening the page', () => {
    expect(block('.status-bar')).toMatch(/overflow-x:\s*auto/);
  });
  it('lets the pill row grow past the bar but never shrink below it', () => {
    const inner = block('.status-inner');
    expect(inner).toMatch(/width:\s*max-content/);
    expect(inner).toMatch(/min-width:\s*100%/);
  });
});

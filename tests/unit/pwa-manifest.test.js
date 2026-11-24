// The web app manifest makes Dua installable and gives it long-press shortcuts. No runtime code is involved, so this test
// checks the files themselves: valid JSON, shortcuts that point at real routes, icons that exist, a content security policy
// that lets the browser read the manifest, and a service worker list that keeps the manifest and icons for offline use.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computePrecache, currentList } from '../../tools/sw-precache.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const html = read('index.html');

async function registeredRoutes() {
  const paths = new Set();
  for (const dir of readdirSync(join(ROOT, 'js/modules')).filter((d) => statSync(join(ROOT, 'js/modules', d)).isDirectory())) {
    const file = join(ROOT, 'js/modules', dir, 'manifest.js');
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)).default;
    for (const r of mod.routes ?? []) paths.add(r.path);
  }
  return paths;
}

describe('web app manifest', () => {
  it('is valid JSON with the install basics', () => {
    expect(manifest.name).toBe('Dua');
    expect(manifest.short_name).toBe('Dua');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#142b4a');
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('uses the same theme colour as index.html and a background colour from css/tokens.css', () => {
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
    expect(read('css/tokens.css').toLowerCase()).toContain(`--bg: ${manifest.background_color.toLowerCase()}`);
  });

  it('lists the SVG, 192 and 512 PNG icons and a 512 maskable PNG', () => {
    const find = (sizes, purpose) => manifest.icons.find((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
    expect(manifest.icons.find((i) => i.src === 'assets/icon.svg')?.type).toBe('image/svg+xml');
    expect(find('192x192', 'any')?.type).toBe('image/png');
    expect(find('512x512', 'any')?.type).toBe('image/png');
    expect(find('512x512', 'maskable')?.type).toBe('image/png');
  });

  it('every icon file exists, and PNG icons are the size they claim and stay small', () => {
    const all = [...manifest.icons, ...manifest.shortcuts.flatMap((s) => s.icons ?? [])];
    for (const icon of all) {
      const file = join(ROOT, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(statSync(file).size, icon.src).toBeLessThan(60 * 1024);
      if (icon.type === 'image/png') {
        const png = readFileSync(file);
        const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
        expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
      }
    }
  });

  it('has the Counting and Individual audit shortcuts', () => {
    expect(manifest.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['Counting', './#/audit/count'],
      ['Individual audit', './#/audit/individual'],
    ]);
    for (const s of manifest.shortcuts) {
      expect(s.short_name).toBeTruthy();
      expect(s.icons?.[0]?.src).toBe('assets/icon-192.png');
    }
  });

  it('every shortcut points at a route registered by a module manifest', async () => {
    const routes = await registeredRoutes();
    for (const s of manifest.shortcuts) {
      expect(s.url.startsWith('./#/'), s.url).toBe(true);
      expect(routes.has(s.url.slice(3)), s.url).toBe(true);
    }
  });
});

describe('index.html and the service worker', () => {
  it('links the manifest', () => {
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest" />');
  });

  it('lets the browser read the manifest without loosening the rest of the policy', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client");
    expect(csp).toContain("object-src 'none'");
  });

  it('keeps the manifest and every icon in the precache list', () => {
    const listed = currentList(read('sw.js'));
    expect(listed).toContain('manifest.webmanifest');
    for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap((s) => s.icons ?? [])]) {
      expect(listed, icon.src).toContain(icon.src);
    }
    expect(listed).toEqual(computePrecache(ROOT));
  });
});

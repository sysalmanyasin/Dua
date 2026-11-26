// Consistency check for the Android shell. It needs no Android SDK, so it runs in the normal CI and on any computer.
// It catches the mistakes that would otherwise only show up on a phone: a plugin method the web app calls but the Java no longer has,
// a resource the Java uses but nobody defined, a changed endpoint, a widened permission, a secret file committed by accident.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shell = resolve(here, '..');
const repo = resolve(shell, '..');
const read = (p) => readFileSync(join(shell, p), 'utf8');
const problems = [];
const need = (cond, msg) => cond || problems.push(msg);

const cfg = JSON.parse(read('capacitor.config.json'));
// The committed sources are the overlay; android/ is generated from Capacitor's template + overlay by scripts/setup.sh.
const OV = 'overlay/app/src/main';
const gradle = read('overlay/app/build.gradle');
const manifest = read(`${OV}/AndroidManifest.xml`);
const main = read(`${OV}/java/com/duapharma/dua/MainActivity.java`);
const plugin = read(`${OV}/java/com/duapharma/dua/DuaDevicePlugin.java`);
const javaDir = join(shell, `${OV}/java/com/duapharma/dua`);
const javaAll = readdirSync(javaDir).filter((f) => f.endsWith('.java')).map((f) => readFileSync(join(javaDir, f), 'utf8')).join('\n');
const nativeJs = readFileSync(join(repo, 'js/core/native.js'), 'utf8');
const attendanceJs = readFileSync(join(repo, 'js/modules/manager/data/attendanceApi.js'), 'utf8');
const cname = readFileSync(join(repo, 'CNAME'), 'utf8').trim();

// 1. the live site, and nothing else, is what the app opens
const host = new URL(cfg.server?.url ?? 'http://x').host;
need(cfg.server?.url === `https://${cname}`, `server.url must be https://${cname} (the CNAME file); it is ${cfg.server?.url}`);
need(JSON.stringify(cfg.server?.allowNavigation) === JSON.stringify([host]), 'allowNavigation must list only the live site');
need(cfg.server?.cleartext === false, 'cleartext must be false');
need(/DuaAndroid\//.test(cfg.android?.appendUserAgent ?? ''), 'appendUserAgent must contain DuaAndroid/ (the web app hides Gmail by it)');
need(cfg.android?.webContentsDebuggingEnabled === false, 'web debugging must be off in the shipped app');
need(gradle.includes(`namespace = "${cfg.appId}"`) && gradle.includes(`applicationId "${cfg.appId}"`), 'appId, namespace and applicationId must match');

// 2. permissions: exactly the ones the features need
const perms = [...manifest.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)].map((m) => m[1]).sort();
const expected = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS'];
need(JSON.stringify(perms) === JSON.stringify(expected), `permissions must be ${expected.join(', ')}; found ${perms.join(', ')}`);
need(/android:allowBackup="false"/.test(manifest) && /usesCleartextTraffic="false"/.test(manifest), 'backup and cleartext must be off');
need(/android:name="\.TodayWidgetProvider"[^>]*android:exported="false"/s.test(manifest), 'the widget receiver must not be exported');
need(main.includes('registerPlugin(DuaDevicePlugin.class)'), 'MainActivity must register DuaDevicePlugin');

// 3. every plugin method the web app calls exists in Java, and the other way round
const javaMethods = [...plugin.matchAll(/@PluginMethod\s+public void (\w+)\(/g)].map((m) => m[1]).sort();
const jsMethods = [...new Set([...(nativeJs + attendanceJs).matchAll(/\b(?:dev|native)\??\.(\w+)\(/g)].map((m) => m[1]))].filter((m) => !['catch', 'then'].includes(m)).sort();
for (const m of jsMethods) need(javaMethods.includes(m), `the web app calls DuaDevice.${m}() but DuaDevicePlugin.java has no such method`);
for (const m of javaMethods) need(jsMethods.includes(m), `DuaDevicePlugin.${m}() is never called by the web app`);

// 4. the widget talks only to our Edge Function
need(plugin.includes('functions/v1/widget-today'), 'the plugin must pin the widget endpoint to .../functions/v1/widget-today');
need(nativeJs.includes('/widget-today'), 'native.js must use the widget-today endpoint');

// 5. resources the Java uses exist
const res = join(shell, `${OV}/res`);
const resText = (dir) => readdirSync(join(res, dir)).map((f) => readFileSync(join(res, dir, f), 'utf8')).join('\n');
const defined = { string: resText('values'), layout: readdirSync(join(res, 'layout')).join('\n'), drawable: readdirSync(join(res, 'drawable')).join('\n'), xml: readdirSync(join(res, 'xml')).join('\n') };
for (const [, kind, name] of javaAll.matchAll(/\bR\.(string|layout|drawable|xml)\.(\w+)/g)) {
  const ok = kind === 'string' ? new RegExp(`<string name="${name}"`).test(defined.string) : new RegExp(`(^|\\n)${name}\\.`).test(defined[kind]);
  need(ok, `R.${kind}.${name} is used in Java but not defined`);
}
const layout = readFileSync(join(res, 'layout/widget_today.xml'), 'utf8');
for (const [, id] of javaAll.matchAll(/\bR\.id\.(\w+)/g)) need(layout.includes(`@+id/${id}`), `R.id.${id} is not in widget_today.xml`);
const generated = new Set(['file_paths']); // written by Capacitor's template, not by us
for (const [, ref] of manifest.matchAll(/@(?:xml|drawable|color)\/(\w+)/g)) {
  if (generated.has(ref)) continue;
  const found = ['xml', 'drawable'].some((d) => readdirSync(join(res, d)).some((f) => f.startsWith(`${ref}.`))) || resText('values').includes(`name="${ref}"`);
  need(found, `the manifest refers to @…/${ref} which does not exist`);
}

// 6. nothing secret is committed (a developer may keep google-services.json locally; it is git-ignored, so only tracked files count)
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '--', shell], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  // not a git checkout (a source archive): fall back to scanning the overlay and scripts only
  const walk = (d, out = []) => {
    for (const n of readdirSync(d)) {
      if (['node_modules', 'android'].includes(n)) continue;
      const f = join(d, n);
      statSync(f).isDirectory() ? walk(f, out) : out.push(f);
    }
    return out;
  };
  tracked = walk(shell);
}
for (const f of tracked) need(!/google-services\.json$|\.jks$|\.keystore$|keystore\.properties$/.test(f), `a secret file is tracked: ${f}`);
need(!tracked.some((f) => /android-app\/android\//.test(f)), 'the generated android/ project must not be committed (scripts/setup.sh rebuilds it)');

if (problems.length) {
  console.error(`Android shell check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Android shell check passed (${javaMethods.length} plugin methods, ${perms.length} permissions).`);

// Usage: node tools/import/sales-import.mjs <backup.json> [--add-mode=signed|abs] [--trust-month-year] [--out=tools/import/out]
// Reads the old app's backup, checks every day against the TOTAL formula, prints a report and writes a normalized file.
// It never contacts a database. The backup contains real business data: keep it out of Git (tools/import/out is ignored).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, summarize } from './sales-lib.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
if (!file) {
  console.error('Give the backup file path.');
  process.exit(2);
}
const addMode = opt('add-mode', 'signed');
const trustMonthYear = args.includes('--trust-month-year');
const outDir = opt('out', 'tools/import/out');

const result = analyze(JSON.parse(readFileSync(file, 'utf8')), { addMode, trustMonthYear });
const s = summarize(result);
console.log(`Mode: add fields ${addMode}${trustMonthYear ? ', month label trusted over typed year' : ''}`);
console.log(`Days: ${s.days} (${s.first} to ${s.last}); calendar gaps: ${s.gapDays}`);
console.log(`Months with only monthly figures: ${s.monthlyOnlyMonths.join(', ') || 'none'}`);
console.log('Findings:', s.anomalyCounts);
for (const a of result.anomalies.filter((x) => x.type !== 'total_mismatch').slice(0, 12)) console.log(' -', JSON.stringify(a));
for (const a of result.anomalies.filter((x) => x.type === 'total_mismatch').slice(0, 12)) console.log(' - total', JSON.stringify(a));

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'sales-normalized.json'),
  JSON.stringify({ methods: result.methods, days: result.days, monthlyOnly: result.monthlyOnly }),
);
writeFileSync(join(outDir, 'sales-findings.json'), JSON.stringify(result.anomalies, null, 1));
console.log(`Wrote ${outDir}/sales-normalized.json and sales-findings.json`);

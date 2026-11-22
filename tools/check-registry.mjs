// Compares supabase/migrations/*.sql with a read-only export of the live registry and says what would have to change.
// It never connects to a database and never writes SQL to supabase/migrations/. See docs/ops/f7-registry-reconciliation.md.
//   node tools/check-registry.mjs registry.json     (registry.json = output of: select version, name from supabase_migrations.schema_migrations)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = /^(\d{4})_(.+)\.sql$/;
const TIMESTAMP = /^\d{14}$/;

export function parseMigrationFile(file) {
  const m = FILE.exec(file);
  return m ? { version: m[1], base: m[2], full: `${m[1]}_${m[2]}` } : null;
}

// A live row may carry the full file name ("0014_staff_logins_pin4") or only the part after the number.
const sameName = (rowName, f) => rowName === f.full || rowName === f.base;

// Pure. files: ['0001_core.sql', ...]; rows: [{version, name}, ...].
export function compareRegistry(files, rows) {
  const parsed = files.map(parseMigrationFile).filter(Boolean);
  const used = new Set();
  const ok = [];
  const timestamped = [];
  const missing = [];
  for (const f of parsed) {
    const exact = rows.find((r) => r.version === f.version && !used.has(r));
    if (exact) {
      used.add(exact);
      (sameName(exact.name, f) ? ok : timestamped).push(
        sameName(exact.name, f) ? f.full : { file: f.full, problem: `registered as ${exact.version} "${exact.name}"` },
      );
      continue;
    }
    const stamped = rows.find((r) => TIMESTAMP.test(r.version) && !used.has(r) && sameName(r.name, f));
    if (stamped) {
      used.add(stamped);
      timestamped.push({ file: f.full, from: stamped.version, to: f.version, name: stamped.name });
    } else missing.push(f.full);
  }
  const extra = rows.filter((r) => !used.has(r)).map((r) => `${r.version} ${r.name}`);
  const renames = timestamped.filter((t) => t.from);
  const clash = renames.filter((t) => rows.some((r) => r.version === t.to)).map((t) => t.file);
  return { ok, timestamped, missing, extra, renames, clash, clean: !timestamped.length && !missing.length && !extra.length };
}

// Pure. The guarded SQL for the renames the owner has approved. One transaction; any surprise aborts it.
export function renameSql(renames) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const rows = renames.map((r) => `    (${q(r.from)}, ${q(r.name)}, ${q(r.to)})`).join(',\n');
  return `begin;
do $$
declare r record; n integer;
begin
  for r in select * from (values
${rows}
  ) as t(old_version, reg_name, new_version) loop
    update supabase_migrations.schema_migrations set version = r.new_version
     where version = r.old_version and name = r.reg_name
       and not exists (select 1 from supabase_migrations.schema_migrations where version = r.new_version);
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'expected to rename exactly 1 row for %, renamed %', r.old_version, n; end if;
  end loop;
end $$;
commit;`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const registryFile = process.argv[2];
  if (!registryFile) {
    console.error('usage: node tools/check-registry.mjs registry.json [--sql]');
    process.exit(2);
  }
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
  const rows = JSON.parse(readFileSync(registryFile, 'utf8'));
  const r = compareRegistry(files, rows);
  console.log(
    `files ${files.length}, registry rows ${rows.length}, in step ${r.ok.length}, timestamp-versioned ${r.renames.length}, other mismatch ${r.timestamped.length - r.renames.length}, not registered ${r.missing.length}, registry-only ${r.extra.length}`,
  );
  for (const t of r.renames) console.log(`  rename ${t.from} -> ${t.to}  (${t.name})`);
  for (const m of r.missing) console.log(`  NOT REGISTERED: ${m}`);
  for (const e of r.extra) console.log(`  REGISTRY ONLY: ${e}`);
  if (r.clash.length) console.log(`  CLASH (target version already used): ${r.clash.join(', ')}`);
  if (process.argv.includes('--sql') && r.renames.length && !r.clash.length) console.log('\n' + renameSql(r.renames));
  process.exit(r.clean ? 0 : 1);
}

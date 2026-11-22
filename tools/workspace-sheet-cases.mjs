// Builds supabase/tests/1102_workspace_sheet_parity_test.sql from tests/fixtures/workspace-sheet-cases.json, so the browser's
// reference model (js/modules/workspace/domain/spreadsheet.js) and the database (workspace_apply_ops and friends) are held
// to the same operation sequences and must give the same answers. A unit test fails if the committed SQL is out of date.
//
//   node tools/workspace-sheet-cases.mjs            write the SQL test from the fixture
//   node tools/workspace-sheet-cases.mjs --record   run the fixture through the model, store its answers as the expected
//                                                   answers, then write the SQL (review the fixture diff before committing)
//
// Fixture format. A case is { name, steps: [step] }, plus `final` ({ state, conflicts }) once recorded. A step is one of
//   { ops: [envelope], expect: { results, head_seq } }        send a batch of operations
//   { ops: [envelope], refused: "part of the error text" }    the whole call is refused; nothing changes
//   { snapshot: "A", expect: { seq } }                        manual restore point labelled A
//   { restore: "A", expect: { status, seq, restored_from_seq } }
// Tokens keep the file readable and are expanded per case (cases never share ids): "$S3" is a sheet id, "$O7" an
// operation id, "$X32768" is that many letter x. Conflict ids and restore-point ids are random in the database and are
// stripped from every comparison.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CallRefused,
  applyOps,
  createSnapshot,
  createWorkbook,
  exportConflicts,
  exportState,
  restoreSnapshot,
  stripIds,
} from '../js/modules/workspace/domain/spreadsheet.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(root, 'tests/fixtures/workspace-sheet-cases.json');
export const OUTPUT = join(root, 'supabase/tests/1102_workspace_sheet_parity_test.sql');

const pad = (n, w) => String(n).padStart(w, '0');
export const sheetUuid = (ci, n) => `a0000000-0000-0000-${pad(ci, 4)}-${pad(n, 12)}`;
export const opUuid = (ci, n) => `b0000000-0000-0000-${pad(ci, 4)}-${pad(n, 12)}`;
export const docUuid = (ci) => `d0000000-0000-0000-${pad(ci, 4)}-000000000001`;
const keyUuid = (ci, n) => `90000000-0000-0000-${pad(ci, 4)}-${pad(n, 12)}`;

// "$S1" -> uuid, "$O1" -> uuid, "$X5" -> "xxxxx", everywhere in a JSON value.
export function expand(v, ci) {
  if (Array.isArray(v)) return v.map((x) => expand(x, ci));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x, ci)]));
  if (typeof v === 'string') {
    let m = /^\$S(\d+)$/.exec(v);
    if (m) return sheetUuid(ci, Number(m[1]));
    m = /^\$O(\d+)$/.exec(v);
    if (m) return opUuid(ci, Number(m[1]));
    m = /^\$X(\d+)$/.exec(v);
    if (m) return 'x'.repeat(Number(m[1]));
  }
  return v;
}

// The reverse, for recording.
export function tokenize(v, ci) {
  if (Array.isArray(v)) return v.map((x) => tokenize(x, ci));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tokenize(x, ci)]));
  if (typeof v === 'string') {
    const m = /^([ab])0000000-0000-0000-(\d{4})-(\d{12})$/.exec(v);
    if (m && Number(m[2]) === ci) return `${m[1] === 'a' ? '$S' : '$O'}${Number(m[3])}`;
    if (v.length >= 1000 && /^x+$/.test(v)) return `$X${v.length}`;
  }
  return v;
}

// Runs one case through the model. Returns the answers in fixture form (tokenized), step by step.
export function runCase(c, ci) {
  const wb = createWorkbook();
  const steps = [];
  for (const step of c.steps) {
    if (step.ops) {
      const ops = expand(step.ops, ci);
      try {
        const out = applyOps(wb, ops);
        steps.push({ expect: tokenize(stripIds(out), ci) });
      } catch (e) {
        if (!(e instanceof CallRefused)) throw e;
        steps.push({ refused: e.message });
      }
    } else if (step.snapshot !== undefined) {
      const out = createSnapshot(wb, step.snapshot);
      steps.push({ expect: { seq: out.seq } });
    } else if (step.restore !== undefined) {
      const snap = wb.snapshots.find((x) => x.label === step.restore && x.kind === 'manual');
      if (!snap) throw new Error(`no restore point ${step.restore}`);
      steps.push({ expect: restoreSnapshot(wb, snap.id) });
    } else throw new Error('unknown step');
  }
  return { steps, final: { state: tokenize(stripIds(exportState(wb)), ci), conflicts: tokenize(stripIds(exportConflicts(wb)), ci) } };
}

export function record(cases) {
  return cases.map((c, i) => {
    const ci = i + 1;
    const ran = runCase(c, ci);
    return {
      name: c.name,
      steps: c.steps.map((s, k) => {
        const base = s.ops ? { ops: s.ops } : s.snapshot !== undefined ? { snapshot: s.snapshot } : { restore: s.restore };
        const got = ran.steps[k];
        return got.refused !== undefined ? { ...base, refused: got.refused } : { ...base, expect: got.expect };
      }),
      final: ran.final,
    };
  });
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const json = (v) => {
  const t = JSON.stringify(v);
  if (t.includes('$j$') || t.includes('$q$')) throw new Error('fixture text must not contain $j$ or $q$');
  return `$j$${t}$j$::jsonb`;
};

const HEADER = `-- GENERATED by tools/workspace-sheet-cases.mjs from tests/fixtures/workspace-sheet-cases.json. Do not edit by hand.
-- Every case is an operation sequence applied to a fresh workbook; the database must answer exactly as the browser model
-- (js/modules/workspace/domain/spreadsheet.js, checked by tests/unit/workspace-spreadsheet.test.js) does.
-- All people, sheets and numbers here are invented.
\\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.same(got jsonb, want jsonb, msg text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL: % (database said %, expected %)', msg, got, want; end if;
  raise notice 'pass: %', msg;
end $$;
-- the same answers in any order (conflict rows have no fixed order)
create function pg_temp.same_set(got jsonb, want jsonb, msg text) returns void language plpgsql as $$
begin
  if jsonb_array_length(got) <> jsonb_array_length(want) or not (got @> want and want @> got) then
    raise exception 'FAIL: % (database said %, expected %)', msg, got, want;
  end if;
  raise notice 'pass: %', msg;
end $$;
create function pg_temp.fails(sql text, msg text, part text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm not like '%' || part || '%' then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
-- random ids the database makes (conflicts, restore points) cannot be compared
create function pg_temp.strip(j jsonb) returns jsonb language plpgsql as $$
declare r jsonb; k text; v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select key, value from jsonb_each(j) loop
      if k not in ('conflict_id', 'snapshot_id') then r := r || jsonb_build_object(k, pg_temp.strip(v)); end if;
    end loop;
    return r;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(pg_temp.strip(e) order by o) from jsonb_array_elements(j) with ordinality t(e, o)), '[]'::jsonb);
  end if;
  return j;
end $$;
-- the whole visible state of a workbook, in the shape exportState() gives
create function pg_temp.state(doc uuid) returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'head_seq', (select head_version from public.workspace_documents where id = doc),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'position', s.position, 'row_order', to_jsonb(s.row_order), 'col_order', to_jsonb(s.col_order),
        'row_sizes', s.row_sizes, 'col_sizes', s.col_sizes, 'frozen_rows', s.frozen_rows, 'frozen_cols', s.frozen_cols,
        'styles', (select coalesce(jsonb_agg(jsonb_build_array(st.style_id, st.style) order by st.style_id), '[]'::jsonb)
                   from public.workspace_sheet_styles st where st.sheet_id = s.id),
        'cells', (select coalesce(jsonb_agg(jsonb_build_array(c.row_id, c.col_id, c.value, c.formula, c.style_id, c.last_seq) order by c.row_id, c.col_id), '[]'::jsonb)
                  from public.workspace_cells c
                  where c.sheet_id = s.id and (c.value is not null or c.formula is not null or c.style_id is not null))
      ) order by s.position) from public.workspace_sheets s where s.document_id = doc and s.deleted_at is null), '[]'::jsonb),
    'pull', coalesce((select jsonb_agg(jsonb_build_object('seq', o.seq, 'op_type', o.op_type, 'payload', o.payload) order by o.seq)
                      from public.workspace_operations o where o.document_id = doc and o.status = 'applied'), '[]'::jsonb))
$$;
create function pg_temp.conflicts(doc uuid) returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'target', k.target, 'server_state', k.server_state, 'local_state', k.local_state)), '[]'::jsonb)
  from public.workspace_conflicts k where k.document_id = doc
$$;
create function pg_temp.snap(doc uuid, lbl text) returns uuid language sql security definer as $$
  select id from public.workspace_sheet_revisions where document_id = doc and label = lbl and kind = 'manual'
$$;
create function pg_temp.u(n int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql as $$ select ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users(id, email) values (pg_temp.u(1), 'author@t');
insert into public.staff(id, full_name) values (pg_temp.s(1), 'Alice Author');
insert into public.profiles(user_id, staff_id, username, role_template) values (pg_temp.u(1), pg_temp.s(1), 'user1', 'junior');
insert into public.user_permissions(user_id, perm_key, effect) values (pg_temp.u(1), 'workspace.use', 'grant'), (pg_temp.u(1), 'workspace.create', 'grant');
select pg_temp.as_user(pg_temp.u(1));
`;

export function buildSql(cases) {
  const out = [HEADER];
  cases.forEach((c, i) => {
    const ci = i + 1;
    const doc = quote(docUuid(ci));
    const label = (k) => quote(`case ${ci} (${c.name}), step ${k + 1}`);
    out.push(`-- ═════ case ${ci}: ${c.name.replace(/\n/g, ' ')} ═════`);
    out.push(`select public.workspace_create_document(${doc}, 'workbook', ${quote(`Parity ${ci}`)}, ${quote(keyUuid(ci, 0))});`);
    c.steps.forEach((s, k) => {
      if (s.ops) {
        const ops = json(expand(s.ops, ci));
        if (s.refused !== undefined) {
          out.push(
            `select pg_temp.fails($q$select public.workspace_apply_ops(${docUuidLiteral(ci)}, ${expandInline(s.ops, ci)})$q$, ${label(k)}, ${quote(s.refused)});`,
          );
        } else {
          out.push(
            `select pg_temp.same(pg_temp.strip(public.workspace_apply_ops(${doc}, ${ops})), ${json(expand(s.expect, ci))}, ${label(k)});`,
          );
        }
      } else if (s.snapshot !== undefined) {
        out.push(
          `select pg_temp.same(jsonb_build_object('seq', public.workspace_snapshot_create(${doc}, ${quote(s.snapshot)}, ${quote(keyUuid(ci, k + 1))}) -> 'seq'), ${json(s.expect)}, ${label(k)});`,
        );
      } else {
        out.push(
          `select pg_temp.same(public.workspace_sheet_restore(${doc}, pg_temp.snap(${doc}, ${quote(s.restore)}), ${quote(keyUuid(ci, k + 1))}), ${json(s.expect)}, ${label(k)});`,
        );
      }
    });
    out.push(
      `select pg_temp.same(pg_temp.strip(pg_temp.state(${doc})), ${json(expand(c.final.state, ci))}, ${quote(`case ${ci} (${c.name}): final state, log and pulled operations`)});`,
    );
    out.push(
      `select pg_temp.same_set(pg_temp.strip(pg_temp.conflicts(${doc})), ${json(expand(c.final.conflicts, ci))}, ${quote(`case ${ci} (${c.name}): conflicts kept`)});`,
    );
    out.push('');
  });
  out.push('rollback;', '');
  return out.join('\n');
}

// inside a dollar-quoted statement the JSON has to be written inline
const docUuidLiteral = (ci) => `'${docUuid(ci)}'`;
const expandInline = (ops, ci) => {
  const t = JSON.stringify(expand(ops, ci));
  if (t.includes('$j$') || t.includes('$q$')) throw new Error('fixture text must not contain $j$ or $q$');
  return `$j$${t}$j$::jsonb`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let cases = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  if (process.argv.includes('--record')) {
    cases = record(cases);
    // Written the way `prettier --write` would, so the format check stays green and re-recording gives a clean diff.
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(FIXTURE)) ?? {};
    writeFileSync(FIXTURE, await prettier.format(JSON.stringify(cases), { ...options, filepath: FIXTURE }));
    console.log(`recorded ${cases.length} cases into ${FIXTURE}`);
  }
  writeFileSync(OUTPUT, buildSql(cases));
  console.log(`wrote ${OUTPUT}`);
}

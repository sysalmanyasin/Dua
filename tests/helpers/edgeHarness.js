// Test harness for the Edge Function handlers (Audit 0, T2/T3). The handlers call Deno.serve at import time and talk to Supabase
// through supabase/functions/_shared/clients.ts. Here Deno is a stub, clients.ts is replaced by fakes, and the registered handler
// is returned so a test can call it with an ordinary Request. Nothing touches a network or a real project.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const FUNCTIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/functions');

// A chainable stand-in for the Supabase query builder. It records every call in `calls` and answers from `cfg`:
//   cfg.counts(q)            -> number for `select(..., { count, head })` queries
//   cfg.single[table](q)     -> { data, error } for maybeSingle()
//   cfg.result['table:kind'] -> { data, error } for awaited insert/update/delete/select
export function fakeDb(cfg = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, kind: 'select', filters: {}, payload: undefined, opts: undefined };
    const b = {
      select(_c, opts) {
        q.opts = opts;
        return b;
      },
      insert(p) {
        q.kind = 'insert';
        q.payload = p;
        return b;
      },
      update(p) {
        q.kind = 'update';
        q.payload = p;
        return b;
      },
      delete() {
        q.kind = 'delete';
        return b;
      },
      eq(k, v) {
        q.filters[k] = v;
        return b;
      },
      gte() {
        return b;
      },
      maybeSingle() {
        calls.push(q);
        const s = cfg.single?.[table];
        return Promise.resolve(typeof s === 'function' ? s(q) : (s ?? { data: null, error: null }));
      },
      then(res, rej) {
        calls.push(q);
        const r =
          q.kind === 'select' && q.opts?.head
            ? { count: cfg.counts ? cfg.counts(q) : 0, error: null }
            : (cfg.result?.[`${table}:${q.kind}`] ?? { data: null, error: null });
        return Promise.resolve(r).then(res, rej);
      },
    };
    return b;
  };
  return { from, calls, auth: { admin: cfg.admin ?? {} } };
}

// Loads a function's index.ts with the given env and client fakes and returns its request handler.
export async function loadHandler(name, { env = {}, clients = {} } = {}) {
  let handler = null;
  globalThis.Deno = {
    serve: (fn) => {
      handler = fn;
    },
    env: { get: (k) => env[k] },
  };
  vi.resetModules();
  vi.doMock(path.join(FUNCTIONS, '_shared/clients.ts'), () => ({
    serviceClient:
      clients.serviceClient ??
      (() => {
        throw new Error('serviceClient not faked');
      }),
    anonClient:
      clients.anonClient ??
      (() => {
        throw new Error('anonClient not faked');
      }),
    userClient:
      clients.userClient ??
      (() => {
        throw new Error('userClient not faked');
      }),
  }));
  await import(path.join(FUNCTIONS, name, 'index.ts'));
  if (!handler) throw new Error(`${name} did not register a handler with Deno.serve`);
  return handler;
}

export const post = (body, headers = {}) =>
  new Request('https://example.test/functions/v1/fn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://sysalmanyasin.github.io', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

export const PEPPER = 'x'.repeat(40);
export const ENV = {
  ALLOWED_ORIGIN: 'https://sysalmanyasin.github.io',
  PIN_PEPPER: PEPPER,
  IP_HASH_SECRET: 'ipsecret',
  SUPABASE_URL: 'https://p.supabase.co',
};

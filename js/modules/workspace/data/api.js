// Workspace is the only layer that talks to Supabase for Workspace data. Reads go through tables under row level security
// or read functions; every write is one of the database functions (each takes an idempotency key).
import { db } from '../../../core/supabase.js';

// Plain-English messages the database functions raise on purpose. Anything else becomes a generic message, so internal
// details never reach the screen.
const KNOWN = [
  'unknown base version',
  'note content is not valid',
  'the document is archived',
  'not a note',
  'that version is already the current one',
  'no such version',
  'this note has too many saved versions',
  'history is not shared',
  'conflict not found',
  'conflict already resolved',
  'type at least 2 characters',
  'title must be 1 to 200 characters',
  'name must be 1 to 80 characters',
  'that person cannot use Workspace',
  'that person cannot own Workspace documents',
  'choose someone else as the new owner',
  'a document can be shared with at most 50 people',
  'the folder is not empty',
  'folders can be nested at most 5 deep',
  'a folder cannot be placed inside itself',
  'document is deleted',
  // Sheets (1102)
  'not a workbook',
  'no such restore point',
  'that restore point is not valid',
  'a label is at most 100 characters',
  'this workbook is too large to take a restore point of',
  'send 1 to 200 operations',
  'that batch is too large',
  'every operation needs an operation_id and a known operation_type',
];

export class WorkspaceError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
    this.cause = cause;
  }
}

export function friendlyError(error) {
  const msg = String(error?.message ?? '');
  if (error?.code === '42501' || msg === 'not allowed')
    return new WorkspaceError('You do not have access to this.', { code: '42501', cause: error });
  if (error?.code === '23505' || msg.includes('duplicate key'))
    return new WorkspaceError('That name is already used.', { code: '23505', cause: error });
  const known = KNOWN.find((k) => msg.includes(k));
  if (known) return new WorkspaceError(known.charAt(0).toUpperCase() + known.slice(1) + '.', { code: error?.code ?? null, cause: error });
  if (/fetch|network|failed to|offline/i.test(msg))
    return new WorkspaceError('You appear to be offline. Try again when you are connected.', { code: 'offline', cause: error });
  return new WorkspaceError('Something went wrong. Please try again.', { code: error?.code ?? null, cause: error });
}

export async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw friendlyError(error);
  return data;
}

export async function read(query) {
  const { data, error } = await query;
  if (error) throw friendlyError(error);
  return data;
}

export const table = (name) => db().from(name);

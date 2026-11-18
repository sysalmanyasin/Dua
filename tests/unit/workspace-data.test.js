import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], reply: { data: null, error: null }, chain: [] }));

vi.mock('../../js/core/supabase.js', () => {
  const builder = (name) => {
    const b = {
      select: (...a) => (h.chain.push([name, 'select', ...a]), b),
      eq: (...a) => (h.chain.push([name, 'eq', ...a]), b),
      order: (...a) => (h.chain.push([name, 'order', ...a]), b),
      single: () => (h.chain.push([name, 'single']), b),
      then: (res, rej) => Promise.resolve(h.reply).then(res, rej),
    };
    return b;
  };
  return { db: () => ({ rpc: (name, args) => (h.calls.push([name, args]), Promise.resolve(h.reply)), from: builder }) };
});

import { friendlyError, rpc, WorkspaceError } from '../../js/modules/workspace/data/api.js';
import * as docs from '../../js/modules/workspace/data/documents.js';
import * as notes from '../../js/modules/workspace/data/notes.js';
import * as sharing from '../../js/modules/workspace/data/sharing.js';
import * as revisions from '../../js/modules/workspace/data/revisions.js';

beforeEach(() => {
  h.calls = [];
  h.chain = [];
  h.reply = { data: { ok: true }, error: null };
});

describe('error messages', () => {
  it('turns database errors into plain messages', () => {
    expect(friendlyError({ code: '42501', message: 'permission denied' }).message).toBe('You do not have access to this.');
    expect(friendlyError({ message: 'not allowed' }).message).toBe('You do not have access to this.');
    expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint' }).message).toBe(
      'That name is already used.',
    );
    expect(friendlyError({ message: 'unknown base version' }).message).toBe('Unknown base version.');
    expect(friendlyError({ message: 'the folder is not empty' }).message).toBe('The folder is not empty.');
    expect(friendlyError({ message: 'TypeError: Failed to fetch' }).code).toBe('offline');
  });
  it('never shows internal text', () => {
    const e = friendlyError({ message: 'relation "workspace_documents" violates something internal', code: 'XX000' });
    expect(e.message).toBe('Something went wrong. Please try again.');
    expect(e.message).not.toMatch(/workspace_documents/);
    expect(e).toBeInstanceOf(WorkspaceError);
    expect(e.cause.code).toBe('XX000');
  });
  it('rpc() throws the friendly error and returns data otherwise', async () => {
    h.reply = { data: null, error: { code: '42501', message: 'denied' } };
    await expect(rpc('workspace_note_open', { p_doc: 'd' })).rejects.toThrow('You do not have access to this.');
    h.reply = { data: { id: 'd' }, error: null };
    await expect(rpc('workspace_note_open', { p_doc: 'd' })).resolves.toEqual({ id: 'd' });
  });
});

describe('documents', () => {
  it('maps create, list and state calls to the database functions', async () => {
    await docs.createDocument({ id: 'i', kind: 'note', title: 'T', key: 'k' });
    await docs.listDocuments({ scope: 'shared', query: 'rota', after: { after_updated: 't', after_id: 'x' }, limit: 10 });
    await docs.listDocuments();
    await docs.setDocumentState('d', 'archive', 'k2');
    await docs.renameDocument('d', 'New', 'k3');
    await docs.setHistoryVisible('d', false, 'k4');
    expect(h.calls).toEqual([
      ['workspace_create_document', { p_id: 'i', p_kind: 'note', p_title: 'T', p_key: 'k' }],
      ['workspace_list_documents', { p_scope: 'shared', p_query: 'rota', p_after_updated: 't', p_after_id: 'x', p_limit: 10 }],
      ['workspace_list_documents', { p_scope: 'all', p_query: null, p_after_updated: null, p_after_id: null, p_limit: 50 }],
      ['workspace_document_state', { p_doc: 'd', p_action: 'archive', p_key: 'k2' }],
      ['workspace_document_rename', { p_doc: 'd', p_title: 'New', p_key: 'k3' }],
      ['workspace_document_set_history_visible', { p_doc: 'd', p_visible: false, p_key: 'k4' }],
    ]);
  });
  it('folders and flags', async () => {
    await docs.saveFolder({ name: 'Rotas', key: 'k' });
    await docs.removeFolder('f', 'k2');
    await docs.setDocumentFlags('d', { folderId: 'f', pinned: true, offline: true, opened: true });
    await docs.setDocumentFlags('d');
    expect(h.calls).toEqual([
      ['workspace_folder_save', { p_id: null, p_parent: null, p_name: 'Rotas', p_key: 'k' }],
      ['workspace_folder_remove', { p_id: 'f', p_key: 'k2' }],
      ['workspace_state_set', { p_doc: 'd', p_folder: 'f', p_pinned: true, p_offline: true, p_opened: true }],
      ['workspace_state_set', { p_doc: 'd', p_folder: null, p_pinned: false, p_offline: false, p_opened: false }],
    ]);
  });
  it('reads folders and personal state from the tables', async () => {
    h.reply = { data: [{ id: 'f' }], error: null };
    await expect(docs.listFolders()).resolves.toEqual([{ id: 'f' }]);
    await docs.listUserState();
    expect(h.chain.map((c) => c[0])).toContain('workspace_folders');
    expect(h.chain.map((c) => c[0])).toContain('workspace_user_state');
  });
});

describe('sharing', () => {
  it('maps to the database functions', async () => {
    await sharing.shareCandidates('bo');
    await sharing.shareCandidates();
    await sharing.listMembers('d');
    await sharing.setMember('d', 's', 'viewer', 'k');
    await sharing.removeMember('d', 's', 'k2');
    await sharing.transferOwnership('d', 's2', 'k3');
    expect(h.calls).toEqual([
      ['workspace_share_candidates', { p_query: 'bo' }],
      ['workspace_share_candidates', { p_query: null }],
      ['workspace_member_list', { p_doc: 'd' }],
      ['workspace_member_set', { p_doc: 'd', p_staff: 's', p_role: 'viewer', p_key: 'k' }],
      ['workspace_member_remove', { p_doc: 'd', p_staff: 's', p_key: 'k2' }],
      ['workspace_transfer_ownership', { p_doc: 'd', p_new_owner: 's2', p_key: 'k3' }],
    ]);
  });
});

describe('notes and history', () => {
  it('saves with the version the editor started from', async () => {
    await notes.saveNote({ docId: 'd', baseVersion: 3, content: { v: 1 }, opId: 'o' });
    await notes.saveNote({
      docId: 'd',
      baseVersion: 4,
      content: { v: 1 },
      opId: 'o2',
      seal: true,
      resolves: 'c',
      resolution: 'kept_local',
    });
    expect(h.calls).toEqual([
      [
        'workspace_note_save',
        { p_doc: 'd', p_base_version: 3, p_content: { v: 1 }, p_op_id: 'o', p_seal: false, p_resolves: null, p_resolution: 'merged' },
      ],
      [
        'workspace_note_save',
        { p_doc: 'd', p_base_version: 4, p_content: { v: 1 }, p_op_id: 'o2', p_seal: true, p_resolves: 'c', p_resolution: 'kept_local' },
      ],
    ]);
  });
  it('open, restore, search, resolve, history', async () => {
    await notes.openNote('d');
    await notes.restoreNote('d', 2, 'o');
    await notes.searchNotes('zebra');
    await notes.resolveConflict('c', 'dismissed', 'k');
    await revisions.listHistory('d');
    await revisions.listHistory('d', { before: 5, limit: 10 });
    expect(h.calls).toEqual([
      ['workspace_note_open', { p_doc: 'd' }],
      ['workspace_note_restore', { p_doc: 'd', p_version: 2, p_op_id: 'o' }],
      ['workspace_search_notes', { p_query: 'zebra', p_limit: 20 }],
      ['workspace_conflict_resolve', { p_id: 'c', p_choice: 'dismissed', p_key: 'k' }],
      ['workspace_note_history', { p_doc: 'd', p_before: null, p_limit: 50 }],
      ['workspace_note_history', { p_doc: 'd', p_before: 5, p_limit: 10 }],
    ]);
  });
  it('reads conflicts and revisions from tables under row level security', async () => {
    h.reply = { data: [], error: null };
    await notes.listConflicts('d');
    await notes.getConflict('c');
    await revisions.getRevision('d', 2);
    const tables = h.chain.filter((c) => c[1] === 'select').map((c) => c[0]);
    expect(tables).toEqual(['workspace_conflicts', 'workspace_conflicts', 'workspace_note_revisions']);
  });
  it('a failed read throws a friendly error', async () => {
    h.reply = { data: null, error: { code: '42501', message: 'denied' } };
    await expect(notes.listConflicts('d')).rejects.toThrow('You do not have access to this.');
  });
});

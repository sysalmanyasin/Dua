import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_WINDOW_MS,
  describeRevision,
  isConflict,
  isSaved,
  restorableVersions,
  wouldSaveInPlace,
} from '../../js/modules/workspace/domain/revisions.js';
import { cleanQuery, kindLabel, newId, nextCursor, normalizeTitle, sortDocuments } from '../../js/modules/workspace/domain/documents.js';

const NOW = Date.parse('2026-11-18T10:00:00Z');
const head = (over = {}) => ({ created_by: 'u1', kind: 'edit', sealed: false, saved_at: '2026-11-18T09:58:00Z', ...over });

describe('autosave in place (mirrors the server rule)', () => {
  it("updates the same author's open, recent revision", () => {
    expect(wouldSaveInPlace(head(), { userId: 'u1', now: NOW })).toBe(true);
    expect(wouldSaveInPlace(head({ kind: 'create' }), { userId: 'u1', now: NOW })).toBe(true);
  });
  it('starts a new version for another author, a sealed head, an old save, or a merge or restore head', () => {
    expect(wouldSaveInPlace(head(), { userId: 'u2', now: NOW })).toBe(false);
    expect(wouldSaveInPlace(head({ sealed: true }), { userId: 'u1', now: NOW })).toBe(false);
    expect(wouldSaveInPlace(head({ saved_at: '2026-11-18T09:50:00Z' }), { userId: 'u1', now: NOW })).toBe(false);
    expect(wouldSaveInPlace(head({ kind: 'merge' }), { userId: 'u1', now: NOW })).toBe(false);
    expect(wouldSaveInPlace(head({ kind: 'restore' }), { userId: 'u1', now: NOW })).toBe(false);
  });
  it('never saves in place when resolving a conflict, or when there is no head', () => {
    expect(wouldSaveInPlace(head(), { userId: 'u1', now: NOW, resolvingConflict: true })).toBe(false);
    expect(wouldSaveInPlace(null, { userId: 'u1', now: NOW })).toBe(false);
  });
  it('uses a five-minute window', () => {
    expect(AUTOSAVE_WINDOW_MS).toBe(300000);
    const edge = new Date(NOW - AUTOSAVE_WINDOW_MS).toISOString();
    expect(wouldSaveInPlace(head({ saved_at: edge }), { userId: 'u1', now: NOW })).toBe(false);
    expect(wouldSaveInPlace(head({ saved_at: new Date(NOW - AUTOSAVE_WINDOW_MS + 1000).toISOString() }), { userId: 'u1', now: NOW })).toBe(
      true,
    );
  });
});

describe('revision labels and results', () => {
  it('describes each kind', () => {
    expect(describeRevision({ kind: 'create' })).toBe('Created');
    expect(describeRevision({ kind: 'edit' })).toBe('Edited');
    expect(describeRevision({ kind: 'merge' })).toBe('Merged after a conflict');
    expect(describeRevision({ kind: 'restore', restored_from: 3 })).toBe('Restored version 3');
    expect(describeRevision({ kind: 'mystery' })).toBe('Saved');
  });
  it('lists restorable versions without the current one', () => {
    const h = [
      { version: 3, is_head: true },
      { version: 2, is_head: false },
      { version: 1, is_head: false },
    ];
    expect(restorableVersions(h).map((v) => v.version)).toEqual([2, 1]);
  });
  it('tells saved from conflict', () => {
    expect(isConflict({ status: 'conflict' })).toBe(true);
    expect(isConflict({ status: 'saved' })).toBe(false);
    expect(isSaved({ status: 'saved' })).toBe(true);
    expect(isSaved(null)).toBe(false);
    expect(isConflict(undefined)).toBe(false);
  });
});

describe('document helpers', () => {
  it('makes ids and tidies titles and searches', () => {
    expect(newId({ randomUUID: () => 'abc' })).toBe('abc');
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(normalizeTitle('  Pharmacy   rota \n 2026 ')).toBe('Pharmacy rota 2026');
    expect(normalizeTitle(null)).toBe('');
    expect(cleanQuery('  a   b ')).toBe('a b');
    expect(cleanQuery('x'.repeat(300)).length).toBe(100);
    expect(kindLabel('note')).toBe('Note');
    expect(kindLabel('workbook')).toBe('Workbook');
    expect(kindLabel('x')).toBe('');
  });
  it('sorts newest first with a stable tie-break and builds the next cursor', () => {
    const rows = [
      { id: 'a', updated_at: '2026-11-18T10:00:00Z' },
      { id: 'c', updated_at: '2026-11-18T11:00:00Z' },
      { id: 'b', updated_at: '2026-11-18T10:00:00Z' },
    ];
    const sorted = sortDocuments(rows);
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0].id).toBe('a');
    expect(nextCursor(sorted)).toEqual({ after_updated: '2026-11-18T10:00:00Z', after_id: 'a' });
    expect(nextCursor([])).toBeNull();
  });
});

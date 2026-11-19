import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  emptyNote,
  isSafeHref,
  newBlockId,
  notePlainText,
  NOTE_LIMITS,
  validateNote,
  validateTitle,
} from '../../js/modules/workspace/domain/validation.js';
import { buildSql, FIXTURE, OUTPUT } from '../../tools/workspace-note-cases.mjs';

const cases = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const doc = (text, id = 'b1') => ({
  v: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }] },
});

describe('note validation: the shared cases (the database checks the same file)', () => {
  it.each(cases)('$name', ({ note, valid }) => {
    expect(validateNote(note).valid).toBe(valid);
  });
  it('the generated database test is up to date with the fixture', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(buildSql(cases));
  });
  it('every invalid case explains itself', () => {
    for (const c of cases.filter((x) => !x.valid)) {
      const r = validateNote(c.note);
      expect(r.errors.length, c.name).toBe(1);
      expect(r.errors[0].length).toBeGreaterThan(5);
    }
  });
});

describe('note validation: limits and odd input', () => {
  it('refuses things that are not notes', () => {
    for (const bad of [null, undefined, 5, 'text', [], { v: 1 }, { v: 1, doc: null }, { v: 1, doc: { type: 'doc' } }]) {
      expect(validateNote(bad).valid).toBe(false);
    }
  });
  it('refuses an oversize note and accepts one just under the limit', () => {
    expect(validateNote(doc('x'.repeat(NOTE_LIMITS.text))).valid).toBe(true);
    const big = {
      v: 1,
      doc: {
        type: 'doc',
        content: Array.from({ length: 6 }, (_, i) => ({
          type: 'paragraph',
          attrs: { id: `p${i}` },
          content: [{ type: 'text', text: 'y'.repeat(45000) }],
        })),
      },
    };
    const r = validateNote(big);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/too large/);
  });
  it('refuses text longer than 50,000 characters', () => {
    expect(validateNote(doc('x'.repeat(NOTE_LIMITS.text + 1))).valid).toBe(false);
  });
  it('counts characters, not UTF-16 units, like the database', () => {
    expect(validateNote(doc('😀'.repeat(NOTE_LIMITS.text))).valid).toBe(true);
  });
  it('refuses more than 5,000 blocks', () => {
    const many = {
      v: 1,
      doc: { type: 'doc', content: Array.from({ length: 5001 }, (_, i) => ({ type: 'paragraph', attrs: { id: `p${i}` } })) },
    };
    expect(validateNote(many).valid).toBe(false);
    many.doc.content.pop();
    expect(validateNote(many).valid).toBe(true);
  });
  it('never accepts an inherited or prototype property as a node key', () => {
    const sneaky = JSON.parse('{"v":1,"doc":{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"a"},"__proto__":{"x":1}}]}}');
    expect(validateNote(sneaky).valid).toBe(false);
  });
});

describe('links', () => {
  it('accepts http, https, mailto and tel only', () => {
    for (const ok of ['http://a.com', 'https://a.com/x?y=1#z', 'HTTPS://A.COM', 'mailto:a@b.co', 'tel:+9200'])
      expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://a.com',
      '//a.com',
      '/relative',
      'https://a.com/a b',
      'https://a.com/\u0000',
      '',
      'https://',
      null,
      5,
    ]) {
      expect(isSafeHref(bad), String(bad)).toBe(false);
    }
  });
  it('refuses links longer than 2,000 characters', () => {
    expect(isSafeHref(`https://a.com/${'x'.repeat(1986)}`)).toBe(true); // exactly 2,000 characters
    expect(isSafeHref(`https://a.com/${'x'.repeat(1987)}`)).toBe(false);
  });
});

describe('new notes and ids', () => {
  it('an empty note is valid', () => {
    expect(validateNote(emptyNote()).valid).toBe(true);
    expect(emptyNote('abc').doc.content[0].attrs.id).toBe('abc');
  });
  it('block ids are short, safe and different each time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newBlockId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
  it('block ids use the random source they are given', () => {
    const fake = { getRandomValues: (b) => b.fill(1) };
    expect(newBlockId(fake)).toBe('b111111111');
  });
});

describe('plain text', () => {
  it('puts line breaks between blocks and keeps inline text together (same as the database)', () => {
    const note = {
      v: 1,
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { id: 'h', level: 1 }, content: [{ type: 'text', text: 'Title' }] },
          {
            type: 'paragraph',
            attrs: { id: 'p' },
            content: [
              { type: 'text', text: 'one ' },
              { type: 'text', text: 'two', marks: [{ type: 'bold' }] },
              { type: 'hard_break' },
              { type: 'text', text: 'three' },
            ],
          },
          {
            type: 'bullet_list',
            attrs: { id: 'l' },
            content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }],
          },
        ],
      },
    };
    expect(notePlainText(note)).toBe('Title\none two\nthree\nitem');
  });
  it('is capped at 20,000 characters', () => {
    expect([...notePlainText(doc('x'.repeat(40000)))].length).toBe(20000);
  });
  it('an empty note has no text', () => {
    expect(notePlainText(emptyNote())).toBe('');
    expect(notePlainText(null)).toBe('');
  });
});

describe('titles', () => {
  it('needs 1 to 200 characters after trimming', () => {
    expect(validateTitle('Rota')).toBeNull();
    expect(validateTitle('   ')).toMatch(/title/i);
    expect(validateTitle('')).toMatch(/title/i);
    expect(validateTitle(undefined)).toMatch(/title/i);
    expect(validateTitle('x'.repeat(200))).toBeNull();
    expect(validateTitle('x'.repeat(201))).toMatch(/200/);
    expect(validateTitle(`  ${'x'.repeat(200)}  `)).toBeNull();
  });
});

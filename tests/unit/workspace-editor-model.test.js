// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FIXTURE } from '../../tools/workspace-note-cases.mjs';
import * as PM from '../../vendor/workspace/prosemirror-bundle-1.0.0.mjs';
import { docToNote, noteToDocJson, SCHEMA_SPEC } from '../../js/modules/workspace/domain/editorModel.js';
import { emptyNote, validateNote } from '../../js/modules/workspace/domain/validation.js';

const cases = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const schema = new PM.Schema(SCHEMA_SPEC);
let counter = 0;
const ids = () => `g${++counter}`;

describe('the editor schema and the note format agree', () => {
  const valid = cases.filter((c) => c.valid);

  it.each(valid)('a valid note loads into the editor and comes back valid and unchanged: $name', ({ note }) => {
    const node = schema.nodeFromJSON(noteToDocJson(note));
    node.check();
    const back = docToNote(node.toJSON(), ids);
    expect(validateNote(back).valid).toBe(true);
    expect(back).toEqual(note);
  });

  it('what the schema refuses, the validator refuses too (checked on the shared invalid cases)', () => {
    let refusedBySchema = 0;
    for (const { note, valid } of cases.filter((c) => !c.valid)) {
      let loads = true;
      try {
        schema.nodeFromJSON(noteToDocJson(note)).check();
      } catch {
        loads = false;
      }
      if (!loads) refusedBySchema += 1;
      // Anything the editor can load and write back must still be judged by the validator, never trusted.
      if (loads) {
        const back = docToNote(schema.nodeFromJSON(noteToDocJson(note)).toJSON(), ids);
        expect(typeof validateNote(back).valid).toBe('boolean');
      }
      expect(valid).toBe(false);
    }
    expect(refusedBySchema).toBeGreaterThan(10);
  });

  it('every node and mark of the schema is one the note format allows, and nothing is missing', () => {
    expect(Object.keys(SCHEMA_SPEC.nodes).sort()).toEqual([
      'bullet_list',
      'doc',
      'hard_break',
      'heading',
      'list_item',
      'ordered_list',
      'paragraph',
      'task_item',
      'task_list',
      'text',
    ]);
    expect(Object.keys(SCHEMA_SPEC.marks).sort()).toEqual(['bold', 'italic', 'link', 'underline']);
  });
});

describe('docToNote', () => {
  it('gives every top-level block a valid, unique id and leaves nested blocks without one', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'same' }, content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', attrs: { id: 'same' }, content: [{ type: 'text', text: 'b' }] },
        { type: 'paragraph', attrs: { id: null } },
        { type: 'heading', attrs: { id: 'bad id', level: 2 }, content: [{ type: 'text', text: 'h' }] },
        {
          type: 'bullet_list',
          attrs: { id: null },
          content: [{ type: 'list_item', content: [{ type: 'paragraph', attrs: { id: 'nested' } }] }],
        },
      ],
    };
    counter = 0;
    const note = docToNote(json, ids);
    const topIds = note.doc.content.map((n) => n.attrs.id);
    expect(new Set(topIds).size).toBe(5);
    expect(topIds[0]).toBe('same');
    expect(topIds[1]).not.toBe('same');
    expect(note.doc.content[4].content[0].content[0].attrs).toBeUndefined();
    expect(validateNote(note).valid).toBe(true);
  });

  it('removes null and unknown attributes and keeps only what the format allows', () => {
    const note = docToNote(
      {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { id: 'h', level: 3, class: 'x' },
            content: [{ type: 'text', text: 't', marks: [{ type: 'link', attrs: { href: 'https://a.com', target: '_blank' } }] }],
          },
        ],
      },
      ids,
    );
    expect(note.doc.content[0].attrs).toEqual({ id: 'h', level: 3 });
    expect(note.doc.content[0].content[0].marks).toEqual([{ type: 'link', attrs: { href: 'https://a.com' } }]);
  });

  it('writes an explicit checked flag for tasks', () => {
    const note = docToNote(
      {
        type: 'doc',
        content: [
          {
            type: 'task_list',
            attrs: { id: 'a' },
            content: [
              { type: 'task_item', attrs: { checked: null }, content: [{ type: 'paragraph' }] },
              { type: 'task_item', attrs: { checked: true }, content: [{ type: 'paragraph' }] },
            ],
          },
        ],
      },
      ids,
    );
    expect(note.doc.content[0].content.map((t) => t.attrs.checked)).toEqual([false, true]);
    expect(validateNote(note).valid).toBe(true);
  });

  it('an empty editor document gives an empty list of blocks (the caller keeps at least one)', () => {
    expect(docToNote({ type: 'doc' }).doc.content).toEqual([]);
    expect(docToNote(null).doc.content).toEqual([]);
  });

  it('a new empty note loads into the editor', () => {
    const node = schema.nodeFromJSON(noteToDocJson(emptyNote('x')));
    node.check();
    expect(node.childCount).toBe(1);
  });
});

describe('pasting: only what the note format allows survives', () => {
  const parser = PM.ProseMirrorDOMParser.fromSchema(schema);
  const paste = (markup) => {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    return docToNote(parser.parse(doc.body).toJSON(), ids);
  };
  const text = (note) => JSON.stringify(note);

  it('keeps headings, emphasis, lists and safe links', () => {
    const note = paste(
      '<h1>Title</h1><p>a <strong>b</strong> <em>c</em> <u>d</u> <a href="https://example.com/x">link</a></p><ul><li>one</li></ul><ol><li>two</li></ol>',
    );
    expect(validateNote(note).valid).toBe(true);
    expect(note.doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bullet_list', 'ordered_list']);
    expect(text(note)).toContain('"type":"bold"');
    expect(text(note)).toContain('"href":"https://example.com/x"');
  });
  it('drops scripts, styles, images, iframes and event handlers but keeps the visible text', () => {
    const note = paste(
      '<p onclick="alert(1)">hello<script>alert(1)</script><style>p{color:red}</style><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe> world</p>',
    );
    expect(validateNote(note).valid).toBe(true);
    const out = text(note);
    expect(out).not.toMatch(/script|onclick|onerror|iframe|img|style/);
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });
  it('keeps the words of an unsafe link but not the link', () => {
    const note = paste(
      '<p><a href="javascript:alert(1)">click me</a> <a href="data:text/html,x">data</a> <a href="ftp://a.com/f">ftp</a></p>',
    );
    expect(validateNote(note).valid).toBe(true);
    expect(text(note)).not.toMatch(/"link"|href|javascript:|data:text/);
    expect(text(note)).toContain('click me');
  });
  it('turns h4 to h6 into level 3 headings and ignores unknown block tags', () => {
    const note = paste('<h5>Deep</h5><table><tr><td>cell</td></tr></table><div>plain</div>');
    expect(validateNote(note).valid).toBe(true);
    expect(note.doc.content[0].attrs.level).toBe(3);
    expect(text(note)).toContain('cell');
    expect(text(note)).toContain('plain');
  });
  it("turns the editor's own checklist markup back into a checklist", () => {
    const note = paste(
      '<ul data-type="task_list"><li data-type="task_item" data-checked="true"><p>done</p></li><li data-type="task_item" data-checked="false"><p>todo</p></li></ul>',
    );
    expect(note.doc.content[0].type).toBe('task_list');
    expect(note.doc.content[0].content.map((t) => t.attrs.checked)).toEqual([true, false]);
  });
  it('whatever is pasted, the result is a valid note once the editor keeps at least one block', () => {
    for (const markup of ['', '<div></div>', '<b></b>', 'just text', '<p>' + 'x'.repeat(60000) + '</p>']) {
      const note = paste(markup);
      if (note.doc.content.length === 0) continue;
      const r = validateNote(note);
      if (!r.valid) expect(r.errors[0]).toMatch(/text must be|too large/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw } from '../../js/shared/html.js';

describe('html template', () => {
  it('escapes interpolated values', () => {
    expect(html`<p>${'<script>alert(1)</script>'}</p>`.toString()).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
  it('escapes quotes so attributes cannot be broken out of', () => {
    expect(html`<input value="${'" onfocus="x()'}" />`.toString()).toBe('<input value="&quot; onfocus=&quot;x()" />');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
  it('treats null/undefined as empty and numbers as text', () => {
    expect(html`${null}|${undefined}|${0}`.toString()).toBe('||0');
  });
  it('joins arrays of templates and escapes arrays of strings', () => {
    expect(html`${[html`<i>${'a&b'}</i>`, html`<b>2</b>`]}`.toString()).toBe('<i>a&amp;b</i><b>2</b>');
    expect(html`${['<x>', '<y>']}`.toString()).toBe('&lt;x&gt;&lt;y&gt;');
  });
  it('only raw() output is trusted', () => {
    expect(html`${raw('<b>ok</b>')}`.toString()).toBe('<b>ok</b>');
    expect(html`${'<b>no</b>'}`.toString()).toBe('&lt;b&gt;no&lt;/b&gt;');
  });
  it('a nested template is not double-escaped, a plain string that looks like one is', () => {
    const inner = html`<u>${'x'}</u>`;
    expect(html`${inner}`.toString()).toBe('<u>x</u>');
    expect(html`${inner.toString()}`.toString()).toBe('&lt;u&gt;x&lt;/u&gt;');
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { openPanel } from '../../js/modules/workspace/ui/panel.js';

const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const count = () => document.querySelectorAll('.ws-panel').length;

afterEach(() => {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  document.querySelectorAll('.ws-backdrop').forEach((n) => n.remove());
});

describe('stacked panels', () => {
  it('Escape closes only the panel on top, then the one below', () => {
    const closed = [];
    openPanel({ title: 'Below', onClose: () => closed.push('below') });
    openPanel({ title: 'Above', onClose: () => closed.push('above') });
    expect(count()).toBe(2);
    escape();
    expect(closed).toEqual(['above']);
    expect(count()).toBe(1);
    escape();
    expect(closed).toEqual(['above', 'below']);
    expect(count()).toBe(0);
  });

  it('after the top panel is closed by its button, the one below answers the keyboard again', () => {
    const below = openPanel({ title: 'Below' });
    const above = openPanel({ title: 'Above' });
    above.close();
    escape();
    expect(below.isOpen()).toBe(false);
  });

  it('closing the one below first does not stop the top one from answering', () => {
    const below = openPanel({ title: 'Below' });
    const above = openPanel({ title: 'Above' });
    below.close();
    escape();
    expect(above.isOpen()).toBe(false);
  });

  it('a change of address closes every panel', () => {
    openPanel({ title: 'One' });
    openPanel({ title: 'Two' });
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(count()).toBe(0);
  });
});

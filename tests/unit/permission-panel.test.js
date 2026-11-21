// @vitest-environment jsdom
// The grouped permission list in a DOM: groups open and close, a tick is saved as the smallest change and shown at once,
// a failed save puts the row back with a message, search and filters narrow the list, and bulk changes need a second tap.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPermissionPanel } from '../../js/shared/permissionPanel.js';

const permissions = [
  { key: 'audit.count', description: 'Count assigned audit items' },
  { key: 'audit.assign', description: 'Assign audit counters' },
  { key: 'audit.compile', description: 'Compile rounds' },
  { key: 'closing.enter_own', description: 'Enter own closing' },
  { key: 'mgmt.salary', description: 'Salary' },
];
const rolePerms = [
  { role: 'junior', perm_key: 'audit.count' },
  { role: 'junior', perm_key: 'closing.enter_own' },
];
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const box = (root, key) => root.querySelector(`input[data-key="${key}"]`);
const setBox = (root, key, checked) => {
  const b = box(root, key);
  b.checked = checked;
  b.dispatchEvent(new Event('change', { bubbles: true }));
};
const open = (root, group) => click(root.querySelector(`button[data-pg="group"][data-group="${group}"]`));

let root;
let save;
function mount(extra = {}) {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  return mountPermissionPanel(root, { permissions, role: 'junior', rolePerms, overrides: [], save, ...extra });
}
beforeEach(() => {
  save = vi.fn(async () => {});
});

describe('permission panel', () => {
  it('shows closed groups with counts, and no checkboxes until a group is opened', () => {
    mount();
    const names = [...root.querySelectorAll('.pg-gname')].map((n) => n.textContent);
    expect(names).toEqual(['Audit', 'Closing', 'Manager']);
    expect(root.querySelector('.pg-group[data-group="audit"] .pg-count').textContent).toBe('1 of 3 allowed');
    expect(root.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    open(root, 'audit');
    expect(root.querySelectorAll('input[type="checkbox"]').length).toBe(3);
    expect(box(root, 'audit.count').checked).toBe(true);
    expect(box(root, 'audit.assign').checked).toBe(false);
  });

  it('opens groups that already hold personal settings', () => {
    mount({ overrides: [{ perm_key: 'mgmt.salary', effect: 'grant' }] });
    expect(box(root, 'mgmt.salary').checked).toBe(true);
    expect(root.querySelector('.pg-tag-grant').textContent).toBe('Custom: allowed');
    expect(box(root, 'audit.count')).toBeNull();
  });

  it('ticking a box the role does not give saves an Allow and shows it at once', async () => {
    const changed = vi.fn();
    mount({ onChange: changed });
    open(root, 'audit');
    setBox(root, 'audit.assign', true);
    expect(box(root, 'audit.assign').checked).toBe(true);
    expect(root.querySelector('.pg-custom-n').textContent).toBe('1 custom');
    await tick();
    expect(save).toHaveBeenCalledWith('audit.assign', 'grant');
    expect(changed).toHaveBeenLastCalledWith([{ perm_key: 'audit.assign', effect: 'grant' }]);
    expect(root.querySelector('.pg-status').textContent).toBe('Saved');
  });

  it('unticking what the role gives saves a Deny; ticking it again clears the setting', async () => {
    mount();
    open(root, 'audit');
    setBox(root, 'audit.count', false);
    await tick();
    expect(save).toHaveBeenLastCalledWith('audit.count', 'deny');
    expect(root.querySelector('.pg-tag-deny').textContent).toBe('Custom: blocked');
    setBox(root, 'audit.count', true);
    await tick();
    expect(save).toHaveBeenLastCalledWith('audit.count', null);
    expect(root.querySelector('.pg-tag')).toBeNull();
  });

  it('puts the row back and says so when a save fails', async () => {
    save = vi.fn(async () => {
      throw new Error('nope');
    });
    mount({ formatError: () => 'Could not save that.' });
    open(root, 'audit');
    setBox(root, 'audit.assign', true);
    await tick();
    expect(box(root, 'audit.assign').checked).toBe(false);
    const msg = root.querySelector('[data-pg-msg]');
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toBe('Could not save that.');
  });

  it('search and the Custom filter narrow the list', () => {
    mount({ overrides: [{ perm_key: 'audit.compile', effect: 'grant' }] });
    const search = root.querySelector('.pg-search');
    search.value = 'salary';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...root.querySelectorAll('input[type="checkbox"]')].map((b) => b.dataset.key)).toEqual(['mgmt.salary']);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    click(root.querySelector('button[data-filter="custom"]'));
    expect([...root.querySelectorAll('input[type="checkbox"]')].map((b) => b.dataset.key)).toEqual(['audit.compile']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.pg-empty')).not.toBeNull();
  });

  it('Allow all needs a second tap and saves only the rows that change', async () => {
    mount();
    open(root, 'audit');
    const allow = () => root.querySelector('button[data-action="allow"][data-group="audit"]');
    click(allow());
    expect(save).not.toHaveBeenCalled();
    expect(allow().textContent.trim()).toBe('Tap again: allow 2');
    click(allow());
    await tick();
    expect(save.mock.calls).toEqual([
      ['audit.assign', 'grant'],
      ['audit.compile', 'grant'],
    ]);
    expect(box(root, 'audit.assign').checked).toBe(true);
  });

  it('Reset to role clears every personal setting after a second tap', async () => {
    mount({
      overrides: [
        { perm_key: 'audit.compile', effect: 'grant' },
        { perm_key: 'audit.count', effect: 'deny' },
      ],
    });
    const reset = () => root.querySelector('button[data-pg="reset-all"]');
    click(reset());
    expect(save).not.toHaveBeenCalled();
    click(reset());
    await tick();
    expect(save.mock.calls).toEqual([
      ['audit.compile', null],
      ['audit.count', null],
    ]);
    expect(reset().disabled).toBe(true);
  });

  it('a failed bulk change restores only the rows that were not saved', async () => {
    let n = 0;
    save = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error('boom');
    });
    mount();
    open(root, 'audit');
    const allow = () => root.querySelector('button[data-action="allow"][data-group="audit"]');
    click(allow());
    click(allow());
    await tick();
    expect(box(root, 'audit.assign').checked).toBe(true); // saved
    expect(box(root, 'audit.compile').checked).toBe(false); // not saved, put back
    expect(root.querySelector('[data-pg-msg]').textContent).toContain('1 of 2 changes were saved');
  });

  it('disables every control when the account is disabled', () => {
    mount({ disabled: true });
    open(root, 'audit');
    expect(box(root, 'audit.count').disabled).toBe(true);
  });
});

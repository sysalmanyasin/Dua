// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gmail, prefs } = vi.hoisted(() => ({
  gmail: { sendGmail: vi.fn(async () => ({ ok: true, id: '1' })) },
  prefs: { getPref: vi.fn(async () => 'saved@example.com'), setPref: vi.fn(async () => ({ error: null })) },
}));
vi.mock('../../js/core/gmail.js', async () => ({
  ...(await vi.importActual('../../js/core/gmail.js')),
  sendGmail: (...a) => gmail.sendGmail(...a),
}));
vi.mock('../../js/core/prefs.js', () => prefs);

import { openMailDialog } from '../../js/shared/mailDialog.js';
import { openDialog } from '../../js/modules/sales/ui/parts.js';

const tick = () => new Promise((r) => setTimeout(r, 10));
const toast = vi.fn();
const onSent = vi.fn();
const open = () => openMailDialog({ subject: 'Subject A', html: '<p>x</p>', text: 'x', openDialog, toast, onSent });
const dlg = () => document.querySelector('dialog');

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.body.innerHTML = '';
  [gmail.sendGmail, prefs.getPref, prefs.setPref, toast, onSent].forEach((f) => f.mockClear());
  gmail.sendGmail.mockImplementation(async () => ({ ok: true, id: '1' }));
});

describe('Send via Gmail dialog', () => {
  it('opens with the last used addresses and the subject filled in', async () => {
    await open();
    expect(dlg().querySelector('#mail-to').value).toBe('saved@example.com');
    expect(dlg().querySelector('#mail-subject').value).toBe('Subject A');
  });
  it('does not call Gmail for a bad address, and says which one', async () => {
    await open();
    dlg().querySelector('#mail-to').value = 'good@example.com, nope';
    dlg().querySelector('[data-send]').click();
    await tick();
    expect(gmail.sendGmail).not.toHaveBeenCalled();
    expect(dlg().querySelector('#mail-note').textContent).toContain('nope');
  });
  it('sends, remembers the addresses, closes, confirms, and reports back', async () => {
    await open();
    dlg().querySelector('#mail-to').value = 'a@b.pk; c@d.com';
    dlg().querySelector('#mail-subject').value = 'Edited subject';
    dlg().querySelector('[data-send]').click();
    await tick();
    const [mail] = gmail.sendGmail.mock.calls[0];
    expect(mail).toMatchObject({ to: 'a@b.pk; c@d.com', subject: 'Edited subject', html: '<p>x</p>', text: 'x' });
    expect(prefs.setPref).toHaveBeenCalledWith('mail.recipients', 'a@b.pk, c@d.com');
    expect(toast).toHaveBeenCalledWith('Sent to a@b.pk, c@d.com');
    expect(onSent).toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('keeps the dialog open and shows the reason when Gmail refuses', async () => {
    gmail.sendGmail.mockImplementation(async () => ({ ok: false, message: 'Gmail access was not allowed.' }));
    await open();
    dlg().querySelector('[data-send]').click();
    await tick();
    expect(dlg().querySelector('#mail-note').textContent).toBe('Gmail access was not allowed.');
    expect(dlg().querySelector('[data-send]').disabled).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
  });
  it('escapes the subject it shows', async () => {
    await openMailDialog({ subject: '"><img src=x onerror=alert(1)>', html: '', text: '', openDialog, toast });
    expect(dlg().querySelector('img')).toBeNull();
  });
});

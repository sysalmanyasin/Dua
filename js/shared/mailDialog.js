// "Send via Gmail" for any report: asks where to send it, remembers the last addresses, and sends.
import { html } from './html.js';
import { parseRecipients, sendGmail } from '../core/gmail.js';
import { getPref, setPref } from '../core/prefs.js';

const KEY = 'mail.recipients';

// openDialog and toast come from the caller so this file stays free of any one module's UI.
export async function openMailDialog({ subject, html: bodyHtml, text, hint, openDialog, toast, onSent }) {
  const saved = (await getPref(KEY).catch(() => null)) ?? '';
  const dlg = openDialog(
    html`<h2>Send via Gmail</h2>
      <p class="muted small">
        Sent from your own Gmail account. Google will ask you to allow sending once; the app can never read your mail.
      </p>
      <label class="field"
        ><span>To (separate several with commas)</span><input id="mail-to" type="email" multiple autocomplete="email" value="${saved}"
      /></label>
      <label class="field"><span>Subject</span><input id="mail-subject" value="${subject}" /></label>
      <p class="note" id="mail-note" role="status"></p>
      <div class="actions-bar"><button class="btn btn-primary" data-send>Send</button><button class="btn" data-close>Cancel</button></div>`,
    { label: 'Send via Gmail' },
  );
  const note = dlg.querySelector('#mail-note');
  const say = (m, bad) => {
    note.textContent = m;
    note.className = `note ${bad ? 'note-error' : ''}`;
  };
  dlg.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-send]');
    if (!btn) return;
    const to = dlg.querySelector('#mail-to').value;
    const rec = parseRecipients(to);
    if (!rec.ok) return say(rec.bad.length ? `Check this address: ${rec.bad[0]}` : 'Enter at least one e-mail address (up to 10).', true);
    btn.disabled = true;
    say('Opening Google… allow sending in the window that appears.');
    const r = await sendGmail({ to, subject: dlg.querySelector('#mail-subject').value || subject, html: bodyHtml, text }, { hint });
    btn.disabled = false;
    if (!r.ok) return say(r.message, true);
    setPref(KEY, rec.list.join(', ')).catch?.(() => {});
    dlg.close();
    toast(`Sent to ${rec.list.join(', ')}`);
    onSent?.();
  });
}

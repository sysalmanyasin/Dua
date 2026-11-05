// Signed-out screens: login (staff / admin), request access, set PIN, MFA.
import { html, raw, render } from '../shared/html.js';
import { icon } from '../shared/icons.js';
import { adminSignIn, claimAccount, mfaEnroll, mfaState, mfaVerify, requestAccess, signOut, staffSignIn } from './auth.js';

const frame = (inner) =>
  html`<main class="auth">
    <section class="card auth-card">
      <div class="brand">
        ${icon('shield')}
        <h1>Dua</h1>
      </div>
      ${inner}
    </section>
  </main>`;
const note = (m, kind = 'info') => (m ? html`<p class="note note-${kind}" role="status">${m}</p>` : '');

function field(label, name, attrs = '') {
  return html`<label class="field"><span>${label}</span><input name="${name}" ${raw(attrs)} required /></label>`;
}

export function showLogin(root, { onDone, tab = 'staff', message = '', kind = 'error' } = {}) {
  const tabs = html`<div class="tabs" role="tablist">
    <button type="button" role="tab" class="tab" aria-selected="${tab === 'staff'}" data-go="staff">Staff</button>
    <button type="button" role="tab" class="tab" aria-selected="${tab === 'admin'}" data-go="admin">Owner / Manager</button>
  </div>`;
  const staffForm = html`<form data-form="staff" autocomplete="on">
      ${field('Username', 'username', 'autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24"')}
      ${field('6-digit PIN', 'pin', 'type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password"')}
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <p class="links">
      <button type="button" class="link" data-go="claim">I have a setup code</button> ·
      <button type="button" class="link" data-go="request">Request access</button>
    </p>`;
  const adminForm = html`<form data-form="admin" autocomplete="on">
    ${field('Email', 'email', 'type="email" autocomplete="username"')}
    ${field('Password', 'password', 'type="password" autocomplete="current-password"')}
    <button class="btn btn-primary" type="submit">Continue</button>
  </form>`;
  render(
    root,
    frame(
      html`${tabs}${note(message, kind)}${tab === 'staff' ? staffForm : adminForm}
        <p id="status" class="note" role="status"></p>`,
    ),
  );
  bind(root, {
    go: (to) =>
      to === 'request'
        ? showRequest(root, { onDone })
        : to === 'claim'
          ? showClaim(root, { onDone })
          : showLogin(root, { onDone, tab: to }),
    staff: async (f) => submit(root, await staffSignIn(f.username, f.pin), onDone),
    admin: async (f) => submit(root, await adminSignIn(f.email, f.password), onDone),
  });
}

async function submit(root, result, onDone) {
  if (result.ok) return onDone();
  setStatus(root, result.message, 'error');
}

export function showRequest(root, { onDone }) {
  render(
    root,
    frame(
      html`<h2>Request access</h2>
        <p class="muted">The owner must approve you before you can sign in.</p>
        <form data-form="request">
          ${field('Your full name', 'full_name', 'autocomplete="name" maxlength="80"')}
          ${field('Username you want', 'username', 'autocapitalize="none" spellcheck="false" maxlength="24"')}
          <button class="btn btn-primary" type="submit">Send request</button>
        </form>
        <p id="status" class="note" role="status"></p>
        <p class="links"><button type="button" class="link" data-go="staff">Back</button></p>`,
    ),
  );
  bind(root, {
    go: () => showLogin(root, { onDone }),
    request: async (f) => {
      const r = await requestAccess(f.full_name, f.username);
      setStatus(root, r.message, r.ok ? 'ok' : 'error');
    },
  });
}

export function showClaim(root, { onDone }) {
  render(
    root,
    frame(
      html`<h2>Set your PIN</h2>
        <p class="muted">Enter the one-time code the owner gave you, then choose a 6-digit PIN.</p>
        <form data-form="claim">
          ${field('Username', 'username', 'autocapitalize="none" spellcheck="false" maxlength="24"')}
          ${field('Setup code', 'code', 'autocapitalize="characters" autocomplete="one-time-code" maxlength="11"')}
          ${field('New 6-digit PIN', 'pin', 'type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password"')}
          ${field('Repeat PIN', 'pin2', 'type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password"')}
          <button class="btn btn-primary" type="submit">Save PIN</button>
        </form>
        <p id="status" class="note" role="status"></p>
        <p class="links"><button type="button" class="link" data-go="staff">Back</button></p>`,
    ),
  );
  bind(root, {
    go: () => showLogin(root, { onDone }),
    claim: async (f) => {
      if (f.pin !== f.pin2) return setStatus(root, 'The two PINs do not match.', 'error');
      const r = await claimAccount(f.username, f.code, f.pin);
      if (r.ok) showLogin(root, { onDone, message: r.message, kind: 'ok' });
      else setStatus(root, r.message, 'error');
    },
  });
}

// Admins must pass MFA (the database refuses everything until aal2).
export async function showMfa(root, { onDone }) {
  const state = await mfaState();
  let factorId = state.factorId;
  let setup = '';
  if (!factorId) {
    const e = await mfaEnroll();
    if (!e.ok) {
      render(root, frame(html`${note(e.message, 'error')}<button class="btn" data-go="out">Sign out</button>`));
      bind(root, { go: () => signOut() });
      return;
    }
    factorId = e.factorId;
    setup = html`<p class="muted">Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy).</p>
      <img class="qr" alt="MFA QR code" src="${e.qr}" width="180" height="180" />
      <p class="muted small">Or type this key: <code>${e.secret}</code></p>`;
  }
  render(
    root,
    frame(
      html`<h2>Two-step verification</h2>
        ${setup}
        <form data-form="mfa">
          ${field('6-digit code from your app', 'code', 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}
          <button class="btn btn-primary" type="submit">Verify</button>
        </form>
        <p id="status" class="note" role="status"></p>
        <p class="links"><button type="button" class="link" data-go="out">Sign out</button></p>`,
    ),
  );
  bind(root, {
    go: () => signOut(),
    mfa: async (f) => {
      const r = await mfaVerify(factorId, f.code);
      if (r.ok) onDone();
      else setStatus(root, r.message, 'error');
    },
  });
}

export function showBlocked(root, message) {
  render(root, frame(html`${note(message, 'error')}<button class="btn" data-go="out">Back to sign in</button>`));
  bind(root, { go: () => signOut() });
}

function setStatus(root, message, kind) {
  const el = root.querySelector('#status');
  if (!el) return;
  el.textContent = message;
  el.className = `note note-${kind}`;
}

// One delegated listener per screen; no inline handlers (CSP forbids them).
function bind(root, handlers) {
  root.onsubmit = async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await handlers[form.dataset.form](Object.fromEntries(new FormData(form)));
    } finally {
      btn.disabled = false;
    }
  };
  root.onclick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go) handlers.go(go.dataset.go);
  };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { b64url, buildMime, encodeHeader, forgetToken, parseRecipients, sendGmail, toBase64 } from '../../js/core/gmail.js';

const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
const fromRaw = (raw) => decode(raw.replace(/-/g, '+').replace(/_/g, '/'));

describe('encoding', () => {
  it('base64 handles every character, including rupee signs and dashes, and url-safe form has no + / =', () => {
    const t = '₨ 614,758 — café ✓';
    expect(decode(toBase64(t))).toBe(t);
    const u = b64url('???>>>~~~ ₨₨₨');
    expect(u).not.toMatch(/[+/=]/);
    expect(fromRaw(u)).toBe('???>>>~~~ ₨₨₨');
  });
  it('plain subjects stay plain, other languages are encoded in short words', () => {
    expect(encodeHeader('Bahria Town Sale Report')).toBe('Bahria Town Sale Report');
    const enc = encodeHeader('Daily Check List — Bahria Town — 2026-11-07');
    expect(enc).toMatch(/^=\?UTF-8\?B\?/);
    for (const w of enc.split('\r\n ')) expect(w.length).toBeLessThanOrEqual(75);
    expect(
      enc
        .split('\r\n ')
        .map((w) => decode(w.slice(10, -2)))
        .join(''),
    ).toBe('Daily Check List — Bahria Town — 2026-11-07');
  });
  it('a subject cannot smuggle in extra headers', () => {
    const mime = buildMime({ to: 'a@b.pk', subject: 'Hi\r\nBcc: spy@evil.com', html: '<p>x</p>', text: 'x' });
    expect(mime.split('\r\n').some((l) => /^bcc:/i.test(l))).toBe(false);
    expect(mime).toContain('Subject: Hi Bcc: spy@evil.com');
  });
});

describe('recipients', () => {
  it('accepts a list separated by commas, semicolons or spaces, removes repeats, and flags bad ones', () => {
    expect(parseRecipients('a@b.pk, c@d.com;a@b.pk e@f.org')).toMatchObject({ ok: true, list: ['a@b.pk', 'c@d.com', 'e@f.org'], bad: [] });
    expect(parseRecipients('a@b.pk, nope').ok).toBe(false);
    expect(parseRecipients('nope').bad).toEqual(['nope']);
    expect(parseRecipients('').ok).toBe(false);
    expect(parseRecipients('"x"@y.pk').ok).toBe(false);
    expect(parseRecipients(Array.from({ length: 11 }, (_, i) => `u${i}@x.pk`).join(',')).ok).toBe(false);
  });
});

describe('message', () => {
  it('has plain text and HTML parts that decode back to the originals', () => {
    const mime = buildMime({ to: 'a@b.pk', subject: 'S', html: '<b>₨ 5</b>', text: 'Rs 5' }, 'BOUND');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="BOUND"');
    const parts = mime.split('--BOUND').slice(1, -1);
    expect(parts).toHaveLength(2);
    expect(decode(parts[0].split('\r\n\r\n')[1])).toBe('Rs 5');
    expect(decode(parts[1].split('\r\n\r\n')[1])).toBe('<b>₨ 5</b>');
    expect(mime.endsWith('--BOUND--\r\n')).toBe(true);
  });
  it('refuses an invalid address instead of sending somewhere unexpected', () => {
    expect(() => buildMime({ to: 'oops', subject: 'S', html: '', text: '' })).toThrow();
  });
});

describe('sending', () => {
  let tokens;
  const mail = { to: 'owner@example.com', subject: 'Report — 04/Nov/2026', html: '<p>hi</p>', text: 'hi' };
  beforeEach(() => {
    forgetToken();
    tokens = vi.fn();
    globalThis.google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => ({
            requestAccessToken: () => {
              tokens();
              cfg.callback({ access_token: `tok${tokens.mock.calls.length}`, expires_in: 3600 });
            },
          }),
        },
      },
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'm1' }) }));
  });

  it('signs in once, posts the message to Gmail with only the raw text, and reuses the token', async () => {
    expect(await sendGmail(mail)).toEqual({ ok: true, id: 'm1' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(init.headers.Authorization).toBe('Bearer tok1');
    expect(fromRaw(JSON.parse(init.body).raw)).toContain('To: owner@example.com');
    await sendGmail(mail);
    expect(tokens).toHaveBeenCalledTimes(1);
  });
  it('an expired token is replaced once and the send is retried', async () => {
    fetch.mockImplementationOnce(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await sendGmail(mail)).toEqual({ ok: true, id: 'm1' });
    expect(tokens).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok2');
  });
  it('gives up with a clear message if sign-in keeps failing', async () => {
    fetch.mockImplementation(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await sendGmail(mail);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/expired|try again/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('explains a missing permission and a blocked site', async () => {
    fetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }),
    }));
    expect((await sendGmail(mail)).message).toMatch(/permission/);
    forgetToken();
    fetch.mockImplementationOnce(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'blocked' } }) }));
    expect((await sendGmail(mail)).message).toMatch(/allowed for your Google client/);
  });
  it('reports no connection, a refused Google window, and a bad address, without sending', async () => {
    fetch.mockImplementationOnce(async () => {
      throw new TypeError('network');
    });
    expect((await sendGmail(mail)).message).toMatch(/No connection/);
    forgetToken();
    globalThis.google.accounts.oauth2.initTokenClient = (cfg) => ({ requestAccessToken: () => cfg.callback({ error: 'access_denied' }) });
    fetch.mockClear();
    expect((await sendGmail(mail)).message).toMatch(/not allowed/);
    expect(fetch).not.toHaveBeenCalled();
    expect((await sendGmail({ ...mail, to: 'nope' })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('a closed Google window is reported kindly', async () => {
    forgetToken();
    globalThis.google.accounts.oauth2.initTokenClient = (cfg) => ({
      requestAccessToken: () => cfg.error_callback({ type: 'popup_closed' }),
    });
    expect((await sendGmail(mail)).message).toMatch(/window was closed/);
  });
});

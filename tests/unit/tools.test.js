// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ageText, backupStatus, canAck, drillStatus, feedStatus, notificationState } from '../../js/modules/tools/domain/tools.js';
import { alertLabel } from '../../js/shared/alerts.js';
import tools from '../../js/modules/tools/manifest.js';
import { MODULE_IDS } from '../../js/modules/index.js';

const now = new Date('2026-11-12T12:00:00Z');
const ago = (h) => new Date(now - h * 36e5).toISOString();

describe('time wording', () => {
  it('speaks plainly', () => {
    expect(ageText(null, now)).toBe('never');
    expect(ageText(ago(0.01), now)).toBe('just now');
    expect(ageText(ago(0.5), now)).toBe('30 min ago');
    expect(ageText(ago(5), now)).toBe('5 h ago');
    expect(ageText(ago(72), now)).toBe('3 d ago');
  });
});

describe('backup health', () => {
  it('is calm when recent and failing when late or failed', () => {
    expect(backupStatus({ last_ok_daily: ago(18) }, now).tone).toBe('good');
    expect(backupStatus({ last_ok_daily: ago(31) }, now).tone).toBe('bad');
    expect(backupStatus({ last_ok_daily: ago(18), last_failed: ago(1) }, now).tone).toBe('bad');
    expect(backupStatus({ last_ok_daily: ago(30), last_failed: ago(40) }, now).tone).toBe('good');
  });
  it('says plainly when nothing has run', () => {
    expect(backupStatus({}, now)).toMatchObject({ tone: 'warn', text: 'No backup has run yet' });
    expect(backupStatus({ last_failed: ago(2) }, now).tone).toBe('bad');
    expect(backupStatus(null, now).tone).toBe('warn');
  });
  it('flags a restore test that never happened or is overdue', () => {
    expect(drillStatus({}, now).tone).toBe('warn');
    expect(drillStatus({ last_drill_ok: ago(24 * 30) }, now).tone).toBe('good');
    expect(drillStatus({ last_drill_ok: ago(24 * 120) }, now).text).toMatch(/overdue/);
  });
});

describe('feed health', () => {
  it('follows the three-hour rule', () => {
    expect(feedStatus({ last_ok: ago(1) }, now).tone).toBe('good');
    expect(feedStatus({ last_ok: ago(4) }, now).tone).toBe('bad');
    expect(feedStatus({}, now).tone).toBe('warn');
  });
});

describe('alerts', () => {
  it('describes delivery honestly', () => {
    expect(notificationState({ status: 'sent' })).toBe('Delivered');
    expect(notificationState({ status: 'failed', attempts: 2 })).toBe('Retrying');
    expect(notificationState({ status: 'failed', attempts: 5 })).toBe('Could not be delivered');
    expect(notificationState({ status: 'pending' })).toBe('Waiting to send');
    expect(notificationState({ status: 'failed', acked_at: 'x' })).toBe('Acknowledged');
  });
  it('lets only open problems be acknowledged', () => {
    expect(canAck({ status: 'failed' })).toBe(true);
    expect(canAck({ status: 'pending' })).toBe(true);
    expect(canAck({ status: 'sent' })).toBe(false);
    expect(canAck({ status: 'failed', acked_at: 'x' })).toBe(false);
  });
  it('names kinds, and unknown ones plainly', () => {
    expect(alertLabel('backup.failed')).toBe('The daily backup failed');
    expect(alertLabel('x.y')).toBe('Alert: x.y');
  });
});

describe('registration', () => {
  it('is owner only and listed', () => {
    expect(tools).toMatchObject({ id: 'tools', permission: 'tools.view', routes: [{ path: '/tools' }] });
    expect(MODULE_IDS).toContain('tools');
  });
});

describe('page', () => {
  const agoNow = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const overview = {
    backups: {
      last_ok_daily: agoNow(18),
      last_failed: null,
      last_drill_ok: null,
      recent: [{ kind: 'daily', status: 'ok', day: '2026-11-11', size_bytes: 3145728, error: null, created_at: agoNow(18) }],
    },
    notifications: {
      failed: 1,
      unsent: 0,
      recent: [
        {
          id: 'n1',
          kind: 'backup.failed',
          status: 'failed',
          attempts: 5,
          last_error: 'ntfy answered 503',
          created_at: agoNow(2),
          acked_at: null,
        },
      ],
    },
    feed: { last_ok: agoNow(1), last_status: 'ok' },
  };
  beforeEach(() => {
    document.body.innerHTML = '<div id="p"></div>';
    globalThis.__ov = async () => overview;
    globalThis.__ack = vi.fn(async () => {});
    vi.resetModules();
    vi.doMock('../../js/modules/tools/data/api.js', () => ({
      toolsOverview: () => globalThis.__ov(),
      ackNotification: (id) => globalThis.__ack(id),
    }));
  });
  it('shows backups, feed and alerts, and acknowledges an alert', async () => {
    const { mount } = await import('../../js/modules/tools/ui/page.js');
    const el = document.getElementById('p');
    await mount(el);
    expect(el.textContent).toContain('Last good backup 18 h ago');
    expect(el.textContent).toContain('A restore test has never been recorded');
    expect(el.textContent).toContain('The daily backup failed');
    expect(el.textContent).toContain('Could not be delivered');
    el.querySelector('[data-act="ack"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.__ack).toHaveBeenCalledWith('n1');
  });
  it('explains itself when the person is not allowed', async () => {
    globalThis.__ov = async () => null;
    const { mount } = await import('../../js/modules/tools/ui/page.js');
    const el = document.getElementById('p');
    await mount(el);
    expect(el.textContent).toContain('second factor');
  });
  it('shows a plain error when loading fails', async () => {
    globalThis.__ov = async () => {
      throw new Error('boom');
    };
    const { mount } = await import('../../js/modules/tools/ui/page.js');
    const el = document.getElementById('p');
    await mount(el);
    expect(el.textContent).toContain('Could not load this page');
    expect(el.textContent).not.toContain('boom');
  });
});

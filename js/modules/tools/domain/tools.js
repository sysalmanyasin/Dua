// Pure rules for the Tools tab: what counts as healthy, late or overdue, in plain words.
const HOUR = 36e5;
const DAY = 24 * HOUR;

export function ageText(iso, now = new Date()) {
  if (!iso) return 'never';
  const ms = now - new Date(iso);
  if (ms < 0 || ms < 2 * 60e3) return 'just now';
  if (ms < HOUR) return `${Math.round(ms / 60e3)} min ago`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h ago`;
  return `${Math.round(ms / DAY)} d ago`;
}

// tone: good | warn | bad
export function backupStatus(b, now = new Date()) {
  if (!b?.last_ok_daily)
    return {
      tone: b?.last_failed ? 'bad' : 'warn',
      text: b?.last_failed ? 'No good backup yet, and the last try failed' : 'No backup has run yet',
    };
  const late = now - new Date(b.last_ok_daily) > 30 * HOUR;
  if (late) return { tone: 'bad', text: `Last good backup was ${ageText(b.last_ok_daily, now)}` };
  if (b.last_failed && new Date(b.last_failed) > new Date(b.last_ok_daily))
    return { tone: 'bad', text: 'The latest backup attempt failed' };
  return { tone: 'good', text: `Last good backup ${ageText(b.last_ok_daily, now)}` };
}

// A restore test proves the backups can really be used. Overdue after about a quarter.
export function drillStatus(b, now = new Date()) {
  if (!b?.last_drill_ok) return { tone: 'warn', text: 'A restore test has never been recorded' };
  if (now - new Date(b.last_drill_ok) > 100 * DAY)
    return { tone: 'warn', text: `Restore test is overdue (last ${ageText(b.last_drill_ok, now)})` };
  return { tone: 'good', text: `Restore tested ${ageText(b.last_drill_ok, now)}` };
}

export function feedStatus(feed, now = new Date()) {
  if (!feed?.last_ok) return { tone: 'warn', text: 'No inventory sync recorded yet' };
  if (now - new Date(feed.last_ok) > 3 * HOUR) return { tone: 'bad', text: `Last good inventory sync was ${ageText(feed.last_ok, now)}` };
  return { tone: 'good', text: `Inventory synced ${ageText(feed.last_ok, now)}` };
}

export function notificationState(n) {
  if (n.acked_at) return 'Acknowledged';
  if (n.status === 'sent') return 'Delivered';
  if (n.status === 'failed') return n.attempts >= 5 ? 'Could not be delivered' : 'Retrying';
  return 'Waiting to send';
}
// Only alerts that still need the owner's eyes can be acknowledged.
export const canAck = (n) => !n.acked_at && (n.status === 'failed' || n.status === 'pending');

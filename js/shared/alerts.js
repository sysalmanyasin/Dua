// Plain-language names for owner alert kinds, shared by the Cover and the Tools tab.
const TEXT = {
  'closing.submitted': 'A closing was submitted',
  'audit.submitted': 'An audit count was submitted',
  'audit.compiled': 'An audit round was compiled',
  'audit.conflict': 'An audit has a conflict to settle',
  'audit.finalized': 'An audit round was made final',
  'attendance.rejected': 'A check-in attempt was refused',
  'attendance.tracking_off': 'A staff phone stopped tracking',
  'attendance.checkout_missed': 'A check-out is missing',
  'attendance.key_refused': 'An iPhone attendance key was refused',
  'attendance.ios_rejects': "An iPhone's check-ins were refused several times",
  'inventory.sync_stale': 'The inventory feed is late',
  'inventory.sync_failed': 'The inventory sync failed',
  'backup.failed': 'The daily backup failed',
  'backup.stale': 'There is no recent backup',
  'restore_drill.failed': 'The restore drill failed',
};
export const alertLabel = (kind) => TEXT[kind] ?? `Alert: ${kind}`;

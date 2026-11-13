// Plain-language names for owner alert kinds, shared by the Cover and the Tools tab.
const TEXT = {
  'closing.submitted': 'A closing was submitted',
  'inventory.sync_stale': 'The inventory feed is late',
  'inventory.sync_failed': 'The inventory sync failed',
  'backup.failed': 'The daily backup failed',
  'backup.stale': 'There is no recent backup',
  'restore_drill.failed': 'The restore drill failed',
};
export const alertLabel = (kind) => TEXT[kind] ?? `Alert: ${kind}`;

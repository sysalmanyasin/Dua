// Backup retention rules (Foundation F7). Pure functions, unit tested.
export const KEEP_DAILY = 30;
export const KEEP_WEEKLY = 12;
export const BACKUP_NAME = /^dua-(\d{4}-\d{2}-\d{2})\.tar\.age$/;

export const backupName = (day) => `dua-${day}.tar.age`;
export const isSunday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0;

// Which files to delete so only the newest `keep` remain. Only files named like our backups are ever considered,
// the file just uploaded is never deleted, and a bad `keep` deletes nothing.
export function selectForDeletion(files, keep, protectName = null) {
  if (!Number.isInteger(keep) || keep < 1) return [];
  const ours = files.filter((f) => BACKUP_NAME.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
  return ours.slice(keep).filter((f) => f.name !== protectName);
}

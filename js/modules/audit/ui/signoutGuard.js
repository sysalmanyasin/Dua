// AUD-9: the guard now lives in the shared outbox module (OD-6) and is installed at boot. Audit pages still call this,
// which is harmless when the guard is already in place.
export { installSignOutGuard } from '../../../shared/outbox.js';

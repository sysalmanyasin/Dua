// Public configuration. The publishable (anon) key is designed to be public; it is safe in Git.
// NEVER put a service-role key, secret key or any password here (CI blocks it).
const STAGING = { url: 'https://sdsynzsflubdxnelgthh.supabase.co', publishableKey: 'sb_publishable_F5kuTbAAFbn6hbCGBrv7LQ_yhKicdkX' };
const ENVIRONMENTS = {
  staging: STAGING,
  // TEMPORARY: no production project exists yet, so the live site uses staging. Replace before launch (Phase 10).
  production: STAGING,
};

export function environmentName(loc = globalThis.location) {
  const host = loc?.hostname ?? '';
  const path = loc?.pathname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || /staging/i.test(path) ? 'staging' : 'production';
}

export function getConfig(loc = globalThis.location) {
  const name = environmentName(loc);
  const { url, publishableKey } = ENVIRONMENTS[name];
  return { name, url, publishableKey, functionsUrl: url ? `${url}/functions/v1` : '', configured: Boolean(url && publishableKey) };
}

// Names shown in the header.
export const BRAND = { title: "Fazal Din's Pharma Plus", branch: 'Bahria Town' };

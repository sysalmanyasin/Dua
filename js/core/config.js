// Public configuration. The publishable (anon) key is designed to be public; it is safe in Git.
// NEVER put a service-role key, secret key or any password here (CI blocks it).
const ENVIRONMENTS = {
  staging: { url: '', publishableKey: '' },
  production: { url: '', publishableKey: '' },
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

// A person's own small settings (kept in the database, private to them).
import { db } from './supabase.js';

export async function getPref(key) {
  const { data } = await db().from('user_prefs').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
export const setPref = (key, value) => db().rpc('prefs_set', { p_key: key, p_value: value });

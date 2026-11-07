import { db } from '../../../core/supabase.js';

export async function coverSummary() {
  const { data, error } = await db().rpc('cover_summary');
  if (error) throw error;
  return data;
}

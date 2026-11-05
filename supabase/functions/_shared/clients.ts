import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const url = (): string => Deno.env.get('SUPABASE_URL')!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

// Service role: only inside Edge Functions, injected by Supabase, never in Git or the browser.
export const serviceClient = () => createClient(url(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, opts);
export const anonClient = () => createClient(url(), Deno.env.get('SUPABASE_ANON_KEY')!, opts);
export const userClient = (authHeader: string) =>
  createClient(url(), Deno.env.get('SUPABASE_ANON_KEY')!, { ...opts, global: { headers: { Authorization: authHeader } } });

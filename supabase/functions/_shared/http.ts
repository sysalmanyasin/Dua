import { ipHash } from './codes.ts';

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = Deno.env.get('ALLOWED_ORIGIN') ?? '';
  const origin = req.headers.get('origin') ?? '';
  const ok = allowed !== '' && origin === allowed;
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders(req) }) : null;
}
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}
export async function requestIpHash(req: Request): Promise<string> {
  return ipHash(clientIp(req), Deno.env.get('IP_HASH_SECRET') ?? 'unset');
}
export const staffDomain = (): string => Deno.env.get('STAFF_EMAIL_DOMAIN') ?? 'staff.dua.invalid';
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

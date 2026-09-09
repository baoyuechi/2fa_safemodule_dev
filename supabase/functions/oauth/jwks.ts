// ============================================================================
// GET /.well-known/jwks.json —— 公钥集合（active + rotation grace 期内的 previous）
// 公开端点，CORS `*`。只含公钥材料，绝无私钥。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { listPublicJwks } from './_shared/signing.ts';
import { warmupKeys } from './_shared/tokens.ts';
import { publicCors } from './_shared/http.ts';

export async function handleJwks(req: Request): Promise<Response> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  try {
    // 冷启动自动装配首个 active key，保证 JWKS 永不为空。
    await warmupKeys(admin);
    const keys = await listPublicJwks(admin);
    return new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...publicCors() },
    });
  } catch (e) {
    console.error('[oauth/jwks]', e);
    return new Response(JSON.stringify({ keys: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...publicCors() },
    });
  }
}

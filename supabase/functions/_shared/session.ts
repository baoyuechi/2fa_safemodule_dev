// account/* 端点组共享：强制会话（JWT）识别。组级 verify_jwt=false（config.toml），
// 由各处理器自行强制（同 phone/bind、webauthn/register-* 纪律）：缺失/无效 → null，
// 调用方统一回 401 FALLBACK。

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface SessionUser {
  id: string;
  email?: string | null;
}

export interface RequireSessionResult {
  user: SessionUser;
  // 携带 Authorization 的 anon 客户端（auth.getUser 已验过 JWT）
  client: SupabaseClient;
}

export async function requireSession(req: Request): Promise<RequireSessionResult | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { user: { id: data.user.id, email: data.user.email }, client };
}
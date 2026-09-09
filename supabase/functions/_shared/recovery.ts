// 恢复码（备用安全码）共享逻辑：端点 6/9/10 复用。
//
// 格式：`XXXX-XXXX`（8 个易读字符 + 分隔符；剔除 0/O/1/I/L 等易混淆字符，
// 32 字符集 ≈ 40 bit 熵）。入库只存 SHA-256(pepper‖归一化明文)，明文永不落库，
// 仅在签发/换批当次返回前端"仅显示一次"。
//
// 批次语义：mfa_enrollments.recovery_batch 为当前有效批次；换批时 +1，旧批
// 自然失效（use 仅认 batch=当前批 且 used_at 为空的行）。

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { config } from './mfa.config.js';
import { getPepper, sha256Hex } from './crypto.ts';

type AdminClient = SupabaseClient; // 与 _shared/phone.ts 同款宽类型（ReturnType 会选中重载最窄泛型）

/** 易读字符集（剔除 0/O/1/I/L） */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_CHARS = 8;

/** 归一化用户输入：去分隔符/空白 → 大写（入库比对前必调） */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase();
}

/** 生成一批明文恢复码（crypto.getRandomValues，服务端 CSPRNG） */
export function generateRecoveryCodes(count: number = config.recoveryCodes): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const rand = crypto.getRandomValues(new Uint8Array(CODE_CHARS));
    const chars = Array.from(rand, (b) => ALPHABET[b % ALPHABET.length]).join('');
    out.push(`${chars.slice(0, 4)}-${chars.slice(4)}`);
  }
  return out;
}

/** 码摘要：SHA-256(pepper‖归一化明文)，PostgREST bytea 入参格式 `\x` + hex */
export async function hashRecoveryCode(code: string): Promise<string> {
  return `\\x${await sha256Hex(getPepper() + normalizeRecoveryCode(code))}`;
}

/**
 * 签发新批次：批次号+1 → 哈希入库 → 对齐 mfa_enrollments.recovery_batch →
 * 返回明文码（调用方仅此一次返回前端）。
 * admin 为 service_role supabase client。
 */
export async function issueRecoveryBatch(admin: AdminClient, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));

  // 当前批次（无行视为 0；单用户低频操作，先读后写可接受）
  const { data: enroll } = await admin
    .from('mfa_enrollments')
    .select('recovery_batch')
    .eq('user_id', userId)
    .maybeSingle();
  const nextBatch = ((enroll as { recovery_batch?: number } | null)?.recovery_batch ?? 0) + 1;

  const { error: insErr } = await admin
    .from('recovery_codes')
    .insert(hashes.map((code_hash) => ({ user_id: userId, code_hash, batch: nextBatch })));
  if (insErr) throw insErr;

  const { error: upErr } = await admin
    .from('mfa_enrollments')
    .upsert({ user_id: userId, recovery_batch: nextBatch }, { onConflict: 'user_id' });
  if (upErr) throw new Error(upErr.message ?? 'batch align failed');

  return codes;
}

// ============================================================================
// L0 端点 6/12 · webauthn/register-verify（处理器，由 webauthn/index.ts 分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 会话 · {response} → {verified, recoveryCodes?}
//   G1: requireUserVerification=true（UV 位必须=1 → uvInitialized=true）；
//   G2: clientDataJSON.crossOrigin=true 拒绝；
//   G4: credentialId ≤1023 字节 + 全局唯一（主键）；
//   G7: expectedChallenge 与暂存精确比对、单次有效（原子认领防并发重放）；
//   G8: 凭据公钥 alg ∈ 白名单（offer 侧只提供白名单 + verify 侧 COSE 断言）。
//   验证成功后：凭据入库 + mfa_enrollments.enabled=true（FR-8 门槛判据）。
//   恢复码：用户尚无有效批次时签发首批（10 条，明文仅此一次返回前端展示）。
//
// 认证：端点默认 verify_jwt=true；userId 请求体字段仅作契约兼容——必须与
//   JWT 会话用户一致（防冒用），否则 403。
//
// 响应：
//   200 {ok:true, credentialId, recoveryCodes?}  验证通过并入库；首绑附带首批恢复码明文
//   400 {ok:false, code:'INVALID_CHALLENGE'}  挑战缺失/过期/已消费
//   400 {ok:false, code:'INVALID_RESPONSE'}   origin/rpID/格式/标志位校验失败
//   400 {ok:false, code:'UV_REQUIRED'}        UV 位未置 1（G1）
//   409 {ok:false, code:'CREDENTIAL_EXISTS'}  凭据 ID 已被注册（防"抢注受害者凭据"）
//   401/403/405/503 {ok:false, code:'FALLBACK'}  鉴权/守卫
// ============================================================================

import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from 'jsr:@simplewebauthn/server@^13.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { guard, json } from '../_shared/http.ts';
import { base64urlDecode, bytesToHex, readCoseAlg } from '../_shared/crypto.ts';
import { issueRecoveryBatch } from '../_shared/recovery.ts';

const PURPOSES = new Set(['enroll', 'rebind']);

export async function handleRegisterVerify(req: Request): Promise<Response> {
  // ── 1. JWT 用户识别（同 register-options）──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    console.warn('[webauthn/register-verify] invalid JWT:', userErr?.message);
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const user = userData.user;

  // ── 2. 请求体：{ response, userId?, purpose? } ──
  let body: { response?: unknown; userId?: unknown; purpose?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  if (body?.purpose !== undefined) {
    if (typeof body.purpose !== 'string' || !PURPOSES.has(body.purpose)) {
      return json(req, { ok: false, code: 'FALLBACK' }, 400);
    }
  }
  const purpose = (body?.purpose as string | undefined) ?? 'enroll';
  if (body?.userId !== undefined && body.userId !== user.id) {
    return json(req, { ok: false, code: 'FALLBACK' }, 403);
  }
  const resp = body?.response as RegistrationResponseJSON | undefined;
  if (
    !resp || typeof resp !== 'object' ||
    typeof (resp as { response?: { clientDataJSON?: unknown } }).response?.clientDataJSON !== 'string' ||
    typeof (resp as { response?: { attestationObject?: unknown } }).response?.attestationObject !== 'string'
  ) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  // G2：clientDataJSON.crossOrigin=true 一律拒绝（本站无 iframe 嵌入场景）
  try {
    const cdj = JSON.parse(
      new TextDecoder().decode(
        base64urlDecode(
          (resp as { response: { clientDataJSON: string } }).response.clientDataJSON,
        ),
      ),
    ) as { crossOrigin?: unknown };
    if (cdj?.crossOrigin === true) {
      return json(req, { ok: false, code: 'INVALID_RESPONSE' }, 400);
    }
  } catch {
    // 解析失败交给验签环节处理（其 INVALID_RESPONSE 语义不变）
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 3. 取该用户该用途最新一条未消费且未过期的挑战 ──
    // 注：契约表无 created_at 列；expires_at = 写入时刻 + 固定 300s，排序等价于按创建时间倒序
    const { data: challenges, error: selErr } = await admin
      .from('webauthn_challenges')
      .select('id, challenge, options')
      .eq('user_id', user.id)
      .eq('purpose', purpose)
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1);
    if (selErr) throw selErr;
    const stored = challenges?.[0];
    if (!stored) {
      return json(req, { ok: false, code: 'INVALID_CHALLENGE' });
    }

    // ── 4. 验证注册响应（G7 expectedChallenge 精确比对 / origin / rpID / G1）──
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: resp,
        expectedChallenge: stored.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true, // G1 指纹底线
      });
    } catch (e) {
      console.warn('[webauthn/register-verify] verify failed:', e);
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      return json(req, {
        ok: false,
        code: msg.includes('challenge') ? 'INVALID_CHALLENGE' : 'INVALID_RESPONSE',
      });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return json(req, { ok: false, code: 'INVALID_RESPONSE' });
    }

    const info = verification.registrationInfo;
    const cred = info.credential;

    // G4: credentialId ≤1023 字节（L3 §7.1-25）
    if (base64urlDecode(cred.id).byteLength > 1023) {
      return json(req, { ok: false, code: 'INVALID_RESPONSE' });
    }
    // G1: UV 位信任状态（防御性再查；requireUserVerification=true 下正常不会触发）
    if (cred.uvInitialized === false) {
      return json(req, { ok: false, code: 'UV_REQUIRED' });
    }
    // G8：断言凭据公钥算法在白名单内（offer 侧已只提供白名单，此处防手工构造响应绕过）
    const coseAlg = readCoseAlg(cred.publicKey);
    if (coseAlg === null || !config.webauthn.allowedAlgorithms.includes(coseAlg)) {
      console.warn('[webauthn/register-verify] alg not allowed:', coseAlg);
      return json(req, { ok: false, code: 'INVALID_RESPONSE' });
    }

    // ── 5. 原子认领挑战（单次有效；并发重放只有一个成功）──
    const { data: claimed, error: claimErr } = await admin
      .from('webauthn_challenges')
      .update({ consumed: true })
      .eq('id', stored.id)
      .eq('consumed', false)
      .select('id');
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      return json(req, { ok: false, code: 'INVALID_CHALLENGE' });
    }

    // ── 6. 凭据入库（handle 取自该次注册暂存的 options.user.id）──
    const handle = (stored.options as { user?: { id?: string } } | null)?.user?.id;
    if (!handle) {
      console.error('[webauthn/register-verify] stored options missing user.id');
      return json(req, { ok: false, code: 'FALLBACK' }, 500);
    }
    const transports = (resp.transports ?? cred.transports ?? []).join(',');
    const { error: insErr } = await admin.from('webauthn_credentials').insert({
      id: cred.id,
      user_id: user.id,
      webauthn_user_id: handle,
      public_key: `\\x${bytesToHex(cred.publicKey)}`,
      counter: cred.counter,
      transports,
      device_type: info.credentialDeviceType, // singleDevice / multiDevice
      uv_initialized: cred.uvInitialized ?? true,
      backup_eligible: cred.backupEligible ?? info.credentialDeviceType === 'multiDevice',
      backup_state: cred.backupState ?? info.credentialBackedUp ?? false,
    });
    if (insErr) {
      if (insErr.code === '23505') {
        return json(req, { ok: false, code: 'CREDENTIAL_EXISTS' }, 409); // G4 全局唯一
      }
      throw insErr;
    }

    // ── 7. FR-8 门槛判据：注册成功 → enabled=true（首绑创建行，重绑更新行）──
    const { error: upErr } = await admin
      .from('mfa_enrollments')
      .upsert({ user_id: user.id, enabled: true }, { onConflict: 'user_id' });
    if (upErr) throw upErr;

    // ── 8. 恢复码首批：尚无有效批次才签发（重绑不重复发，旧码继续有效）──
    //   明文仅此一次返回，前端"仅显示一次"面板展示后即丢弃。
    let recoveryCodes: string[] | undefined;
    const { data: enrollRow } = await admin
      .from('mfa_enrollments')
      .select('recovery_batch')
      .eq('user_id', user.id)
      .maybeSingle();
    const curBatch = (enrollRow as { recovery_batch?: number } | null)?.recovery_batch ?? 0;
    let hasLiveBatch = false;
    if (curBatch > 0) {
      const { data: live } = await admin
        .from('recovery_codes')
        .select('id')
        .eq('user_id', user.id)
        .eq('batch', curBatch)
        .is('used_at', null)
        .limit(1);
      hasLiveBatch = ((live as Array<unknown> | null)?.length ?? 0) > 0;
    }
    if (!hasLiveBatch) {
      recoveryCodes = await issueRecoveryBatch(admin, user.id);
    }

    return json(req, { ok: true, credentialId: cred.id, ...(recoveryCodes ? { recoveryCodes } : {}) });
  } catch (e) {
    console.error('[webauthn/register-verify]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

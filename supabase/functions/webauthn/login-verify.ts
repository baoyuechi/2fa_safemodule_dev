// ============================================================================
// L0 端点 8/12 · webauthn/login-verify（处理器，由 webauthn/index.ts 分发）
// —— M2 路线图：桥接端点，全链路风险最高的关节
//
// 契约（design/05-数据库与API契约.md §三）：POST · 无认证 · {response} → {token_hash}
//   userHandle↔credentialId 双重核对；UV 位=1（底线）；counter 检查（Touch ID 恒 0
//   豁免，stored>0 才比较）；BE 不可变校验；suspended 凭据拒；service_role
//   generate_link 出一次性 token_hash 供前端兑换标准会话。
//
// 挑战定位（对 login-options 实现约定的兑现）：decoy/discovery 挑战行 user_id 为空，
//   故以 clientDataJSON.challenge 精确匹配未消费 login 行，而非按 email/user_id 查。
// 身份判定（W3C §7.2-6 ①/②）：凭据属主是唯一权威身份源；email 仅作一致性复核
//   （提供时必须与凭据属主一致）；userHandle 缺席仅在提供 email 时可接受。
//
// 错误码（不泄露细节，防枚举）：
//   200 {ok:true, token_hash}
//   400 INVALID_CHALLENGE   挑战缺失/过期/已消费
//   400 CREDENTIAL_NOT_FOUND 凭据不存在（含已吊销）/userHandle 不匹配/邮箱与凭据属主不符
//   400 CREDENTIAL_SUSPENDED 凭据级或账号级挂起（FR-6.3）
//   400 INVALID_SIGNATURE    验签/UV/origin/rpID/BE/counter 任一失败（原始原因仅入日志）
//   500 FALLBACK             未预期错误
// ============================================================================

import { verifyAuthenticationResponse } from 'jsr:@simplewebauthn/server@^13.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { guard, json } from '../_shared/http.ts';
import { base64urlDecode, hexToBytes } from '../_shared/crypto.ts';

export async function handleLoginVerify(req: Request): Promise<Response> {
  // ── 1. 请求体：{ email?, response }（契约主形态 {response}，email 为可选复核）──
  let body: { email?: unknown; response?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const resp = body?.response as
    | { response?: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown }; id?: unknown }
    | undefined;
  if (
    !resp || typeof resp !== 'object' ||
    typeof resp.id !== 'string' ||
    typeof resp.response?.clientDataJSON !== 'string' ||
    typeof resp.response?.authenticatorData !== 'string' ||
    typeof resp.response?.signature !== 'string'
  ) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const email = typeof body?.email === 'string' && body.email.trim()
    ? body.email.trim().toLowerCase()
    : null;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 2. 解析 clientDataJSON，按挑战串定位未消费 login 挑战行 ──
    let challengeStr: string;
    try {
      challengeStr = JSON.parse(new TextDecoder().decode(base64urlDecode(resp.response.clientDataJSON as string))).challenge;
    } catch {
      return json(req, { ok: false, code: 'FALLBACK' }, 400);
    }
    const { data: challenges, error: selErr } = await admin
      .from('webauthn_challenges')
      .select('id, challenge')
      .eq('purpose', 'login')
      .eq('challenge', challengeStr)
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1);
    if (selErr) throw selErr;
    const stored = challenges?.[0];
    if (!stored) {
      return json(req, { ok: false, code: 'INVALID_CHALLENGE' });
    }

    // ── 3. 凭据定位（吊销即失效——tech 清单 §2.4）──
    const { data: credRows, error: credErr } = await admin
      .from('webauthn_credentials')
      .select('id, user_id, webauthn_user_id, public_key, counter, transports, suspended, backup_eligible, backup_state')
      .eq('id', resp.id)
      .limit(1);
    if (credErr) throw credErr;
    const cred = credRows?.[0];
    if (!cred) {
      return json(req, { ok: false, code: 'CREDENTIAL_NOT_FOUND' });
    }

    // ── 4. 挂起检查（凭据级 + 账号级，FR-6.3）──
    if (cred.suspended) {
      return json(req, { ok: false, code: 'CREDENTIAL_SUSPENDED' });
    }
    const { data: enroll, error: enErr } = await admin
      .from('mfa_enrollments')
      .select('suspended')
      .eq('user_id', cred.user_id)
      .maybeSingle();
    if (enErr) throw enErr;
    if (enroll?.suspended) {
      return json(req, { ok: false, code: 'CREDENTIAL_SUSPENDED' });
    }

    // ── 5. 双重核对（W3C §7.2-6）：userHandle ↔ credentialId ↔ email 复核 ──
    const userHandle = (resp.response as { userHandle?: unknown }).userHandle;
    if (email) {
      const { data: emailUser, error: rpcErr } = await admin.rpc('find_auth_user_id_by_email', {
        p_email: email,
      });
      if (rpcErr) throw rpcErr;
      // ① 语义：已识别用户 → 凭据必须属于该用户（未识别的邮箱与冒用同码，无泄露差异）
      if (!emailUser || emailUser !== cred.user_id) {
        return json(req, { ok: false, code: 'CREDENTIAL_NOT_FOUND' });
      }
    }
    if (userHandle !== undefined && userHandle !== null) {
      if (userHandle !== cred.webauthn_user_id) {
        return json(req, { ok: false, code: 'CREDENTIAL_NOT_FOUND' });
      }
    } else if (!email) {
      // ② 语义：用户未识别 → userHandle MUST 存在
      return json(req, { ok: false, code: 'CREDENTIAL_NOT_FOUND' });
    }

    // ── 6. 验签（UV 底线；BE 不可变校验由库凭 backupEligible 执行；counter 回退由库拒绝）──
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: resp as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: stored.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: {
          id: cred.id,
          publicKey: hexToBytes(cred.public_key),
          counter: Number(cred.counter),
          transports: cred.transports ? String(cred.transports).split(',').filter(Boolean) : [],
          backupEligible: cred.backup_eligible, // G3：BE 创建时定死，登录须一致
          backupState: cred.backup_state,
        },
      });
    } catch (e) {
      console.warn('[webauthn/login-verify] verify failed:', e);
      const msg = String((e as Error)?.message ?? e).toLowerCase();
      return json(req, {
        ok: false,
        code: msg.includes('challenge') ? 'INVALID_CHALLENGE' : 'INVALID_SIGNATURE',
      });
    }
    if (!verification.verified || !verification.authenticationInfo) {
      return json(req, { ok: false, code: 'INVALID_SIGNATURE' });
    }
    const authInfo = verification.authenticationInfo;

    // ── 7. 原子认领挑战（单次有效；并发重放只有一个成功）──
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

    // ── 8. 更新凭据记录：counter 防克隆 + BS 漂移（G3，变化由安全中心提示）+ last_used_at ──
    const { error: updErr } = await admin
      .from('webauthn_credentials')
      .update({
        counter: authInfo.newCounter,
        backup_state: authInfo.credentialBackedUp ?? cred.backup_state,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', cred.id);
    if (updErr) throw updErr;

    // ── 9. 风控留痕（FR-9.4）。M2 阶段仅记 webauthn 登录通过；信号采集与
    //      risk/evaluate 矩阵属 M5，counter 回退等失败原始原因仅入服务端日志。──
    const { error: riskErr } = await admin.from('risk_events').insert({
      user_id: cred.user_id,
      signals: ['webauthn_login'],
      level: 'normal',
      channel: 'webauthn',
      action_taken: 'pass',
    });
    if (riskErr) throw riskErr;

    // ── 10. 会话桥接：admin.generateLink 签发一次性 token_hash（前端兑换标准会话）──
    const { data: userData, error: uErr } = await admin.auth.admin.getUserById(cred.user_id);
    if (uErr || !userData.user?.email) {
      console.error('[webauthn/login-verify] getUserById failed:', uErr?.message);
      return json(req, { ok: false, code: 'FALLBACK' }, 500);
    }
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.user.email,
    });
    if (linkErr || !link.properties?.hashed_token) {
      console.error('[webauthn/login-verify] generateLink failed:', linkErr?.message);
      return json(req, { ok: false, code: 'FALLBACK' }, 500);
    }

    // riskLevel 待 M5 risk/evaluate 接入后随响应返回（契约 {token_hash, riskLevel}）
    return json(req, { ok: true, token_hash: link.properties.hashed_token });
  } catch (e) {
    console.error('[webauthn/login-verify]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

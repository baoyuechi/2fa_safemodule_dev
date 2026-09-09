// ============================================================================
// L0 端点组 · recovery/*（Part 5 §三：9 recovery/use、10 recovery/regenerate；
// 另附管理页 supporting 端点 recovery/status）
//
// 说明：Supabase CLI 函数名仅允许 [A-Za-z0-9_-]（不支持斜杠），故契约路径
// recovery/use、recovery/regenerate、recovery/status 由本函数按 pathname
// 后缀还原分发；处理器分文件维护，与契约表格逐一对应，L0 对外路径不变。
//
// 认证：组级 verify_jwt=false（config.toml），由各处理器自行强制——
//   use 系无认证端点（邮箱+码定位用户 + 限流防穷举）；
//   regenerate/status 需有效 JWT 会话（缺失/无效一律 401）。
// ============================================================================

import { guard, json } from '../_shared/http.ts';
import { handleRecoveryUse } from './use.ts';
import { handleRegenerate } from './regenerate.ts';
import { handleStatus } from './status.ts';

Deno.serve(async (req) => {
  const denied = guard(req);
  if (denied) return denied;

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (path.endsWith('/recovery/use')) return handleRecoveryUse(req);
  if (path.endsWith('/recovery/regenerate')) return handleRegenerate(req);
  if (path.endsWith('/recovery/status')) return handleStatus(req);

  return json(req, { ok: false, code: 'FALLBACK' }, 404);
});

// 本地测试（supabase start 后）：
//   换批（需登录会话 access_token）：
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/recovery/regenerate \
//     -H "Authorization: Bearer <access_token>" -H 'Content-Type: application/json' -d '{}'
//   余量：
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/recovery/status \
//     -H "Authorization: Bearer <access_token>" -H 'Content-Type: application/json' -d '{}'
//   消费（把 CODE 换成签发出的码）：
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/recovery/use \
//     -H 'Content-Type: application/json' -d '{"email":"you@isawuhan.com","code":"CODE"}'

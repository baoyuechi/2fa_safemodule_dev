import * as React from 'react';
import Typography from '@mui/material/Typography';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import {
  confirmEmailWithTokenHash,
  handleError,
  saveSession,
  toast,
} from '../api/mfaClient';
import type { MfaSession } from '../api/mfaClient';

/** 从地址 hash（#key=value&…）解析出普通对象；空/无 = null */
function parseHash(hash: string): Record<string, string> | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const out: Record<string, string> = {};
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

/**
 * 注册确认链接落地页。邮件里的「确认链接」经 GoTrue 校验后 303 回跳为
 * `site_url/#access_token=...&refresh_token=...&token_type=bearer&expires_at=...`
 * （fragment 载荷——浏览器不把它发给服务端），本页负责读取 fragment 里的
 * 会话字段并 saveSession() 持久化，随后进入手机号绑定步。
 *
 * 兼容两种来源：
 *  A. fragment 形会话（当前 GoTrue 默认形态）→ 解析并 saveSession；
 *  B. ?token_hash=…&type=signup（token_hash 链接形态）→ 经 GoTrue /verify 换会话。
 */
export default function ConfirmEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const doneRef = React.useRef(false);

  React.useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;

    // A. fragment 形会话载荷
    const hash = parseHash(location.hash);
    if (hash?.access_token) {
      const session: MfaSession = {
        access_token: hash.access_token,
        token_type: hash.token_type ?? 'bearer',
        expires_at: Number(hash.expires_at ?? NaN),
        refresh_token: hash.refresh_token,
        user: hash.user ? (JSON.parse(hash.user) as Record<string, unknown>) : undefined,
      };
      saveSession(session);
      const email = (session?.user as { email?: string } | undefined)?.email ?? hash.email;
      toast('邮箱验证成功', 'success');
      navigate('/register/phone', { state: email ? { email } : undefined, replace: true });
      return;
    }

    // B. token_hash 形链接
    const tokenHash = params.get('token_hash');
    if (!tokenHash || params.get('type') !== 'signup') {
      toast('验证链接无效或已过期，请重新注册', 'error');
      navigate('/register', { replace: true });
      return;
    }
    void (async () => {
      let s: MfaSession | null = null;
      try {
        s = await confirmEmailWithTokenHash(tokenHash);
        toast('邮箱验证成功', 'success');
        saveSession(s);
      } catch (e) {
        handleError(e);
      } finally {
        const e = (s?.user as { email?: string } | undefined)?.email;
        navigate('/register/phone', { state: e ? { email: e } : undefined, replace: true });
      }
    })();
  }, [navigate, location.hash, params]);

  return (
    <AuthShell title="正在验证您的邮箱…" subtitle="正在验证邮箱，请稍候">
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>正在验证邮箱…</Typography>
    </AuthShell>
  );
}
// ============================================================================
// OAuth 授权页（Provider 前端）：/oauth/authorize?tx=…[&state=…]
//
// 职责：展示"业务网站请求登录"（client 名 + scope）→ 已有 Provider 会话则
// 一键继续（调 complete；政策满足即导航到业务 callback），无会话则引导去
// 现有登录页（登录成功后自动回到本页继续，全程复用现有 Password/Passkey/
// Recovery 流程，零改动）。acr 未满足 → 提示补强认证；需 consent → 确认页。
//
// 本页不经手任何 OAuth token：complete 只返回 redirect_to。
// ============================================================================
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import { useI18n } from '../i18n/LocaleContext';
import {
  clearPendingOAuthTx,
  completeOAuthTransaction,
  consentOAuthTransaction,
  getOAuthTransaction,
  readPendingOAuthTx,
  savePendingOAuthTx,
} from '../api/oauthClient';
import { fetchSessionUser, getSession, handleError } from '../api/mfaClient';

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' }
  | { kind: 'consent'; clientName: string; scopes: string[] };

const SCOPE_LABEL: Record<string, string> = {
  openid: '确认你的登录身份',
  profile: '基本资料（用户名）',
  email: '邮箱地址',
  offline_access: '离线访问（保持登录）',
};

export default function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const tx = params.get('tx') ?? '';
  const state = params.get('state');
  const [view, setView] = React.useState<View>({ kind: 'loading' });
  const [txInfo, setTxInfo] = React.useState<{
    clientName: string;
    scopes: string[];
    requestedAcr: string | null;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  // transaction 展示信息（公开能力查询，无需会话）。
  // state 有效值 = query（302 带来）?? 已存（登录往返后 query 丢失时兜底）；
  // 以有效值回写存储，避免空 query 覆盖掉已存 state。
  const effState = state ?? (() => {
    try {
      const p = readPendingOAuthTx();
      return p && p.tx === tx ? p.state : null;
    } catch {
      return null;
    }
  })();
  React.useEffect(() => {
    if (!tx) {
      setView({ kind: 'error', message: '缺少授权事务（tx）' });
      return;
    }
    // state 随本页流转：刷新不丢（query 持有），登录往返靠 sessionStorage。
    savePendingOAuthTx(tx, effState);
    void getOAuthTransaction(tx)
      .then((info) => {
        if (!info.ok) {
          setView({ kind: 'error', message: '授权事务无效或已过期，请从业务网站重新发起登录' });
          return;
        }
        setTxInfo({
          clientName: info.client_name,
          scopes: info.scopes,
          requestedAcr: info.requested_acr,
        });
        setView({ kind: 'ready' });
      })
      .catch(() => setView({ kind: 'error', message: '无法读取授权事务，请稍后重试' }));
  }, [tx, state]);

  /** 去登录页（携带 oauth_state，登录成功后原样回来）。 */
  function goLogin() {
    const to = `/login?oauth_tx=${encodeURIComponent(tx)}` +
      (effState ? `&oauth_state=${encodeURIComponent(effState)}` : '');
    navigate(to, { replace: true });
  }

  /** 已有会话 → 推进 transaction；成功则导航业务 callback。 */
  async function handleContinue() {
    const session = getSession();
    if (!session?.access_token) {
      goLogin();
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await completeOAuthTransaction(session.access_token, tx, effState);
      if (res.ok && res.status === 'redirect') {
        clearPendingOAuthTx();
        window.location.href = res.redirect_to;
        return;
      }
      if (res.ok && res.status === 'consent_required') {
        setView({ kind: 'consent', clientName: res.client_name, scopes: res.scopes });
        return;
      }
      if (!res.ok && res.code === 'ACR_NOT_SATISFIED') {
        // 需要补强：回到现有登录页做 Passkey/恢复码，再自动回来。
        setNotice('当前登录强度不足，请使用通行密钥或恢复码补强后再继续');
        goLogin();
        return;
      }
      if (!res.ok && res.code === 'AUTH_REQUIRED') {
        goLogin();
        return;
      }
      const detail = !res.ok ? res.code : 'unknown';
      setNotice(`授权失败（${detail}），请重试`);
    } catch (e) {
      handleError(e);
      setNotice('网络异常，请重试');
    } finally {
      setBusy(false);
    }
  }

  /** 会话预检：有效会话直接显示继续按钮（SSO 基线 loa1）。 */
  const [sessionEmail, setSessionEmail] = React.useState<string | null>(null);
  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) return;
      try {
        const user = await fetchSessionUser(session.access_token);
        setSessionEmail(typeof user.email === 'string' ? user.email : null);
      } catch {
        /* 会话失效 → 显示去登录 */
      }
    })();
  }, []);

  async function handleConsent(approve: boolean) {
    const session = getSession();
    if (!session?.access_token) {
      goLogin();
      return;
    }
    setBusy(true);
    try {
      const res = await consentOAuthTransaction(session.access_token, tx, approve);
      if (approve) {
        // 同意后重试 complete 出码。
        await handleContinue();
        return;
      }
      if (res.redirect_to) {
        clearPendingOAuthTx();
        window.location.href = res.redirect_to;
      }
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  if (view.kind === 'loading') {
    return (
      <AuthShell title="统一登录" subtitle="正在准备授权…">
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      </AuthShell>
    );
  }

  if (view.kind === 'error') {
    return (
      <AuthShell title="无法授权" subtitle={view.message}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          请返回业务网站重新发起登录。
        </Typography>
      </AuthShell>
    );
  }

  if (view.kind === 'consent') {
    return (
      <AuthShell title="授权确认" subtitle={`${view.clientName} 请求访问你的账号信息`}>
        <Box sx={{ display: 'grid', gap: 1 }}>
          {view.scopes.map((s) => (
            <Typography key={s} variant="body2">
              · {SCOPE_LABEL[s] ?? s}
            </Typography>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <Button variant="outlined" disabled={busy} onClick={() => void handleConsent(false)}>
            拒绝
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void handleConsent(true)}>
            同意并继续
          </Button>
        </Box>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="统一登录"
      subtitle={txInfo ? `${txInfo.clientName} 请求使用统一身份登录` : undefined}
    >
      {notice && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {txInfo && (
        <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            将共享的信息：
          </Typography>
          {txInfo.scopes.map((s) => (
            <Typography key={s} variant="body2">
              · {SCOPE_LABEL[s] ?? s}
            </Typography>
          ))}
          {txInfo.requestedAcr === 'urn:example:loa:2' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              该应用要求双因子/强认证（LoA2）。
            </Typography>
          )}
        </Box>
      )}
      {sessionEmail ? (
        <Button variant="contained" size="large" disabled={busy} onClick={() => void handleContinue()}>
          {busy ? '正在授权…' : `以 ${sessionEmail} 继续`}
        </Button>
      ) : (
        <Button variant="contained" size="large" onClick={goLogin}>
          {t('login.title')}
        </Button>
      )}
    </AuthShell>
  );
}

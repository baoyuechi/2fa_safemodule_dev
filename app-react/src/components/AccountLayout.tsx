// ============================================================================
// AccountLayout.tsx —— 账户区布局路由（图 1 壳的唯一宿主）
//
// 顶栏 + 左侧导航常驻同一挂载：左栏切换选项时不再整页重挂（此前各页各自挂载
// AccountShell + 全屏 PageLoader，导致顶栏闪动）。会话守卫与头像档案只在此处
// 取一次；子页（Security/Enroll/Phone/Recovery）经 useAccount() 拿 user 与
// logout，只负责各自的内容与数据。
// ============================================================================
import * as React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import AccountShell from './AccountShell';
import { useI18n } from '../i18n/LocaleContext';
import {
  clearSession,
  fetchSessionUser,
  getSession,
  signOut,
  toast,
} from '../api/mfaClient';
import type { MfaUser } from '../api/mfaClient';

interface AccountCtx {
  user: MfaUser;
  logout: () => void;
}

const AccountContext = React.createContext<AccountCtx | null>(null);

export function useAccount(): AccountCtx {
  const ctx = React.useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountLayout');
  return ctx;
}

/** 左栏激活项：用户中心三 Tab；安全子功能深链归到 security（与 NAV_ITEMS key 对齐） */
export type AccountNavKey = 'profile' | 'settings' | 'security' | 'passkeys' | 'phone' | 'recovery';
function activeFromPath(pathname: string): AccountNavKey {
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/profile') || pathname.startsWith('/user')) return 'profile';
  if (pathname.startsWith('/recovery')) return 'recovery';
  if (pathname.startsWith('/phone')) return 'phone';
  if (pathname.startsWith('/enroll')) return 'passkeys';
  return 'security';
}

export default function AccountLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [user, setUser] = React.useState<MfaUser | null>(null);

  const logout = React.useCallback(() => {
    const session = getSession();
    void (async () => {
      try {
        if (session?.access_token) await signOut(session.access_token);
      } catch {
        /* 登出失败也照常清本地 */
      } finally {
        clearSession();
        toast(t('common.signedOut'), 'info');
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate, t]);

  // 会话守卫（仅壳一次）：无一/失效 → 登录页；头像与菜单依赖的档案只取一次。
  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        setUser(await fetchSessionUser(session.access_token));
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  if (!user) {
    // 首次到位前：仅占位（不含壳），避免闪现半截导航——此后切换路由永不重挂。
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <AccountContext.Provider value={{ user, logout }}>
      <AccountShell active={activeFromPath(pathname)} user={user} onLogout={logout}>
        <Outlet />
      </AccountShell>
    </AccountContext.Provider>
  );
}
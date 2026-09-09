import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppTheme from './shared-theme/AppTheme';
import { LocaleProvider } from './i18n/LocaleContext';
import ToastHost from './components/ToastHost';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CheckEmailPage from './pages/CheckEmailPage';
import ConfirmEmailPage from './pages/ConfirmEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import PhoneBindPage from './pages/PhoneBindPage';
import VerificationSuccessPage from './pages/VerificationSuccessPage';
import EnrollPage from './pages/EnrollPage';
import PhonePage from './pages/PhonePage';
import PasswordPage from './pages/PasswordPage';
import PhoneRebindPage from './pages/PhoneRebindPage';
import SecondaryEmailPage from './pages/SecondaryEmailPage';
import SecurityPage from './pages/SecurityPage';
import RecoveryPage from './pages/RecoveryPage';
import TermsPage from './pages/TermsPage';
import AccountLayout from './components/AccountLayout';
import OAuthAuthorizePage from './pages/OAuthAuthorizePage';
import UserCenterPage from './pages/user/UserCenterPage';
import ProfileHomeTab from './pages/user/ProfileHomeTab';
import ProfileEditTab from './pages/user/ProfileEditTab';

/**
 * 邮件确认链接按 site_url 回跳到站点根路径，会话在 URL hash 里
 * （#access_token=...）。通配路由若直接跳 /login 会把会话丢掉——
 * 这里先拦截带 token 的 hash，转交给确认落地页；其余路径维持原行为。
 */
function LandingGate() {
  const location = useLocation();
  if (location.hash.includes('access_token=')) {
    return <Navigate to={{ pathname: '/auth/confirm', hash: location.hash }} replace />;
  }
  return <Navigate to="/login" replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <AppTheme>
          <ToastHost />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/register/check-email" element={<CheckEmailPage />} />
            <Route path="/register/phone" element={<PhoneBindPage />} />
            <Route path="/register/verified" element={<VerificationSuccessPage />} />
            <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            {/* OAuth Provider 授权页：业务站 302 落点（?tx=…&state=…），复用现有登录 */}
            <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
            {/* 用户中心（Tabs 布局常驻：切换 Tab 只换 Outlet，不重挂壳） */}
            <Route element={<AccountLayout />}>
              <Route element={<UserCenterPage />}>
                <Route path="/profile" element={<ProfileHomeTab />} />
                <Route path="/settings" element={<ProfileEditTab />} />
                <Route path="/security" element={<SecurityPage />} />
              </Route>
              {/* 安全子功能深链（逻辑零改动）：左栏高亮归到“安全性与登录” */}
              <Route path="/enroll" element={<EnrollPage />} />
              <Route path="/phone" element={<PhonePage />} />
              <Route path="/recovery" element={<RecoveryPage />} />
              {/* 兼容旧入口：/user 跳个人主页 */}
              <Route path="/user" element={<Navigate to="/profile" replace />} />
            </Route>
            <Route path="/security/password" element={<PasswordPage />} />
            <Route path="/security/phone/rebind" element={<PhoneRebindPage />} />
            <Route path="/security/email" element={<SecondaryEmailPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/" element={<LandingGate />} />
            <Route path="*" element={<LandingGate />} />
          </Routes>
        </AppTheme>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
);

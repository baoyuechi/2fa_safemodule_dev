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
import PhoneBindPage from './pages/PhoneBindPage';
import VerificationSuccessPage from './pages/VerificationSuccessPage';
import EnrollPage from './pages/EnrollPage';
import PhonePage from './pages/PhonePage';
import SecurityPage from './pages/SecurityPage';

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
            <Route path="/enroll" element={<EnrollPage />} />
            <Route path="/phone" element={<PhonePage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/" element={<LandingGate />} />
            <Route path="*" element={<LandingGate />} />
          </Routes>
        </AppTheme>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
);

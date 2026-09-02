import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppTheme from './shared-theme/AppTheme';
import ToastHost from './components/ToastHost';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CheckEmailPage from './pages/CheckEmailPage';
import ConfirmEmailPage from './pages/ConfirmEmailPage';
import PhoneBindPage from './pages/PhoneBindPage';
import EnrollPage from './pages/EnrollPage';
import PhonePage from './pages/PhonePage';
import SecurityPage from './pages/SecurityPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppTheme>
        <ToastHost />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/check-email" element={<CheckEmailPage />} />
          <Route path="/register/phone" element={<PhoneBindPage />} />
          <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
          <Route path="/enroll" element={<EnrollPage />} />
          <Route path="/phone" element={<PhonePage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppTheme>
    </BrowserRouter>
  </StrictMode>,
);

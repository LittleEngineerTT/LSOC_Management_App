import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AppShell } from '../app/AppShell';
import { AuthLayout } from './components';
import { SessionProvider } from './session';
import { LoginPage } from './pages/LoginPage';
import { RecoveryPage } from './pages/RecoveryPage';
import { PasswordPage } from './pages/PasswordPage';
import { AuthSuccessPage } from './pages/AuthSuccessPage';
import { PrivacyPage } from '../app/PrivacyPage';

function Page({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}

export function AuthApp() {
  const [search] = useSearchParams();
  const tokenKey = search.get('token') ?? '';
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route
          path="/login"
          element={
            <Page>
              <LoginPage />
            </Page>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <Page>
              <RecoveryPage />
            </Page>
          }
        />
        <Route
          path="/reset-password"
          element={
            <Page>
              <PasswordPage key={`reset:${tokenKey}`} />
            </Page>
          }
        />
        <Route
          path="/activate"
          element={
            <Page>
              <PasswordPage key={`invitation:${tokenKey}`} invitation />
            </Page>
          }
        />
        <Route
          path="/activate/success"
          element={
            <Page>
              <AuthSuccessPage flow="activate" />
            </Page>
          }
        />
        <Route
          path="/reset-password/success"
          element={
            <Page>
              <AuthSuccessPage flow="reset-password" />
            </Page>
          }
        />
        <Route path="/confidentialite" element={<PrivacyPage />} />
        <Route path="/app/*" element={<AppShell />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </SessionProvider>
  );
}

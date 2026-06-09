import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return null; // or a spinner; avoids redirect-flash before session hydrates

  if (!session) {
    // remember where they were headed so SignIn can bounce back after login
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

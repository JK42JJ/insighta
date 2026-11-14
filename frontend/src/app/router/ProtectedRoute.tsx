import { Navigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '@/features/auth/model/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Shown while the sign-in check runs; default nothing (the previous page stays). */
  fallback?: React.ReactNode;
}

export function ProtectedRoute({ children, fallback = null }: ProtectedRouteProps) {
  const { user, isLoading } = useAuthContext();
  const location = useLocation();

  // Return null during auth check to prevent full-screen spinner flash.
  // The previous page (or HTML shell background) stays visible until auth resolves.
  if (isLoading) {
    return <>{fallback}</>;
  }

  if (!user) {
    const returnTo = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

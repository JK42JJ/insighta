import { Navigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '@/features/auth/model/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuthContext();
  const location = useLocation();

  // Return null during auth check to prevent full-screen spinner flash.
  // The previous page (or HTML shell background) stays visible until auth resolves.
  if (isLoading) {
    return null;
  }

  if (!user) {
    const returnTo = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

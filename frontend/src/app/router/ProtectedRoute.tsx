import { Navigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '@/features/auth/model/AuthContext';
import { PageLoader } from '@/shared/ui/PageLoader';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading } = useAuthContext();
  const location = useLocation();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    const returnTo = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

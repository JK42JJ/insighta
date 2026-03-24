import { Navigate } from 'react-router-dom';
import { useAuthContext } from '@/features/auth/model/AuthContext';
import { useAdminCheck } from '@/pages/admin/hooks/useAdminCheck';
import { ApiHttpError } from '@/shared/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';

const HTTP_FORBIDDEN = 403;

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isLoading: authLoading } = useAuthContext();
  const { isAdmin, isLoading: adminLoading, error } = useAdminCheck();
  const queryClient = useQueryClient();

  if (authLoading || adminLoading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (error instanceof ApiHttpError && error.statusCode === HTTP_FORBIDDEN) {
    return <Navigate to="/" replace />;
  }

  // Transient error → show retry UI instead of wrong redirect
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px' }}>
        <p>Failed to verify admin access. Please try again.</p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'check'] })}
          style={{ padding: '8px 16px', cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

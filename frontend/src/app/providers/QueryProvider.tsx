import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/shared/config/query-client';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { CreditCard, AlertTriangle } from 'lucide-react';

export function AdminPayments() {
  const { data: revenueData } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue'],
    queryFn: () => apiClient.getAdminAnalyticsRevenue(),
    staleTime: 60_000,
  });

  const { data: txData, isLoading } = useQuery({
    queryKey: ['admin', 'payments', 'transactions'],
    queryFn: () => apiClient.getAdminTransactions(),
    staleTime: 30_000,
  });

  const mrr = revenueData?.data?.mrr ?? 0;
  const subscribers = revenueData?.data?.subscribers ?? 0;
  const transactions = txData?.data?.transactions ?? [];
  const stripeConfigured = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Payments</h1>

      {!stripeConfigured && (
        <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-400">Stripe not configured</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to enable payment processing.
              See #243 for setup instructions.
            </p>
          </div>
        </div>
      )}

      {/* Revenue KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">MRR</p>
          </div>
          <p className="text-2xl font-bold">${(mrr / 100).toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-2">Active Subscribers</p>
          <p className="text-2xl font-bold">{subscribers}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-2">Total Transactions</p>
          <p className="text-2xl font-bold">{transactions.length}</p>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Recent Transactions</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">User</th>
              <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Amount</th>
              <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No transactions yet.</td></tr>
            ) : transactions.map((tx: Record<string, unknown>) => (
              <tr key={tx['id'] as string} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(tx['created_at'] as string).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-sm">{tx['user_email'] as string}</td>
                <td className="px-4 py-3 text-sm text-right font-mono">
                  ${((tx['amount'] as number) / 100).toFixed(2)} {tx['currency'] as string}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    tx['status'] === 'succeeded' ? 'bg-green-500/20 text-green-400' :
                    tx['status'] === 'failed' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {tx['status'] as string}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-xs">
                  {(tx['description'] as string) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

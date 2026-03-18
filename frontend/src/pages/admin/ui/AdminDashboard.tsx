import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { Users, CreditCard, Grid3X3, TrendingUp } from 'lucide-react';

export function AdminDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiClient.getAdminStats(),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 admin-glass animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Dashboard</h2>
        <p className="text-destructive">Failed to load stats.</p>
      </div>
    );
  }

  const stats = data.data;

  const cards = [
    {
      label: 'Total Users',
      value: stats.users.total,
      icon: Users,
      detail: `${stats.users.active} active (30d)`,
    },
    {
      label: 'Total Cards',
      value: stats.content.totalCards,
      icon: CreditCard,
      detail: null,
    },
    {
      label: 'Total Mandalas',
      value: stats.content.totalMandalas,
      icon: Grid3X3,
      detail: null,
    },
    {
      label: 'New Signups (7d)',
      value: stats.recentSignups.reduce((sum, d) => sum + d.count, 0),
      icon: TrendingUp,
      detail: null,
    },
  ];

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className="admin-glass p-4 flex items-start gap-3"
          >
            <div className="p-2 rounded-md bg-primary/10">
              <card.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-bold">{card.value.toLocaleString()}</p>
              {card.detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{card.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tier Distribution */}
      <div className="admin-glass p-4 mb-8">
        <h3 className="font-semibold mb-3">Tier Distribution</h3>
        <div className="flex gap-6">
          {stats.tiers.map((t) => (
            <div key={t.tier} className="text-center">
              <p className="text-xl font-bold">{t.count}</p>
              <p className="text-xs text-muted-foreground capitalize">{t.tier}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Signups */}
      {stats.recentSignups.length > 0 && (
        <div className="admin-glass p-4">
          <h3 className="font-semibold mb-3">Recent Signups (Last 7 Days)</h3>
          <div className="space-y-1">
            {stats.recentSignups.map((d) => (
              <div key={d.date} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{d.date}</span>
                <span className="font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

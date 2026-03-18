import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const PERIOD_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1y', value: 365 },
] as const;

export function AdminAnalytics() {
  const [days, setDays] = useState(30);

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'analytics', 'users', days],
    queryFn: () => apiClient.getAdminAnalyticsUsers(days),
    staleTime: 60_000,
  });

  const { data: growthData } = useQuery({
    queryKey: ['admin', 'analytics', 'growth', days],
    queryFn: () => apiClient.getAdminAnalyticsGrowth(days),
    staleTime: 60_000,
  });

  const { data: revenueData } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue'],
    queryFn: () => apiClient.getAdminAnalyticsRevenue(),
    staleTime: 60_000,
  });

  const dau = usersData?.data?.dau ?? [];
  const signups = growthData?.data?.signups ?? [];
  const totalUsers = growthData?.data?.totalUsers ?? 0;
  const mrr = revenueData?.data?.mrr ?? 0;
  const subscribers = revenueData?.data?.subscribers ?? 0;

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p.value}
              onClick={() => setDays(p.value)}
              className={`px-3 py-1 rounded-full text-xs ${
                days === p.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="admin-glass p-4">
          <p className="text-xs text-muted-foreground">Total Users</p>
          <p className="text-2xl font-bold mt-1">{totalUsers}</p>
        </div>
        <div className="admin-glass p-4">
          <p className="text-xs text-muted-foreground">MRR</p>
          <p className="text-2xl font-bold mt-1">${(mrr / 100).toFixed(2)}</p>
        </div>
        <div className="admin-glass p-4">
          <p className="text-xs text-muted-foreground">Active Subscribers</p>
          <p className="text-2xl font-bold mt-1">{subscribers}</p>
        </div>
      </div>

      {/* DAU Chart */}
      <div className="admin-glass p-4">
        <h2 className="text-sm font-medium mb-4">Daily Active Users</h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={dau}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
            />
            <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Signups Chart */}
      <div className="admin-glass p-4">
        <h2 className="text-sm font-medium mb-4">New Signups</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={signups}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

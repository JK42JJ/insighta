import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, ArrowLeft, Gift, ScrollText, BarChart3, CreditCard, Shield, HeartPulse } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const NAV_ITEMS = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/admin/moderation', icon: Shield, label: 'Moderation' },
  { to: '/admin/promotions', icon: Gift, label: 'Promotions' },
  { to: '/admin/payments', icon: CreditCard, label: 'Payments' },
  { to: '/admin/health', icon: HeartPulse, label: 'Health' },
  { to: '/admin/audit-log', icon: ScrollText, label: 'Audit Log' },
] as const;

export function AdminLayout() {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Admin</h1>
            {import.meta.env.DEV && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                DEV
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Insighta Backoffice</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-border">
          <NavLink
            to="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to App
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

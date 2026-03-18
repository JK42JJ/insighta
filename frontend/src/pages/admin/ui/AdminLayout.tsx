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

function AdminBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Grain texture only — no color gradients, no animation */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.3] dark:opacity-[0.15]">
        <filter id="admin-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#admin-grain)" />
      </svg>
    </div>
  );
}

export function AdminLayout() {
  return (
    <div className="flex h-screen relative">
      <AdminBackground />

      {/* Glass Sidebar */}
      <aside className="w-56 flex flex-col relative z-10 admin-glass-sidebar">
        <div className="p-4 border-b admin-glass-divider">
          <h1 className="text-lg font-semibold text-foreground">Admin</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Insighta Backoffice</p>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200',
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

        <div className="p-2 border-t admin-glass-divider">
          <NavLink
            to="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-all duration-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to App
          </NavLink>
        </div>
      </aside>

      {/* Glass Main Content */}
      <main className="flex-1 overflow-auto relative z-10">
        <Outlet />
      </main>
    </div>
  );
}

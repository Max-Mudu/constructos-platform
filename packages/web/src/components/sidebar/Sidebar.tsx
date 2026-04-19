'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, HardHat, ClipboardCheck, Target,
  Truck, UserCheck, FileStack, PieChart, Receipt, Lock,
  ScrollText, Settings, LogOut, Menu, X, Bell,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import { getVisibleNavItems } from './nav-config';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/Separator';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useSSE } from '@/providers/SSEProvider';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Building2, HardHat, ClipboardCheck, Target,
  Truck, UserCheck, FileStack, PieChart, Receipt, Lock,
  ScrollText, Settings, Bell,
};

function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon className={className} /> : null;
}

// ─── Sidebar contents (shared between desktop and mobile drawer) ──────────────

function ConnectionDot() {
  const { status } = useSSE();
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'connected'    && 'bg-emerald-500',
          status === 'connecting'   && 'bg-amber-400 animate-pulse',
          status === 'disconnected' && 'bg-red-400',
        )}
      />
      <span className="text-[10px] text-muted-foreground/50 capitalize">{status}</span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();

  if (!user) return null;

  const visibleItems = getVisibleNavItems(user.role, user.canViewFinance);

  // Group items by their `group` field, preserving order
  type Group = { group: string; items: typeof visibleItems };
  const groups: Group[] = [];
  let currentGroup = '';
  for (const item of visibleItems) {
    const g = item.group ?? currentGroup;
    currentGroup = g;
    const existing = groups.find((x) => x.group === g);
    if (existing) existing.items.push(item);
    else groups.push({ group: g, items: [item] });
  }

  async function handleLogout() {
    try { await authApi.logout(); } catch {}
    clearAuth();
    router.push('/login');
  }

  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  const roleLabel = user.role.replace(/_/g, ' ');

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">

      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar-border shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Building2 className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-none">ConstructOS</p>
          <p className="text-xs text-muted-foreground mt-0.5 capitalize truncate">{roleLabel}</p>
        </div>
      </div>

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map(({ group, items }, gi) => (
          <div key={group} className={cn(gi > 0 && 'mt-5')}>
            {group && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {group}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-sidebar-active text-sidebar-active-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <NavIcon
                        name={item.icon}
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-sidebar-active-foreground' : 'text-muted-foreground/70',
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                      {item.requiresFinance && (
                        <Lock
                          className="ml-auto h-3 w-3 shrink-0 text-amber-500"
                          aria-label="Private"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── User footer ───────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <ConnectionDot />
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          {/* Avatar */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-none">
              {user.firstName} {user.lastName}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <NotificationBell />
          <button
            onClick={handleLogout}
            title="Log out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

    </div>
  );
}

// ─── Public Sidebar component ─────────────────────────────────────────────────

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:min-h-screen shrink-0 border-r border-border">
        <SidebarContent />
      </aside>

      {/* Mobile: fixed top bar with hamburger */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">ConstructOS</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile: drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border shadow-lg">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}

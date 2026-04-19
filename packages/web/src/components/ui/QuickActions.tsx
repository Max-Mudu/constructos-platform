import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface QuickAction {
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

interface QuickActionsProps {
  title?: string;
  actions: QuickAction[];
  className?: string;
}

export function QuickActions({ title, actions, className }: QuickActionsProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {title && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action, i) => {
          const base = cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            action.variant === 'primary'
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border border-border bg-transparent text-foreground hover:bg-navy-elevated',
          );
          if (action.href) {
            return (
              <Link key={i} href={action.href} className={base}>
                {action.icon}
                {action.label}
              </Link>
            );
          }
          return (
            <button key={i} onClick={action.onClick} className={base}>
              {action.icon}
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

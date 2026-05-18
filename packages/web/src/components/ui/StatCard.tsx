import * as React from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  valueClassName?: string;
  className?: string;
}

export function StatCard({ label, value, icon, valueClassName, className }: StatCardProps) {
  return (
    <div className={cn(
      'rounded-xl border border-border bg-card p-4 transition-colors hover:border-gold/30',
      className,
    )}>
      {icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10 text-gold">
          {icon}
        </div>
      )}
      <p className={cn('text-2xl font-bold text-gold', valueClassName)}>{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
    </div>
  );
}

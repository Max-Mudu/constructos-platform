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
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
      )}
      <p className={cn('text-2xl font-bold text-brand-light', valueClassName)}>{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

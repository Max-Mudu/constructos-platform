import * as React from 'react';
import { cn } from '@/lib/utils';

interface StickyActionsRowProps {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}

export function StickyActionsRow({ title, actions, className }: StickyActionsRowProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex items-center justify-between',
        'border-b border-border bg-background/90 backdrop-blur-sm px-6 py-3',
        className,
      )}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

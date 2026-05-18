import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:     'border-transparent bg-primary/20 text-primary border-primary/20',
        secondary:   'border-border/60 bg-navy-elevated text-muted-foreground',
        destructive: 'border-red-900/50 bg-red-950/60 text-red-400',
        outline:     'border-border text-muted-foreground',
        // ── Operational status variants — preserve semantics ────────────
        active:      'border-emerald-900/50 bg-emerald-950/60 text-emerald-400',
        inactive:    'border-navy-border/60 bg-navy-elevated text-muted-foreground/70',
        pending:     'border-amber-900/50 bg-amber-950/60 text-amber-400',
        warning:     'border-amber-900/50 bg-amber-950/60 text-amber-400',
        info:        'border-blue-900/50 bg-blue-950/60 text-blue-400',
        private:     'border-amber-900/40 bg-amber-950/40 text-amber-500/80',
        // ── Gold — premium highlight ────────────────────────────────────
        gold:        'border-[hsl(38_58%_30%)] bg-[hsl(38_58%_12%)] text-gold',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

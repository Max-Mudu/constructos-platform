import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground hover:bg-primary/85 shadow-sm',
        destructive: 'bg-red-950 text-red-300 border border-red-900/60 hover:bg-red-900 hover:text-red-200',
        outline:     'border border-border bg-transparent text-foreground hover:bg-navy-elevated hover:border-border/80',
        secondary:   'bg-navy-elevated text-foreground border border-border/60 hover:bg-navy-border',
        ghost:       'text-muted-foreground hover:bg-navy-elevated hover:text-foreground',
        link:        'text-primary underline-offset-4 hover:underline',
        gold:        'bg-gold text-gold-foreground hover:bg-gold/90 shadow-sm font-semibold',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-8 rounded-md px-3 text-xs',
        lg:      'h-10 px-6',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    const content = !asChild && loading
      ? <><Loader2 className="h-4 w-4 animate-spin" />{children}</>
      : children;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children={content as any}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };

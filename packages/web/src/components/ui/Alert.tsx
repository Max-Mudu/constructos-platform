import { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  [
    'relative w-full rounded-lg border p-4 text-sm',
    '[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4',
    '[&>svg~*]:pl-7',
  ],
  {
    variants: {
      variant: {
        default:     'bg-navy-elevated border-border/80 text-foreground [&>svg]:text-muted-foreground',
        destructive: 'bg-red-950/40 border-red-900/60 text-red-400 [&>svg]:text-red-400',
        warning:     'bg-amber-950/40 border-amber-900/60 text-amber-400 [&>svg]:text-amber-400',
        info:        'bg-blue-950/40 border-blue-900/60 text-blue-400 [&>svg]:text-blue-400',
        success:     'bg-emerald-950/40 border-emerald-900/60 text-emerald-400 [&>svg]:text-emerald-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  );
}

function AlertTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <h5
      className={cn('mb-1 font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div className={cn('text-sm opacity-85', className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription };

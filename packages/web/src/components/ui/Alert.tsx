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
        default:     'bg-navy-surface border-border text-foreground [&>svg]:text-foreground',
        destructive: 'bg-red-950/50 border-red-800 text-red-400 [&>svg]:text-red-400',
        warning:     'bg-amber-950/50 border-amber-800 text-amber-300 [&>svg]:text-amber-300',
        info:        'bg-blue-950/50 border-blue-800 text-blue-300 [&>svg]:text-blue-300',
        success:     'bg-emerald-950/50 border-emerald-800 text-emerald-300 [&>svg]:text-emerald-300',
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
    <div className={cn('text-sm opacity-90', className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription };

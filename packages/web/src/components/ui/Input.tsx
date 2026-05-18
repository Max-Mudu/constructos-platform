import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </label>
        )}
        <input
          id={inputId}
          type={type}
          className={cn(
            'flex h-9 w-full rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground/50',
            'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-gold/40',
            'disabled:cursor-not-allowed disabled:opacity-40',
            error && 'border-red-700 focus-visible:ring-red-500/50',
            className,
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { Input };

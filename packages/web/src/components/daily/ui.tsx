'use client';

/**
 * Small UI primitives for the Daily Report screens. They use the scoped
 * .theme-daily tokens (light palette) and 44 px minimum tap targets.
 */
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReportStatus } from '@/lib/daily-report-types';

// ─── Button ──────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'md' | 'lg' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-sm hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-hover))]',
  secondary: 'border border-border bg-card text-foreground hover:bg-accent active:bg-accent',
  soft: 'bg-accent text-accent-foreground hover:bg-[hsl(41_76%_90%)]',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
  danger: 'border border-destructive/30 bg-card text-destructive hover:bg-destructive/5',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-[44px] px-3 text-sm',
  md: 'min-h-[44px] px-4 text-[15px]',
  lg: 'min-h-[52px] px-5 text-base',
};

export interface DButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

export const DButton = React.forwardRef<HTMLButtonElement, DButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, block = false, className, disabled, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
DButton.displayName = 'DButton';

/** Same look as DButton, for links. */
export function buttonClass(variant: Variant = 'primary', size: Size = 'md', block = false): string {
  return cn(
    'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export const DCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)} {...props}>
      {children}
    </div>
  ),
);
DCard.displayName = 'DCard';

// ─── Status chip ─────────────────────────────────────────────────────────────

export type ChipTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'primary';

const CHIP: Record<ChipTone, string> = {
  neutral: 'border-border bg-background text-muted-foreground',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/25 bg-info/10 text-info',
  danger: 'border-destructive/25 bg-destructive/10 text-destructive',
  primary: 'border-primary/25 bg-accent text-accent-foreground',
};

export function Chip({ tone = 'neutral', className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', CHIP[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function ReportStatusBadge({ status, revision, className }: { status: ReportStatus | 'not_started'; revision?: number; className?: string }) {
  if (status === 'not_started') return <Chip tone="neutral" className={className}>Not started</Chip>;
  if (status === 'final') {
    return <Chip tone="success" className={className}>Final{revision ? ` · Rev ${revision}` : ''}</Chip>;
  }
  return <Chip tone="info" className={className}>Draft{revision ? ` · Rev ${revision}` : ''}</Chip>;
}

// ─── Notice ──────────────────────────────────────────────────────────────────

type NoticeTone = 'info' | 'warning' | 'danger' | 'success';
const NOTICE: Record<NoticeTone, { box: string; icon: React.ComponentType<{ className?: string }>; iconCls: string }> = {
  info: { box: 'border-info/25 bg-info/5', icon: Info, iconCls: 'text-info' },
  warning: { box: 'border-warning/30 bg-warning/5', icon: AlertTriangle, iconCls: 'text-warning' },
  danger: { box: 'border-destructive/25 bg-destructive/5', icon: XCircle, iconCls: 'text-destructive' },
  success: { box: 'border-success/25 bg-success/5', icon: CheckCircle2, iconCls: 'text-success' },
};

export function Notice({
  tone = 'info', title, children, actions, className, live = false,
}: {
  tone?: NoticeTone; title?: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; className?: string; live?: boolean;
}) {
  const t = NOTICE[tone];
  const Icon = t.icon;
  return (
    <div
      className={cn('rounded-xl border p-3.5', t.box, className)}
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <div className="flex gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', t.iconCls)} aria-hidden />
        <div className="min-w-0 flex-1">
          {title && <p className="text-[15px] font-semibold text-foreground">{title}</p>}
          {children && <div className={cn('text-sm text-muted-foreground', title && 'mt-0.5')}>{children}</div>}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-foreground">
      {children}
      {hint && <span className="ml-1 font-normal text-[hsl(var(--text-tertiary))]">{hint}</span>}
    </label>
  );
}

const fieldBase =
  'w-full rounded-xl border border-input bg-card px-3 text-foreground shadow-none outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:text-muted-foreground';

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldBase, 'min-h-[44px] py-2', className)} {...props} />,
);
TextInput.displayName = 'TextInput';

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, 'py-2.5 leading-relaxed', className)} {...props} />,
);
TextArea.displayName = 'TextArea';

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'min-h-[44px] appearance-auto py-2', className)} {...props}>
      {children}
    </select>
  ),
);
SelectInput.displayName = 'SelectInput';

// ─── Misc ────────────────────────────────────────────────────────────────────

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-10', className)} role="status" aria-label={label}>
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-border/60', className)} aria-hidden />;
}

/** Sticky bottom action bar with safe-area padding. Pages add pb-28 to their content. */
export function BottomBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85',
        className,
      )}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
    >
      <div className="mx-auto flex w-full max-w-screen-sm items-center gap-3 px-4 pt-3 md:max-w-screen-md">{children}</div>
    </div>
  );
}

export function PageContainer({ children, className, withBottomBar = false }: { children: React.ReactNode; className?: string; withBottomBar?: boolean }) {
  return (
    <div className={cn('mx-auto w-full max-w-screen-sm px-4 py-4 md:max-w-screen-md md:py-6', withBottomBar && 'pb-32', className)}>
      {children}
    </div>
  );
}

/** Accessible modal dialog (no portal dependency). */
export function Dialog({
  open, onClose, title, children, footer, labelledBy = 'dr-dialog-title',
}: {
  open: boolean; onClose: () => void; title: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; labelledBy?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>('textarea, input, select, button');
    focusable?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-[#121826]/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.25rem)' }}
      >
        <h2 id={labelledBy} className="text-lg font-semibold text-foreground">{title}</h2>
        {children && <div className="mt-2 text-[15px] text-muted-foreground">{children}</div>}
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

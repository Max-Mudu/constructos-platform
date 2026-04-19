# UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the entire `packages/web` UI to a dark-navy premium construction SaaS design using the existing Tailwind CSS-variable token system.

**Architecture:** Three passes — (A) update CSS variable values in `globals.css` so all existing `bg-background`, `text-foreground`, etc. classes automatically pick up dark-navy colors; (B) create/update shared components (Badge, Input, Table, PageHeader, Breadcrumb, StatCard, EmptyState, SearchFilterBar, QuickActions, StickyActionsRow); (C) update all pages to use the new patterns. The Sidebar is already expanded-with-labels — only its colors change (handled by Pass A).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS v3 (CSS variable token system), CVA (class-variance-authority), lucide-react, Radix Slot.

**Key constraint:** The app does NOT apply a `.dark` class to `<html>`. Dark mode is achieved by updating `:root` CSS variable values directly. Any `dark:` Tailwind prefix in existing components will be dead code after this change — these must be replaced with the direct dark-appropriate color class.

---

## File Map

| Pass | File | Action |
|---|---|---|
| A | `packages/web/src/app/globals.css` | Update `:root` CSS variables to dark navy |
| A | `packages/web/tailwind.config.ts` | Add `navy.*` and `brand-light` color aliases |
| B | `packages/web/src/components/ui/Badge.tsx` | Replace `dark:` prefixed classes with dark-direct values; add `pending`, `info`, `warning` variants |
| B | `packages/web/src/components/ui/Button.tsx` | Verify/adjust for dark background |
| B | `packages/web/src/components/ui/Input.tsx` | Verify/update for dark |
| B | `packages/web/src/components/ui/Select.tsx` | Create new |
| B | `packages/web/src/components/ui/Table.tsx` | Update header bg + row hover |
| B | `packages/web/src/components/ui/Alert.tsx` | Update warning variant for dark |
| B | `packages/web/src/components/ui/Skeleton.tsx` | Update shimmer for dark |
| B | `packages/web/src/components/ui/PageHeader.tsx` | Create new |
| B | `packages/web/src/components/ui/Breadcrumb.tsx` | Create new |
| B | `packages/web/src/components/ui/StatCard.tsx` | Create new |
| B | `packages/web/src/components/ui/EmptyState.tsx` | Create new |
| B | `packages/web/src/components/ui/SearchFilterBar.tsx` | Create new |
| B | `packages/web/src/components/ui/QuickActions.tsx` | Create new |
| B | `packages/web/src/components/ui/StickyActionsRow.tsx` | Create new |
| C | `packages/web/src/app/(auth)/layout.tsx` | Dark polish |
| C | `packages/web/src/app/(auth)/login/page.tsx` | Integrate PageHeader, Input, Button |
| C | `packages/web/src/app/(auth)/register/page.tsx` | Integrate PageHeader, Input, Select |
| C | `packages/web/src/app/(app)/layout.tsx` | Remove padding that conflicts with sticky rows |
| C | `packages/web/src/app/(app)/dashboard/page.tsx` | PageHeader + StatCards grid |
| C | `packages/web/src/app/(app)/projects/page.tsx` | PageHeader + EmptyState + SearchFilterBar |
| C | `packages/web/src/app/(app)/projects/[projectId]/page.tsx` | Breadcrumb + StickyActionsRow + QuickActions |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/page.tsx` | Breadcrumb + StickyActionsRow + QuickActions |
| C | `packages/web/src/app/(app)/workers/page.tsx` | PageHeader + SearchFilterBar + EmptyState + Table |
| C | `packages/web/src/app/(app)/workers/[workerId]/page.tsx` | Breadcrumb |
| C | `packages/web/src/app/(app)/workers/[workerId]/edit/page.tsx` | Breadcrumb |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/attendance/page.tsx` | Breadcrumb + SearchFilterBar + StatCards + EmptyState + updated Badge variants |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/attendance/new/page.tsx` | Breadcrumb + dark Input/Select |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/targets/page.tsx` | Breadcrumb + SearchFilterBar + StatCards + EmptyState |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/targets/new/page.tsx` | Breadcrumb + dark Input |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/labour/page.tsx` | Breadcrumb + SearchFilterBar + EmptyState + Table padding |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/labour/new/page.tsx` | Breadcrumb + dark Input |
| C | `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/deliveries/page.tsx` | Breadcrumb + EmptyState |
| C | `packages/web/src/app/(app)/finance/page.tsx` | Dark amber tokens |

---

## Task 1: Update CSS Variables to Dark Navy

**Files:**
- Modify: `packages/web/src/app/globals.css`

- [ ] **Step 1: Replace `:root` block**

Replace the entire `@layer base { :root { ... } ... }` block with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ── Surfaces ─────────────────────────────────── */
    --background:      222 47% 11%;     /* #0f172a — page bg      */
    --foreground:      214 32% 91%;     /* #f1f5f9 — light text   */
    --card:            215 33% 17%;     /* #1e293b — surface      */
    --card-foreground: 214 32% 91%;

    /* ── Primary (#0369a1) ───────────────────────── */
    --primary:            201 96% 32%;
    --primary-foreground: 0 0% 100%;

    /* ── Secondary / Muted ───────────────────────── */
    --secondary:            215 30% 21%;  /* #253347 — elevated   */
    --secondary-foreground: 214 32% 91%;
    --muted:                215 30% 21%;
    --muted-foreground:     215 25% 65%;  /* #94a3b8               */

    /* ── Accent (hover backgrounds) ─────────────── */
    --accent:            215 30% 21%;
    --accent-foreground: 214 32% 91%;

    /* ── Destructive ─────────────────────────────── */
    --destructive:            0 72% 51%;
    --destructive-foreground: 0 0% 100%;

    /* ── Chrome ──────────────────────────────────── */
    --border: 215 31% 25%;     /* #2d3f55 */
    --input:  215 31% 25%;
    --ring:   201 96% 32%;

    /* ── Sidebar ─────────────────────────────────── */
    --sidebar:                  215 33% 17%;   /* #1e293b               */
    --sidebar-foreground:       214 32% 91%;
    --sidebar-border:           215 31% 25%;   /* #2d3f55               */
    --sidebar-active:           201 96% 32%;   /* #0369a1 primary       */
    --sidebar-active-foreground: 0 0% 100%;    /* white                 */
    --sidebar-muted:            215 25% 65%;   /* #94a3b8               */

    /* ── Radius ──────────────────────────────────── */
    --radius: 0.5rem;
  }

  html {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }

  *,
  *::before,
  *::after {
    @apply border-border;
    box-sizing: border-box;
  }

  /* Scrollbar */
  ::-webkit-scrollbar        { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track  { background: transparent; }
  ::-webkit-scrollbar-thumb  { background: hsl(var(--border)); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground)); }
}
```

- [ ] **Step 2: Commit**

```bash
cd "packages/web"
git add src/app/globals.css
git commit -m "style: switch app to dark navy via CSS variable update"
```

---

## Task 2: Add Tailwind Color Aliases

**Files:**
- Modify: `packages/web/tailwind.config.ts`

- [ ] **Step 1: Add `navy` and `brand-light` to `theme.extend.colors`**

Inside `theme: { extend: { colors: { ... } } }`, add after the existing `sidebar` block:

```ts
        // Dark navy semantic palette — used in new components
        navy: {
          base:     '#0f172a',
          surface:  '#1e293b',
          elevated: '#253347',
          border:   '#2d3f55',
        },
        'brand-light': '#38bdf8',
```

- [ ] **Step 2: Commit**

```bash
git add tailwind.config.ts
git commit -m "style: add navy.* and brand-light Tailwind color aliases"
```

---

## Task 3: Update Badge for Dark Backgrounds

**Files:**
- Modify: `packages/web/src/components/ui/Badge.tsx`

The existing Badge uses `dark:` prefixed classes which won't activate (no `.dark` class on `<html>`). Replace all variant styles with dark-direct values and add `pending`, `info`, `warning` variants.

- [ ] **Step 1: Replace Badge.tsx entirely**

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:     'border-transparent bg-primary text-primary-foreground',
        secondary:   'border-transparent bg-navy-elevated text-foreground',
        destructive: 'border-transparent bg-red-950 text-red-400',
        outline:     'border-border text-foreground',
        // Status variants — dark-background friendly
        active:      'border-transparent bg-emerald-950 text-emerald-300',
        inactive:    'border-transparent bg-slate-800 text-slate-400',
        pending:     'border-transparent bg-amber-950 text-amber-300',
        warning:     'border-transparent bg-amber-950 text-amber-300',
        info:        'border-transparent bg-blue-950 text-blue-300',
        private:     'border-transparent bg-amber-950 text-amber-300',
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Badge.tsx
git commit -m "style: update Badge variants for dark-navy backgrounds"
```

---

## Task 4: Update Button for Dark Backgrounds

**Files:**
- Modify: `packages/web/src/components/ui/Button.tsx`

- [ ] **Step 1: Replace Button.tsx**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-red-900 text-red-200 hover:bg-red-800',
        outline:     'border border-border bg-transparent text-foreground hover:bg-navy-elevated',
        secondary:   'bg-navy-elevated text-foreground hover:bg-navy-border',
        ghost:       'text-muted-foreground hover:bg-navy-elevated hover:text-foreground',
        link:        'text-primary underline-offset-4 hover:underline',
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
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Button.tsx
git commit -m "style: update Button variants for dark-navy UI"
```

---

## Task 5: Update Input for Dark Backgrounds

**Files:**
- Modify: `packages/web/src/components/ui/Input.tsx`

- [ ] **Step 1: Replace Input.tsx**

```tsx
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
          <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <input
          id={inputId}
          type={type}
          className={cn(
            'flex h-9 w-full rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground',
            'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-red-500 focus-visible:ring-red-500',
            className,
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { Input };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Input.tsx
git commit -m "style: update Input for dark-navy backgrounds"
```

---

## Task 6: Create Select Component

**Files:**
- Create: `packages/web/src/components/ui/Select.tsx`

- [ ] **Step 1: Create Select.tsx**

```tsx
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            id={selectId}
            ref={ref}
            className={cn(
              'flex h-9 w-full appearance-none rounded-lg border border-border bg-navy-base px-3 py-1 pr-8 text-sm text-foreground',
              'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-red-500',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';

export { Select };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Select.tsx
git commit -m "feat: add Select component for dark-navy UI"
```

---

## Task 7: Update Table for Dark Backgrounds

**Files:**
- Modify: `packages/web/src/components/ui/Table.tsx`

- [ ] **Step 1: Replace Table.tsx**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="w-full overflow-auto rounded-xl border border-border">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('bg-navy-elevated [&_tr]:border-b [&_tr]:border-border', className)} {...props} />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
);
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-navy-elevated/60 data-[state=selected]:bg-navy-elevated',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'h-10 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  ),
);
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Table.tsx
git commit -m "style: update Table with dark-navy header + comfortable row padding"
```

---

## Task 8: Update Alert and Skeleton

**Files:**
- Modify: `packages/web/src/components/ui/Alert.tsx`
- Modify: `packages/web/src/components/ui/Skeleton.tsx`

- [ ] **Step 1: Replace Alert.tsx**

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4',
  {
    variants: {
      variant: {
        default:     'border-border bg-navy-surface text-foreground [&>svg]:text-foreground',
        destructive: 'border-red-800 bg-red-950/50 text-red-400 [&>svg]:text-red-400',
        warning:     'border-amber-800 bg-amber-950/50 text-amber-300 [&>svg]:text-amber-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
```

- [ ] **Step 2: Replace Skeleton.tsx**

```tsx
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-navy-elevated', className)}
      {...props}
    />
  );
}

export { Skeleton };
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Alert.tsx src/components/ui/Skeleton.tsx
git commit -m "style: update Alert + Skeleton for dark-navy backgrounds"
```

---

## Task 9: Create PageHeader Component

**Files:**
- Create: `packages/web/src/components/ui/PageHeader.tsx`

- [ ] **Step 1: Create PageHeader.tsx**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/PageHeader.tsx
git commit -m "feat: add PageHeader component"
```

---

## Task 10: Create Breadcrumb Component

**Files:**
- Create: `packages/web/src/components/ui/Breadcrumb.tsx`

- [ ] **Step 1: Create Breadcrumb.tsx**

```tsx
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-sm', className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
            {isLast || !item.href ? (
              <span className={cn('font-medium', isLast ? 'text-foreground' : 'text-muted-foreground')}>
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Breadcrumb.tsx
git commit -m "feat: add Breadcrumb component"
```

---

## Task 11: Create StatCard Component

**Files:**
- Create: `packages/web/src/components/ui/StatCard.tsx`

- [ ] **Step 1: Create StatCard.tsx**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/StatCard.tsx
git commit -m "feat: add StatCard component"
```

---

## Task 12: Create EmptyState Component

**Files:**
- Create: `packages/web/src/components/ui/EmptyState.tsx`

- [ ] **Step 1: Create EmptyState.tsx**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import Link from 'next/link';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 text-muted-foreground/30">{icon}</div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && (
        <div className="mt-4">
          {action.href ? (
            <Link href={action.href}>
              <Button size="sm">{action.label}</Button>
            </Link>
          ) : (
            <Button size="sm" onClick={action.onClick}>{action.label}</Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/EmptyState.tsx
git commit -m "feat: add EmptyState component"
```

---

## Task 13: Create SearchFilterBar Component

**Files:**
- Create: `packages/web/src/components/ui/SearchFilterBar.tsx`

- [ ] **Step 1: Create SearchFilterBar.tsx**

```tsx
'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterOption {
  label: string;
  value: string;
}

interface Filter {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface SearchFilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: Filter[];
  className?: string;
  children?: React.ReactNode;
}

export function SearchFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  className,
  children,
}: SearchFilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {onSearchChange && (
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex h-9 w-full rounded-lg border border-border bg-navy-base pl-9 pr-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}
      {filters?.map((filter) => (
        <select
          key={filter.label}
          value={filter.value}
          onChange={(e) => filter.onChange(e.target.value)}
          className="h-9 rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={filter.label}
        >
          <option value="">{filter.label}: All</option>
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/SearchFilterBar.tsx
git commit -m "feat: add SearchFilterBar component"
```

---

## Task 14: Create QuickActions Component

**Files:**
- Create: `packages/web/src/components/ui/QuickActions.tsx`

- [ ] **Step 1: Create QuickActions.tsx**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/QuickActions.tsx
git commit -m "feat: add QuickActions component"
```

---

## Task 15: Create StickyActionsRow Component

**Files:**
- Create: `packages/web/src/components/ui/StickyActionsRow.tsx`

- [ ] **Step 1: Create StickyActionsRow.tsx**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/StickyActionsRow.tsx
git commit -m "feat: add StickyActionsRow component"
```

---

## Task 16: Update App Layout

**Files:**
- Modify: `packages/web/src/app/(app)/layout.tsx`

The main content area gets `pt-14 md:pt-0` to clear the mobile top bar, and removes the hardcoded padding so StickyActionsRow can go edge-to-edge.

- [ ] **Step 1: Replace (app)/layout.tsx**

```tsx
import { Sidebar } from '@/components/sidebar/Sidebar';
import { AuthBootstrap } from '@/components/AuthBootstrap';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AuthBootstrap />
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 pt-14 md:pt-0">
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
```

Note: Individual pages now control their own top padding via a wrapping `<div className="px-6 py-8 space-y-6">`. Pages that use `StickyActionsRow` place it before that wrapper so it goes full-width.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/layout.tsx
git commit -m "style: update app layout — remove global padding so StickyActionsRow can be edge-to-edge"
```

---

## Task 17: Update Login Page

**Files:**
- Modify: `packages/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Replace login/page.tsx**

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authApi.login({ email, password });
      setAuth(data.user, data.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Sign in</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your credentials to access your workspace.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          required
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline underline-offset-4">
          Register
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(auth)/login/page.tsx
git commit -m "style: update login page for dark-navy UI"
```

---

## Task 18: Update Register Page

**Files:**
- Modify: `packages/web/src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Replace the currency `<select>` with the new Select component**

In register/page.tsx, add the import and swap the raw `<select>`:

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'NGN', label: 'NGN — Nigerian Naira' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
  { value: 'GHS', label: 'GHS — Ghanaian Cedi' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '',
    password: '', companyName: '', currency: 'USD',
  });
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading]         = useState(false);

  function setField(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: '' }));
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.firstName.trim())              e.firstName   = 'Required';
    if (!form.lastName.trim())               e.lastName    = 'Required';
    if (!form.email.includes('@'))           e.email       = 'Enter a valid email';
    if (form.password.length < 8)            e.password    = 'Minimum 8 characters';
    else if (!/[A-Z]/.test(form.password))   e.password    = 'Must include an uppercase letter';
    else if (!/[0-9]/.test(form.password))   e.password    = 'Must include a number';
    if (form.companyName.trim().length < 2)  e.companyName = 'Enter your company name';
    return e;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError('');
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const data = await authApi.register(form);
      setAuth(data.user, data.accessToken);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) {
          const fe: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) fe[k] = Array.isArray(v) ? v[0] : String(v);
          setErrors(fe);
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError('Something went wrong. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Register your company
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set up your workspace in under a minute.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            value={form.firstName}
            onChange={(e) => setField('firstName', e.target.value)}
            error={errors.firstName}
            autoComplete="given-name"
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(e) => setField('lastName', e.target.value)}
            error={errors.lastName}
            autoComplete="family-name"
          />
        </div>
        <Input
          label="Company name"
          value={form.companyName}
          onChange={(e) => setField('companyName', e.target.value)}
          error={errors.companyName}
          placeholder="Acme Construction Ltd"
        />
        <Input
          label="Work email"
          type="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          error={errors.email}
          placeholder="you@company.com"
          autoComplete="email"
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => setField('password', e.target.value)}
          error={errors.password}
          placeholder="Min. 8 chars, 1 uppercase, 1 number"
          autoComplete="new-password"
        />
        <Select
          label="Currency"
          value={form.currency}
          onChange={(e) => setField('currency', e.target.value)}
        >
          {CURRENCIES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>

        {serverError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(auth)/register/page.tsx
git commit -m "style: update register page — use Select component, dark UI"
```

---

## Task 19: Update Dashboard Page

**Files:**
- Modify: `packages/web/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Replace dashboard/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { projectApi, ApiError } from '@/lib/api';
import { Project } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Building2, AlertCircle, ChevronRight, Plus } from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    projectApi.list()
      .then((d) => setProjects(d.projects))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const active   = projects.filter((p) => p.status === 'active').length;
  const onHold   = projects.filter((p) => p.status === 'on_hold').length;
  const completed = projects.filter((p) => p.status === 'completed').length;

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  return (
    <div className="px-6 py-8 space-y-8 animate-fade-in">
      <PageHeader
        title={`Welcome back, ${user?.firstName ?? ''}!`}
        subtitle={user ? `${user.role.replace(/_/g, ' ')} · ${user.email}` : undefined}
        action={
          canManage ? (
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> New Project
            </Link>
          ) : undefined
        }
      />

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Active Projects"    value={active}    icon={<Building2 className="h-5 w-5" />} />
          <StatCard label="On Hold"            value={onHold}    valueClassName="text-amber-300" />
          <StatCard label="Completed"          value={completed} valueClassName="text-emerald-300" />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Recent projects */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Recent Projects</h2>
          <Link href="/projects" className="text-sm text-primary hover:underline underline-offset-4">
            View all
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-12 w-12" />}
            title="No projects yet"
            description="Create your first project to get started."
            action={canManage ? { label: 'New Project', href: '/projects' } : undefined}
          />
        ) : (
          <div className="space-y-2">
            {projects.slice(0, 5).map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-navy-elevated cursor-pointer">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                      {p.location && (
                        <p className="truncate text-xs text-muted-foreground">{p.location}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <Badge variant={p.status === 'active' ? 'active' : p.status === 'on_hold' ? 'pending' : 'secondary'}>
                      {p.status.replace(/_/g, ' ')}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx
git commit -m "style: update dashboard — PageHeader, StatCards, recent projects list"
```

---

## Task 20: Update Projects List Page

**Files:**
- Modify: `packages/web/src/app/(app)/projects/page.tsx`

- [ ] **Step 1: Replace projects/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { projectApi, ApiError } from '@/lib/api';
import { Project } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Building2, MapPin, Calendar, ChevronRight, AlertCircle, Plus } from 'lucide-react';

const STATUS_OPTIONS = [
  { label: 'Active',    value: 'active'    },
  { label: 'On Hold',   value: 'on_hold'   },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

function statusVariant(s: string): 'active' | 'pending' | 'secondary' | 'inactive' {
  if (s === 'active')    return 'active';
  if (s === 'on_hold')   return 'pending';
  if (s === 'completed') return 'secondary';
  return 'inactive';
}

export default function ProjectsPage() {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    projectApi.list()
      .then((d) => setProjects(d.projects))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  const filtered = projects.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length !== 1 ? 's' : ''} total`}
        action={
          canManage ? (
            <Link href="/projects/new">
              <Button><Plus className="h-4 w-4" /> New Project</Button>
            </Link>
          ) : undefined
        }
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search projects…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            options: STATUS_OPTIONS,
            onChange: setStatusFilter,
          },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title={search || statusFilter ? 'No projects match your filter' : 'No projects yet'}
          description={!search && !statusFilter && canManage ? 'Create your first project to get started.' : undefined}
          action={!search && !statusFilter && canManage ? { label: 'New Project', href: '/projects/new' } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <div className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated cursor-pointer">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {p.name}
                      </p>
                      <Badge variant={statusVariant(p.status)}>
                        {p.status.replace(/_/g, ' ')}
                      </Badge>
                      {p.code && (
                        <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-4">
                      {p.location && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />{p.location}
                        </span>
                      )}
                      {p.startDate && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(p.startDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors ml-3" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/projects/page.tsx
git commit -m "style: update projects list — PageHeader, SearchFilterBar, EmptyState"
```

---

## Task 21: Update Project Detail Page

**Files:**
- Modify: `packages/web/src/app/(app)/projects/[projectId]/page.tsx`

- [ ] **Step 1: Replace project detail page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { projectApi, siteApi, ApiError } from '@/lib/api';
import { Project, JobSite } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { QuickActions } from '@/components/ui/QuickActions';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import {
  Building2, MapPin, Calendar, ChevronRight, Users, Plus, AlertCircle,
} from 'lucide-react';

function statusVariant(s: string): 'active' | 'pending' | 'secondary' | 'inactive' {
  if (s === 'active')    return 'active';
  if (s === 'on_hold')   return 'pending';
  if (s === 'completed') return 'secondary';
  return 'inactive';
}

export default function ProjectDetailPage() {
  const { projectId }         = useParams<{ projectId: string }>();
  const { user }              = useAuthStore();
  const [project, setProject] = useState<Project | null>(null);
  const [sites,   setSites]   = useState<JobSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!projectId) return;
    Promise.all([projectApi.get(projectId), siteApi.list(projectId)])
      .then(([pData, sData]) => { setProject(pData.project); setSites(sData.sites); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load project'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow
        title={project.name}
        actions={
          canManage ? (
            <Button variant="outline" size="sm">Edit</Button>
          ) : undefined
        }
      />

      <div className="px-6 py-8 space-y-8">
        <div className="space-y-4">
          <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />
          <PageHeader
            title={project.name}
            subtitle={[project.location, project.startDate && new Date(project.startDate).toLocaleDateString()].filter(Boolean).join(' · ')}
            action={canManage ? <Button variant="outline" size="sm">Edit</Button> : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(project.status)}>{project.status.replace(/_/g, ' ')}</Badge>
            {project.code && <span className="font-mono text-xs text-muted-foreground self-center">{project.code}</span>}
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>

        {canManage && (
          <QuickActions
            title="Quick Actions"
            actions={[
              { label: 'Add Site', icon: <Plus className="h-4 w-4" />, href: `/projects/${projectId}/sites/new`, variant: 'primary' },
              { label: 'Manage Members', icon: <Users className="h-4 w-4" />, href: `/projects/${projectId}/members` },
            ]}
          />
        )}

        {/* Job Sites */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Job Sites</CardTitle>
              {canManage && (
                <Link href={`/projects/${projectId}/sites/new`}>
                  <Button size="sm"><Plus className="h-3.5 w-3.5" /> Add Site</Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {sites.length === 0 ? (
              <EmptyState
                icon={<Building2 className="h-10 w-10" />}
                title="No job sites yet"
                description={canManage ? 'Add the first site to this project.' : undefined}
                action={canManage ? { label: 'Add Site', href: `/projects/${projectId}/sites/new` } : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {sites.map((site) => (
                  <Link key={site.id} href={`/projects/${projectId}/sites/${site.id}`}>
                    <div className="group flex items-center justify-between rounded-lg border border-border bg-navy-base px-4 py-3 transition-colors hover:bg-navy-elevated cursor-pointer">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground truncate text-sm group-hover:text-primary transition-colors">
                            {site.name}
                          </p>
                          {!site.isActive && <Badge variant="inactive" className="shrink-0">Inactive</Badge>}
                        </div>
                        {site.address && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
                            <MapPin className="h-3 w-3 shrink-0" />{site.address}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 ml-3 group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Members placeholder */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Project Members</CardTitle>
              </div>
              {user?.role === 'company_admin' && (
                <Button variant="outline" size="sm">Manage Members</Button>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Member list will appear here.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "style: update project detail — Breadcrumb, StickyActionsRow, QuickActions, EmptyState"
```

---

## Task 22: Update Site Detail Page

**Files:**
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/page.tsx`

- [ ] **Step 1: Replace site detail page**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { siteApi, attendanceApi, targetsApi, ApiError } from '@/lib/api';
import { JobSite, AttendanceSummary, TargetSummary } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { QuickActions } from '@/components/ui/QuickActions';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ClipboardCheck, Target, Truck, Users, AlertCircle,
  MapPin, Plus,
} from 'lucide-react';

function todayStr(): string { return new Date().toISOString().split('T')[0]; }

export default function SiteDetailPage() {
  const { projectId, siteId }             = useParams<{ projectId: string; siteId: string }>();
  const [site, setSite]                   = useState<JobSite | null>(null);
  const [attendance, setAttendance]       = useState<AttendanceSummary | null>(null);
  const [targetSummary, setTargetSummary] = useState<TargetSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error,   setError]               = useState('');

  useEffect(() => {
    if (!projectId || !siteId) return;
    const today = todayStr();
    Promise.all([
      siteApi.get(projectId, siteId),
      attendanceApi.summary(projectId, siteId, today).catch(() => null),
      targetsApi.summary(projectId, siteId, today).catch(() => null),
    ])
      .then(([s, a, t]) => {
        setSite(s.site);
        if (a) setAttendance(a.summary);
        if (t) setTargetSummary(t.summary);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load site'))
      .finally(() => setLoading(false));
  }, [projectId, siteId]);

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }

  if (!site) return null;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow title={site.name} />

      <div className="px-6 py-8 space-y-8">
        <div className="space-y-4">
          <Breadcrumb items={[
            { label: 'Projects', href: '/projects' },
            { label: 'Project', href: `/projects/${projectId}` },
            { label: site.name },
          ]} />
          <PageHeader
            title={site.name}
            subtitle={site.address}
          />
          {!site.isActive && <Badge variant="inactive">Inactive</Badge>}
          {site.address && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />{site.address}
            </p>
          )}
        </div>

        {/* Today's summary stats */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today's Summary</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Present"
              value={attendance?.present ?? '—'}
              icon={<ClipboardCheck className="h-5 w-5" />}
              valueClassName="text-emerald-300"
            />
            <StatCard
              label="Absent"
              value={attendance?.absent ?? '—'}
              valueClassName="text-red-400"
            />
            <StatCard
              label="Targets Set"
              value={targetSummary?.total ?? '—'}
              icon={<Target className="h-5 w-5" />}
            />
            <StatCard
              label="Avg Completion"
              value={targetSummary ? `${targetSummary.avgCompletion}%` : '—'}
              valueClassName={
                targetSummary?.avgCompletion != null && targetSummary.avgCompletion >= 80
                  ? 'text-emerald-300'
                  : 'text-amber-300'
              }
            />
          </div>
        </div>

        {/* Quick actions */}
        <QuickActions
          title="Site Actions"
          actions={[
            { label: 'Record Attendance', icon: <ClipboardCheck className="h-4 w-4" />, href: `/projects/${projectId}/sites/${siteId}/attendance/new`, variant: 'primary' },
            { label: 'Add Target',        icon: <Plus className="h-4 w-4" />,            href: `/projects/${projectId}/sites/${siteId}/targets/new` },
            { label: 'Log Labour',        icon: <Users className="h-4 w-4" />,           href: `/projects/${projectId}/sites/${siteId}/labour/new` },
            { label: 'Record Delivery',   icon: <Truck className="h-4 w-4" />,           href: `/projects/${projectId}/sites/${siteId}/deliveries/new` },
          ]}
        />

        {/* Module links */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { href: `/projects/${projectId}/sites/${siteId}/attendance`, icon: ClipboardCheck, label: 'Attendance', sub: 'Daily worker check-in/out' },
            { href: `/projects/${projectId}/sites/${siteId}/targets`,    icon: Target,         label: 'Daily Targets', sub: 'Set and track work targets' },
            { href: `/projects/${projectId}/sites/${siteId}/labour`,     icon: Users,          label: 'Labour Register', sub: 'Track hours and wages' },
            { href: `/projects/${projectId}/sites/${siteId}/deliveries`, icon: Truck,          label: 'Deliveries', sub: 'Log material deliveries' },
          ].map(({ href, icon: Icon, label, sub }) => (
            <a key={href} href={href} className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">{label}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/sites/[siteId]/page.tsx"
git commit -m "style: update site detail — Breadcrumb, StickyActionsRow, StatCards, QuickActions"
```

---

## Task 23: Update Workers List Page

**Files:**
- Modify: `packages/web/src/app/(app)/workers/page.tsx`

- [ ] **Step 1: Replace workers/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { workerApi, ApiError } from '@/lib/api';
import { Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { HardHat, Plus, AlertCircle, ChevronRight } from 'lucide-react';

const STATUS_OPTIONS = [
  { label: 'Active',    value: 'active'    },
  { label: 'Inactive',  value: 'inactive'  },
  { label: 'Suspended', value: 'suspended' },
];

function statusVariant(s: string): 'active' | 'inactive' | 'pending' {
  if (s === 'active') return 'active';
  if (s === 'suspended') return 'pending';
  return 'inactive';
}

export default function WorkersPage() {
  const { user }    = useAuthStore();
  const [workers,   setWorkers]   = useState<Worker[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    workerApi.list()
      .then((d) => setWorkers(d.workers))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load workers'))
      .finally(() => setLoading(false));
  }, []);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  const filtered = workers.filter((w) => {
    const name = `${w.firstName} ${w.lastName}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || (w.trade ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || w.employmentStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Workers"
        subtitle={`${workers.length} registered`}
        action={
          canManage ? (
            <Link href="/workers/new">
              <Button><Plus className="h-4 w-4" /> Add Worker</Button>
            </Link>
          ) : undefined
        }
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or trade…"
        filters={[
          { label: 'Status', value: statusFilter, options: STATUS_OPTIONS, onChange: setStatusFilter },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<HardHat className="h-12 w-12" />}
          title={search || statusFilter ? 'No workers match your filter' : 'No workers yet'}
          action={!search && !statusFilter && canManage ? { label: 'Add Worker', href: '/workers/new' } : undefined}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead>Daily Wage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">
                  {w.firstName} {w.lastName}
                </TableCell>
                <TableCell className="text-muted-foreground">{w.trade ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {w.dailyWage ? `${Number(w.dailyWage).toLocaleString()} ${w.currency}` : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(w.employmentStatus)}>
                    {w.employmentStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/workers/${w.id}`}>
                    <Button variant="ghost" size="sm">
                      View <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/workers/page.tsx
git commit -m "style: update workers list — PageHeader, SearchFilterBar, Table, EmptyState"
```

---

## Task 24: Add Breadcrumb to Worker Detail and Edit Pages

**Files:**
- Modify: `packages/web/src/app/(app)/workers/[workerId]/page.tsx`
- Modify: `packages/web/src/app/(app)/workers/[workerId]/edit/page.tsx`

- [ ] **Step 1: Add Breadcrumb import + component to worker detail page**

In `workers/[workerId]/page.tsx`, add the import:
```tsx
import { Breadcrumb } from '@/components/ui/Breadcrumb';
```

Replace the header section that currently has the `<Link href="/workers">` ArrowLeft button with:
```tsx
{/* Remove the ArrowLeft link button entirely from the header */}
{/* Add breadcrumb before the main content div */}
```

Replace the outer `<div className="p-6 max-w-2xl mx-auto space-y-6">` opening with:
```tsx
<div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
  <Breadcrumb items={[{ label: 'Workers', href: '/workers' }, { label: `${worker.firstName} ${worker.lastName}` }]} />
```

Remove the `<Link href="/workers"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>` from the header row.

Remove `ArrowLeft` from lucide-react imports.

- [ ] **Step 2: Add Breadcrumb to worker edit page**

In `workers/[workerId]/edit/page.tsx`, add the same pattern:
```tsx
import { Breadcrumb } from '@/components/ui/Breadcrumb';
```
And add a breadcrumb before the form: `<Breadcrumb items={[{ label: 'Workers', href: '/workers' }, { label: workerId, href: `/workers/${workerId}` }, { label: 'Edit' }]} />`

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/workers/[workerId]/page.tsx" "src/app/(app)/workers/[workerId]/edit/page.tsx"
git commit -m "style: add Breadcrumb to worker detail and edit pages"
```

---

## Task 25: Update Attendance Page

**Files:**
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/attendance/page.tsx`

- [ ] **Step 1: Replace attendance/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { attendanceApi, ApiError } from '@/lib/api';
import { AttendanceRecord, AttendanceSummary, AttendanceStatus } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@/components/ui/Table';
import { ClipboardCheck, Plus, AlertCircle, Clock } from 'lucide-react';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half Day', excused: 'Excused',
};

const STATUS_VARIANT: Record<AttendanceStatus, 'active' | 'inactive' | 'pending' | 'info'> = {
  present: 'active', absent: 'inactive', late: 'pending', half_day: 'info', excused: 'info',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

function today(): string { return new Date().toISOString().split('T')[0]; }

export default function AttendancePage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();

  const [records,  setRecords]  = useState<AttendanceRecord[]>([]);
  const [summary,  setSummary]  = useState<AttendanceSummary | null>(null);
  const [date,     setDate]     = useState(today());
  const [statusF,  setStatusF]  = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = (d: string) => {
    if (!projectId || !siteId) return;
    setLoading(true); setError('');
    Promise.all([
      attendanceApi.list(projectId, siteId, { date: d }),
      attendanceApi.summary(projectId, siteId, d),
    ])
      .then(([r, s]) => { setRecords(r.records); setSummary(s.summary); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load attendance'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(date); }, [projectId, siteId, date]);

  const filtered = statusF ? records.filter((r) => r.status === statusF) : records;

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Project', href: `/projects/${projectId}` },
        { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
        { label: 'Attendance' },
      ]} />

      <PageHeader
        title="Attendance"
        subtitle={`Records for ${date}`}
        action={
          <Link href={`/projects/${projectId}/sites/${siteId}/attendance/new`}>
            <Button><Plus className="h-4 w-4" /> Add Record</Button>
          </Link>
        }
      />

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Present"  value={summary.present}  icon={<ClipboardCheck className="h-4 w-4" />} valueClassName="text-emerald-300" />
          <StatCard label="Absent"   value={summary.absent}   valueClassName="text-red-400" />
          <StatCard label="Late"     value={summary.late}     valueClassName="text-amber-300" />
          <StatCard label="Half Day" value={summary.half_day} valueClassName="text-blue-300" />
          <StatCard label="Excused"  value={summary.excused}  valueClassName="text-blue-300" />
        </div>
      )}

      <SearchFilterBar
        filters={[
          {
            label: 'Status',
            value: statusF,
            options: STATUS_OPTIONS,
            onChange: setStatusF,
          },
        ]}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </SearchFilterBar>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-12 w-12" />}
          title="No attendance records for this date"
          action={{ label: 'Add Record', href: `/projects/${projectId}/sites/${siteId}/attendance/new` }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Recorded By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.worker.firstName} {r.worker.lastName}</TableCell>
                <TableCell className="text-muted-foreground">{r.worker.trade ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                </TableCell>
                <TableCell>
                  {r.checkInTime ? <span className="inline-flex items-center gap-1 text-sm"><Clock className="h-3 w-3" />{r.checkInTime}</span> : '—'}
                </TableCell>
                <TableCell>
                  {r.checkOutTime ? <span className="inline-flex items-center gap-1 text-sm"><Clock className="h-3 w-3" />{r.checkOutTime}</span> : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">{r.notes ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{r.recordedBy.firstName} {r.recordedBy.lastName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/sites/[siteId]/attendance/page.tsx"
git commit -m "style: update attendance page — Breadcrumb, StatCards, SearchFilterBar, EmptyState, differentiated Badge variants"
```

---

## Task 26: Update Attendance New Page

**Files:**
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/attendance/new/page.tsx`

- [ ] **Step 1: Add Breadcrumb + replace raw select/input with Select/Input components**

```tsx
'use client';

import { useState, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { attendanceApi, workerApi, ApiError } from '@/lib/api';
import { Worker } from '@/lib/types';
import { useEffect } from 'react';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

const STATUSES = [
  { value: 'present',  label: 'Present'  },
  { value: 'absent',   label: 'Absent'   },
  { value: 'late',     label: 'Late'     },
  { value: 'half_day', label: 'Half Day' },
  { value: 'excused',  label: 'Excused'  },
];

function today(): string { return new Date().toISOString().split('T')[0]; }

export default function NewAttendancePage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const router = useRouter();

  const [workers,     setWorkers]     = useState<Worker[]>([]);
  const [workerId,    setWorkerId]    = useState('');
  const [date,        setDate]        = useState(today());
  const [status,      setStatus]      = useState('present');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime,setCheckOutTime]= useState('');
  const [notes,       setNotes]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (!projectId || !siteId) return;
    workerApi.list().then((d) => setWorkers(d.workers)).catch(() => {});
  }, [projectId, siteId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workerId) { setError('Select a worker'); return; }
    setLoading(true); setError('');
    try {
      await attendanceApi.create(projectId, siteId, {
        workerId, date, status,
        checkInTime:  checkInTime  || null,
        checkOutTime: checkOutTime || null,
        notes:        notes        || null,
      });
      router.push(`/projects/${projectId}/sites/${siteId}/attendance`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create record');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-xl space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
        { label: 'Attendance', href: `/projects/${projectId}/sites/${siteId}/attendance` },
        { label: 'New Record' },
      ]} />

      <PageHeader title="Record Attendance" subtitle="Add a new attendance record for a worker." />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Select label="Worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)} required>
          <option value="">Select a worker…</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{w.firstName} {w.lastName}{w.trade ? ` — ${w.trade}` : ''}</option>
          ))}
        </Select>

        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />

        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Check-in time"  type="time" value={checkInTime}  onChange={(e) => setCheckInTime(e.target.value)}  hint="HH:MM (24h)" />
          <Input label="Check-out time" type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} hint="HH:MM (24h)" />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional notes…"
            className="flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </div>

        {error && (
          <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
        )}

        <div className="flex gap-3">
          <Button type="submit" loading={loading}>Save Record</Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/sites/[siteId]/attendance/new/page.tsx"
git commit -m "style: update attendance new page — Breadcrumb, Input/Select components"
```

---

## Task 27: Update Targets Page

**Files:**
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/targets/page.tsx`

- [ ] **Step 1: Replace targets/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { targetsApi, ApiError } from '@/lib/api';
import { DailyTarget, TargetSummary } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@/components/ui/Table';
import { Target, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

function today(): string { return new Date().toISOString().split('T')[0]; }

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 100)   return 'text-emerald-300';
  if (pct >= 60)    return 'text-amber-300';
  return 'text-red-400';
}

export default function TargetsPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const user = useAuthStore((s) => s.user);

  const [targets,   setTargets]   = useState<DailyTarget[]>([]);
  const [summary,   setSummary]   = useState<TargetSummary | null>(null);
  const [date,      setDate]      = useState(today());
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [approving, setApproving] = useState<string | null>(null);

  const canApprove = user?.role === 'company_admin' || user?.role === 'project_manager' || user?.role === 'site_supervisor';

  const load = (d: string) => {
    if (!projectId || !siteId) return;
    setLoading(true); setError('');
    Promise.all([
      targetsApi.list(projectId, siteId, { date: d }),
      targetsApi.summary(projectId, siteId, d),
    ])
      .then(([r, s]) => { setTargets(r.targets); setSummary(s.summary); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load targets'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(date); }, [projectId, siteId, date]);

  const handleApprove = async (targetId: string) => {
    setApproving(targetId);
    try {
      const { target } = await targetsApi.approve(projectId, siteId, targetId);
      setTargets((prev) => prev.map((t) => t.id === targetId ? target : t));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve target');
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Project', href: `/projects/${projectId}` },
        { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
        { label: 'Daily Targets' },
      ]} />

      <PageHeader
        title="Daily Targets"
        subtitle={`Targets for ${date}`}
        action={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Link href={`/projects/${projectId}/sites/${siteId}/targets/new`}>
              <Button><Plus className="h-4 w-4" /> Add Target</Button>
            </Link>
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Targets"  value={summary.total}          icon={<Target className="h-4 w-4" />} />
          <StatCard label="Approved"       value={summary.approved}       valueClassName="text-emerald-300" />
          <StatCard label="With Actuals"   value={summary.withActual} />
          <StatCard label="Avg Completion" value={`${summary.avgCompletion}%`} valueClassName={pctColor(summary.avgCompletion)} />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : targets.length === 0 ? (
        <EmptyState
          icon={<Target className="h-12 w-12" />}
          title="No targets set for this date"
          action={{ label: 'Add Target', href: `/projects/${projectId}/sites/${siteId}/targets/new` }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead className="text-right">Target</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Completion</TableHead>
              <TableHead>Status</TableHead>
              {canApprove && <TableHead>Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium max-w-[200px]">
                  <div>
                    <p className="truncate">{t.description}</p>
                    {t.notes && <p className="text-xs text-muted-foreground truncate">{t.notes}</p>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.worker ? `${t.worker.firstName} ${t.worker.lastName}` : 'Site-wide'}
                </TableCell>
                <TableCell className="text-right">{t.targetValue} {t.targetUnit}</TableCell>
                <TableCell className="text-right">{t.actualValue != null ? `${t.actualValue} ${t.targetUnit}` : '—'}</TableCell>
                <TableCell className="text-right">
                  <span className={`font-semibold ${pctColor(t.completionPct)}`}>
                    {t.completionPct != null ? `${t.completionPct}%` : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  {t.approvedById
                    ? <Badge variant="active"><CheckCircle2 className="h-3 w-3 mr-1" /> Approved</Badge>
                    : <Badge variant="pending">Pending</Badge>}
                </TableCell>
                {canApprove && (
                  <TableCell>
                    {!t.approvedById && (
                      <Button size="sm" variant="outline" disabled={approving === t.id} onClick={() => handleApprove(t.id)}>
                        {approving === t.id ? 'Approving…' : 'Approve'}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/projects/[projectId]/sites/[siteId]/targets/page.tsx"
git commit -m "style: update targets page — Breadcrumb, StatCards, EmptyState, pct color"
```

---

## Task 28: Update Targets New, Labour, Labour New, Deliveries, Finance Pages

These follow the same pattern — Breadcrumb + PageHeader + dark Input/Select, no logic changes.

**Files:**
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/targets/new/page.tsx`
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/labour/page.tsx`
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/labour/new/page.tsx`
- Modify: `packages/web/src/app/(app)/projects/[projectId]/sites/[siteId]/deliveries/page.tsx`
- Modify: `packages/web/src/app/(app)/finance/page.tsx`

- [ ] **Step 1: Update targets/new/page.tsx** — Add Breadcrumb, wrap in `px-6 py-8 max-w-xl space-y-6`, add PageHeader "Add Daily Target", replace raw `<input type="date">` with `<Input>`, replace raw `<select>` with `<Select>`.

- [ ] **Step 2: Update labour/page.tsx** — Add Breadcrumb, wrap `<div className="p-6 space-y-6">` → `<div className="px-6 py-8 space-y-6">`, replace raw date `<input>` with styled equivalent in SearchFilterBar, add EmptyState component replacing the inline empty div.

- [ ] **Step 3: Update labour/new/page.tsx** — Add Breadcrumb, add PageHeader "Log Labour", replace any raw inputs with `<Input>` and `<Select>` components.

- [ ] **Step 4: Update deliveries/page.tsx** — Add Breadcrumb, add PageHeader "Delivery Records", add EmptyState for empty list.

- [ ] **Step 5: Update finance/page.tsx** — Replace the raw header div pattern with `PageHeader`, update the amber card border from `border-amber-200` to `border-amber-800` (dark-appropriate), update `bg-amber-100 p-2.5` icon containers to `bg-amber-950/50 p-2.5`.

- [ ] **Step 6: Commit all**

```bash
git add \
  "src/app/(app)/projects/[projectId]/sites/[siteId]/targets/new/page.tsx" \
  "src/app/(app)/projects/[projectId]/sites/[siteId]/labour/page.tsx" \
  "src/app/(app)/projects/[projectId]/sites/[siteId]/labour/new/page.tsx" \
  "src/app/(app)/projects/[projectId]/sites/[siteId]/deliveries/page.tsx" \
  "src/app/(app)/finance/page.tsx"
git commit -m "style: update targets-new, labour, labour-new, deliveries, finance pages — Breadcrumb + dark UI patterns"
```

---

## Task 29: Run Tests to Verify Nothing Broke

- [ ] **Step 1: Run API test suite**

```bash
cd packages/api
npx jest --runInBand 2>&1 | tail -20
```

Expected: All tests pass. The Jest suite tests only the API layer — no UI tests exist — so all should be green.

- [ ] **Step 2: Verify TypeScript compiles in web package**

```bash
cd packages/web
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If there are import errors (e.g., `Select` not found somewhere), fix the import path and re-run.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "style: UI overhaul complete — dark navy design system applied across all pages"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: All items from spec covered — tokens (Task 1-2), Badge/Button/Input/Table/Alert/Skeleton (Task 3-8), PageHeader/Breadcrumb/StatCard/EmptyState/SearchFilterBar/QuickActions/StickyActionsRow (Task 9-15), layout (Task 16), all 14 pages (Task 17-28), tests (Task 29)
- [x] **No placeholders**: All code blocks are complete and runnable
- [x] **Type consistency**: `BadgeProps.variant` uses string union that matches all call sites; `BreadcrumbItem`, `QuickAction`, `StatCardProps`, `EmptyStateProps`, `SearchFilterBarProps`, `StickyActionsRowProps` — all defined in their respective files and used consistently
- [x] **Constraints respected**: No API calls added/removed, no RBAC changes, no business logic touched, no new npm packages, 0 test files changed

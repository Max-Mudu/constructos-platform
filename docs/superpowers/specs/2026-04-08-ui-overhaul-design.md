# UI Overhaul Design Spec
**Date:** 2026-04-08  
**Scope:** Full web UI standardization — `packages/web`  
**Approach:** Layer-by-layer (tokens → components → pages)

---

## Goals

Standardize and upgrade the entire web UI into a consistent, premium dark-navy construction SaaS style. No business logic, RBAC, or API contract changes. All existing Jest tests must continue to pass.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Color scheme | Dark navy | Suits field-heavy SaaS; matches existing #0369a1 brand; reduces eye strain |
| Sidebar | Always-expanded with labels | 8+ destinations; field supervisors are not power users; labels remove guesswork |
| Content density | Comfortable (balanced) | Enough breathing room for premium feel; enough rows visible without immediate scroll |

---

## Design Tokens

### Tailwind Semantic Aliases (`tailwind.config.ts`)

| Alias | Hex | Usage |
|---|---|---|
| `bg-base` | `#0f172a` | Page background |
| `bg-surface` | `#1e293b` | Cards, sidebar, panels |
| `bg-elevated` | `#253347` | Table headers, hover states |
| `border-subtle` | `#2d3f55` | All borders |
| `text-primary` | `#f1f5f9` | Headings, stat values |
| `text-secondary` | `#94a3b8` | Labels, descriptions |
| `text-muted` | `#475569` | Placeholders, timestamps |
| `accent` | `#0369a1` | Primary buttons, active nav, links |
| `accent-light` | `#38bdf8` | Stat values, highlights |

### Status Badge Colors (`globals.css` or `badge.tsx`)

| Status | Background | Text |
|---|---|---|
| active / present / approved | `#065f46` | `#6ee7b7` |
| late / pending | `#78350f` | `#fcd34d` |
| absent / overdue | `#7f1d1d` | `#fca5a5` |
| half_day / excused | `#1e3a5f` | `#93c5fd` |
| inactive / draft | `#1f2937` | `#6b7280` |

---

## Implementation Passes

### Pass A — Tokens & Config (2 files)

1. **`tailwind.config.ts`** — Add semantic color aliases above to `theme.extend.colors`
2. **`src/app/globals.css`** — Replace current CSS custom properties with dark navy palette; set `body { background: #0f172a; color: #f1f5f9; }`

### Pass B — Shared Components & Layout Shell (~10 files)

#### Sidebar (`components/layout/Sidebar.tsx`)
- Width: `w-56` (224px)
- Background: `bg-surface`, right border `border-r border-subtle`
- Logo area: brand icon + "ConstructPro" wordmark + company name in `text-muted text-xs`
- Nav items: 16px icon + label, `rounded-lg py-2 px-3`, hover `bg-elevated`, active `bg-accent text-white`
- Bottom slot: user avatar circle + name + role + logout button

#### PageHeader (new — `components/ui/PageHeader.tsx`)
- Props: `title`, optional `subtitle`, optional `action` (ReactNode)
- Renders: `<h1 className="text-2xl font-semibold text-primary">` + `<p className="text-secondary text-sm">` + right-aligned action slot
- Used consistently on every page, replacing 5+ ad-hoc header patterns

#### Button (`components/ui/Button.tsx`) — CVA variants
- `primary`: `bg-accent hover:bg-sky-800 text-white font-medium rounded-lg px-4 py-2`
- `secondary`: `border border-subtle text-secondary hover:bg-elevated rounded-lg px-4 py-2`
- `danger`: `bg-red-900 hover:bg-red-800 text-red-200 rounded-lg px-4 py-2`
- Sizes: `sm` (`px-3 py-1.5 text-sm`), `md` (default), `lg` (`px-6 py-3`)

#### Card (`components/ui/Card.tsx`)
- `bg-surface border border-subtle rounded-xl p-6`
- Optional `className` override via CVA

#### Badge (`components/ui/Badge.tsx`)
- Pill: `inline-flex items-center rounded-full text-xs font-medium px-2.5 py-0.5`
- Variants map to status color table above
- Props: `variant` (one of: `active | pending | danger | info | neutral`)

#### StatCard (new — `components/ui/StatCard.tsx`)
- Icon box (24px, `bg-accent/10 rounded-lg`) + large value (`text-2xl font-bold text-accent-light`) + label (`text-xs text-muted uppercase tracking-wide`)
- Used on Dashboard, Site detail summary rows

#### Table (`components/ui/Table.tsx`)
- `<thead>`: `bg-elevated text-muted text-xs uppercase tracking-wide`
- `<tbody>` rows: `border-b border-subtle hover:bg-elevated/40 transition-colors`
- Cell padding: `py-3 px-4`
- Wrapper: `rounded-xl border border-subtle overflow-hidden`

#### Input (`components/ui/Input.tsx`)
- `bg-base border border-subtle rounded-lg px-3 py-2 text-primary placeholder:text-muted`
- Focus: `focus:outline-none focus:ring-1 focus:ring-accent`

#### Select (`components/ui/Select.tsx`)
- Same visual style as Input; native `<select>` wrapped in a styled div with chevron icon
- `bg-base border border-subtle rounded-lg px-3 py-2 text-primary`

#### Alert, Skeleton, Separator — update colors to use new token aliases

#### Breadcrumb (new — `components/ui/Breadcrumb.tsx`)
- Used on all routes deeper than one level (project detail, site detail, attendance, targets, labour, deliveries, drawings, contractors)
- Renders a horizontal chain: `Home / Projects / {name} / {page}` with `›` separators
- Each segment except the last is a link (`text-muted hover:text-secondary`); active segment is `text-primary font-medium`
- Props: `items: Array<{ label: string; href?: string }>` — omit `href` on the last item to render it as plain text
- Sits between the sidebar and the PageHeader, inside the main content column

#### QuickActions Card (new — `components/ui/QuickActions.tsx`)
- A `bg-surface border border-subtle rounded-xl p-4` card containing a row of action buttons
- Props: `actions: Array<{ label: string; icon?: ReactNode; href?: string; onClick?: () => void; variant?: 'primary' | 'secondary' }>` 
- Used on Site detail (Record Attendance, Add Target, Log Labour, Record Delivery) and Project detail (Add Site, Invite Member)
- Renders as a horizontal flex row on desktop, wraps gracefully on small screens

#### EmptyState (new — `components/ui/EmptyState.tsx`)
- Shown when a list/table has zero rows
- Centered vertically in the table area: large muted icon (48px) + heading (`text-primary font-medium`) + description (`text-secondary text-sm`) + optional primary action Button
- Props: `icon`, `title`, `description`, optional `action: { label: string; href?: string; onClick?: () => void }`
- Used on: Projects list, Workers, Attendance, Targets, Labour, Deliveries, Drawings, Contractors

#### SearchFilterBar (new — `components/ui/SearchFilterBar.tsx`)
- A horizontal bar containing a search Input (left, flex-grow) + optional filter Select dropdowns (right)
- Props: `searchValue`, `onSearchChange`, `filters?: Array<{ label: string; value: string; options: Array<{ label: string; value: string }> ; onChange: (v: string) => void }>`
- Sits between the PageHeader and the content table/list
- Used on: Workers (search by name, filter by trade/status), Attendance (date + status filter), Targets (date filter), Labour (date filter), Deliveries (date + status filter)

#### StickyActionsRow (new — `components/ui/StickyActionsRow.tsx`)
- A `sticky top-0 z-10 bg-base/90 backdrop-blur-sm border-b border-subtle py-3 px-6` bar
- Contains the page title (condensed, `text-sm font-semibold text-primary`) on the left + primary action button(s) on the right
- Appears only on large detail pages with long scrollable content: Site detail, Project detail, Budget, Contractors
- Behaviour: always visible at the top of the main content area as the user scrolls; does NOT replace the PageHeader — both coexist, with the StickyActionsRow appearing below the Breadcrumb

### Pass C — Pages (priority order)

| Priority | Page | Key changes |
|---|---|---|
| 1 | Login / Register | Centered card on bg-base, new Input/Button, logo above form |
| 2 | Dashboard | PageHeader, 4 StatCards grid, recent projects/sites list (existing API data), remove placeholder text |
| 3 | Projects list | PageHeader + "New Project" Button, project Cards with status Badge |
| 4 | Project detail | PageHeader, sites as Card grid, status badges, member list |
| 5 | Site detail | Breadcrumb in PageHeader, live StatCards for attendance/targets, quick-action buttons |
| 6 | Workers | PageHeader, fix raw inputs → Input component, Table with trade/status badges |
| 7 | Attendance | Date filter bar, StatCards summary row, Table with colored status badges |
| 8 | Targets | StatCards row, Table with completionPct color coding, inline Approve button |
| 9 | Labour | PageHeader + Table pattern |
| 10 | Deliveries | PageHeader + Table + status Badge |
| 11 | Finance / Budget | PageHeader + Cards/Table, budget utilization CSS progress bar (no chart library) |
| 12 | Drawings | PageHeader + Table |
| 13 | Contractors | PageHeader + Table |
| 14 | Settings / Profile | Section Cards, consistent Input styling |

---

## Constraints

- **No new npm packages** — Tailwind, CVA, Radix Slot already installed
- **No business logic changes** — data fetching, auth, RBAC untouched
- **No API contract changes** — request/response shapes unchanged
- **Tests must pass** — Jest tests are API-only; no UI test changes needed
- **No feature additions** — purely visual standardization

---

## Files Changed Summary

| Pass | Files |
|---|---|
| A | `tailwind.config.ts`, `src/app/globals.css` |
| B | `Sidebar.tsx`, `Button.tsx`, `Card.tsx`, `Badge.tsx`, `Input.tsx`, `Select.tsx`, `Table.tsx`, `StatCard.tsx` (new), `PageHeader.tsx` (new), `Breadcrumb.tsx` (new), `QuickActions.tsx` (new), `EmptyState.tsx` (new), `SearchFilterBar.tsx` (new), `StickyActionsRow.tsx` (new), `Alert.tsx`, `Skeleton.tsx` |
| C | ~16 page files in `src/app/(app)/` and `src/app/(auth)/` |

**Total:** ~33 files touched, 0 test files changed.

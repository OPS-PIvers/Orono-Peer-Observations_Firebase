# Admin Console UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin console a consistent, modern "clean & airy" look by upgrading shared design tokens and primitives so every admin page levels up at once.

**Architecture:** Presentational-only. Tune `@theme` tokens in `index.css`, add three small primitives (`Card`, `Badge`, `EmptyState`), default `PageHeader` to a light variant with an optional breadcrumb, and polish `AdminDataView` (table header/rows/empty/loading). Pages inherit improvements; a final sweep adopts the new primitives where pages used ad-hoc chips/panels.

**Tech Stack:** React + TypeScript, Tailwind v4 (`@theme`), shadcn-style primitives, OPS brand tokens, Vite. Verification per task = `pnpm --filter @ops/web typecheck`, `eslint`, `prettier`, and the Claude preview browser (no unit tests for visual changes).

**Verification baseline (run after each task that changes web code):**
- `pnpm --filter @ops/web typecheck` → exit 0
- `npx eslint <changed files> --max-warnings 0` → exit 0
- `npx prettier --check <changed files>` → clean
- Browser: load the affected admin page in the preview, confirm no console errors and the intended visual change.

---

### Task 1: Foundation tokens

**Files:**
- Modify: `apps/web/src/index.css` (the `@theme` block, ~lines 15–70)

- [ ] **Step 1: Soften radius and add shadow tokens**

In the `@theme` block, change the radius and add shadow + a soft border token. Find:

```css
  --radius: 0.375rem;
```

Replace with:

```css
  --radius: 0.5rem;

  /* Soft surfaces for the "clean & airy" admin look. */
  --color-border-soft: #e5e7eb;
  --shadow-card: 0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06);
  --shadow-popover: 0 4px 12px -2px rgba(16, 24, 40, 0.1), 0 2px 6px -2px rgba(16, 24, 40, 0.06);
```

- [ ] **Step 2: Point the default border token at the softer gray**

Find:

```css
  --color-border: var(--color-ops-gray-lighter);
```

Replace with:

```css
  --color-border: var(--color-border-soft);
```

(Leaves `--color-ops-gray-lighter` available for places that want a stronger rule.)

- [ ] **Step 3: Verify**

Run: `pnpm --filter @ops/web typecheck` → exit 0. Load any admin page in the preview; borders/cards should look slightly lighter and corners softer. No console errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(ui): soften radius + add card/popover shadow tokens"
```

---

### Task 2: `Card` primitive

**Files:**
- Create: `apps/web/src/components/ui/card.tsx`

- [ ] **Step 1: Create the Card primitive**

```tsx
import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

/** Airy surface for grouped content (settings panels, branding, sections). */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'border-border bg-card rounded-lg border shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-heading text-ops-blue-dark text-base font-semibold', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-muted-foreground text-sm', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @ops/web typecheck` → 0; `npx eslint apps/web/src/components/ui/card.tsx --max-warnings 0` → 0.

```bash
git add apps/web/src/components/ui/card.tsx
git commit -m "feat(ui): add Card primitive"
```

---

### Task 3: `Badge` primitive

**Files:**
- Create: `apps/web/src/components/ui/badge.tsx`

- [ ] **Step 1: Create the Badge primitive**

```tsx
import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'active' | 'inactive' | 'info' | 'warning';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  active: 'bg-green-50 text-green-700',
  inactive: 'bg-muted text-muted-foreground',
  info: 'bg-ops-blue-lighter text-ops-blue-dark',
  warning: 'bg-ops-red-lighter text-ops-red-dark',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small status pill used for Active/Inactive/System and similar chips. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Verify + commit**

Run typecheck + eslint on the file → 0.

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "feat(ui): add Badge primitive"
```

---

### Task 4: `EmptyState` primitive

**Files:**
- Create: `apps/web/src/components/ui/empty-state.tsx`

- [ ] **Step 1: Create the EmptyState primitive**

```tsx
import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Friendly empty-state block: icon + message + optional primary action. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-12 text-center', className)}>
      {Icon ? (
        <span className="bg-muted text-muted-foreground mb-1 flex h-10 w-10 items-center justify-center rounded-full">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <p className="text-foreground text-sm font-medium">{title}</p>
      {description ? <p className="text-muted-foreground max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run typecheck + eslint → 0.

```bash
git add apps/web/src/components/ui/empty-state.tsx
git commit -m "feat(ui): add EmptyState primitive"
```

---

### Task 5: Light `PageHeader` default + breadcrumb

**Files:**
- Modify: `apps/web/src/components/PageHeader.tsx`

- [ ] **Step 1: Add a `breadcrumb` prop and a new light default treatment**

Add to `PageHeaderProps`:

```tsx
  /** Optional wayfinding breadcrumb, e.g. ["Admin", "Staff"]. Rendered above
   *  the title in the light variant. */
  breadcrumb?: string[];
  /** `light` (new admin default) — white chrome, brand-blue title, hairline.
   *  `dark` — legacy dark-blue strip. `plain` — centered brand-blue title. */
  variant?: 'light' | 'dark' | 'plain';
```

Change the default: `variant = 'light'`.

- [ ] **Step 2: Implement the `light` branch**

Add this branch (before the existing `dark` return). It mirrors the sticky/`chromeRef`/`belowBar` structure already used:

```tsx
  if (variant === 'light') {
    return (
      <>
        <div ref={chromeRef} className="bg-background sticky top-0 z-20 w-full border-b">
          <div
            className={cn(
              'mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 md:px-6',
              subtitle ? 'py-4' : 'py-3',
            )}
          >
            <div className="min-w-0">
              {breadcrumb && breadcrumb.length > 0 ? (
                <nav className="text-muted-foreground mb-1 text-xs" aria-label="Breadcrumb">
                  {breadcrumb.join(' › ')}
                </nav>
              ) : null}
              <h1 className="font-heading text-ops-blue-dark text-xl font-semibold sm:text-2xl">
                {title}
              </h1>
              {subtitle ? <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          {belowBar ? <div className="w-full">{belowBar}</div> : null}
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</div>
      </>
    );
  }
```

Keep the existing `plain` and `dark` branches unchanged.

- [ ] **Step 3: Audit action-button styling for the light header**

Many admin pages style their primary action for a dark header (e.g. `className="text-ops-blue-dark bg-white hover:bg-white/90"`). On a light header that white-on-white button is invisible. Grep for it:

Run: `grep -rn "bg-white hover:bg-white/90" apps/web/src/admin` — for each hit (e.g. `StaffPage.tsx`, `EmailTemplatesPage.tsx`), remove that override so the button uses the default primary (blue) styling. (These are addressed per-page in Task 8; just note the list now.)

- [ ] **Step 4: Verify**

Run: `pnpm --filter @ops/web typecheck` → 0. Load `/admin/staff` and `/admin/branding` in the preview: headers should now be light/white with a brand-blue title; confirm the page action buttons are still visible (if not, that page is fixed in Task 8). No console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PageHeader.tsx
git commit -m "feat(ui): light PageHeader default with optional breadcrumb"
```

---

### Task 6: Polish `AdminDataView` (tables)

**Files:**
- Modify: `apps/web/src/admin/_shared/AdminDataView.tsx`
- Modify: `apps/web/src/components/ui/table.tsx` (header/row classes, if needed)

- [ ] **Step 1: Quiet the desktop header row**

In `apps/web/src/components/ui/table.tsx`, find the `TableHead` className and ensure it reads as a quiet, uppercase, muted header. Set the `<th>` classes to include:

```
text-muted-foreground h-10 px-3 text-left align-middle text-xs font-medium uppercase tracking-wide
```

(Adjust the existing class string to match; keep any existing structural classes.)

- [ ] **Step 2: Add row hover + lighter separators**

In the same file, the `TableRow` className should include `hover:bg-muted/40 border-b transition-colors` and `TableCell` padding `px-3 py-3 align-middle text-sm`. Confirm `border-b` uses the (now-soft) `--color-border`.

- [ ] **Step 3: Use EmptyState for the empty branch**

In `AdminDataView.tsx`, import `EmptyState` and replace the desktop empty `<TableCell>` text and the mobile empty `<div>` with `<EmptyState title={typeof empty === 'string' ? empty : 'Nothing here yet'} />` (keep the `empty` prop; when it's a string use it as the title, else render the node).

Desktop empty branch becomes:

```tsx
            <TableRow>
              <TableCell colSpan={colSpan} className="p-0">
                {typeof empty === 'string' || empty == null ? (
                  <EmptyState title={(empty as string) ?? 'No data.'} />
                ) : (
                  <div className="px-4 py-6 text-center">{empty}</div>
                )}
              </TableCell>
            </TableRow>
```

Mobile empty branch:

```tsx
        <div className="bg-background border-border rounded-lg border">
          {typeof empty === 'string' || empty == null ? (
            <EmptyState title={(empty as string) ?? 'No data.'} />
          ) : (
            <div className="px-4 py-8 text-center">{empty}</div>
          )}
        </div>
```

- [ ] **Step 4: Soften the card container**

The desktop wrapper `div` (currently `border-border bg-background overflow-hidden rounded-lg border`) gains the card shadow: append `shadow-[var(--shadow-card)]`.

- [ ] **Step 5: Verify**

Run typecheck → 0; eslint on both files → 0. Load `/admin/staff`: header row is uppercase/muted, rows hover, the table reads airier; filter to an empty search to confirm the new empty state. No console errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/admin/_shared/AdminDataView.tsx apps/web/src/components/ui/table.tsx
git commit -m "feat(ui): polish AdminDataView table header/rows/empty state"
```

---

### Task 7: Dialog + Button + Input consistency

**Files:**
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/button.tsx` (verify variants only)
- Modify: `apps/web/src/components/ui/input.tsx` (verify focus ring/height only)

- [ ] **Step 1: Sticky dialog footer + soft shadow**

In `dialog.tsx`, the `DialogContent` className: ensure it uses `rounded-lg shadow-[var(--shadow-popover)]`. The `DialogFooter` className: make it `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` and add `border-t bg-background sticky bottom-0 -mx-6 -mb-6 mt-2 px-6 py-4` so long dialogs keep the actions visible. (Match existing padding tokens; adjust `-mx`/`-mb` to the content padding the component uses.)

- [ ] **Step 2: Confirm button variants exist**

In `button.tsx`, confirm variants exist for `default` (blue primary), `outline`/`secondary`, `ghost`, `destructive`. If any are missing, add them using OPS tokens (`bg-primary text-primary-foreground`, `border-input`, `bg-destructive`). Do not change call sites here.

- [ ] **Step 3: Confirm input styling**

In `input.tsx`, ensure inputs use `border-input rounded-md h-10 focus-visible:ring-ring focus-visible:ring-2` and error styling can be applied via an `aria-invalid:border-destructive` class. No behavior change.

- [ ] **Step 4: Verify**

Run typecheck → 0; eslint on changed files → 0. Open the Staff edit dialog and the Branding page in preview: dialog footer stays put when scrolling, corners/shadow match the new system, inputs/buttons look consistent. No console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/dialog.tsx apps/web/src/components/ui/button.tsx apps/web/src/components/ui/input.tsx
git commit -m "feat(ui): consistent dialog footer, button variants, input styling"
```

---

### Task 8: Per-page sweep — adopt primitives + fix header buttons

**Files (modify, as needed):** every page under `apps/web/src/admin/*` plus `apps/web/src/routes/StaffDirectoryPage.tsx`. The recurring edits:

- [ ] **Step 1: Fix dark-header action buttons**

Run: `grep -rn "text-ops-blue-dark bg-white hover:bg-white/90" apps/web/src`. For each match, delete that `className` override on the `<Button>` (let it use the default primary). Pages include at least: `admin/staff/StaffPage.tsx`, `admin/email-templates/EmailTemplatesPage.tsx`, `admin/buildings/BuildingsPage.tsx`, and any others the grep finds.

- [ ] **Step 2: Add breadcrumbs to admin pages**

For each top-level admin page using `<PageHeader title="X" ...>`, add `breadcrumb={['Admin', 'X']}` (e.g. `breadcrumb={['Admin', 'Staff']}`). Grep the page list: `grep -rln "PageHeader" apps/web/src/admin`.

- [ ] **Step 3: Replace ad-hoc status chips with `Badge`**

Run: `grep -rn "inline-flex items-center rounded.*text-xs" apps/web/src/admin`. For status chips (Active/Inactive/System), replace the inline `<span className="...">` with `<Badge tone="active">Active</Badge>` / `<Badge tone="inactive">Inactive</Badge>` / `<Badge tone="neutral">System</Badge>`. Key spots: `admin/staff/StaffPage.tsx` (Status column), `admin/buildings/BuildingsPage.tsx`, `admin/email-templates/EmailTemplatesPage.tsx`.

- [ ] **Step 4: Replace settings/branding panels with `Card`**

In `admin/branding/BrandingPage.tsx` and `admin/settings/*`, replace ad-hoc `className="border-border bg-background ... rounded-lg border p-4|p-6"` panels with `<Card><CardContent>…</CardContent></Card>` (or `CardHeader`/`CardTitle` where there's a panel heading).

- [ ] **Step 5: Verify each touched page**

For every page you edited, load it in the preview. Confirm: light header + breadcrumb renders, action button visible, status badges render, no console errors, behavior unchanged (open a dialog, toggle a filter).

Run across the app:
- `pnpm --filter @ops/web typecheck` → 0
- `npx eslint apps/web/src --max-warnings 0` → 0 (or lint changed files)
- `npx prettier --check "apps/web/src/**/*.{ts,tsx}"` → clean (or `--write` then re-check)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/admin apps/web/src/routes
git commit -m "feat(ui): adopt Card/Badge/light headers across admin pages"
```

---

### Task 9: Final verification + push

- [ ] **Step 1: Full checks**

Run:
- `pnpm --filter @ops/shared build` → 0 (if any shared types touched; otherwise skip)
- `pnpm --filter @ops/web typecheck` → 0
- `npx eslint apps/web/src --max-warnings 0` → 0
- `npx prettier --check "apps/web/src/**/*.{ts,tsx,css}"` → clean

- [ ] **Step 2: Browser smoke test**

Visit each admin page (`/admin/staff`, `/roles`, `/modules`, `/buildings`, `/rubrics`, `/role-year-mappings`, `/work-product`, `/email-templates`, `/branding`, `/dashboard`, `/settings`, `/audit-log`, `/scheduling`, `/signup-fields`). Confirm: consistent light headers, polished tables, no console errors, dialogs work.

- [ ] **Step 3: Push**

```bash
git push origin dev-paul
```

Then watch the deploy: `gh run watch <run-id> --exit-status`.

---

## Self-review notes

- **Spec coverage:** Foundation tokens (Task 1), Card/Badge/EmptyState (Tasks 2–4), light PageHeader + breadcrumb (Task 5), table polish (Task 6), forms/dialogs + button/input consistency (Task 7), per-page sweep incl. wayfinding + consistency (Task 8), verification (Task 9). All five spec parts covered.
- **No behavior changes:** every task is presentational; verification steps confirm dialogs/filters still work.
- **Type consistency:** `Badge` tone type, `Card*` exports, `EmptyState` props, and `PageHeader` `variant`/`breadcrumb` props are defined where introduced and used consistently downstream.
- **Risk:** the highest-risk change is defaulting `PageHeader` to `light` (Task 5) — Task 5 Step 3 + Task 8 Step 1 explicitly handle the now-invisible white action buttons.

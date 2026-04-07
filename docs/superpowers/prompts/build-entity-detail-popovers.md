# Agent Prompt: Build Client, Invoice, Estimate, and Task Detail Popovers

## Context

The OPS-Web dashboard uses floating detail popovers to show entity details without navigating away from the current page. Popovers already exist for **pipeline opportunities** and **projects**. This task builds equivalent popovers for **clients**, **invoices**, **estimates**, and **tasks**.

A shared hook `useWidgetEntityOpen` at `src/components/dashboard/widgets/shared/use-widget-entity-open.ts` already routes entity clicks. It currently falls back to `router.push()` for entity types without popovers. Once new popovers are built, update this hook to open them instead.

## Reference Implementations

Study these files — they are the exact pattern to follow:

### Pipeline Opportunity Popover
- **Store:** `src/app/(dashboard)/pipeline/_components/detail-popover-store.ts`
- **Component:** `src/app/(dashboard)/pipeline/_components/spatial-detail-popover.tsx`
- **Rendered in:** `src/components/layouts/dashboard-layout.tsx`

### Project Popover
- **Store:** `src/app/(dashboard)/projects/_components/project-detail-popover-store.ts`
- **Component:** `src/app/(dashboard)/projects/_components/project-detail-popover.tsx`
- **Rendered in:** `src/components/layouts/dashboard-layout.tsx`

### Pattern Summary
Each entity popover consists of:
1. **Zustand store** — manages open/close/minimize/restore/focus/position/resize/tab state
2. **Popover component** — draggable, resizable floating window with tabs
3. **Registration in dashboard-layout.tsx** — renders all open popovers globally

### Store API (copy from existing):
```ts
openPopover(entityId, screenPosition, title, color)
closePopover(id)
minimizePopover(id)
restorePopover(id)
focusPopover(id)
updatePosition(id, {x, y})
updateSize(id, {width, height})
setActiveTab(id, tab)
```

### Constants (reuse from existing):
```ts
POPOVER_DEFAULT_WIDTH = 440
POPOVER_DEFAULT_HEIGHT = 520
POPOVER_MIN_WIDTH = 360
POPOVER_MIN_HEIGHT = 320
POPOVER_Z_BASE = 2000
```

## What to Build

### 1. Client Detail Popover

**Store:** `src/stores/client-detail-popover-store.ts`
**Component:** `src/components/ops/client-detail-popover.tsx`

**Tabs:**
- **Overview** — client name, contact info (email, phone), address, company, notes
- **Projects** — list of client's projects with status badges
- **Financial** — revenue, outstanding receivables, payment history summary
- **Activity** — recent activity/correspondence related to this client

**Data fetching:** Use existing hooks from `src/lib/hooks/`:
- `useClient(clientId)` for client details
- `useClientProjects(clientId)` for projects
- `useClientInvoices(clientId)` for financial data

### 2. Invoice Detail Popover

**Store:** `src/stores/invoice-detail-popover-store.ts`
**Component:** `src/components/ops/invoice-detail-popover.tsx`

**Tabs:**
- **Overview** — invoice number, client, status, dates (issued, due), line items, totals
- **Payments** — payment history for this invoice, amount paid vs balance
- **Activity** — send history, views, reminders sent

**Data fetching:**
- `useInvoice(invoiceId)` or filter from `useInvoices()`
- Payment data from invoice object (amountPaid, payments array)

### 3. Estimate Detail Popover

**Store:** `src/stores/estimate-detail-popover-store.ts`
**Component:** `src/components/ops/estimate-detail-popover.tsx`

**Tabs:**
- **Overview** — estimate number, client, status, dates, line items, totals
- **Activity** — send history, views, approval/decline events

**Data fetching:**
- `useEstimate(estimateId)` or filter from `useEstimates()`

### 4. Task Detail Popover (optional — tasks are usually viewed in project context)

Consider whether tasks need their own popover or if clicking a task should open the **project** popover to the **tasks** tab. The project popover already has a tasks tab.

**Recommendation:** Open the project detail popover with `activeTab: "tasks"` instead of building a separate task popover. Update `useWidgetEntityOpen` to handle this:
```ts
case "task":
  // Open the parent project's popover on the tasks tab
  if (opts.parentProjectId) {
    openProjectPopover(opts.parentProjectId, screenPos, opts.parentProjectTitle, color);
    // Then set active tab to "tasks"
  }
```

## Wiring Into useWidgetEntityOpen

After building the stores, update `src/components/dashboard/widgets/shared/use-widget-entity-open.ts`:

```ts
import { useClientDetailPopoverStore } from "@/stores/client-detail-popover-store";
import { useInvoiceDetailPopoverStore } from "@/stores/invoice-detail-popover-store";
import { useEstimateDetailPopoverStore } from "@/stores/estimate-detail-popover-store";

// In the hook:
const openClientPopover = useClientDetailPopoverStore((s) => s.openPopover);
const openInvoicePopover = useInvoiceDetailPopoverStore((s) => s.openPopover);
const openEstimatePopover = useEstimateDetailPopoverStore((s) => s.openPopover);

// In the switch:
case "client":
  openClientPopover(entityId, screenPos, title, color ?? WT.accent);
  return;
case "invoice":
  openInvoicePopover(entityId, screenPos, title, color ?? WT.accent);
  return;
case "estimate":
  openEstimatePopover(entityId, screenPos, title, color ?? WT.accent);
  return;
case "task":
  // Open parent project popover on tasks tab
  if (opts.parentProjectId) {
    openProjectPopover(opts.parentProjectId, screenPos, title, color ?? WT.accent);
  }
  return;
```

## Rendering in Dashboard Layout

Add the new popover components to `src/components/layouts/dashboard-layout.tsx` alongside the existing pipeline and project popovers.

## Design Guidelines

- Follow `.interface-design/system.md` for all styling
- Frosted glass surface: `rgba(10, 10, 10, 0.70)` + `backdrop-blur(20px) saturate(1.2)` + `1px solid rgba(255, 255, 255, 0.08)`
- Use existing `WidgetLineItem` for list rows inside popovers
- Use `WidgetStatusBadge` for status indicators
- Font: Mohave for body, Kosugi for labels, JetBrains Mono for data
- Border radius: 5px for the popover card
- Title bar: draggable, shows entity name + minimize/close buttons
- Z-index: starts at 2000, auto-increments

## Verification

- Click a client in any widget → client detail popover opens near click position
- Click an invoice → invoice detail popover opens
- Click an estimate → estimate detail popover opens
- Popovers are draggable, resizable, minimizable
- Minimized popovers appear in the window dock
- Multiple popovers can be open simultaneously
- Popovers cascade (don't overlap) when opened in sequence
- All data loads correctly via existing hooks
- No TypeScript errors

# HUD Layout Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the dashboard layout from a document-style push layout into a first-person video game HUD where page content fills the entire viewport and sidebar/topbar/metrics float as glass overlays.

**Architecture:** Sidebar becomes a fixed overlay that does NOT push content — content fills edge-to-edge behind it. TopBar becomes a fixed glass overlay at the top. MetricsHeader becomes an absolute overlay positioned below TopBar. All pages receive uniform safe-area padding from the layout level so no per-page margin hacks are needed.

**Tech Stack:** Next.js App Router, Tailwind CSS, Framer Motion, Zustand

---

## Current vs Target

### Current (document-style)
```
Sidebar PUSHES content → main has ml-[72px]/ml-[256px]
TopBar is STICKY in scroll flow → content flows below it
ContentHeader renders breadcrumbs as separate component
MetricsHeader is in page flow → pushes content below
Pages wrapped in p-3 → content is inset from edges
```

### Target (HUD overlay)
```
Sidebar OVERLAYS content → content fills full viewport
TopBar OVERLAYS content → fixed, glass, breadcrumbs built-in
ContentHeader DELETED → breadcrumbs move into TopBar
MetricsHeader OVERLAYS content → absolute positioned, glass
Content fills 100vw → safe-area padding from layout (not pages)
Content scrolls BEHIND glass overlays (parallax feel)
```

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/components/layouts/dashboard-layout.tsx` | Remove sidebar margin push, restructure to overlay model, add safe-area CSS vars |
| Modify | `src/components/layouts/sidebar.tsx` | Hover-to-expand, auto-collapse on nav click, overlay behavior |
| Modify | `src/components/layouts/top-bar.tsx` | Add breadcrumb support for nested routes |
| Delete | `src/components/layouts/content-header.tsx` | Replaced by TopBar breadcrumbs |
| Modify | `src/components/metrics/MetricsHeader.tsx` | No structural changes needed (already just metrics) |
| Modify | `src/stores/sidebar-store.ts` | Add hover expand/collapse state |
| Modify | `src/app/(dashboard)/pipeline/page.tsx` | Remove full-bleed hacks (-m-3, -mt-[59px]) — no longer needed |
| Modify | ~15 page files | Remove any per-page margin/padding overrides |

## Safe Area Insets

CSS custom properties set at the layout level:

```
--hud-top: 56px        (TopBar height)
--hud-left: 72px       (collapsed sidebar width)
--hud-right: 0px
--hud-bottom: 0px
--hud-metrics: 0px     (set per-page by MetricsHeader when rendered)
--hud-content-top: calc(var(--hud-top) + var(--hud-metrics) + 12px)
```

Pages receive uniform padding: `pt-[var(--hud-content-top)] pl-[calc(var(--hud-left)+12px)] pr-[12px] pb-[12px]`

---

## Tasks

### Task 1: Sidebar — Overlay Mode with Hover Expand

**Files:**
- Modify: `src/components/layouts/sidebar.tsx`
- Modify: `src/stores/sidebar-store.ts`

**Behavior change:**
- Sidebar is ALWAYS visually collapsed (72px icon rail) in its resting state
- On hover → slides to 256px overlaying content (no content reflow)
- On nav item click → navigates + collapses back to 72px
- Mobile: unchanged (drawer overlay)

- [ ] **Step 1: Update sidebar store — add hover state**

In `src/stores/sidebar-store.ts`, add:
```typescript
isHoverExpanded: boolean;
setHoverExpanded: (expanded: boolean) => void;
```
`isHoverExpanded` is NOT persisted — it's transient UI state.

- [ ] **Step 2: Modify sidebar positioning — always overlay**

In `src/components/layouts/sidebar.tsx`:
- The sidebar is already `fixed left-0 top-0 h-screen z-[45]` — no change needed
- Change width logic: always 72px by default, 256px when `isHoverExpanded`
- Remove: any reference to `isCollapsed` for width calculation on desktop (sidebar is always visually collapsed)
- `isCollapsed` store value becomes irrelevant for desktop — only `isHoverExpanded` matters

```tsx
const width = isMobileOpen ? 256 : isHoverExpanded ? 256 : 72;
```

- [ ] **Step 3: Add hover listeners to sidebar**

```tsx
onMouseEnter={() => setHoverExpanded(true)}
onMouseLeave={() => setHoverExpanded(false)}
```

- [ ] **Step 4: Auto-collapse on navigation**

In each nav item's `onClick`, after `router.push()`:
```tsx
setHoverExpanded(false);
closeMobile(); // existing mobile close
```

- [ ] **Step 5: Remove the collapse chevron button**

The toggle chevron (`absolute top-1/2 -right-[10px]`) is no longer needed since expand/collapse is hover-driven. Delete or hide it.

- [ ] **Step 6: Verify sidebar overlay behavior**

Test: hover sidebar → expands to 256px overlaying content. Move mouse away → collapses to 72px. Click nav item → navigates + collapses. Content never reflows.

- [ ] **Step 7: Commit**

```bash
git add src/components/layouts/sidebar.tsx src/stores/sidebar-store.ts
git commit -m "feat(layout): sidebar hover-to-expand overlay mode"
```

---

### Task 2: Dashboard Layout — Remove Sidebar Push, Add Safe Area

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx`
- Delete: `src/components/layouts/content-header.tsx`

- [ ] **Step 1: Remove sidebar margin from main content**

In `dashboard-layout.tsx`, change the `<main>` element:

Before:
```tsx
isCollapsed
  ? "md:ml-[72px] md:w-[calc(100vw-72px)]"
  : "md:ml-[256px] md:w-[calc(100vw-256px)]"
```

After:
```tsx
"w-full"
```

Content now fills the full viewport width. No margin push.

- [ ] **Step 2: Make TopBar fixed overlay instead of sticky**

Change the TopBar wrapper from `sticky top-0` to `fixed top-0 left-0 right-0`:

```tsx
<div
  className="fixed top-0 left-0 right-0 z-10 h-[56px]"
  style={{
    background: "rgba(10, 10, 10, 0.70)",
    backdropFilter: "blur(20px) saturate(1.2)",
    WebkitBackdropFilter: "blur(20px) saturate(1.2)",
  }}
>
  <TopBar />
</div>
```

- [ ] **Step 3: Remove ContentHeader from layout**

Delete the `<ContentHeader />` line from dashboard-layout.tsx. Breadcrumbs will be handled by TopBar (Task 3).

- [ ] **Step 4: Replace p-3 content wrapper with safe-area padding**

Remove the `<div className="p-3 relative z-[1]">` wrapper. Instead, set CSS custom properties on `<main>` and apply safe-area padding directly:

```tsx
<main
  className="h-screen w-full overflow-y-auto overflow-x-auto"
  style={{
    '--hud-top': '56px',
    '--hud-left': '72px',
    paddingTop: 'var(--hud-top)',
    paddingLeft: 'calc(var(--hud-left) + 12px)',
    paddingRight: '12px',
    paddingBottom: '12px',
  } as React.CSSProperties}
>
  <UnassignedRoleBanner />
  {children}
</main>
```

Note: `paddingTop` is just the TopBar height. MetricsHeader (rendered per-page as an absolute overlay) will add its own offset via the page's content area.

- [ ] **Step 5: Delete content-header.tsx**

Remove the file and any imports referencing it.

- [ ] **Step 6: Remove auto-collapse useEffect**

The useEffect that sets `isCollapsed=true` when width < 1024px is no longer needed since the sidebar is always in collapsed (72px) resting state. Remove it.

- [ ] **Step 7: Verify layout**

Test: content fills full viewport. TopBar floats over content at top. Sidebar floats over content at left. Scrolling content moves behind the glass TopBar. No content reflow on any interaction.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(layout): HUD overlay layout — content fills viewport edge-to-edge"
```

---

### Task 3: TopBar — Add Breadcrumbs for Nested Routes

**Files:**
- Modify: `src/components/layouts/top-bar.tsx`

The TopBar already shows the page title from the route. For nested routes (e.g. `/clients/abc`), it needs to show breadcrumbs instead.

- [ ] **Step 1: Import breadcrumb store and add breadcrumb logic**

Port the breadcrumb generation logic from the deleted `content-header.tsx` into `top-bar.tsx`. When `pathname` has more than 1 segment, render breadcrumbs instead of a simple title:

```tsx
// If nested route, show: Clients / Acme Corp
// If top-level route, show: CLIENTS
```

The breadcrumbs should be inline in the left section of the TopBar, replacing the `<h1>` title when on a nested route.

- [ ] **Step 2: Style breadcrumbs to match TopBar**

- Parent segments: `font-mohave text-body-sm text-text-tertiary uppercase tracking-wider` — clickable
- Divider: `/` in `text-text-disabled font-mono`
- Current segment: `font-mohave text-heading text-text-primary uppercase tracking-wider` — not clickable
- Entity names from `useBreadcrumbStore().entityName` override the last segment

- [ ] **Step 3: Verify nested routes**

Test: navigate to `/clients/[id]` → TopBar shows `CLIENTS / Acme Corp`. Click `CLIENTS` → navigates back. Top-level routes still show just the title.

- [ ] **Step 4: Commit**

```bash
git add src/components/layouts/top-bar.tsx
git commit -m "feat(topbar): breadcrumbs for nested routes"
```

---

### Task 4: Pipeline Page — Remove Full-Bleed Hacks

**Files:**
- Modify: `src/app/(dashboard)/pipeline/page.tsx`

The pipeline page previously used `-m-3 -mt-[59px]` to break out of the layout padding. Since the layout no longer has that padding wrapper, these hacks must be removed.

- [ ] **Step 1: Remove negative margin hacks**

Change:
```tsx
<div className="relative h-screen -m-3 -mt-[59px] min-w-0">
```
To:
```tsx
<div className="relative h-screen min-w-0">
```

- [ ] **Step 2: Adjust metrics overlay top position**

The metrics overlay was positioned at `top-[56px]` to account for the TopBar. Since content now starts at `padding-top: 56px` (from the layout safe area), the metrics overlay should be at `top-0` relative to the page container (which already has the TopBar offset):

```tsx
<div className="absolute top-0 left-0 right-0 z-[100] pointer-events-none">
```

- [ ] **Step 3: Verify pipeline canvas**

Test: pipeline canvas fills viewport. Metrics overlay is directly below TopBar. Kanban columns are visible. No gaps, no overlaps.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/pipeline/page.tsx
git commit -m "refactor(pipeline): remove full-bleed margin hacks — HUD layout handles it"
```

---

### Task 5: All Pages — Remove Per-Page Margin/Padding Overrides

**Files:**
- Modify: ~15 page files in `src/app/(dashboard)/`

Since the layout now provides uniform safe-area padding, any per-page padding adjustments must be removed. Each page should render its MetricsHeader + content without worrying about layout insets.

- [ ] **Step 1: Audit all pages for margin/padding overrides**

Search for:
- `-m-3`, `-mx-3`, `-mt-*` (negative margin escapes)
- `px-3`, `py-3`, `p-3` at page root level (redundant with layout padding)
- `h-[calc(100vh-*)]` (hardcoded viewport height calculations)

Each page's root element should be a simple container (no padding, no negative margins). The layout handles all spacing.

- [ ] **Step 2: Fix each page**

For standard pages (projects, invoices, estimates, clients, etc.):
- Root should be `<div className="space-y-3">` or similar — no padding
- MetricsHeader at top, content below

For full-bleed pages (pipeline, map, dashboard):
- Root should be `<div className="relative h-full">` — fills available space
- MetricsHeader as absolute overlay

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove per-page layout overrides — HUD safe area handles spacing"
```

---

### Task 6: MetricsHeader — Overlay Positioning for All Pages

**Files:**
- Modify: `src/components/metrics/MetricsHeader.tsx`
- Possibly modify: individual page files

Currently MetricsHeader is in page flow. For the HUD feel, it should overlay content with frosted glass — just like pipeline does. Two options:

**Option A (recommended):** Each page that wants overlay metrics wraps it in an absolute container (pipeline already does this). Standard pages keep it in flow but with glass background.

**Option B:** MetricsHeader itself renders as fixed/absolute. This is harder because it needs to know about the TopBar height.

Go with **Option A** — MetricsHeader stays structurally the same, but gets a glass background by default so it blends with the HUD:

- [ ] **Step 1: Add glass background to MetricsHeader**

Both variants should have the frosted glass treatment:
```tsx
style={{
  background: "rgba(10, 10, 10, 0.70)",
  backdropFilter: "blur(20px) saturate(1.2)",
  WebkitBackdropFilter: "blur(20px) saturate(1.2)",
}}
```

This ensures that as content scrolls behind it, the glass effect is visible.

- [ ] **Step 2: Verify across pages**

Test: visit every page (projects, invoices, pipeline, clients, etc.). MetricsHeader should have consistent glass appearance. Content scrolls behind it on pages with enough content.

- [ ] **Step 3: Commit**

```bash
git add src/components/metrics/MetricsHeader.tsx
git commit -m "feat(metrics): add frosted glass background for HUD consistency"
```

---

### Task 7: Visual Polish & Edge Cases

- [ ] **Step 1: Verify mobile layout**

Mobile should be unchanged in behavior:
- Sidebar is a drawer overlay (slide in/out)
- TopBar is fixed at top
- Content fills viewport with safe padding
- No horizontal overflow

- [ ] **Step 2: Verify floating windows, modals, FAB**

All z-index layers should still work:
- FAB at z-1500 → above content, below modals
- Floating windows at z-2000+ → above FAB
- Modals at z-3000 → above everything
- Command palette → functions correctly

- [ ] **Step 3: Verify keyboard shortcuts**

⌘K opens command palette. Sidebar hover doesn't interfere with typing.

- [ ] **Step 4: Final type-check and build**

```bash
npx tsc --noEmit
npx next build
```

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat(layout): HUD layout complete — video game UI paradigm"
git push origin main
```

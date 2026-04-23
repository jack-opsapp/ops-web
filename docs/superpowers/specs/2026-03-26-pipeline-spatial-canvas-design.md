# Pipeline Spatial Canvas — Design Spec

**Date:** 2026-03-26
**Scope:** Replace the existing kanban-column pipeline board with a 2D spatial canvas where deal cards live in stage-grouped stacks on a pannable, zoomable surface. Users can drag cards freely, multi-select via marquee, change stages via proximity-based drop zones, and expand cards inline for detail comparison.

**Key principle for implementers:** DO NOT GUESS ANYTHING. Every type, color, enum value, field name, animation constant, and design token MUST be verified by reading the actual source file before use. If a file path or export is mentioned in this spec, read it and confirm it exists before importing. If a database column is referenced, verify it in the schema. No assumptions.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Task Dependency Graph](#2-task-dependency-graph)
3. [Task 1: Canvas Infrastructure — Zustand Store](#task-1-canvas-infrastructure--zustand-store)
4. [Task 2: Canvas Infrastructure — Pan/Zoom Engine](#task-2-canvas-infrastructure--panzoom-engine)
5. [Task 3: Canvas Background Layer](#task-3-canvas-background-layer)
6. [Task 4: Stage Stack Layout Engine](#task-4-stage-stack-layout-engine)
7. [Task 5: Pipeline Card — Collapsed State](#task-5-pipeline-card--collapsed-state)
8. [Task 6: Pipeline Card — Hover State with Floating Metrics](#task-6-pipeline-card--hover-state-with-floating-metrics)
9. [Task 7: Pipeline Card — Expanded Inline State](#task-7-pipeline-card--expanded-inline-state)
10. [Task 8: Staleness Opacity System](#task-8-staleness-opacity-system)
11. [Task 9: Drag & Drop — Single Card](#task-9-drag--drop--single-card)
12. [Task 10: Drag & Drop — Proximity Glow & Card Displacement](#task-10-drag--drop--proximity-glow--card-displacement)
13. [Task 11: Multi-Select — Marquee Selection](#task-11-multi-select--marquee-selection)
14. [Task 12: Multi-Select — Batch Drag & Drop](#task-12-multi-select--batch-drag--drop)
15. [Task 13: Context Menus — Card & Canvas](#task-13-context-menus--card--canvas)
16. [Task 14: Won/Lost Terminal Regions](#task-14-wonlost-terminal-regions)
17. [Task 15: Floating Toolbar](#task-15-floating-toolbar)
18. [Task 16: Archive/Discard Tray](#task-16-archivediscard-tray)
19. [Task 17: Metrics Bar Integration](#task-17-metrics-bar-integration)
20. [Task 18: Pipeline Page Shell — Orchestration](#task-18-pipeline-page-shell--orchestration)
21. [Task 19: Mobile Fallback](#task-19-mobile-fallback)
22. [Task 20: Motion Variants & Reduced Motion](#task-20-motion-variants--reduced-motion)
23. [Task 21: i18n Dictionary Updates](#task-21-i18n-dictionary-updates)
24. [Design Tokens Reference](#design-tokens-reference)

---

## 1. Architecture Overview

### Current State (to be replaced)

The pipeline currently renders as a traditional kanban board:

| File | Role |
|------|------|
| `src/app/(dashboard)/pipeline/page.tsx` | Page shell — state, mutations, dialogs, responsive switching |
| `_components/pipeline-board.tsx` | dnd-kit kanban board with dynamic column visibility |
| `_components/pipeline-column.tsx` | Individual stage column with droppable zone |
| `_components/pipeline-card.tsx` | Deal card with collapsed/expanded states |
| `_components/pipeline-card-actions.tsx` | Action bar (call, text, note, more menu) |
| `_components/pipeline-health-bar.tsx` | Time-in-stage progress bar |
| `_components/pipeline-collapsed-column.tsx` | Compact bar for hidden stages |
| `_components/pipeline-mobile.tsx` | Tab-based mobile view with swipe |
| `_components/pipeline-stage-tab-bar.tsx` | Mobile stage tabs |
| `_components/pipeline-filter-row.tsx` | Stage/assignee dropdowns + New Lead button |
| `_components/pipeline-metrics-bar.tsx` | Animated metrics dashboard |

### New State

Replace `pipeline-board.tsx`, `pipeline-column.tsx`, `pipeline-card.tsx`, `pipeline-health-bar.tsx`, `pipeline-collapsed-column.tsx`, and `pipeline-filter-row.tsx` with the spatial canvas system. Keep `pipeline-card-actions.tsx`, `pipeline-metrics-bar.tsx`, `pipeline-mobile.tsx`, and `pipeline-stage-tab-bar.tsx`. The page shell (`page.tsx`) will be modified to orchestrate the new canvas instead of the kanban board.

### New File Structure

```
src/app/(dashboard)/pipeline/_components/
├── spatial-canvas.tsx              # Main canvas container (pan/zoom/background)
├── spatial-canvas-store.ts         # Zustand store for canvas state
├── spatial-layout-engine.ts        # Pure TS: calculates stack positions from card count
├── spatial-stage-stack.tsx          # Stage column stack with header + glow region
├── spatial-card.tsx                # Deal card (collapsed/hover/expanded states)
├── spatial-card-hover-metrics.tsx  # Floating borderless metrics on hover
├── spatial-card-expanded.tsx       # Inline expanded card content
├── spatial-drag-overlay.tsx        # Drag overlay + proximity glow system
├── spatial-marquee-select.tsx      # Rectangle selection tool
├── spatial-context-menu.tsx        # Right-click menus (card + canvas)
├── spatial-terminal-region.tsx     # Won/Lost auto-arrange regions
├── spatial-floating-toolbar.tsx    # Fit All, + New Lead, Archive Tray toggle
├── spatial-archive-tray.tsx        # Slide-in panel for archived/discarded deals
├── pipeline-card-actions.tsx       # KEEP — reused in expanded card
├── pipeline-metrics-bar.tsx        # KEEP — floats on top of canvas
├── pipeline-mobile.tsx             # KEEP — unchanged mobile fallback
├── pipeline-stage-tab-bar.tsx      # KEEP — used by mobile view
```

### Data Flow

```
page.tsx
 └─ useOpportunities() → Opportunity[]
 └─ useClients() → Map<string, string>
 └─ usePipelineMetrics() → metrics
 └─ mutations: useMoveOpportunityStage, useUpdateOpportunity, useCreateOpportunity, etc.
 │
 ├─ <PipelineMetricsBar />  (floating, z-index 100)
 ├─ <SpatialFloatingToolbar />  (floating, z-index 100)
 └─ <SpatialCanvas>
      ├─ Background layer (dot grid via CSS)
      ├─ <SpatialStageStack /> × N (one per active stage)
      │    └─ <SpatialCard /> × M (one per opportunity in stage)
      ├─ <SpatialTerminalRegion stage="won" />
      ├─ <SpatialTerminalRegion stage="lost" />
      ├─ <SpatialMarqueeSelect />
      ├─ <SpatialDragOverlay />
      └─ <SpatialContextMenu />
 └─ <SpatialArchiveTray />  (slide-in panel)
```

---

## 2. Task Dependency Graph

```
Parallel Group A (no dependencies — can run simultaneously):
  Task 1:  Canvas Zustand Store
  Task 3:  Canvas Background Layer
  Task 20: Motion Variants & Reduced Motion
  Task 21: i18n Dictionary Updates

Parallel Group B (depends on Task 1):
  Task 2:  Pan/Zoom Engine
  Task 4:  Stage Stack Layout Engine
  Task 8:  Staleness Opacity System

Parallel Group C (depends on Tasks 1, 4):
  Task 4b: Stage Stack Component
  Task 5:  Card — Collapsed State
  Task 14: Won/Lost Terminal Regions

Parallel Group D (depends on Task 5):
  Task 6:  Card — Hover State
  Task 7:  Card — Expanded State
  Task 9:  Drag & Drop — Single Card

Parallel Group E (depends on Tasks 9, 2):
  Task 10: Proximity Glow & Card Displacement
  Task 11: Marquee Selection

Parallel Group F (depends on Tasks 10, 11):
  Task 12: Batch Drag & Drop

Parallel Group G (depends on Task 1):
  Task 13: Context Menus
  Task 15: Floating Toolbar
  Task 16: Archive Tray

Parallel Group H (depends on all above):
  Task 17: Metrics Bar Integration
  Task 18: Page Shell Orchestration
  Task 19: Mobile Fallback
```

---

## Task 1: Canvas Infrastructure — Zustand Store

**File:** `src/app/(dashboard)/pipeline/_components/spatial-canvas-store.ts`

**Prerequisite reads (MANDATORY before writing):**
- `src/stores/intel-store.ts` — reference for OPS Zustand store patterns
- `src/lib/types/pipeline.ts` — `Opportunity`, `OpportunityStage` types
- `src/lib/store/auth-store.ts` — verify Zustand import pattern

**Store shape:**

```typescript
interface CardPosition {
  x: number;
  y: number;
}

interface SpatialCanvasState {
  // Viewport
  viewportX: number;              // pan offset X
  viewportY: number;              // pan offset Y
  zoom: number;                   // 1.0 = normal, range [MIN_ZOOM, MAX_ZOOM]

  // Canvas dimensions (computed from card count)
  canvasWidth: number;
  canvasHeight: number;

  // Card positions (only for cards dragged out of auto-layout)
  // Key = opportunity ID, value = absolute canvas position
  // Cards NOT in this map are auto-positioned by their stage stack
  customPositions: Map<string, CardPosition>;

  // Selection
  selectedCardIds: Set<string>;
  expandedCardIds: Set<string>;   // multiple can be expanded simultaneously
  hoveredCardId: string | null;

  // Drag state
  isDragging: boolean;
  dragCardIds: string[];          // IDs being dragged (1 or multi)
  dragOrigin: CardPosition | null;

  // Marquee
  isMarqueeActive: boolean;
  marqueeStart: CardPosition | null;
  marqueeEnd: CardPosition | null;

  // Context menu
  contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    type: "canvas" | "card" | "selection";
    targetCardId: string | null;
  } | null;

  // Archive tray
  isArchiveTrayOpen: boolean;

  // Actions
  setViewport: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  setCanvasDimensions: (width: number, height: number) => void;
  toggleCardExpanded: (id: string) => void;
  setHoveredCard: (id: string | null) => void;
  selectCard: (id: string) => void;
  deselectCard: (id: string) => void;
  clearSelection: () => void;
  selectCards: (ids: string[]) => void;
  toggleCardSelected: (id: string) => void;
  startDrag: (cardIds: string[], origin: CardPosition) => void;
  endDrag: () => void;
  startMarquee: (start: CardPosition) => void;
  updateMarquee: (end: CardPosition) => void;
  endMarquee: () => void;
  showContextMenu: (menu: SpatialCanvasState["contextMenu"]) => void;
  hideContextMenu: () => void;
  toggleArchiveTray: () => void;
  fitAll: () => void;             // resets viewport to show all content
  resetLayout: () => void;        // clears customPositions, re-stacks
}
```

**Constants** (define at top of file):

```typescript
const MIN_ZOOM = 0.3;     // bird's eye — just pills, no text
const MAX_ZOOM = 1.5;     // close-up minimum zoom enforced
const DEFAULT_ZOOM = 0.8; // default landing zoom
const ZOOM_STEP = 0.1;    // per scroll tick
const BIRD_EYE_THRESHOLD = 0.5; // below this = bird's eye (no text, just pills)
```

---

## Task 2: Canvas Infrastructure — Pan/Zoom Engine

**File:** `src/app/(dashboard)/pipeline/_components/spatial-canvas.tsx`

**Prerequisite reads (MANDATORY):**
- `spatial-canvas-store.ts` (Task 1 output)
- `src/components/intel/galaxy-scene.tsx` — reference for OPS pan/zoom patterns
- `src/lib/utils/motion.ts` — verify `EASE_SMOOTH` export

**Responsibilities:**
- Renders the full-bleed canvas container
- Handles wheel events for zoom (pinch-to-zoom on trackpad)
- Handles middle-click / two-finger drag for panning
- Applies CSS transform to the canvas content layer: `transform: translate(${viewportX}px, ${viewportY}px) scale(${zoom})`
- Clamps pan to keep content within canvas bounds (user never pans into void)
- Clamps zoom to `[MIN_ZOOM, MAX_ZOOM]`
- Calls `setCanvasDimensions` on mount and when opportunity count changes

**Canvas sizing formula:**
```
CARD_WIDTH = 200
CARD_HEIGHT = 44 (collapsed)
STACK_GAP = 6
STACK_HEADER_HEIGHT = 52
STACK_HORIZONTAL_GAP = 40
CANVAS_PADDING = 200 // generous breathing room on all sides

activeStageCount = number of non-terminal stages with opportunities
maxCardsInAnyStage = max(stage.opportunities.length for each stage)

canvasWidth = (activeStageCount × (CARD_WIDTH + STACK_HORIZONTAL_GAP)) + TERMINAL_REGION_WIDTH + (CANVAS_PADDING × 2)
canvasHeight = STACK_HEADER_HEIGHT + (maxCardsInAnyStage × (CARD_HEIGHT + STACK_GAP)) + (CANVAS_PADDING × 2)
```

Recalculate on opportunity count change. Animate dimension changes with `EASE_SMOOTH`, duration 0.3s.

**Container markup:**
```tsx
<div className="relative w-full h-full overflow-hidden" /* outer viewport */>
  <div
    style={{
      transform: `translate(${viewportX}px, ${viewportY}px) scale(${zoom})`,
      transformOrigin: "0 0",
      width: canvasWidth,
      height: canvasHeight,
    }}
    /* inner canvas — all stage stacks, cards, regions rendered inside */
  >
    {children}
  </div>
</div>
```

**Surface styling:**
- Outer container: `bg-[#0A0A0A]` (page background)
- Inner canvas: transparent (background layer renders the dot grid)

---

## Task 3: Canvas Background Layer

**File:** Rendered as first child inside the canvas content layer in `spatial-canvas.tsx`

**Prerequisite reads (MANDATORY):**
- `.interface-design/system.md` — verify background color `#0A0A0A`

**Implementation:**
- SVG pattern of small dots: `r="0.7"`, spacing `24px`, fill `rgba(255,255,255,0.06)`
- Pattern covers the full canvas dimensions
- Must NOT intercept pointer events: `pointer-events: none`
- The dot grid provides spatial orientation during pan/zoom

```tsx
<svg
  className="absolute inset-0 w-full h-full pointer-events-none"
  xmlns="http://www.w3.org/2000/svg"
>
  <pattern id="spatial-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="12" cy="12" r="0.7" fill="rgba(255,255,255,0.06)" />
  </pattern>
  <rect width="100%" height="100%" fill="url(#spatial-grid)" />
</svg>
```

---

## Task 4: Stage Stack Layout Engine

**File:** `src/app/(dashboard)/pipeline/_components/spatial-layout-engine.ts`

**Prerequisite reads (MANDATORY):**
- `src/lib/types/pipeline.ts` — read `PIPELINE_STAGES_DEFAULT`, `OPPORTUNITY_STAGE_SORT_ORDER`, `isActiveStage`, `isTerminalStage`, `OpportunityStage` enum. Verify every stage slug and sort order.
- `spatial-canvas-store.ts` (Task 1 output) — canvas dimension constants

**Purpose:** Pure TypeScript function that takes an array of opportunities and returns absolute (x, y) positions for every stage stack header and every card within each stack.

**Signature:**
```typescript
interface StackLayout {
  stage: OpportunityStage;
  headerPosition: { x: number; y: number };
  cardPositions: { opportunityId: string; x: number; y: number }[];
  regionBounds: { x: number; y: number; width: number; height: number };
}

interface TerminalRegionLayout {
  stage: OpportunityStage; // "won" or "lost"
  position: { x: number; y: number };
  cardPositions: { opportunityId: string; x: number; y: number }[];
  bounds: { x: number; y: number; width: number; height: number };
}

interface CanvasLayout {
  stacks: StackLayout[];
  terminalRegions: TerminalRegionLayout[];
  canvasWidth: number;
  canvasHeight: number;
}

export function calculateCanvasLayout(
  opportunities: Opportunity[],
  sortBy: "value" | "name" | "date" | "days_in_stage"
): CanvasLayout
```

**Layout rules:**
- Active stages (read `isActiveStage()` from pipeline.ts to determine which — do NOT guess) are laid out left-to-right in sort order
- Each stack: `CARD_WIDTH = 200px`, `STACK_GAP = 6px` between cards, `STACK_HORIZONTAL_GAP = 40px` between stacks
- `CANVAS_PADDING = 200px` on all sides
- Stack header: `52px` tall
- Card: `44px` tall (collapsed), variable when expanded (handled at render time, not layout time)
- Terminal regions (Won, Lost) positioned to the right of all active stacks with `80px` gap
- Terminal region cards arranged in a 2D grid: `TERMINAL_COLS = 3`, wrapping as count grows, expanding right and down

**Sort options** (applied within each stack):
- `value`: descending by `estimatedValue` (nulls last)
- `name`: alphabetical by resolved client name
- `date`: newest `createdAt` first
- `days_in_stage`: most days first (calculated from `stageEnteredAt`)

---

## Task 4b: Stage Stack Component

**File:** `src/app/(dashboard)/pipeline/_components/spatial-stage-stack.tsx`

**Prerequisite reads (MANDATORY):**
- `spatial-layout-engine.ts` (Task 4 output) — `StackLayout` interface
- `spatial-canvas-store.ts` (Task 1 output) — canvas state
- `src/lib/types/pipeline.ts` — `OpportunityStage`, `OPPORTUNITY_STAGE_COLORS`, `getStageDisplayName`, `formatCurrency`, `getDaysInStage`
- Current `pipeline-column.tsx` — reference for column header pattern (lines 196-236)
- `.interface-design/system.md` — typography, border, surface tokens
- `@dnd-kit/core` — `useDroppable` usage (verify from current `pipeline-column.tsx`)

**Props:**
```typescript
interface SpatialStageStackProps {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  clients: Map<string, string>;
  layout: StackLayout;
  expandedCardIds: Set<string>;
  selectedCardIds: Set<string>;
  hoveredCardId: string | null;
  isBirdEye: boolean;
  canManage: boolean;
  activeId: string | null; // currently being dragged
  // All card callbacks (passed through)
  onToggleExpand: (id: string) => void;
  onHoverCard: (id: string | null) => void;
  onSelectCard: (id: string, e: React.MouseEvent) => void;
  onCardContextMenu: (e: React.MouseEvent, id: string) => void;
  onAdvance: (opportunity: Opportunity) => void;
  onRetreat: (opportunity: Opportunity) => void;
  onLogCall: (id: string) => void;
  onLogText: (id: string) => void;
  onAddNote: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onOpenDetail: (opportunity: Opportunity) => void;
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
}
```

**Region rendering:**
- Positioned absolutely at `layout.headerPosition` coordinates
- Region background: `radial-gradient(ellipse at center, ${stageColor}08 0%, transparent 70%)` — ultra-subtle persistent glow (~3% opacity)
- Region bounds: `layout.regionBounds` — the full area including header + all cards + padding
- On hover within region: glow intensifies to `${stageColor}15` (~8% opacity), transition `0.2s ease-out`
- When `isOver` (dnd-kit droppable): glow intensifies further to `${stageColor}20` (~12% opacity)

**Header rendering:**
- Stage name: `font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest`
- Count: `font-mohave text-body-lg text-text-primary` — `{opportunities.length}`
- Total value: `font-mohave text-body-lg text-text-primary` — `formatCurrency(totalValue)`, preceded by `/` separator in `text-text-disabled`
- Border-top: `3px solid ${stageColor}`
- Surface: `bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px]` (match current column header from pipeline-column.tsx line 201)

**Hover on header — aggregate metrics** (appear below the count/value line):
- Average days in stage: `"avg {n}d"` — `font-kosugi text-micro-sm text-text-disabled`
- Oldest deal: `"oldest: {n}d"` — `font-kosugi text-micro-sm text-text-disabled`
- Animate in with `opacity 0 → 1`, duration `0.15s`

**Card rendering:**
- Render `<SpatialCard>` for each opportunity at its layout-calculated position
- Each card wrapped with dnd-kit `useDraggable` (same pattern as current `DraggableCard` wrapper)
- Cards stacked vertically with `STACK_GAP = 6px`

**Droppable zone:**
- The entire region is a drop target via `useDroppable({ id: stage })`
- When a card is dragged over: trigger card displacement (Task 10)

**Empty state:**
- If `opportunities.length === 0`: show dashed border zone with "No deals in this stage" + "Drop here to move"
- Same pattern as current `pipeline-column.tsx` lines 276-290

---

## Task 5: Pipeline Card — Collapsed State

**File:** `src/app/(dashboard)/pipeline/_components/spatial-card.tsx`

**Prerequisite reads (MANDATORY):**
- `src/lib/types/pipeline.ts` — read `Opportunity` interface (every field), `OPPORTUNITY_STAGE_COLORS`, `formatCurrency`, `getDaysInStage`, `isOpportunityStale`, `getStageDisplayName`
- `spatial-canvas-store.ts` — `hoveredCardId`, `expandedCardIds`, `selectedCardIds`, `zoom`, `BIRD_EYE_THRESHOLD`
- `src/lib/utils/motion.ts` — `EASE_SMOOTH`
- `.interface-design/system.md` — surface colors, border tokens, frosted glass spec, typography rules, border radius
- `src/i18n/dictionaries/en/pipeline.json` — verify all dictionary keys before using `t()`

**Props:**
```typescript
interface SpatialCardProps {
  opportunity: Opportunity;
  clientName: string;
  stageColor: string;
  stalenessOpacity: number;      // 0.4 to 1.0, calculated by staleness system (Task 8)
  isSelected: boolean;
  isExpanded: boolean;
  isHovered: boolean;
  isBirdEye: boolean;            // zoom < BIRD_EYE_THRESHOLD
  canManage: boolean;
  onToggleExpand: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  // Mutation callbacks (passed through to expanded state)
  onAdvance: () => void;
  onRetreat: () => void;
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onOpenDetail: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
}
```

**Bird's eye rendering** (`isBirdEye === true`):
- Render as a small pill: `width: 200px`, `height: 8px`
- `background: stageColor` at `stalenessOpacity`
- No text, no border detail
- `border-radius: 4px`
- Still clickable, hoverable, draggable, selectable

**Normal rendering** (`isBirdEye === false`):
- `width: 200px`, min-height: `44px`
- Surface: `bg-[rgba(13,13,13,0.6)]` `backdrop-blur-xl`
- Border: `1px solid rgba(255,255,255,0.08)`, `border-radius: 4px` (verify from system.md: "2-4px")
- Left border: `3px solid ${stageColor}`
- Opacity: `stalenessOpacity` (overridden to 1.0 on hover)
- Padding: `10px horizontal`, `8px vertical`

**Content — Line 1 (only line in collapsed):**
- Left: client name — `font-mohave text-body-sm font-medium text-text-primary truncate`
- Right: value — `font-mohave text-body-sm text-text-secondary`
  - If `estimatedValue` exists: `formatCurrency(estimatedValue)` (read the function from pipeline.ts, verify its signature)
  - If `estimatedValue` is null: `"$--"`

**Selection glow:**
- When `isSelected === true`: border changes to `2px solid ${stageColor}` (glow in their stage color, NOT accent)
- Add `box-shadow: 0 0 12px ${stageColor}40` for the glow effect (40 = 25% opacity hex)

**Hover:**
- `border-[rgba(255,255,255,0.15)]` (existing pattern — verify from current pipeline-card.tsx)
- Opacity overridden to 1.0

**Click:** calls `onToggleExpand`

**Right-click:** calls `onContextMenu` with the mouse event

---

## Task 6: Pipeline Card — Hover State with Floating Metrics

**File:** `src/app/(dashboard)/pipeline/_components/spatial-card-hover-metrics.tsx`

**Prerequisite reads (MANDATORY):**
- `src/lib/types/pipeline.ts` — `Opportunity` fields: `stageEnteredAt`, `estimatedValue`, `lastInboundAt`, `lastOutboundAt`, `correspondenceCount`, `nextFollowUpAt`. Read each field's type.
- `src/lib/types/pipeline.ts` — `getDaysInStage()`, `formatCurrency()`, `isOpportunityStale()` — read their implementations
- Current `pipeline-card.tsx` lines 59-109 — the date helper functions (`isDateToday`, `isDateOverdue`, `daysOverdue`, `formatTimeAgo`). Copy these utilities.
- `src/lib/utils/motion.ts` — `EASE_SMOOTH`
- `src/i18n/dictionaries/en/pipeline.json` — verify keys

**Rendering:**
- Positioned BELOW the card (below = `top: 100%` relative to card)
- `position: absolute`, `left: 0`, `top: calc(100% + 4px)`, `z-index: 10`
- No background, no border — completely borderless floating text
- Width matches card width (200px)

**Metrics displayed (each on its own line, stacked vertically with 2px gap):**

1. **Days in stage:** `"{count}d in {stageName}"` — `font-kosugi text-micro-sm text-text-tertiary`
   - Calculate using `getDaysInStage(opportunity)` (read the function — it uses `stageEnteredAt`)
   - Stage name from `getStageDisplayName(opportunity.stage)`

2. **Value:** `formatCurrency(estimatedValue)` or `"$--"` — `font-mohave text-body-sm text-text-secondary`
   - Only show if NOT already visible on the card (it is on the card, so SKIP this in hover metrics)

3. **Last correspondence:** — `font-kosugi text-micro-sm text-text-disabled`
   - Determine the most recent of `lastInboundAt` and `lastOutboundAt`
   - Format: `"email {timeAgo}"` using the `formatTimeAgo` helper
   - If no correspondence: `"no correspondence"`

4. **Follow-up status:** — `font-kosugi text-micro-sm`
   - If `nextFollowUpAt` is overdue: red text `text-[#93321A]`, format: `"overdue {count}d"`
   - If `nextFollowUpAt` is today: amber text `text-[#C4A868]`, format: `"follow-up today"`
   - If `nextFollowUpAt` is future: `text-text-tertiary`, format: `"follow-up {day}"`
   - If no follow-up scheduled: omit this line entirely

**Animation:**
- Entry: `opacity: 0, y: -4` → `opacity: 1, y: 0`, duration `0.15s`, easing `EASE_SMOOTH`
- Exit: `opacity: 0`, duration `0.1s`, easing `EASE_SMOOTH`
- Wrap in `<AnimatePresence>` keyed on `isHovered`
- Reduced motion: opacity only, no y transform

**Important:** These metrics ONLY appear when `isHovered === true` AND `isExpanded === false` AND `isBirdEye === false`.

---

## Task 7: Pipeline Card — Expanded Inline State

**File:** `src/app/(dashboard)/pipeline/_components/spatial-card-expanded.tsx`

**Prerequisite reads (MANDATORY):**
- Current `pipeline-card.tsx` lines 345-468 — the existing expanded content. Reuse the same information architecture.
- Current `pipeline-card-actions.tsx` — the action bar component. Reuse this component directly.
- `src/lib/types/pipeline.ts` — `Opportunity` full interface, all fields used in expanded state
- `src/lib/utils/motion.ts` — verify `pipelineCardContentVariants` and `pipelineCardContentVariantsReduced` exports

**Rendering:**
- Rendered inside `<SpatialCard>` below the collapsed content, separated by a `border-t border-[rgba(255,255,255,0.06)]`
- Wrapped in `<AnimatePresence initial={false}>` for mount/unmount animation
- Card width stays at `200px` — content flows vertically

**Content (same structure as current expanded card):**

1. **Contact info:**
   - `opportunity.contactName` if exists — `font-mohave text-body-sm text-text-secondary`
   - Phone link: `tel:` href, with Phone icon (12px), `text-[#6F94B0]` — only if `opportunity.contactPhone` exists
   - Email link: `mailto:` href, with Mail icon (12px), `text-[#6F94B0]` — only if `opportunity.contactEmail` exists

2. **Email correspondence stats** (only if `opportunity.correspondenceCount > 0`):
   - `"{count} email(s)"` — `font-kosugi text-micro-sm text-text-tertiary`
   - `"{inboundCount} in / {outboundCount} out"` — `text-text-disabled`
   - `"last {timeAgo}"` — most recent of `lastInboundAt`/`lastOutboundAt`

3. **Actions bar:**
   - Render `<PipelineCardActions>` with all mutation callbacks
   - Read current `pipeline-card-actions.tsx` to verify its props interface exactly

4. **Last activity:**
   - If `opportunity.lastActivityAt` exists: `"activity {timeAgo}"` — `font-kosugi text-micro-sm text-text-disabled`

5. **Details button:**
   - `font-mohave text-body-sm text-[#6F94B0] hover:text-text-primary cursor-pointer`
   - Calls `onOpenDetail` — this will eventually open the tethered detail popover (designed separately, for now opens deal detail sheet)

**Animation per content row:**
- Use `pipelineCardContentVariants` (read from motion.ts — verify it exists)
- Custom prop = stagger index (0, 0.5, 1, 2, 3)
- Reduced motion: `pipelineCardContentVariantsReduced`

---

## Task 8: Staleness Opacity System

**File:** Utility function exported from `spatial-layout-engine.ts` or a new `spatial-staleness.ts`

**Prerequisite reads (MANDATORY):**
- `src/lib/types/pipeline.ts` — read `isOpportunityStale()` implementation (line ~857). Understand exactly how it determines staleness.
- `src/lib/types/pipeline.ts` — read `getDaysInStage()` implementation (line ~870). Understand what it returns.
- `src/lib/types/pipeline.ts` — read `PIPELINE_STAGES_DEFAULT` — each stage has `autoFollowUpDays` which determines the stale threshold.
- `src/lib/types/pipeline.ts` — read `PipelineStageDefault` interface — the `autoFollowUpDays` field.

**Formula:**

```typescript
export function calculateStalenessOpacity(
  opportunity: Opportunity,
  stageConfig: PipelineStageDefault
): number {
  const daysInStage = getDaysInStage(opportunity);
  // Expected days = autoFollowUpDays × 3, fallback to 21
  // (This matches the current health bar expectedDays calculation — verify in pipeline-card.tsx line 156-158)
  const expectedDays = stageConfig.autoFollowUpDays
    ? stageConfig.autoFollowUpDays * 3
    : 21;

  if (daysInStage <= expectedDays * 0.5) return 1.0;   // fresh — full opacity
  if (daysInStage >= expectedDays * 2.0) return 0.4;    // deeply stale — minimum opacity

  // Linear interpolation between 1.0 and 0.4
  const progress = (daysInStage - expectedDays * 0.5) / (expectedDays * 1.5);
  return 1.0 - (progress * 0.6); // 1.0 → 0.4
}
```

- Terminal stages (Won, Lost, Discarded): always return `0.8` (slightly dimmed, settled)
- Hover overrides this to `1.0` at the component level (not in this function)

---

## Task 9: Drag & Drop — Single Card

**File:** Integrated into `spatial-card.tsx` and `spatial-drag-overlay.tsx`

**Prerequisite reads (MANDATORY):**
- `src/app/(dashboard)/pipeline/_components/pipeline-board.tsx` — current dnd-kit setup. Read the `DragOverlay` usage.
- `@dnd-kit/core` — read how `useDraggable` and `DragOverlay` work in the existing codebase. Do NOT guess the API.
- `spatial-canvas-store.ts` — drag state shape

**Implementation:**

In `spatial-card.tsx`:
- Wrap card with `useDraggable` from `@dnd-kit/core` (same pattern as current `DraggableCard` in `pipeline-column.tsx` — read lines 56-125)
- When dragging starts: `store.startDrag([opportunity.id], { x, y })`
- When dragging: the card at its original position goes `opacity: 0.2` (same as current `isDragging && "opacity-20"` pattern)

In `spatial-drag-overlay.tsx`:
- Uses `<DragOverlay>` from `@dnd-kit/core`
- Renders a ghost copy of the card being dragged
- Ghost: `scale(1.03)`, `border-[rgba(255,255,255,0.20)]` (matches current `isOverlay` styling in pipeline-card.tsx line 242)
- `box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)` (verify `DRAG_GRABBED_SHADOW` in motion.ts)

**Drop targets:**
- Each `<SpatialStageStack>` is a drop target (using `useDroppable` from `@dnd-kit/core`)
- Drop on a stage stack → call `onMoveStage(opportunityId, newStage)`
- Drop on empty canvas (not on any stack) → show discard confirmation dialog

**Discard confirmation:**
- Use the existing `toast` or a simple confirmation dialog
- Text: `"Discard {clientName}?"` with Confirm/Cancel buttons
- On confirm: call `onDiscard(opportunityId)`
- On cancel: animate card back to original position

---

## Task 10: Drag & Drop — Proximity Glow & Card Displacement

**File:** Integrated into `spatial-stage-stack.tsx` and `spatial-drag-overlay.tsx`

**Prerequisite reads (MANDATORY):**
- `spatial-canvas-store.ts` — drag state
- `src/lib/utils/motion.ts` — `EASE_SMOOTH`
- `@dnd-kit/core` — read how `useDroppable` `isOver` state works in the existing `pipeline-column.tsx`

**Proximity glow:**
- Each stage stack's region has a persistent ultra-subtle glow: `background: radial-gradient(ellipse at center, ${stageColor}08 0%, transparent 70%)`
- The `08` = ~3% opacity hex suffix
- When `isOver === true` (dnd-kit's droppable hover state): intensify to `${stageColor}20` (~12% opacity)
- Transition: `transition: background 0.2s ease-out`
- Additionally, the stack header border-top intensifies from its base color at 60% to 100% opacity

**Card displacement:**
- When a dragged card enters a stack's droppable zone, existing cards in that stack should animate apart to show an insertion gap
- Gap height: `CARD_HEIGHT + STACK_GAP` = `50px`
- Gap position: determined by the dragged card's Y position relative to the stack's cards (find the nearest gap between cards)
- Cards above the gap: unchanged position
- Cards below the gap: translate down by `50px` with `transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)`
- When the dragged card leaves: cards animate back with same timing
- Reduced motion: instant position change, no animation

---

## Task 11: Multi-Select — Marquee Selection

**File:** `src/app/(dashboard)/pipeline/_components/spatial-marquee-select.tsx`

**Prerequisite reads (MANDATORY):**
- `spatial-canvas-store.ts` — marquee state, selection state
- All card position data (from layout engine or store)

**Interaction:**
- Mouse down on **empty canvas space** (not on a card) starts the marquee
- Must distinguish from pan: marquee = left-click drag on empty space. Pan = middle-click or two-finger.
- As the user drags, render a selection rectangle:
  - `border: 1px solid rgba(111, 148, 176, 0.5)` (accent at 50%)
  - `background: rgba(111, 148, 176, 0.08)` (accent at 8%)
  - `border-radius: 2px`
  - `pointer-events: none`
- On every mousemove: calculate which cards intersect the rectangle (compare card bounding boxes against marquee rect)
- Update `selectedCardIds` in store with intersecting card IDs
- On mouseup: finalize selection, end marquee

**Selection rectangle rendering:**
- Positioned absolutely within the canvas content layer
- Coordinates in canvas space (accounts for zoom + pan transform)
- `z-index: 50` (above cards, below floating UI)

**Edge cases:**
- If user starts marquee then drags outside the canvas viewport: extend selection rectangle to edge, scroll/pan canvas in that direction
- Shift+click on a card: toggle that card's selection without clearing others
- Click on empty space without dragging: clear all selections

---

## Task 12: Multi-Select — Batch Drag & Drop

**File:** Integrated into `spatial-card.tsx` and `spatial-drag-overlay.tsx`

**Prerequisite reads (MANDATORY):**
- Task 9 output (single card drag)
- Task 11 output (marquee selection)
- `spatial-canvas-store.ts` — `selectedCardIds`, `dragCardIds`

**Behavior:**
- When user starts dragging a card that is part of a selection (i.e., `selectedCardIds.has(cardId)`):
  - ALL selected cards enter drag state (`opacity: 0.2` at their original positions)
  - The drag overlay shows a stacked ghost: the primary card + a badge showing `"+{count - 1}"` for additional cards
  - Badge: `font-kosugi text-micro-sm`, positioned top-right of the ghost card, `background: rgba(10,10,10,0.8)`, `border: 1px solid rgba(255,255,255,0.15)`, `border-radius: 10px`, `padding: 2px 8px`
- Drop on a stage stack: batch move ALL selected cards to that stage
- Drop on empty canvas: "Discard {count} deals?" confirmation
- After drop: clear selection

**If user drags a card that is NOT in the selection:**
- Clear the current selection
- Drag only that single card (Task 9 behavior)

---

## Task 13: Context Menus — Card & Canvas

**File:** `src/app/(dashboard)/pipeline/_components/spatial-context-menu.tsx`

**Prerequisite reads (MANDATORY):**
- `.interface-design/system.md` — frosted glass spec for overlays: `rgba(10, 10, 10, 0.70)` + `backdrop-blur(20px) saturate(1.2)` + `1px solid rgba(255, 255, 255, 0.08)`
- `spatial-canvas-store.ts` — `contextMenu` state shape
- `src/lib/types/pipeline.ts` — `OpportunityStage`, `getStageDisplayName()`, `OPPORTUNITY_STAGE_COLORS`
- `src/i18n/dictionaries/en/pipeline.json` — verify or add keys for menu items

**Card context menu** (right-click on a single card):
| Item | Icon | Action |
|------|------|--------|
| Edit | Pencil (lucide `Pencil`) | Opens edit flow (calls `onOpenDetail`) |
| Archive | Archive (lucide `Archive`) | Calls `onArchive(cardId)` |
| Delete | Trash2 (lucide `Trash2`) | Confirmation prompt, then calls `onDelete(cardId)` |

**Selection context menu** (right-click when multiple cards selected):
| Item | Icon | Action |
|------|------|--------|
| Move to Stage > | ArrowRight | Submenu with all active stages (each with stage color dot) |
| Assign to > | UserPlus | Submenu with team members |
| Archive | Archive | Batch archive all selected |
| Mark Won | Trophy | Batch move to Won |
| Mark Lost | XCircle | Batch move to Lost |

**Canvas context menu** (right-click on empty canvas):
| Item | Icon | Action |
|------|------|--------|
| Sort by: Value | ArrowDownWideNarrow | Calls layout engine with sort="value", re-stacks |
| Sort by: Name | ArrowDownAZ | Calls layout engine with sort="name" |
| Sort by: Date Added | Calendar | Calls layout engine with sort="date" |
| Sort by: Days in Stage | Clock | Calls layout engine with sort="days_in_stage" |
| --- | (divider) | |
| Organize by Stage | LayoutGrid | Calls `store.resetLayout()` — clears custom positions |
| Select All | CheckSquare | Selects all visible cards |

**Menu styling:**
- Surface: frosted glass (spec above)
- Width: `180px` for card/canvas, `220px` for selection (wider for submenus)
- Item height: `32px`
- Item text: `font-mohave text-body-sm text-text-primary`
- Item hover: `bg-[rgba(255,255,255,0.06)]`
- Icon: `w-[14px] h-[14px] text-text-tertiary mr-[8px]`
- Divider: `1px solid rgba(255,255,255,0.06)`, `margin: 4px 0`
- Border-radius: `4px`
- `z-index: 1000` (dropdown layer per z-index scale in CLAUDE.md)
- Position: rendered at mouse coordinates, clamped to viewport bounds
- Dismiss: click outside, Escape key, or scroll

**Submenus (Move to Stage, Assign to):**
- Open to the right of the parent menu item on hover
- Each stage item shows a small colored dot (`8px` circle) using `OPPORTUNITY_STAGE_COLORS[stage]`
- Same frosted glass surface as parent

---

## Task 14: Won/Lost Terminal Regions

**File:** `src/app/(dashboard)/pipeline/_components/spatial-terminal-region.tsx`

**Prerequisite reads (MANDATORY):**
- `src/lib/types/pipeline.ts` — `OpportunityStage.Won`, `OpportunityStage.Lost`, `OPPORTUNITY_STAGE_COLORS`
- `spatial-layout-engine.ts` (Task 4 output) — `TerminalRegionLayout`
- `.interface-design/system.md` — verify border, surface tokens

**Props:**
```typescript
interface SpatialTerminalRegionProps {
  stage: OpportunityStage.Won | OpportunityStage.Lost;
  opportunities: Opportunity[];
  clients: Map<string, string>;
  layout: TerminalRegionLayout;
  onOpenDetail: (opportunity: Opportunity) => void;
  onContextMenu: (e: React.MouseEvent, opportunityId: string) => void;
}
```

**Rendering:**
- Positioned on the far right of the canvas (positions from layout engine)
- Header: stage name (uppercase kosugi) + count
- Region background: same subtle glow as active stacks but dimmer (`${stageColor}05` ≈ 2% opacity)
- Cards arranged in a 2D grid: `TERMINAL_COLS = 3`, wrapping
- Card spacing: `6px` gap
- Cards are NOT draggable, NOT repositionable
- Cards are clickable (opens detail) and right-clickable (context menu)
- Region grows right and down as cards accumulate
- Cards render at staleness opacity `0.8` (settled, dimmed)

**Card rendering within terminal regions:**
- Same `<SpatialCard>` component but with `draggable={false}` prop
- Add a `draggable?: boolean` prop to SpatialCard, defaults to `true`

**Drop target:**
- The terminal region IS a drop target (useDroppable)
- Dropping a card here triggers the Won/Lost transition dialog (reuse existing `StageTransitionDialog`)

---

## Task 15: Floating Toolbar

**File:** `src/app/(dashboard)/pipeline/_components/spatial-floating-toolbar.tsx`

**Prerequisite reads (MANDATORY):**
- `.interface-design/system.md` — frosted glass spec
- `spatial-canvas-store.ts` — `fitAll()`, `toggleArchiveTray()`
- `src/lib/utils/motion.ts` — `EASE_SMOOTH`
- Existing FAB/toolbar patterns — read `src/components/layouts/` for positioning patterns

**Position:** Fixed position, horizontally centered, below the metrics bar. `z-index: 100` (interactive layer).

**Styling:**
- Frosted glass: `rgba(10, 10, 10, 0.70)` + `backdrop-blur(20px) saturate(1.2)` + `1px solid rgba(255, 255, 255, 0.08)`
- `border-radius: 4px`
- `padding: 4px 8px`
- Horizontal layout with `gap: 2px`

**Buttons:**

| Button | Icon | Tooltip | Action |
|--------|------|---------|--------|
| Fit All | Maximize2 (lucide) | "Fit all" | `store.fitAll()` |
| + New Lead | Plus (lucide) | "New lead" | `onAddLead()` (passed from page) |
| Archive Tray | Archive (lucide) | "Archived deals" | `store.toggleArchiveTray()` |

**Button styling:**
- `p-[6px]`, `border-radius: 2px`
- `text-text-disabled hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)]`
- `transition: all 0.15s ease`
- Icons: `w-[16px] h-[16px]`
- Active state (archive tray open): `text-[#6F94B0]` `bg-[rgba(111,148,176,0.1)]`

---

## Task 16: Archive/Discard Tray

**File:** `src/app/(dashboard)/pipeline/_components/spatial-archive-tray.tsx`

**Prerequisite reads (MANDATORY):**
- `src/lib/hooks/index.ts` — find the hook that fetches archived opportunities. Read `useOpportunities` to understand its filter params (does it support `archivedAt IS NOT NULL`?). If not, read the service layer.
- `src/lib/api/services/` — find the pipeline/opportunity service. Read how archived opportunities are queried.
- `spatial-canvas-store.ts` — `isArchiveTrayOpen`
- `.interface-design/system.md` — frosted glass, typography

**Position:** Fixed, right edge of viewport, full height. Slides in from the right.

**Styling:**
- Width: `280px`
- Frosted glass background
- `z-index: 500` (nav layer — sits above canvas but below modals)
- `border-left: 1px solid rgba(255,255,255,0.08)`

**Animation:**
- Enter: `x: 280` → `x: 0`, duration `0.25s`, easing `EASE_SMOOTH`
- Exit: `x: 0` → `x: 280`, duration `0.2s`, easing `EASE_SMOOTH`
- Reduced motion: opacity only

**Content:**
- Header: `"ARCHIVED"` — `font-kosugi text-micro-sm uppercase tracking-widest text-text-tertiary`
- Close button: X icon, top-right
- Scrollable list of archived + discarded opportunities
- Each item: simple row with client name + value + stage color dot + archived date
  - `font-mohave text-body-sm text-text-secondary`
  - `padding: 8px 12px`, `border-bottom: 1px solid rgba(255,255,255,0.04)`
  - Hover: `bg-[rgba(255,255,255,0.04)]`

**Item interactions:**
- **Click:** Opens a small action menu: "Restore to [stage dropdown]", "Delete permanently", "Edit"
- **Drag out of tray:** The item becomes draggable. When dragged onto a stage stack in the canvas, it restores the opportunity to that stage (calls `unarchive` + `moveStage`).

**Empty state:** `"No archived deals"` — `font-mohave text-body-sm text-text-disabled`, centered

---

## Task 17: Metrics Bar Integration

**File:** Modifications to `pipeline-metrics-bar.tsx` (minimal) and `page.tsx`

**Prerequisite reads (MANDATORY):**
- Current `pipeline-metrics-bar.tsx` — understand its full implementation
- Current `page.tsx` — understand how metrics bar is currently rendered

**Changes:**
- The metrics bar now floats on top of the canvas instead of being in the page flow
- Wrap it in a fixed-position container: `position: absolute`, `top: 0`, `left: 0`, `right: 0`, `z-index: 100`
- Add `pointer-events: none` to the container, `pointer-events: auto` to the metrics bar itself (so click-through works on the canvas behind empty areas)
- No changes to the metrics bar's internal implementation

---

## Task 18: Pipeline Page Shell — Orchestration

**File:** `src/app/(dashboard)/pipeline/page.tsx`

**Prerequisite reads (MANDATORY):**
- Current `page.tsx` in full — read ALL of it. This is the orchestration layer.
- All new spatial components (Tasks 1-17 outputs)
- `src/lib/hooks/index.ts` — verify all hook exports
- `src/lib/types/pipeline.ts` — all types used

**Changes:**
- Remove imports of: `PipelineBoard`, `PipelineFilterRow`, `PipelineColumn`
- Add imports of: `SpatialCanvas`, `SpatialStageStack`, `SpatialCard`, `SpatialFloatingToolbar`, `SpatialArchiveTray`, `SpatialMarqueeSelect`, `SpatialDragOverlay`, `SpatialContextMenu`, `SpatialTerminalRegion`
- The responsive switching logic stays: desktop → spatial canvas, mobile (< 900px) → `PipelineMobile` (unchanged)
- Remove the filter row rendering
- Render the metrics bar in a floating container above the canvas
- Render the floating toolbar below the metrics bar
- Pass all mutation callbacks through to the canvas components
- Keep all existing dialogs: `StageTransitionDialog`, `DealDetailSheet`, etc.
- Keep the Gmail connection banner, email review panel, setup interception

**Layout:**
```tsx
<div className="flex flex-col h-full">
  {/* Gmail banner if needed */}
  {/* Floating metrics bar — absolute positioned */}
  {/* Floating toolbar — absolute positioned */}

  {/* Canvas takes full remaining space */}
  <div className="flex-1 relative overflow-hidden">
    <SpatialCanvas opportunities={opportunities} ...>
      {/* Background layer */}
      {/* Stage stacks */}
      {/* Terminal regions */}
      {/* Marquee */}
      {/* Drag overlay */}
      {/* Context menu */}
    </SpatialCanvas>
  </div>

  {/* Archive tray (fixed position, slides in) */}
  <SpatialArchiveTray />

  {/* Existing dialogs */}
  <StageTransitionDialog />
  <DealDetailSheet />
</div>
```

---

## Task 19: Mobile Fallback

**No changes required.** The existing `PipelineMobile` component and `PipelineStageTabBar` remain as-is. The page shell already handles responsive switching at 900px breakpoint (verify in current `page.tsx`). The spatial canvas only renders on desktop.

---

## Task 20: Motion Variants & Reduced Motion

**File:** Add to `src/lib/utils/motion.ts`

**Prerequisite reads (MANDATORY):**
- Current `motion.ts` — read the full file. Understand the naming pattern. Follow it exactly.
- `.interface-design/system.md` — motion section

**New exports to add:**

```typescript
// ── Spatial canvas animations ──

/** Card hover metrics — float in from above */
export const spatialHoverMetricsVariants: Variants = {
  hidden: { opacity: 0, y: -4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_SMOOTH } },
};

export const spatialHoverMetricsVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** Archive tray — slide in from right */
export const spatialArchiveTrayVariants: Variants = {
  hidden: { x: 280 },
  visible: { x: 0, transition: { duration: 0.25, ease: EASE_SMOOTH } },
  exit: { x: 280, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

export const spatialArchiveTrayVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Context menu — scale in from click point */
export const spatialContextMenuVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.12, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.08, ease: EASE_SMOOTH } },
};

export const spatialContextMenuVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};

/** Floating toolbar — fade in */
export const spatialToolbarVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

export const spatialToolbarVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};
```

---

## Task 21: i18n Dictionary Updates

**File:** `src/i18n/dictionaries/en/pipeline.json` and `src/i18n/dictionaries/es/pipeline.json`

**Prerequisite reads (MANDATORY):**
- Current `en/pipeline.json` — read the full file. Understand the key structure. Follow it exactly.
- Current `es/pipeline.json` — read the full file. Add matching keys.

**New keys to add (nest under appropriate sections — match existing structure):**

```json
{
  "spatial": {
    "fitAll": "Fit all",
    "newLead": "New lead",
    "archivedDeals": "Archived deals",
    "noArchivedDeals": "No archived deals",
    "discardConfirm": "Discard {name}?",
    "discardBatchConfirm": "Discard {count} deals?",
    "confirm": "Confirm",
    "cancel": "Cancel",
    "noCorrespondence": "no correspondence",
    "emailTimeAgo": "email {timeAgo}",
    "overdueCount": "overdue {count}d",
    "followUpToday": "follow-up today",
    "followUpDate": "follow-up {date}",
    "daysInStage": "{count}d in {stage}"
  },
  "contextMenu": {
    "edit": "Edit",
    "archive": "Archive",
    "delete": "Delete",
    "deleteConfirm": "Delete permanently?",
    "moveToStage": "Move to stage",
    "assignTo": "Assign to",
    "markWon": "Mark won",
    "markLost": "Mark lost",
    "sortByValue": "Sort by: Value",
    "sortByName": "Sort by: Name",
    "sortByDate": "Sort by: Date added",
    "sortByDays": "Sort by: Days in stage",
    "organizeByStage": "Organize by stage",
    "selectAll": "Select all",
    "restoreTo": "Restore to...",
    "deletePermanently": "Delete permanently"
  },
  "archiveTray": {
    "title": "ARCHIVED",
    "restore": "Restore",
    "empty": "No archived deals"
  }
}
```

Add Spanish translations for all keys in `es/pipeline.json`.

---

## Design Tokens Reference

All values verified from the source files listed. Implementers MUST re-verify by reading the actual files.

### Colors (from `.interface-design/system.md` + `pipeline.ts`)

| Token | Value | Source |
|-------|-------|--------|
| Background | `#0A0A0A` | `.interface-design/system.md` line 12 |
| Surface | `rgba(13,13,13,0.6)` | Current `pipeline-card.tsx` line 228 |
| Border | `rgba(255,255,255,0.08)` | `.interface-design/system.md` line 132 |
| Border hover | `rgba(255,255,255,0.15)` | Current `pipeline-card.tsx` line 237 |
| Accent | `#6F94B0` | `.interface-design/system.md` line 16 |
| Frosted glass bg | `rgba(10, 10, 10, 0.70)` | `.interface-design/system.md` line 129 |
| Frosted glass blur | `blur(20px) saturate(1.2)` | `.interface-design/system.md` line 130 |
| Stage colors | `OPPORTUNITY_STAGE_COLORS` | `pipeline.ts` lines 197-207 |

### Typography (from `.interface-design/system.md`)

| Role | Classes |
|------|---------|
| Card name | `font-mohave text-body-sm font-medium text-text-primary` |
| Card value | `font-mohave text-body-sm text-text-secondary` |
| Hover metrics | `font-kosugi text-micro-sm text-text-tertiary` |
| Stack header | `font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest` |
| Context menu item | `font-mohave text-body-sm text-text-primary` |

### Motion (from `motion.ts`)

| Token | Value |
|-------|-------|
| `EASE_SMOOTH` | `[0.22, 1, 0.36, 1]` |
| Drag shadow | `0 12px 40px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)` |
| Drag scale | `1.03` |
| Card displacement | `transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)` |

### Dimensions

| Token | Value |
|-------|-------|
| Card width | `200px` |
| Card height (collapsed) | `44px` |
| Card pill height (bird's eye) | `8px` |
| Stack gap | `6px` |
| Stack horizontal gap | `40px` |
| Stack header height | `52px` |
| Canvas padding | `200px` |
| Terminal columns | `3` |
| Archive tray width | `280px` |
| Context menu width | `180px` (card/canvas), `220px` (selection) |

### Z-Index (from OPS-Web CLAUDE.md z-index scale)

| Layer | z-index | Usage |
|-------|---------|-------|
| Cards | `0` | Normal flow |
| Expanded card | `20` | Above siblings |
| Marquee rectangle | `50` | Above cards |
| Floating toolbar | `100` | Interactive layer |
| Metrics bar | `100` | Interactive layer |
| Archive tray | `500` | Nav layer |
| Context menu | `1000` | Dropdown layer |
| Drag overlay | `1000` | Dropdown layer |
| Dialogs | `3000` | Modal layer |

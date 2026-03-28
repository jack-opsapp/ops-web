# Pipeline Spatial Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** DO NOT GUESS ANYTHING. Before writing ANY code, you MUST read every file listed in the "Prerequisite reads" section. Verify every import, every type, every function signature, every color value, every class name by reading the actual source file. If something doesn't exist where the spec says it should, STOP and report it.

**Goal:** Replace the kanban-column pipeline board with a 2D spatial canvas where deal cards live in stage-grouped stacks on a pannable, zoomable surface with drag-to-drop stage changes, marquee multi-select, inline card expansion, context menus, and an archive tray.

**Architecture:** DOM-based 2D canvas with CSS transforms for pan/zoom. Zustand store for canvas state. dnd-kit for drag & drop (same library as current kanban). Framer Motion for all animations with reduced-motion fallbacks. Cards are native DOM elements for crisp text. Layout engine is pure TypeScript, decoupled from rendering.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Zustand, dnd-kit, Framer Motion, Lucide React icons

**Spec:** `docs/superpowers/specs/2026-03-26-pipeline-spatial-canvas-design.md`

---

## Task Dependency Graph

```
Group A (parallel, no deps):     Task 1, 3, 20, 21
Group B (depends on A):          Task 2, 4, 8
Group C (depends on B):          Task 4b, 5, 14
Group D (depends on C):          Task 6, 7, 9
Group E (depends on D):          Task 10, 11
Group F (depends on E):          Task 12
Group G (parallel, depends on A): Task 13, 15, 16
Group H (depends on all):        Task 17, 18, 19
```

Within each group, tasks can run as parallel agents. Between groups, wait for all tasks in the previous group to complete.

---

## Group A — Foundation (4 parallel agents)

---

### Task 1: Canvas Zustand Store

**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/spatial-canvas-store.ts`

**Prerequisite reads:**
- `src/stores/intel-store.ts` — Zustand pattern: `import { create } from "zustand"`, interface defines state + actions, `create<Type>()((set, get) => ({...}))`
- `src/lib/types/pipeline.ts` — `OpportunityStage` enum (line ~29)

- [ ] **Step 1: Create the store file with all types and constants**

Read `src/stores/intel-store.ts` to confirm the exact Zustand import pattern. Then create:

```typescript
// src/app/(dashboard)/pipeline/_components/spatial-canvas-store.ts
"use client";

import { create } from "zustand";

// ── Constants ──
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 1.5;
export const DEFAULT_ZOOM = 0.8;
export const ZOOM_STEP = 0.1;
export const BIRD_EYE_THRESHOLD = 0.5;

// ── Layout constants ──
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 44;
export const CARD_PILL_HEIGHT = 8;
export const STACK_GAP = 6;
export const STACK_HORIZONTAL_GAP = 40;
export const STACK_HEADER_HEIGHT = 52;
export const CANVAS_PADDING = 200;
export const TERMINAL_COLS = 3;
export const TERMINAL_GAP = 80;

// ── Types ──
export interface CardPosition {
  x: number;
  y: number;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  type: "canvas" | "card" | "selection";
  targetCardId: string | null;
}

interface SpatialCanvasState {
  // Viewport
  viewportX: number;
  viewportY: number;
  zoom: number;

  // Canvas dimensions
  canvasWidth: number;
  canvasHeight: number;

  // Sort
  sortBy: "value" | "name" | "date" | "days_in_stage";

  // Selection
  selectedCardIds: Set<string>;
  expandedCardIds: Set<string>;
  hoveredCardId: string | null;

  // Drag state
  isDragging: boolean;
  dragCardIds: string[];
  dragOrigin: CardPosition | null;

  // Marquee
  isMarqueeActive: boolean;
  marqueeStart: CardPosition | null;
  marqueeEnd: CardPosition | null;

  // Context menu
  contextMenu: ContextMenuState | null;

  // Archive tray
  isArchiveTrayOpen: boolean;

  // Actions
  setViewport: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (delta: number, centerX: number, centerY: number) => void;
  setCanvasDimensions: (width: number, height: number) => void;
  setSortBy: (sort: SpatialCanvasState["sortBy"]) => void;
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
  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;
  toggleArchiveTray: () => void;
  fitAll: (viewportWidth: number, viewportHeight: number) => void;
  resetLayout: () => void;
}

export const useSpatialCanvasStore = create<SpatialCanvasState>()((set, get) => ({
  // Initial state
  viewportX: 0,
  viewportY: 0,
  zoom: DEFAULT_ZOOM,
  canvasWidth: 1600,
  canvasHeight: 900,
  sortBy: "value",
  selectedCardIds: new Set(),
  expandedCardIds: new Set(),
  hoveredCardId: null,
  isDragging: false,
  dragCardIds: [],
  dragOrigin: null,
  isMarqueeActive: false,
  marqueeStart: null,
  marqueeEnd: null,
  contextMenu: null,
  isArchiveTrayOpen: false,

  // Actions
  setViewport: (x, y) => set({ viewportX: x, viewportY: y }),

  setZoom: (zoom) =>
    set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),

  zoomBy: (delta, centerX, centerY) => {
    const state = get();
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + delta));
    if (newZoom === state.zoom) return;
    // Zoom toward cursor position
    const scale = newZoom / state.zoom;
    const newViewportX = centerX - (centerX - state.viewportX) * scale;
    const newViewportY = centerY - (centerY - state.viewportY) * scale;
    set({ zoom: newZoom, viewportX: newViewportX, viewportY: newViewportY });
  },

  setCanvasDimensions: (width, height) =>
    set({ canvasWidth: width, canvasHeight: height }),

  setSortBy: (sortBy) => set({ sortBy }),

  toggleCardExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedCardIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedCardIds: next };
    }),

  setHoveredCard: (id) => set({ hoveredCardId: id }),

  selectCard: (id) =>
    set({ selectedCardIds: new Set([id]) }),

  deselectCard: (id) =>
    set((state) => {
      const next = new Set(state.selectedCardIds);
      next.delete(id);
      return { selectedCardIds: next };
    }),

  clearSelection: () => set({ selectedCardIds: new Set() }),

  selectCards: (ids) => set({ selectedCardIds: new Set(ids) }),

  toggleCardSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedCardIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedCardIds: next };
    }),

  startDrag: (cardIds, origin) =>
    set({ isDragging: true, dragCardIds: cardIds, dragOrigin: origin }),

  endDrag: () =>
    set({ isDragging: false, dragCardIds: [], dragOrigin: null }),

  startMarquee: (start) =>
    set({ isMarqueeActive: true, marqueeStart: start, marqueeEnd: start }),

  updateMarquee: (end) => set({ marqueeEnd: end }),

  endMarquee: () =>
    set({ isMarqueeActive: false, marqueeStart: null, marqueeEnd: null }),

  showContextMenu: (menu) => set({ contextMenu: menu }),

  hideContextMenu: () => set({ contextMenu: null }),

  toggleArchiveTray: () =>
    set((state) => ({ isArchiveTrayOpen: !state.isArchiveTrayOpen })),

  fitAll: (viewportWidth, viewportHeight) => {
    const state = get();
    const scaleX = viewportWidth / state.canvasWidth;
    const scaleY = viewportHeight / state.canvasHeight;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(scaleX, scaleY) * 0.9));
    // Center the canvas in the viewport
    const scaledWidth = state.canvasWidth * zoom;
    const scaledHeight = state.canvasHeight * zoom;
    const viewportX = (viewportWidth - scaledWidth) / 2;
    const viewportY = (viewportHeight - scaledHeight) / 2;
    set({ zoom, viewportX, viewportY });
  },

  resetLayout: () => set({ sortBy: "value" }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/pipeline/_components/spatial-canvas-store.ts
git commit -m "feat(pipeline): add spatial canvas Zustand store with viewport, selection, drag, marquee, and context menu state"
```

---

### Task 3: Canvas Background Layer

This is a simple SVG component. It will be inlined into `spatial-canvas.tsx` in Task 2, but we define the pattern here.

**Files:**
- This task produces a code snippet used in Task 2. No standalone file.

- [ ] **Step 1: Document the background pattern**

The background is an SVG dot grid rendered as the first child of the canvas content layer. The exact code:

```tsx
<svg
  className="absolute inset-0 w-full h-full pointer-events-none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <pattern id="spatial-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="12" cy="12" r="0.7" fill="rgba(255,255,255,0.06)" />
  </pattern>
  <rect width="100%" height="100%" fill="url(#spatial-grid)" />
</svg>
```

This will be placed inside the inner canvas div in Task 2. No commit needed — this is consumed by Task 2.

---

### Task 20: Motion Variants & Reduced Motion

**Files:**
- Modify: `src/lib/utils/motion.ts`

**Prerequisite reads:**
- `src/lib/utils/motion.ts` — read the FULL file. Confirm the import `import type { Variants, Easing } from "framer-motion"` and the `EASE_SMOOTH` constant.

- [ ] **Step 1: Read motion.ts and confirm patterns**

Run: Read `src/lib/utils/motion.ts` in full. Confirm:
- `EASE_SMOOTH` is exported as `[0.22, 1, 0.36, 1]`
- `Variants` type is imported from `framer-motion`
- Naming convention: `camelCaseVariants` + `camelCaseVariantsReduced`

- [ ] **Step 2: Append spatial canvas animation variants**

Add the following at the end of `motion.ts`:

```typescript
// ── Spatial canvas animations ──

/** Card hover metrics — float in below card */
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

- [ ] **Step 3: Commit**

```bash
git add src/lib/utils/motion.ts
git commit -m "feat(pipeline): add spatial canvas motion variants with reduced-motion fallbacks"
```

---

### Task 21: i18n Dictionary Updates

**Files:**
- Modify: `src/i18n/dictionaries/en/pipeline.json`
- Modify: `src/i18n/dictionaries/es/pipeline.json`

**Prerequisite reads:**
- `src/i18n/dictionaries/en/pipeline.json` — read the FULL file. Confirm the flat key structure (e.g., `"card.daysInStage"`, not nested objects).
- `src/i18n/dictionaries/es/pipeline.json` — read the FULL file to understand Spanish translation patterns.

- [ ] **Step 1: Read both dictionary files to confirm key structure**

Confirm the structure is flat dot-notation keys like `"card.daysInStage": "{count}d in stage"`, NOT nested JSON objects like `{ "card": { "daysInStage": "..." } }`.

- [ ] **Step 2: Add English spatial canvas keys**

Add the following keys to `en/pipeline.json` (maintaining the flat key structure if that's what the file uses, or nesting if it nests — match exactly):

```json
"spatial.fitAll": "Fit all",
"spatial.newLead": "New lead",
"spatial.archivedDeals": "Archived deals",
"spatial.noArchivedDeals": "No archived deals",
"spatial.discardConfirm": "Discard {name}?",
"spatial.discardBatchConfirm": "Discard {count} deals?",
"spatial.confirm": "Confirm",
"spatial.cancel": "Cancel",
"spatial.noCorrespondence": "no correspondence",
"spatial.emailTimeAgo": "email {timeAgo}",
"spatial.overdueCount": "overdue {count}d",
"spatial.followUpToday": "follow-up today",
"spatial.followUpDate": "follow-up {date}",
"spatial.daysInStage": "{count}d in {stage}",

"contextMenu.edit": "Edit",
"contextMenu.archive": "Archive",
"contextMenu.delete": "Delete",
"contextMenu.deleteConfirm": "Delete permanently?",
"contextMenu.moveToStage": "Move to stage",
"contextMenu.assignTo": "Assign to",
"contextMenu.markWon": "Mark won",
"contextMenu.markLost": "Mark lost",
"contextMenu.sortByValue": "Sort by: Value",
"contextMenu.sortByName": "Sort by: Name",
"contextMenu.sortByDate": "Sort by: Date added",
"contextMenu.sortByDays": "Sort by: Days in stage",
"contextMenu.organizeByStage": "Organize by stage",
"contextMenu.selectAll": "Select all",
"contextMenu.restoreTo": "Restore to...",
"contextMenu.deletePermanently": "Delete permanently",

"archiveTray.title": "ARCHIVED",
"archiveTray.restore": "Restore",
"archiveTray.empty": "No archived deals"
```

- [ ] **Step 3: Add Spanish translations**

Add matching keys to `es/pipeline.json` with Spanish translations.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/dictionaries/en/pipeline.json src/i18n/dictionaries/es/pipeline.json
git commit -m "feat(pipeline): add i18n keys for spatial canvas, context menus, and archive tray"
```

---

## Groups B through H

**IMPORTANT:** The remaining tasks (2, 4, 4b, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19) follow the exact same patterns established in Group A. Each task in the spec at `docs/superpowers/specs/2026-03-26-pipeline-spatial-canvas-design.md` contains:

1. The exact file to create/modify
2. MANDATORY prerequisite reads
3. Full TypeScript interfaces and props
4. Complete rendering specifications with exact CSS classes, colors, and dimensions
5. Animation specs referencing motion.ts variants
6. Edge cases and interaction details

**For each remaining task, the implementing agent MUST:**

1. Read ALL prerequisite files listed in the spec task section
2. Verify every import path, type name, and function signature exists
3. Write the component exactly as specified
4. Include `"use client"` directive on every component that uses hooks/handlers
5. Follow the Zustand store pattern from Task 1
6. Use motion variants from Task 20
7. Use i18n keys from Task 21
8. Include reduced-motion fallbacks for all animations
9. Commit after completing each task

**The spec IS the plan for these tasks.** Each spec task section contains production-ready detail. Agents should execute the spec sections directly, reading the prerequisite files first.

### Execution Sequence

**Group B** (after Group A completes):
- Agent B1 → Task 2: `spatial-canvas.tsx` (pan/zoom engine + background)
- Agent B2 → Task 4: `spatial-layout-engine.ts` (pure TS layout calculator)
- Agent B3 → Task 8: `spatial-staleness.ts` (opacity calculator)

**Group C** (after Group B completes):
- Agent C1 → Task 4b: `spatial-stage-stack.tsx` (stage stack with header + glow)
- Agent C2 → Task 5: `spatial-card.tsx` (collapsed card state)
- Agent C3 → Task 14: `spatial-terminal-region.tsx` (Won/Lost regions)

**Group D** (after Group C completes):
- Agent D1 → Task 6: `spatial-card-hover-metrics.tsx` (floating metrics)
- Agent D2 → Task 7: `spatial-card-expanded.tsx` (inline expansion)
- Agent D3 → Task 9: `spatial-drag-overlay.tsx` (single card drag)

**Group E** (after Group D completes):
- Agent E1 → Task 10: Proximity glow + card displacement (modify `spatial-stage-stack.tsx` + `spatial-drag-overlay.tsx`)
- Agent E2 → Task 11: `spatial-marquee-select.tsx` (marquee selection)

**Group F** (after Group E completes):
- Agent F1 → Task 12: Batch drag & drop (modify `spatial-card.tsx` + `spatial-drag-overlay.tsx`)

**Group G** (can run in parallel with B-F, depends only on Group A):
- Agent G1 → Task 13: `spatial-context-menu.tsx` (context menus)
- Agent G2 → Task 15: `spatial-floating-toolbar.tsx` (floating toolbar)
- Agent G3 → Task 16: `spatial-archive-tray.tsx` (archive tray)

**Group H** (after ALL groups complete):
- Agent H1 → Task 17: Modify `pipeline-metrics-bar.tsx` wrapper in page.tsx (floating container)
- Agent H2 → Task 18: Modify `page.tsx` (orchestration — replaces kanban with spatial canvas)
- Agent H3 → Task 19: Verify mobile fallback still works (read-only verification, no changes needed)

### Commit Convention

Every task ends with a commit:
```bash
git commit -m "feat(pipeline): <task description>"
```

### Verification After Group H

After all tasks complete, run the dev server and verify:
```bash
cd OPS-Web && npm run dev
```

Then navigate to `/pipeline` and verify:
1. Canvas renders with dot grid background
2. Stage stacks display with headers showing count + value
3. Cards show name + value (or `$--`)
4. Card opacity fades with staleness
5. Hover shows floating metrics below card
6. Click expands card inline
7. Multiple cards can be expanded
8. Drag a card → stage stacks glow on proximity → cards displace → drop changes stage
9. Drag to empty space → "Discard?" prompt
10. Marquee select → multi-select glow in stage colors
11. Batch drag → all selected move
12. Right-click card → Edit/Archive/Delete menu
13. Right-click canvas → Sort/Organize/Select All menu
14. Right-click selection → Move to Stage/Assign/Archive/Won/Lost menu
15. Won/Lost regions on far right with 2D grid layout
16. Floating toolbar with Fit All / New Lead / Archive toggle
17. Archive tray slides in from right with archived deals
18. Metrics bar floats on top of canvas
19. Bird's eye zoom shows pills only (no text)
20. Mobile (< 900px) shows existing PipelineMobile unchanged

# Dashboard Map Background Design

**Date:** 2026-03-02
**Status:** Approved
**Approach:** Map layer behind widget grid (Approach A)

---

## Overview

Add a Leaflet map as a fixed-position background layer behind the existing widget dashboard. The map shows project locations, today's tasks, crew locations, and custom events. Widgets float over the map with frosted-glass card styling. A collapsible icon-rail sidebar on the right edge provides filter controls.

## Layout Architecture

Map is a fixed-position layer inside `dashboard-layout.tsx`, behind the scrollable content area.

```
+------------+---------------------------------------+
|            |  TopBar                               |
|            +---------------------------------------+
|  Sidebar   |  ContentHeader (greeting)             |
|            +---------------------------------------+
|            |  +-- MAP (fixed, fills area) -------+ |
|            |  |                                   | |
|            |  |   [widget] [widget] [widget]      | |
|            |  |   [widget] [widget]               | |
|            |  |        (scrollable over map)       | |
|            |  |                                   | |
|            |  +-------------------------------[FR]+ |
+------------+---------------------------------------+
                                              FR = filter rail
```

**Key changes:**
- Dashboard content area gets `bg-transparent`
- Widget cards keep `bg-background-card` with `backdrop-blur` (frosted glass)
- Map: `position: fixed`, `z-index: 0`; content: `z-index: 1`
- Vignette gradient overlay on map edges — `radial-gradient(ellipse, transparent 50%, rgba(0,0,0,0.6) 100%)`
- Top gradient fade under TopBar for text readability
- Map scope: `/dashboard` route only

## Map Background Component

**Component:** `DashboardMapBackground`

- Leaflet with CartoDB dark tiles (same as existing `project-map.tsx`)
- Initializes centered on user's projects (fit-bounds) or US center fallback
- Zoom controls: bottom-right, styled dark
- No attribution clutter (minimal)

## Pin Types

### Project Pins
- Teardrop shape with `PROJECT_STATUS_COLORS`
- White center dot
- Glow shadow at ~30% opacity matching status color
- Click popup: frosted-glass card (title, address, status badge)

### Task Pins (Today filter)
- Smaller circle with task-type color ring
- Task name label below (Kosugi, uppercase, 10px)
- Visually distinct from project pins

### Crew Pins
- Circular avatar with status ring:
  - Green (#A5B368) = on-site (within 100m of job)
  - Amber (#C4A868) = en-route (moving)
  - Gray (#8E8E93) = idle (no update > 5 min)
- Initials fallback, first name label below (Kosugi, uppercase)

### Event Pins
- Diamond shape, accent color (#597794)
- Calendar icon center
- Event title label

## Filter Sidebar (Icon Rail)

Thin vertical icon rail on right edge of content area, inside the map layer.

### Collapsed (default): 44px wide
- 5 stacked icon buttons (44x44 each)
- Icons: CalendarClock (Today), FolderKanban (Active), Layers (All), Users (Crew), CalendarDays (Events)
- Active filter: accent color background pill
- Frosted glass rail: `rgba(10,10,10,0.7)` + `backdrop-blur(20px)` + `1px border rgba(255,255,255,0.08)`
- Chevron toggle at top to expand

### Expanded: ~180px wide
- Icons + text labels (Kosugi, uppercase, 11px)
- View group (radio): Today's Tasks | Active Projects | All Projects
- Layer group (toggles): Crew Locations | Events
- Framer Motion layout animation, 200ms ease-out

## Animations

### Pin load
- Stagger: `scale(0->1)` + `opacity(0->1)`, 300ms each, 50ms delay
- Spring: stiffness 300, damping 20

### Filter switch
- Out: `scale(1->0.8)` + `opacity(1->0)`, 150ms
- In: stagger same as load
- Map refits bounds: 800ms ease-in-out

### Crew movement
- Position transition: 1s ease-in-out CSS
- Status ring color: 300ms transition

### Pin hover
- Scale to 1.15x, glow intensifies
- Tooltip fades in (frosted glass card)

### Filter rail
- Expand/collapse: Framer Motion `layout`, 200ms ease-out
- Labels: `AnimatePresence` fade + slide
- Active pill: spring (stiffness 400, damping 25)

## Interaction Model

- Widgets capture pointer events naturally (DOM stacking)
- Map interactive in gaps between widgets (pan, zoom, click pins)
- During widget customize mode: map gets `pointer-events: none`

## Data Flow

### Sources (existing hooks)
- `useProjects()` — project pins with lat/lng
- `useTasks()` — today's tasks with event locations
- `useTeamMembers()` — crew list (extend with location)
- `useCalendarEventsForRange()` — events with locations

### Permission scoping
- Uses existing `usePermissionStore()`
- Filters: `projects.view`, `team.view`, `calendar.view`
- Data already permission-filtered by API

### Filter state
- New Zustand store: `useMapFilterStore` (persisted to localStorage)
- Shape: `{ view: 'today' | 'active' | 'all', showCrew: boolean, showEvents: boolean }`

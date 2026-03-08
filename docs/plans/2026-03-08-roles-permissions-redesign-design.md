# Roles & Permissions Editor Redesign

**Date**: 2026-03-08
**Status**: Approved

## Problem

The current roles/permissions editor has several UX issues:
- Constrained to 600px width — wastes widescreen space
- 55 individual toggle switches in nested accordions = very tall scroll
- All/Assigned scope toggle is confusing — appears only when a permission is enabled
- Accordion expand/collapse animation is clunky
- No way to bulk-set permissions for a category

## Design

### Role List View
- Remove `max-w-[600px]`, use full settings width (`max-w-[1000px]`)
- Same structure: preset roles (with lock icon) at top, custom roles below
- Wider rows with role name, description, member count, action buttons

### Role Editor — Desktop (>= ~800px content width)

#### Top Bar
- Back button, role name (inline editable), description, Save button
- Full width

#### Main Area — Two Columns

**Left: Permission Palette (~300px fixed)**
- All 19 modules grouped under 5 category headers (Core Ops, Financial, Resources, People & Location, Admin)
- Each module is a clickable/draggable card
- Category headers are also draggable → bulk-add all modules in that category
- Click a module → auto-adds to View Only column
- Drag a module → drop into specific tier column
- Already-added modules: lower opacity + overlay badge showing current tier ("View Only", "Manage", "Full Access")

**Right: Three Tier Columns (flex-1, equal width)**
- `View Only` | `Manage` | `Full Access`
- Module cards can be dragged between columns to change tier
- Each card has a minus/remove button
- Drag a card back to the palette (left) to remove the permission
- Smooth slide/fade CSS transitions

**Tier Definitions:**
- **View Only**: Only `*.view` permissions enabled
- **Manage**: view + create + edit + assign + change_status + send + annotate + upload (non-destructive write actions)
- **Full Access**: All permissions including delete, archive, manage_sections, configure_stages, record_payment, import, manage_templates, manage_branding, etc.

#### Below Main Area — Two Cards Side by Side

**Data Scope Card (left)**
- Lists only modules that have been added AND support scope options (all/assigned/own)
- Each row: module name + segmented picker `All` | `Assigned Only`
- Tooltip explaining what "All" vs "Assigned Only" means
- Only populated for modules currently granted permissions

**Assigned Members Card (right)**
- Same as today: list of members assigned to role
- Add member button → dropdown of unassigned team members
- Remove button per member

### Role Editor — Mobile/Collapsed (< ~800px content width)

When the editor area is narrower than ~800px:
- No palette / tier columns
- Flat list of all modules grouped by category header
- Each module row: module name + segmented picker `None` | `View` | `Manage` | `Full`
- Category headers have a bulk picker that sets all modules within that category
- Data Scope section as a separate card below
- Members card below

### Preset Roles
- Entire editor is read-only (no drag, no pickers, no toggles)
- Visual indication of current permission state
- "Duplicate to Customize" button prominently shown

### Animations
- Cards slide smoothly from palette to tier columns (CSS transform + opacity transition)
- Removed cards fade back into the palette with opacity restoring
- Drag-and-drop uses HTML5 drag API or a lightweight library (dnd-kit if already available, otherwise native)

## Permission-to-Tier Mapping

For each module, the tier is determined by which actions are enabled:

| Module | View Only | Manage | Full Access |
|--------|-----------|--------|-------------|
| Projects | view | view, create, edit, assign_team | + delete, archive |
| Tasks | view | view, create, edit, assign, change_status | + delete |
| Clients | view | view, create, edit | + delete |
| Calendar | view | view, create, edit | + delete |
| Job Board | view | view | + manage_sections |
| Estimates | view | view, create, edit, send | + delete |
| Invoices | view | view, create, edit, send, record_payment | + delete |
| Pipeline | view | view, manage | + configure_stages |
| Products | view | view, manage | (same as manage) |
| Expenses | view | view, create, edit | + approve |
| Accounting | view | view | + manage_connections |
| Inventory | view | view, manage | + import |
| Photos | view | view, upload, annotate | + delete |
| Documents | view | view | + manage_templates |
| Team | view | view, manage | + assign_roles |
| Map | view | view, view_crew_locations | (same as manage) |
| Notifications | view | view, manage_preferences | (same as manage) |
| Settings | — | preferences | + company, billing, integrations |
| Portal | view | view | + manage_branding |
| Reports | view | view | (same as view) |

## Files to Modify
- `src/components/settings/roles-tab.tsx` — complete rewrite of RoleEditor
- `src/lib/types/permissions.ts` — add tier mapping constants
- `src/i18n/dictionaries/en/settings.json` — new labels for tiers, data scope, palette
- `src/i18n/dictionaries/es/settings.json` — Spanish translations

# Roles & Permissions Editor Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the toggle-switch permissions editor with a Kanban-style drag-and-drop tier board (desktop) and segmented-picker fallback (mobile).

**Architecture:** New `PermissionBoard` component with dnd-kit (already installed), tier mapping constants in `permissions.ts`, responsive breakpoint switches between board and picker layouts. The `RoleEditor` is rewritten; `RolesTab` list view gets width unlock. Everything stays in `roles-tab.tsx` except the tier mapping constants.

**Tech Stack:** React, @dnd-kit/core (v6.3, already installed), Zustand, Tailwind CSS, i18n dictionaries

---

### Task 1: Add tier mapping constants to permissions.ts

**Files:**
- Modify: `src/lib/types/permissions.ts`

**Step 1: Add tier type and mapping**

Add at the end of `permissions.ts`:

```typescript
// ─── Permission Tiers ───────────────────────────────────────────────────────

export type PermissionTier = "view" | "manage" | "full";

export const TIER_LABELS: Record<PermissionTier, string> = {
  view: "View Only",
  manage: "Manage",
  full: "Full Access",
};

/**
 * For each module, defines which actions belong to each tier.
 * "view" = only view-level actions
 * "manage" = view + non-destructive write actions
 * "full" = all actions
 */
export function getActionsForTier(
  module: PermissionModule,
  tier: PermissionTier
): string[] {
  const viewActions = module.actions
    .filter((a) => a.id.endsWith(".view"))
    .map((a) => a.id);

  const destructiveKeywords = ["delete", "archive", "approve", "import", "assign_roles", "manage_connections", "manage_templates", "manage_branding", "configure_stages", "manage_sections", "company", "billing", "integrations"];

  const manageActions = module.actions
    .filter(
      (a) =>
        !destructiveKeywords.some((kw) => a.id.endsWith(`.${kw}`))
    )
    .map((a) => a.id);

  const fullActions = module.actions.map((a) => a.id);

  switch (tier) {
    case "view":
      return viewActions;
    case "manage":
      return manageActions;
    case "full":
      return fullActions;
  }
}

/**
 * Determine the current tier for a module based on which permissions are enabled.
 * Returns null if no permissions are enabled for this module.
 */
export function detectModuleTier(
  module: PermissionModule,
  enabledPermissions: Set<string>
): PermissionTier | null {
  const modulePerms = module.actions.map((a) => a.id);
  const enabled = modulePerms.filter((p) => enabledPermissions.has(p));

  if (enabled.length === 0) return null;

  const fullActions = getActionsForTier(module, "full");
  if (fullActions.every((a) => enabled.includes(a))) return "full";

  const manageActions = getActionsForTier(module, "manage");
  if (manageActions.every((a) => enabled.includes(a))) return "manage";

  // If some permissions are on but don't match manage, still show as view
  return "view";
}

/** Get all modules that have scope options (more than just "all") */
export function getModulesWithScopes(): { moduleId: string; label: string; actions: PermissionAction[] }[] {
  const result: { moduleId: string; label: string; actions: PermissionAction[] }[] = [];
  for (const cat of PERMISSION_CATEGORIES) {
    for (const mod of cat.modules) {
      const scopeActions = mod.actions.filter((a) => a.scopes.length > 1);
      if (scopeActions.length > 0) {
        result.push({ moduleId: mod.id, label: mod.label, actions: scopeActions });
      }
    }
  }
  return result;
}
```

**Step 2: Commit**

```bash
git add src/lib/types/permissions.ts
git commit -m "feat: add permission tier mapping constants"
```

---

### Task 2: Add i18n labels for the new UI

**Files:**
- Modify: `src/i18n/dictionaries/en/settings.json` — add keys under `roles`
- Modify: `src/i18n/dictionaries/es/settings.json` — add Spanish translations

**Step 1: Add new keys to EN dictionary**

Add under the existing `roles` object:

```json
"palette": "Permission Palette",
"paletteHint": "Click or drag modules to grant permissions",
"tierViewOnly": "View Only",
"tierManage": "Manage",
"tierFullAccess": "Full Access",
"tierNone": "None",
"dataScope": "Data Scope",
"dataScopeHint": "Control whether this role can access all records or only those assigned to them",
"scopeAll": "All",
"scopeAssignedOnly": "Assigned Only",
"scopeOwn": "Own Only",
"dragToRemove": "Drag here to remove",
"bulkAddCategory": "Add all",
"removePermission": "Remove",
"noPermissionsGranted": "No permissions granted yet. Click or drag modules from the palette to add them.",
"noScopePermissions": "Grant permissions above to configure data scope.",
"tierTooltipView": "Can view records but not modify them",
"tierTooltipManage": "Can view, create, and edit records",
"tierTooltipFull": "Full control including delete and advanced actions"
```

**Step 2: Add matching keys to ES dictionary**

```json
"palette": "Paleta de Permisos",
"paletteHint": "Haz clic o arrastra módulos para otorgar permisos",
"tierViewOnly": "Solo Ver",
"tierManage": "Gestionar",
"tierFullAccess": "Acceso Total",
"tierNone": "Ninguno",
"dataScope": "Alcance de Datos",
"dataScopeHint": "Controla si este rol puede acceder a todos los registros o solo a los asignados",
"scopeAll": "Todos",
"scopeAssignedOnly": "Solo Asignados",
"scopeOwn": "Solo Propios",
"dragToRemove": "Arrastra aquí para eliminar",
"bulkAddCategory": "Agregar todos",
"removePermission": "Eliminar",
"noPermissionsGranted": "No se han otorgado permisos aún. Haz clic o arrastra módulos de la paleta.",
"noScopePermissions": "Otorga permisos arriba para configurar el alcance.",
"tierTooltipView": "Puede ver registros pero no modificarlos",
"tierTooltipManage": "Puede ver, crear y editar registros",
"tierTooltipFull": "Control total incluyendo eliminar y acciones avanzadas"
```

**Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/settings.json src/i18n/dictionaries/es/settings.json
git commit -m "feat: add i18n labels for permission tiers and data scope"
```

---

### Task 3: Build the Permission Palette component

**Files:**
- Modify: `src/components/settings/roles-tab.tsx` — replace `ModuleAccordion` and `PermissionRow` with new components

**Step 1: Create the PermissionPaletteCard sub-component**

A draggable card representing a single module in the palette. Shows module name, and when already granted shows lower opacity + tier badge overlay.

```typescript
// Uses useDraggable from @dnd-kit/core
// id format: "palette-{moduleId}"
// data: { type: "palette-card", moduleId, categoryId }
// Visual: module label, dimmed if granted, badge overlay showing tier
```

**Step 2: Create the PermissionPalette component**

Left-side panel containing all modules grouped by category. Category headers are also draggable (for bulk-add). Each module card is a `PermissionPaletteCard`. Click handler auto-adds to "view" tier.

```typescript
// Props: grantedModules (Map<moduleId, tier>), onClickAdd(moduleId), disabled
// Groups modules under category headers from PERMISSION_CATEGORIES
// Category header: label + "Add all" button/drag handle
// ~300px fixed width, scrollable if needed
```

**Step 3: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: add permission palette component with draggable cards"
```

---

### Task 4: Build the Tier Columns component

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`

**Step 1: Create the TierColumn component**

A droppable column representing one tier (View Only / Manage / Full Access). Uses `useDroppable` from dnd-kit. Shows column header with tier name + tooltip, and contains module cards.

```typescript
// id: "tier-view" | "tier-manage" | "tier-full"
// Droppable zone via useDroppable
// Accepts drops from palette cards and other tier columns
// Visual: header label, hover highlight when drag-over, module cards stacked vertically
```

**Step 2: Create the TierModuleCard component**

A draggable card inside a tier column. Shows module name + remove button (minus icon). Can be dragged to another column or back to palette.

```typescript
// Uses useDraggable from @dnd-kit/core
// id format: "tier-{moduleId}"
// data: { type: "tier-card", moduleId, currentTier }
// Visual: module label, X/minus remove button, drag handle
```

**Step 3: Create the TierBoard container**

Wraps the three TierColumns in a flex row. Includes a "drag here to remove" drop zone at bottom/left for removing permissions.

```typescript
// Props: grantedModules (Map<moduleId, tier>), disabled
// Layout: flex gap-2, three equal columns
// Contains a remove drop zone (id: "palette-drop")
```

**Step 4: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: add tier columns with droppable zones and module cards"
```

---

### Task 5: Wire up DndContext and drag handlers

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`

**Step 1: Add DndContext to the RoleEditor**

Wrap the palette + tier board in a `DndContext` with `closestCorners` collision detection and `PointerSensor` (activation distance: 8px, matching pipeline board pattern).

Handle events:
- `onDragStart`: track active dragged item for DragOverlay
- `onDragEnd`: determine source and destination, update grantedModules state
  - palette → tier column: add module at that tier
  - tier column → different tier column: change module's tier
  - tier column → palette drop zone: remove module
  - category drag → tier column: bulk-add all modules in category

**Step 2: Add DragOverlay**

Shows a ghost card of the dragged module during drag. Same pattern as `pipeline-board.tsx`.

**Step 3: Connect to permission edits state**

The `grantedModules` map (moduleId → tier) is derived from and writes back to the existing `permissionEdits` Map. When a module is added to a tier:
1. Call `getActionsForTier(module, tier)` to get the action IDs
2. Enable those actions in `permissionEdits`, disable others for that module
3. Set scope to "all" by default for actions with multiple scopes

When a module is removed:
1. Disable all actions for that module in `permissionEdits`

**Step 4: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: wire DndContext with drag handlers for permission board"
```

---

### Task 6: Build the mobile/collapsed segmented picker fallback

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`

**Step 1: Create MobilePermissionEditor component**

Shown when content area < 800px (use a `useMediaQuery` hook or container query). Flat list of modules grouped by category. Each module row has a segmented picker: None | View | Manage | Full. Category headers have a bulk picker.

```typescript
// Uses the same permissionEdits state as the desktop board
// Segmented picker sets the tier, which maps to enabled actions via getActionsForTier
// Category bulk picker: sets all modules in category to the selected tier
```

**Step 2: Add responsive switching**

In the RoleEditor, check viewport width. Render either the DnD board (palette + tiers) or the mobile picker. Use `useState` + `useEffect` with `window.innerWidth` check or a `useMediaQuery` custom hook if one exists.

**Step 3: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: add mobile segmented picker fallback for permissions"
```

---

### Task 7: Build the Data Scope section

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`

**Step 1: Create DataScopeCard component**

Shows only modules that (a) have been granted permissions AND (b) have actions with multiple scopes. Each row: module name + segmented picker `All` | `Assigned Only` (or `Own Only` for calendar/expenses).

Uses `getModulesWithScopes()` from permissions.ts, filtered by currently granted modules. Changing scope updates `permissionEdits` for all scope-eligible actions in that module.

Add a tooltip (?) icon explaining what scope means.

**Step 2: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: add data scope card with scope selectors"
```

---

### Task 8: Rewrite the RoleEditor layout

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`

**Step 1: Replace the existing RoleEditor render**

Remove the old single-column layout (name card → permissions card with accordions → members card). Replace with:

```
Top bar: Back | Role Name (inline) | Description | Save

Desktop (>= 800px):
┌──────────────┬──────────────────────────────────┐
│   Palette    │  View Only │ Manage │ Full Access │
│   (~300px)   │         (flex-1, 3 cols)          │
│              │                                    │
└──────────────┴──────────────────────────────────┘
┌─────────────────────┬────────────────────────────┐
│   Data Scope        │   Assigned Members          │
└─────────────────────┴────────────────────────────┘

Mobile (< 800px):
┌──────────────────────────────────────────────────┐
│   Segmented Picker List (by category)             │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│   Data Scope                                      │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│   Assigned Members                                │
└──────────────────────────────────────────────────┘
```

For preset roles: everything is read-only. Palette cards are not clickable/draggable. Pickers are disabled. Prominent "Duplicate to Customize" button.

**Step 2: Remove old components**

Delete `PermissionRow`, `ScopeSelector`, `ModuleAccordion` — they're fully replaced.

**Step 3: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: rewrite role editor with kanban tier layout"
```

---

### Task 9: Update the Role List view width

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`

**Step 1: Remove max-w-[600px] from list view**

Change the list view wrapper from `max-w-[600px]` to no max-width (inherits the settings page's `max-w-[1000px]`).

Also remove `max-w-[600px]` from the editor view wrapper.

**Step 2: Commit**

```bash
git add src/components/settings/roles-tab.tsx
git commit -m "feat: widen roles tab to use full settings width"
```

---

### Task 10: Polish animations and transitions

**Files:**
- Modify: `src/components/settings/roles-tab.tsx`
- Possibly modify: `tailwind.config.ts` (if new keyframes needed)

**Step 1: Add smooth card transitions**

- Cards sliding from palette to tier columns: CSS `transition-all duration-200`
- Opacity changes on palette cards when granted: `transition-opacity duration-200`
- Tier column highlight on drag-over: subtle background color shift
- DragOverlay card: slight scale + shadow (matching pipeline board style)

**Step 2: Ensure tier badge overlay on palette cards animates in**

When a module is added from the palette, the badge overlay ("View Only", "Manage", etc.) fades in with the opacity reduction.

**Step 3: Commit**

```bash
git add src/components/settings/roles-tab.tsx tailwind.config.ts
git commit -m "feat: polish drag animations and tier badge transitions"
```

---

### Task 11: Build and verify

**Step 1: Run build**

```bash
cd /Users/jacksonsweet/Desktop/OPS\ LTD./OPS-Web && npx next build --no-lint
```

Expected: Build succeeds with no type errors.

**Step 2: Visual verification**

Open the app, navigate to Settings → Company → Roles, click into a role, verify:
- Desktop: Palette on left, three tier columns on right
- Click a palette card → appears in View Only column
- Drag between columns works
- Drag back to palette removes
- Category bulk-add works
- Data Scope shows modules with scope options
- Resize window below 800px → switches to segmented pickers
- Preset roles are read-only with Duplicate button

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: roles permissions editor redesign — kanban tier board"
```

# OPS Web — Project-Specific Instructions

Supplements the root `OPS LTD./CLAUDE.md`. Read both.

## Tech Stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (Postgres + RLS + Realtime)
- TanStack Query (data fetching, caching, optimistic updates)
- Zustand (client state)
- Framer Motion (animations)
- Lucide React (icons)
- dnd-kit (drag and drop)

## Fonts

**Product UI (allowed everywhere):**
- **Mohave** — headings, body text, UI labels (`font-mohave`)
- **JetBrains Mono** — micro labels, captions, numerical data, timestamps, tactical brackets, `//` prefixes (`font-mono`)

**Heavy uppercase display voice (weight 300 only):**
- **Cake Mono** — loaded from Adobe Typekit (kit `dbh0pet`, family `cake-mono`, weights 300/400/700). OPS-Web uses Cake Mono Light (`font-cakemono font-light`) for every uppercase display treatment: page titles, section headers, buttons, badges, card titles, form labels, wizard steps. Weight is always 300 (Light). Never use Regular (400) or Bold (700) in product UI. Never for body text, sentence-case content, numerical data (`font-mono`), or the tiny 11px uppercase label tier (`font-kosugi`).

**Deprecated (removed 2026-04-17):**
- Bebas Neue — do not reintroduce.
- Kosugi — retired on 2026-04-17; all former usages moved to `font-mono`. Do not reintroduce.

## Design System (spec v2 — 2026-04-17)

- Read and follow `.interface-design/system.md` for every UI decision (canonical source)
- Canvas: pure `#000000`
- Glass surfaces (Command Deck spec): `rgba(18, 18, 20, 0.58)` + `backdrop-blur(28px) saturate(1.3)` + `1px solid rgba(255, 255, 255, 0.09)`. `.glass-dense` variant uses `0.78` alpha for stacked layers (modals / popovers / toasts).
- **Accent `#6F94B0`** (steel blue) — primary CTA and focus ring ONLY. Never on links, toggles, nav, tabs, tags. One element per screen maximum.
- **Text ladder:** `#EDEDED` / `#B5B5B5` / `#8A8A8A` / `#6A6A6A` (text-mute decorative only — `//` slashes, separators)
- **Earth tones (semantic):** `olive #9DB582` / `tan #C4A868` / `rose #B58289` / `brick #93321A` (border-only)
- **Border radius:** `panel: 10` / `modal: 12` / `btn: 5` / `chip: 4` / `bar: 2` / `sidebar: 6`. No 999px pills except avatars.
- **Depth:** borders-only, zero box-shadows on dark backgrounds
- **Primary button:** outlined at rest with `text-ops-accent border-ops-accent` → fills to `bg-ops-accent text-black` on hover
- **Text alignment:** left only, never center
- **Animation easing:** single curve `EASE_SMOOTH` = `cubic-bezier(0.22, 1, 0.36, 1)` / `[0.22, 1, 0.36, 1]` for Framer Motion. No spring/bounce (drag-reorder is the lone exception).
- **Tactical voice:** `//` prefix for panel/section titles, `[brackets]` for instructional micro-text and metadata, `SYS ::` for system state, `// OPERATOR :: NAME` for identity. No emoji. No exclamation points. UPPERCASE for authority, sentence case for content.
- **Numbers always mono** (JetBrains Mono) with `font-feature-settings: "tnum" 1, "zero" 1`. 11px minimum.

## Key Architecture Patterns

### i18n
- Dictionary pattern: `src/i18n/dictionaries/{en,es}/<namespace>.json`
- Access via `useDictionary("<namespace>")`
- All user-facing strings must be in dictionaries, never hardcoded

### State Management
- Server state: TanStack Query hooks in `src/lib/hooks/`
- Client state: Zustand stores in `src/stores/`
- Query keys: centralized in `src/lib/api/query-client.ts`
- Auth: `useAuthStore` in `src/lib/store/auth-store.ts`

### Services
- API services in `src/lib/api/services/`
- Each service exports a const object with async methods
- Services use `requireSupabase()` for client access

### Components
- Dashboard widgets: `src/components/dashboard/widgets/`
- Layout components: `src/components/layouts/`
- Shared UI: `src/components/ui/`
- Feature components: `src/components/ops/`

## Notification Rail

The header contains a notification rail (left side of TopBar). When building features that produce user-facing events, create notifications:

```typescript
import { NotificationService } from "@/lib/api/services/notification-service";

// Standard dismissible notification
await supabase.from("notifications").insert({
  user_id: userId,
  company_id: companyId,
  type: "mention",
  title: "Task completed",
  body: "Roof inspection has been marked complete",
  is_read: false,
  persistent: false,
  action_url: "/projects/abc",
  action_label: "View Project",
});

// Persistent notification (stays until resolved)
await supabase.from("notifications").insert({
  user_id: userId,
  company_id: companyId,
  type: "role_needed",
  title: "Email scan complete",
  body: "12 new leads found from inbox scan",
  is_read: false,
  persistent: true,  // Cannot be dismissed by user
  action_url: "/pipeline",
  action_label: "View Results",
});
```

**When to use persistent:** Long-running operations the user initiated and is waiting on (scans, imports, AI analysis). Resolve by setting `is_read = true` programmatically when the user acts on it.

**When to use standard:** Informational events (task completed, expense approved, new comment). User can dismiss.

## Animation Variants

All notification and widget animations are centralized in `src/lib/utils/motion.ts`. Use existing variants before creating new ones. All must include reduced-motion fallbacks.

## Dashboard Widgets

- All widgets must use `overflow-y-auto scrollbar-hide` for content overflow
- Widget shell: `src/components/dashboard/widget-shell.tsx`
- Widget tray: bottom sheet with detent snapping
- Spacer widget supports all-edge resize with 8 handles
- Map is non-interactive (zoom via toolbar only)

## FAB (Floating Action Button)

- Bottom-right, handles all primary actions (Add Project, New Task, etc.)
- Customizable per user via long-press edit mode
- Page-level action buttons were removed from the header — use FAB instead
- Creation actions (project, client, task, estimate, lead) open floating windows via `handler: "window"` in `fab-actions.ts`
- Navigation actions (expenses, inventory, settings) use `handler: "route"`

## Z-Index Scale

Full reference: `ops-software-bible/05_DESIGN_SYSTEM.md` § 15. Use this scale for all new z-index values.

| Layer | z-index | Purpose |
|-------|---------|---------|
| **base** | 0 | Normal flow |
| **content** | 1–10 | In-page elevation (vignettes, calendar states) |
| **interactive** | 100–200 | Drag/resize/ghost overlays |
| **nav** | 500 | Sidebar |
| **dropdown** | 1000 | Menus, autocomplete |
| **floating-ui** | 1500–1600 | FAB, bug report, action prompts, window dock |
| **window** | 2000+ | Floating windows (dynamic, auto-increments) |
| **modal** | 3000 | Portaled dialogs/sheets (Radix) |
| **map-controls** | 5000 | Full-screen map page only |
| **emergency** | 9000–9999 | Sign-out, lockout overlays |

**Rules:** Decorative overlays must never exceed 10. Gaps between layers are intentional — use them for future additions. Existing components use the old tight scale (sidebar=45, FAB=95, etc.) — migrate to the new scale as you touch them.

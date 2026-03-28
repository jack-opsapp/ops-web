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

- **Mohave** — headings, body text, UI labels (`font-mohave`)
- **Kosugi** — captions, section labels, uppercase metadata (`font-kosugi`)

## Design System

- Read and follow `.interface-design/system.md` for every UI decision
- Frosted glass surfaces: `rgba(10, 10, 10, 0.70)` + `backdrop-blur(20px) saturate(1.2)` + `1px solid rgba(255, 255, 255, 0.08)`
- Accent `#597794` — used sparingly, never as decoration
- Border radius: 2-4px (sharp, not rounded)
- Depth: borders-only, no shadows on dark backgrounds
- Text alignment: left only, never center
- Animation easing: `EASE_SMOOTH` = `[0.22, 1, 0.36, 1]`, no spring/bounce

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

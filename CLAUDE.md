# OPS Web — Project-Specific Instructions

Supplements the root `OPS LTD./CLAUDE.md`. Read both.

## Tech Stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (Postgres + RLS + Realtime)
- TanStack Query (data fetching, caching, optimistic updates)
- Zustand (client state)
- Framer Motion (animations)
- IBM Carbon (`@carbon/icons-react`) (icons)
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

- Read and follow `ops-design-system/project/uploads/system.md` for every UI decision (canonical spec). Agent brief: `ops-design-system/project/README.md`. UI kit: `ops-design-system/project/ui_kits/ops-web/`.
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

### Project Workspace Window

Single mode-aware floating window for all project interactions (`src/components/ops/projects/workspace/`).

- **Modes:** `viewing` (dossier with map + tabs) / `editing` (form tabs) / `creating` (form tabs, no project yet)
- **Open via:** `useWindowStore.openProjectWindow({ projectId, mode, onProjectCreated? })`
- **Mounts inside** `FloatingWindows` in `dashboard-layout.tsx` via `<ProjectWorkspaceContainer windowId={win.id} />`
- **Position + size persist** to `localStorage` keyed by `opsWin:project-{projectId}`
- **Status hex** from `PROJECT_STATUS_COLORS` (`@/lib/types/models`) drives map pin glow, schedule today-tick, active task highlight
- **Map:** Mapbox GL JS via `<ProjectMap>` / `<MapHero>`. Token: `NEXT_PUBLIC_MAPBOX_TOKEN`
- **Activity timeline:** `project_notes` table is iOS-canonical; `event_kind` discriminates user notes (NULL) from system events (`status_change`, `project_created`, `project_archived`, `photo_uploaded`, `payment_received`, etc.). Read via `useProjectActivity`.
- **Notifications:** every project action dispatches via `notification-dispatch.ts` helpers (`dispatchProjectStatusChange`, `dispatchProjectArchived`, `dispatchProjectAssignment`, `dispatchMentionPush`). `actionUrl` follows the deep-link format `/dashboard?openProject={id}&mode=view` (Phase 9.7; prefix was `/` until P14-1 fixed the root-redirect query-param drop).
- **i18n:** all strings via `useDictionary("project-workspace")` — en + es dictionaries at `src/i18n/dictionaries/{en,es}/project-workspace.json`
- **Permissions:** `usePermissionStore.can("projects.{view|edit|create|archive}")` — never filter by role
- **iOS sync constraint:** schema additions are all nullable; iOS app reads `event_kind`/`content_metadata`/`trade` as optional and ignores them until next App Store release

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

## PMF Dashboard (`/admin/pmf`)

The PMF tracking deck is the operator's primary operating surface during the pre-PMF phase (Gate B: Sept 1 2026). Separate tenancy model from the main app — global operator view, not company-scoped.

### Architecture
- **Data flow:** `src/lib/admin/pmf-queries.ts` → `computePmfState()` (uncached) or `getPmfState()` (ISR, 60s TTL) → dashboard page + crons
- **Mutations revalidate** via `revalidateTag('pmf-state')` — call from any admin POST/PATCH/DELETE on PMF data
- **Route-cache TTL constant:** `PMF_STATE_TTL_SECONDS = 60` — pages import this for `export const revalidate`, so cache drift can't happen

### Design system — scoped, not global
- The PMF dashboard applies visual tokens via the `.pmf-scope` wrapper at `src/styles/pmf-tokens.css`
- Do NOT extend pmf tokens globally; they live under the scope exclusively
- Fonts inside `.pmf-scope`: Cake Mono Light (uppercase display), JetBrains Mono (numbers), Mohave (body)
- Accent `#6F94B0` (matches global spec v2 accent — intentional reuse, not divergence)

### Notifications pipeline (Session 3)
- **Sender:** `src/lib/notifications/pmf-send.ts` — `sendPmfNotification({ kind, trigger, smsBody?, emailSubject?, emailReact?, inAppTitle?, inAppBody?, inAppActionUrl?, dedupMs? })`
- **Channels by kind:**
  - `threshold_alert`: SMS + email + in-app (all three)
  - `daily_digest`: email only
  - `weekly_digest`: email only
- **Dedup:** 4-hour window for threshold alerts, 0 (always fire) for digests — keyed by `(kind, trigger)` against `pmf_notification_log` and filtered to successful prior sends only
- **Retry:** exponential backoff 1s / 5s (two real waits, then rejects); `logSend` never throws
- **Email path:** `sendTransactionalEmail` at `src/lib/email/sendgrid.ts` (added by Task 24); templates at `src/emails/pmf/*`
- **In-app path:** inserts into `notifications` table with `type: 'pmf_alert'`, `company_id: PMF_OPERATOR_COMPANY_ID`, `action_label: 'VIEW DECK'`

### Cron schedule (registered in `vercel.json`)
| Path | Schedule (UTC) | Purpose |
|------|----------------|---------|
| `/api/cron/pmf/threshold-check` | `*/15 * * * *` | Detect state transitions + event-driven alerts |
| `/api/cron/pmf/daily-digest` | `0 15 * * *` | 7am PT daily recap email |
| `/api/cron/pmf/weekly-digest` | `0 15 * * 1` | Mon 7am PT weekly recap + cohorts |
| `/api/cron/pmf/cleanup-snapshots` | `30 14 * * *` | Prune snapshots older than 30 days |
| `/api/cron/pmf/google-ads-sync` | `15 14 * * *` | Daily ad spend sync |

### Source of truth rules
- **Billing events / MRR:** `billing_events` table, written by the Stripe webhook at `/api/webhooks/stripe/route.ts` (layered — NOT a separate endpoint). Do not compute MRR from `companies.subscription_status` alone.
- **Retention cohorts:** `pmf_retention_cohorts` RPC (migration `20260422120001_pmf_retention_cohorts_rpc.sql` — must be applied to prod before weekly digest runs)
- **Attribution:** UTM cookies on `try-ops` landing → `/api/admin/pmf/attributions/seed` → `trial_attributions` table
- **Threshold snapshots:** `pmf_threshold_snapshots` — written every 15 min by threshold-check cron, consumed by next run's diff

### Environment variables
| Name | Purpose |
|------|---------|
| `PMF_NOTIFICATION_SMS` | Operator SMS recipient (E.164) |
| `PMF_NOTIFICATION_EMAIL` | Operator email recipient |
| `PMF_OPERATOR_USER_ID` | Supabase auth user id of the operator (for in-app rail routing) |
| `PMF_OPERATOR_COMPANY_ID` | Operator's company_id (in-app `notifications.company_id` NOT NULL) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | SMS transport |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` | Email transport |
| `CRON_SECRET` | Vercel cron auth (Bearer token) |
| `NEXT_PUBLIC_APP_URL` | Dashboard URL base for `VIEW DECK` links |

### Testing
- Unit: `tests/unit/notifications/pmf-send.test.ts` (sender internals), `tests/unit/notifications/pmf-templates.test.ts` (email templates)
- Integration: `tests/integration/pmf-*-cron.test.ts` (cron handlers), `tests/integration/notifications.test.ts` (transport boundary), `tests/integration/pmf-crud-routes.test.ts`, `tests/integration/pmf-attributions-seed.test.ts`, `tests/integration/stripe-webhook-billing-events.test.ts`
- E2E: `tests/e2e/pmf-*.spec.ts` — admin-gated tests skipped unless `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` set

## Product Environment Variables

Variables consumed by the main product surfaces (dashboards, modals, maps, geocoding). Distinct from the PMF block above.

| Name | Purpose |
|------|---------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox GL JS public access token. Required for the project workspace map (compact + expanded states) and address autocomplete. Free tier covers 50k map loads + 100k geocoding requests per month. URL allowlist recommended at `account.mapbox.com/access-tokens/` — currently unrestricted (accepted risk). |

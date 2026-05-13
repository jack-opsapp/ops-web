# OPS Web — Development Standards

Self-contained CLAUDE.md for the `OPS-Web` sub-project. Universal OPS rules (kept in sync across every OPS sub-project) come first; OPS-Web-specific rules come after the divider.

If you update a universal section here, also update the mirrors in `ops-ios/CLAUDE.md`, `ops-software-bible/CLAUDE.md`, `ops-site/CLAUDE.md`, and `/Users/jacksonsweet/Projects/OPS/CLAUDE.md`.

## Perfection Standard

- **We pursue perfection no matter the cost.** We would rather write 1,000 lines of code for 100% perfection than 300 lines for 80%. There is no acceptable threshold below perfect. No shortcuts, no stubs, no TODOs, no "good enough."
- Complexity is not a reason to simplify. If the correct solution requires more code, more logic, or more effort, that is the solution.
- **Never defer work.** Do not push problems to later iterations, future releases, or follow-up PRs. Solve it now, completely.
- Treat every task as if it ships to customers today.

## Brand & MO

We sell confidence, not software. Our user is a trades business owner drowning in texts, paper, and chaos — barely keeping their head above water. OPS gives them back control. The aesthetic is military tactical minimalist: sharp, refined, clean. Every element earns its place. Nothing decorative, nothing cute, nothing that says "tech startup." The vibe is understated confidence — "hell. yeah." not "Hell yeah!" We design for gloves, sunlight, poor connectivity, and distraction. Not for desk-bound power users. The test: does this make a stressed-out business owner feel like they just found the thing that gives them their life back? If it feels like a tech demo, it's wrong. If it feels like a lifeline, it's right.

## Skill Usage — Mandatory

**Default to using a skill rather than not.** If there is even a 1% chance a skill applies, invoke it. This is not optional. Check ALL available skills before every task.

| Skill | When to Use |
|-------|-------------|
| `ops-copywriter` | ANY user-facing text: labels, tooltips, empty states, error messages, button text, headlines, onboarding copy. No writing copy without this skill. |
| `animation-studio:animation-architect` | ANY animation, transition, or motion work. The gateway skill — always load first. |
| `animation-studio:web-animations` / `ios-animations` | Platform-specific animation implementation after loading the architect. |
| `animation-studio:data-visualization` | ANY metrics, charts, or numeric data that could be visualized. Visuals over numbers, always. |
| `animation-studio:interactive-scenes` | Product demos, interactive tutorials, gamified interactions, explainer sequences. |
| `animation-studio:marketing-hero` | Hero sections, scroll narratives, constellation fields, 3D scenes, landing page animations. |
| `ops-design` | ALL visual/UI work across every surface. The Claude Design system skill — read `ops-design-system/project/SKILL.md`. Every styling choice must trace to the design system tokens. |
| `frontend-design` | Any web component, page, or UI build. |
| `mobile-ux-design` | Any mobile screen design or UX decision. |
| `wireframe` | When planning layouts or exploring design options. |
| `brainstorming` | Before any creative or feature work. Explore intent, constraints, and alternatives before building. |

## OPS Software Bible

**The OPS Software Bible (`ops-software-bible/`) is the encyclopedia of OPS.** It is the single source of truth for architecture, data models, API contracts, feature specifications, and the current state of every system. It is used by agents to describe the app, reference endpoints, understand data structures, and pull feature context.

- **Always consult the bible** before making assumptions about data types, table schemas, API behavior, or feature requirements.
- **Always fetch from Supabase** (via MCP tools) to verify table schemas, column types, and RLS policies before writing queries or migrations. Never guess column names or types.
- **Keep the bible updated.** When you implement a feature, add a migration, change a data model, or build a new system — update the relevant bible section in the same session. The bible must stay current. An outdated bible is a broken bible.

## Design System — `ops-design-system/`

All styling decisions live in the centralized design system — not in CLAUDE.md, not improvised. No colors, fonts, spacing, or radii should be hardcoded.

**The OPS visual system lives at `ops-design-system/project/`.** Exported from Claude Design, this is the single source of truth for every styling decision across all surfaces — military tactical minimalist, monochrome canvas, glass + hairlines, steel-blue accent, three-font system (Mohave / JetBrains Mono / Cake Mono), earth-tone semantics.

| Surface | Source of Truth |
|---------|----------------|
| Cross-platform brand | `ops-design-system/project/README.md` (agent brief) + `ops-design-system/project/uploads/system.md` (canonical spec with WCAG ratios) |
| Web tokens (CSS) | `ops-design-system/project/colors_and_type.css` — **import first** in any web work |
| Brand assets | `ops-design-system/project/assets/` (`ops-mark.svg`, `ops-lockup.svg`) |
| Brand fonts | `ops-design-system/project/fonts/` (Cake Mono Light/Regular/Bold) — Mohave + JetBrains Mono via Google Fonts |
| OPS-Web UI kit | `ops-design-system/project/ui_kits/ops-web/` — dashboard components, sidebar, topbar, widgets, FAB |
| Marketing site kit | `ops-design-system/project/ui_kits/ops-site/` — diverges intentionally (heavier Mohave display type) |
| iOS app kit | `ops-design-system/project/ui_kits/opsapp/` — 390×844 phone frames, field-crew screens |
| Per-token previews | `ops-design-system/project/preview/*.html` — buttons, tags, inputs, sidebar, dataviz, colors, type, spacing |
| iOS implementation tokens | `OPS/OPS/Styles/OPSStyle.swift` (+ `Styles/Components/`) — iOS keeps its own tokenized Swift source |
| Broader brand context | `ops-software-bible/05_DESIGN_SYSTEM.md` — for any OPS-Web styling, defer to `ops-design-system/` |

**Rules:**

- **Import `ops-design-system/project/colors_and_type.css` first** in every web component, page, or prototype. Never hardcode color/spacing/radius/font values — every value traces to a token.
- **Read `ops-design-system/project/README.md` before any UI work.** The README is the agent-facing brief; `uploads/system.md` is the canonical spec.
- **Voice:** OPS copy is terse and tactical. `// OPERATOR :: JACKSON`, not "Welcome back!". No emoji, no exclamation points, sentence case for content / UPPERCASE for authority. See `ops-design-system/project/README.md` § CONTENT FUNDAMENTALS.
- **Numbers:** Always JetBrains Mono, tabular-lining, slashed zero. Always formatted (`87%`, never `86.5671641`). Empty state is `—`, not "N/A".
- **Motion:** One easing curve `cubic-bezier(0.22, 1, 0.36, 1)`. No spring physics, no bounce (exception: drag-and-drop reorder). Always honor `prefers-reduced-motion`.
- **Icons:** Lucide, 1.5px stroke, `currentColor`. No emoji, no decorative icons.

### Claude Design Handoff Protocol

When implementing designs exported from Claude Design (handoff bundles), agents must follow this protocol exactly:

1. **Read the skill first.** Load `ops-design-system/project/SKILL.md`, then `ops-design-system/project/README.md`. Become an expert in the OPS brand before touching any code.
2. **Read the handoff bundle top-to-bottom.** Open the primary design file and every file it imports — CSS, components, scripts. Understand how the pieces connect before implementing.
3. **Import tokens first.** In production code: use the project's Tailwind tokens. In prototypes: import `colors_and_type.css`. Every value must trace to a token — zero improvisation.
4. **Match the visual output, not the prototype code.** Handoff HTML/CSS/JS are prototypes, not production code. Recreate the visual result pixel-perfectly in the target tech stack (React, Swift, etc.). Don't copy prototype internals unless they happen to fit.
5. **Verify against reference screenshots.** If the handoff bundle includes `screenshots/`, compare your implementation against them. Flag any deviation in color, spacing, typography, or layout.
6. **When anything is ambiguous, ask.** It is cheaper to clarify scope than to build the wrong thing. Never guess a token value, component pattern, or layout decision.
7. **Plan before coding.** For non-trivial handoffs, write a plan listing every component, token reference, and layout decision — get confirmation, then implement.

## Notification System

- **The web app has a notification rail in the header.** When building any feature that produces a user-facing event (task completed, expense approved, scan finished, import done, etc.), create a notification so it appears in the rail.
- See `ops-software-bible/07_SPECIALIZED_FEATURES.md` Section 14 for the full notification architecture (iOS + Web).
- Notification types: **standard** (dismissible) and **persistent** (stays until resolved). Use `persistent: true` for long-running operations the user is waiting on.
- Action buttons: set `actionUrl` and `actionLabel` to give users a click-through to the relevant page.

## Precision

- **Never guess.** If unsure about a data type, API response shape, table schema, or business rule — look it up or ask the user.
- Do not make inferences. Read the actual code, query the actual database, check the actual documentation.
- When asked about specific code behavior, read the file line by line. Do not speculate.

## Cost Transparency

- **Always inform the user of associated costs** when making decisions that involve money — Vercel subscriptions, function invocation costs, third-party API pricing, database tier changes, etc.
- If you don't know the cost, tell the user you need to research it before proceeding. Never assume something is free or cheap.

## Development Velocity Context

- This project moves at extreme speed. Major features (entire pipeline system, full web app foundation, notification systems) are built in single sessions.
- The developer runs 8-9 Claude terminal windows in parallel.
- **When estimating timelines or scoping work:** assume AI-assisted development at this pace. A "week-long" feature by traditional estimates is a single-day build here. Do not pad estimates or suggest breaking work across multiple days/sprints unless the scope genuinely requires it.
- **Never suggest deferring scope** because "it would take too long." Build it now, build it complete.

## Git Commit Guidelines

- **You may commit without asking first.** The default "ask before committing" behavior is overridden — make atomic commits as work lands. **Pushes still require explicit permission** (`git push`, force-push, rebase against shared history, branch deletion, tag-write).
- **Don't step on parallel agent work.** This repo regularly has multiple Claude sessions / worktrees running in parallel (`git worktree list` shows current ones). Before acting on shared state:
  - Do **not** stash, reset, restore, or `git add` files that have pre-existing uncommitted WIP you did not create.
  - Do **not** rebase or rewrite history on a branch a sibling worktree is using.
  - Do **not** delete, rename, or move files another session is mid-edit on.
  - Do **not** modify shared build artifacts (DerivedData, lockfiles, migrations, generated types) that a parallel session may be writing to. Check `lsof` or running processes if uncertain.
  - When uncertain whether parallelism applies, ask before acting.
- **Atomic commits.** One logical change per commit. Do not mix unrelated scopes (e.g. a feature + a docs update) in a single commit; split them, even within the same branch.
- **Branch scope discipline.** A feature branch (e.g. `nightly/...`, `feat/...`) is for that feature only. Drop unrelated commits (docs, policy, tooling) onto `main` directly or on their own short-lived branch — not onto someone else's feature branch.
- **Never include Claude as co-author.** No `Co-Authored-By: Claude`, no `noreply@anthropic.com`, no AI attribution of any kind in commit messages or trailers.
- **Stage by name, not bulk.** Never `git add -A` or `git add .` — name the specific files. Bulk-staging risks pulling in unrelated WIP, secrets (`Secrets.xcconfig`, `.env*`), or another session's files.
- **Conventional-commit style.** `feat(scope): …`, `fix(scope): …`, `docs(scope): …`, `refactor(scope): …`. Describe what changed and why, not how.

## Spawned Task Naming Convention

When spawning a follow-up chat, fresh worktree, or background task (e.g. via `mcp__ccd_session__spawn_task`, `Agent` with isolation, or any "open this in a new chat" affordance), the **title** must follow this hierarchical convention so spawned tasks can be traced back to the parent initiative + phase + ordinal at a glance.

**Format:**

```
<PROJECT> - P<phase>-<task#>[-<subtask#>...]
```

- `<PROJECT>` — uppercase, hyphenated. The initiative the spawn relates to (e.g. `INBOX REDESIGN`, `PIPELINE V2`, `ESTIMATES OVERHAUL`). Pulled from the session brief, the PR title, the active ticket, or — failing all of those — the most-edited directory name in the current worktree.
- `P<phase>` — the phase number of the parent initiative (`P1`, `P6`, etc.). Phases come from the brief, the implementation plan, or the PR description. If the parent initiative is single-phase or unphased, use `P1`.
- `<task#>` — the spawn ordinal **within the current phase, in the current session**. First spawn of the session within P6 → `1`. Second spawn → `2`. Restart at `1` for a new phase.
- `<subtask#>` — present only when spawning from inside an already-spawned task (a "spawn within a spawn"). Increments per nesting level.

**Examples:**

- Working on phase 1 of inbox redesign, spawning the first follow-up: `INBOX REDESIGN - P1-1`
- Second follow-up from the same phase: `INBOX REDESIGN - P1-2`
- A follow-up discovered while inside that second follow-up's chat: `INBOX REDESIGN - P1-2-1`
- Working on phase 6 of inbox redesign, first follow-up: `INBOX REDESIGN - P6-1`

**Rules:**

- The convention is **mandatory** — every spawned task title must conform. Do not deviate even when "the task is small" or "it's just a one-off."
- Project name + phase number persist across sessions. When a session ends and a new one resumes the same initiative, the new session's first spawn continues the ordinal sequence (P6-3 follows P6-2, not P6-1).
- The `tldr` and `prompt` fields are unrelated to this convention — they describe what the spawned chat will do; the title encodes lineage.
- If you cannot confidently determine the project + phase from context, ask the user before spawning rather than guessing.

---

# OPS-Web-specific rules

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

# OPS Web - Project Status

> Last updated: 2026-02-15 (v3 ground-up redesign)

## Overview

OPS Web is a Jobber-competing field service management platform for trade businesses.
Built with Next.js 15, TypeScript, Tailwind CSS, TanStack Query, Zustand.
Deployed on Vercel at **app.opsapp.co**.

**Target**: Replace Jobber ($300+/month) at $90-190/month with clean, professional aesthetic.

## Build Stats

| Metric | Count |
|---|---|
| Source Files | 123 |
| Test Files | 6 |
| Total Files | 129 |
| Lines of Code | ~29,000 |
| Routes | 21 |
| Tests Passing | 262 |
| TypeScript Errors | 0 |
| Build Status | PASSING |

## Page Status

### Fully Wired to API Hooks
| Page | Route | Status |
|---|---|---|
| Projects List | `/projects` | Real hooks + bulk operations + modal creation |
| Project Detail | `/projects/[id]` | Real hooks + tasks CRUD |
| New Project | `/projects/new` | React Hook Form + Zod + mutation (also available as modal) |
| Dashboard | `/dashboard` | Real hooks (projects, tasks, clients, calendar, team) + typewriter |
| Calendar | `/calendar` | `useCalendarEventsForRange` with date range computation |
| Clients List | `/clients` | `useClients` hook, filtered + mapped + modal creation |
| Client Detail | `/clients/[id]` | `useClient` + `useSubClients` + `useProjects` + mutations |
| New Client | `/clients/new` | `useCreateClient` mutation + toast feedback (also available as modal) |
| Team | `/team` | `useTeamMembers` hook |
| Job Board | `/job-board` | `useProjects` + DnD status update mutations |
| Map | `/map` | `useProjects` + Leaflet with status filtering |
| Pipeline | `/pipeline` | `useProjects` + `useClients` + DnD status mutations + expanded cards |
| Settings | `/settings` | `useCompany` + `useUpdateUser` + `useUpdateCompany` |

### UI Complete, Needs Backend Data Model
| Page | Route | What's Missing |
|---|---|---|
| Invoices | `/invoices` | Needs invoice data model + API |
| Accounting | `/accounting` | Needs financial data model + API |

### Auth & System Pages
| Page | Route | Status |
|---|---|---|
| Login | `/login` | Firebase + Bubble `/wf/login_google` and `/wf/generate-api-token` |
| Register | `/register` | Firebase auth wired |
| PIN | `/pin` | UI complete, PIN verification placeholder |
| Setup/Onboarding | `/setup` | 5-step survey, saves to localStorage |
| Subscription Lockout | `/locked` | UI complete, Stripe links placeholder |

## Infrastructure Status

### Complete & Working
- [x] Next.js 15 App Router with TypeScript
- [x] Tailwind CSS with full OPS design system (dark theme, iOS-matched tokens)
- [x] 54 UI components (shadcn/ui pattern + OPS-specific)
- [x] Bubble.io API client with rate limiting, retry, error types
- [x] 10 entity types with full DTO conversions (byte-perfect BubbleFields)
- [x] 7 TanStack Query hooks with optimistic updates
- [x] 8 API services (project, task, client, user, company, calendar, image, task-type)
- [x] Unified Zustand auth store (OPS User model + Firebase auth sync)
- [x] Zustand stores (sidebar, setup, selection, page-actions)
- [x] Firebase Web App registered + all env vars configured
- [x] Firebase auth integration (Google Sign-In, email/password)
- [x] Bubble workflow auth endpoints (`/wf/login_google`, `/wf/generate-api-token`)
- [x] Auth middleware (route protection, redirects)
- [x] Command palette (Cmd+K) with navigation, actions, search
- [x] Keyboard shortcuts (1-9 nav, Cmd+Shift+P/C)
- [x] Bulk operations with floating action bar + CSV export
- [x] S3 image upload with client-side compression
- [x] Leaflet map with dark tiles (CartoDB)
- [x] Toast notifications (Sonner)
- [x] Subscription enforcement + lockout page
- [x] MSW mock handlers for testing
- [x] Vitest + React Testing Library (262 tests)
- [x] Playwright E2E test setup
- [x] All pages wired to real API hooks (except invoices/accounting)
- [x] React error boundaries
- [x] GitHub Actions CI/CD pipeline
- [x] vercel.json configured (region, security headers)
- [x] Deployed on Vercel at app.opsapp.co
- [x] Modal creation dialogs (projects + clients)
- [x] Page-specific action buttons in top bar

### Not Yet Done
- [ ] Sentry error tracking
- [ ] Vercel Analytics
- [ ] Stripe payment integration
- [ ] Email sending (estimates/invoices)
- [ ] Real-time sync / polling
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance optimization (code splitting beyond Next.js defaults)

## Recent Changes (Feb 15 v3)

### Design System Fix (iOS OPSStyle Parity)
All design tokens now match the iOS OPSStyle.swift source of truth exactly:
- **Background**: Pure black `#000000` (was `#0B0D11` charcoal)
- **Panel**: `#0A0A0A`, **Card**: `#191919`, **Elevated**: `#1A1A1A`
- **Card Material**: `rgba(13,13,13,0.6)` + `backdrop-blur(20px)` + `white @ 20%` border
- **Text**: `#E5E5E5` (was `#E2E4E9`), `#A7A7A7` (was `#8B8F9A`), `#777777` (was `#5C6070`)
- **Borders**: white @ 20% default (was 6%), 40% for button borders, 15% for separators
- **Cards**: `rounded-[5px]` with `bg-[rgba(13,13,13,0.6)]` + blur + 20% white border
- **Buttons**: ALL CAPS text, correct border opacities, `active:scale-[0.98]`
- **No glow effects anywhere** — subtle elevation shadows only

### ALL CAPS Treatment
Applied `uppercase` to all:
- Page titles in top bar
- Sidebar nav labels
- Section headers
- Card titles (where appropriate)
- Button text (via button component)
- Badge text
- Tab/column headers

### Architectural Changes
1. **Modal Creation Dialogs**: Project and client creation now use modal dialogs
   - `CreateProjectModal` — extracted from projects/new/page.tsx
   - `CreateClientModal` — extracted from clients/new/page.tsx
   - Triggered from top bar action buttons, list page buttons, and empty states
2. **Top Bar Rewrite**: Now shows page title (ALL CAPS) + contextual action buttons per route
   - `/projects` → "NEW PROJECT" button
   - `/clients` → "NEW CLIENT" button
   - `/pipeline` → "NEW LEAD" button
   - Uses `usePageActionsStore` (zustand) for page-specific actions
3. **Pipeline Expanded Cards**: Cards always show full details (client, address, contact, actions)
   - No click-to-expand — all info visible immediately
   - Drag-over: column border highlights with accent color
   - Card background: ultrathinmaterial (frosted glass)

### Typewriter Animation Restored
- Dashboard greeting has typewriter animation with blinking caret
- CSS keyframes for `typewriter` and `blink-caret` added back to globals.css

### Bug Fixes Preserved
- **Sign-out → blank screen**: Cookie cleared synchronously before navigation
- **User data not loading**: `setLoading(false)` always called (in `finally` + else branch)
- **Auth layout**: Grid background + glow blobs remain removed

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3.4 |
| Components | Radix UI (shadcn/ui pattern) |
| State (server) | TanStack Query v5 |
| State (client) | Zustand v5 |
| Forms | React Hook Form + Zod |
| Auth | Firebase + Bubble workflow endpoints |
| API | Axios (Bubble.io REST) |
| Maps | Leaflet + react-leaflet |
| DnD | Native HTML5 drag-and-drop |
| Testing | Vitest + RTL + MSW + Playwright |
| Deployment | Vercel |

## Design System (v3 - iOS OPSStyle Parity)

- **Background**: `#000000` (pure black, matches iOS)
- **Panel**: `#0A0A0A`, **Card**: `#191919`, **Elevated**: `#1A1A1A`
- **Card-dark**: `#0D0D0D` (used in card material @ 60% opacity)
- **Accent**: `#417394` (steel blue) - used sparingly
- **Secondary**: `#C4A868` (amber/gold) - active/selected state only
- **Text**: `#E5E5E5` (primary), `#A7A7A7` (secondary), `#777777` (tertiary), `#555555` (disabled)
- **Error**: `#93321A` (deep brick red)
- **Success**: `#A5B368` (muted olive green)
- **Cards**: `rgba(13,13,13,0.6)` + `backdrop-blur(20px)` + `rgba(255,255,255,0.2)` border
- **Material**: ultrathin-material-dark = `rgba(13,13,13,0.6)` + `blur(20px)` + white @ 20% border
- **Fonts**: Mohave (primary), Kosugi (captions), JetBrains Mono (data)
- **Corners**: 5px standard (iOS-matched)
- **Spacing**: 8-point grid
- **Borders**: white at 20% default, 40% for buttons, 5% subtle, 15% separators
- **Shadows**: No glow effects. Subtle elevation only (card/elevated/floating)
- **Text**: ALL CAPS on titles, nav labels, buttons, badges, section headers
- **Live indicator**: sage green (#6B8F71), 4px dot, 3s pulse
- **Active nav**: white left border @ 20% + white bg @ 6%, NOT blue

## Known Issues

- Address autocomplete is stubbed (Google Places API TODO)
- Project images not wired into project form (component exists)
- No inline task creation during project creation
- Revenue/Accounting pages need financial data model
- Some test mocks may need updating after auth flow change

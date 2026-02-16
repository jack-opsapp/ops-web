# OPS Web - Project Status

> Last updated: 2026-02-16

## Overview

OPS Web is a Jobber-competing field service management platform for trade businesses.
Built with Next.js 15, TypeScript, Tailwind CSS, TanStack Query, Zustand.
Deployed on Vercel at **app.opsapp.co**.

**Target**: Replace Jobber ($300+/month) at $90-190/month with clean, professional aesthetic.

## Build Stats

| Metric | Count |
|---|---|
| Source Files | ~130 |
| Test Files | 6 |
| Total Files | ~136 |
| Lines of Code | ~28,000 |
| Routes | 22 |
| TypeScript Errors | 0 |
| Lint Warnings | console.log only (debug, will clean up) |
| Build Status | PASSING |

## API & Auth Status

### Bubble.io Integration
- **Base URL**: `https://opsapp.co/api/1.1` (LIVE — NOT version-test)
- **Proxy**: Server-side API route (`/api/bubble/[...path]/route.ts`) sets Authorization header server-side
- **Auth token**: Set server-side only (never exposed to browser)
- **Rate limiting**: 500ms minimum between requests + retry with exponential backoff

### Auth Flow (Google Sign-In)
1. Firebase popup → get idToken
2. `POST /wf/login_google` → Bubble workflow authenticates, returns user + company objects
3. `GET /obj/company/{id}` → Data API for additional company fields (adminIds, subscription)
4. `GET /obj/user/{id}` → Data API for additional user fields
5. Merge workflow + Data API data (workflow takes priority for privacy-restricted fields)
6. Role detection: company.adminIds FIRST → employeeType → default Field Crew
7. Store user + company in Zustand (persisted to localStorage)
8. AuthProvider skips API call if login page already handled it (prevents duplicate calls)

### Data Fetching
- All list hooks auto-paginate past Bubble's 100-item limit
- Projects, clients, tasks, team members all use `fetchAll*` methods
- Sub-clients and project tasks also auto-paginate
- TanStack Query with optimistic updates on mutations

## Page Status

### Fully Wired to API Hooks
| Page | Route | Status |
|---|---|---|
| Projects List | `/projects` | Real hooks + bulk ops + modal creation + client name resolution |
| Project Detail | `/projects/[id]` | Real hooks + tasks CRUD |
| New Project | `/projects/new` | React Hook Form + Zod + mutation (also available as modal) |
| Dashboard | `/dashboard` | Real hooks (projects, tasks, clients, calendar, team) + typewriter |
| Calendar | `/calendar` | `useCalendarEventsForRange` with date range computation |
| Clients List | `/clients` | `useClients` + `useProjects` for project counts + modal creation |
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
- [x] Server-side Bubble API proxy route (auth header set server-side, no CORS issues)
- [x] 10 entity types with full DTO conversions (byte-perfect BubbleFields)
- [x] BubbleReference resolution for all relationship fields (company, client, admin, etc.)
- [x] Auto-pagination on all list hooks (fetches ALL data, not just first 100)
- [x] 9 TanStack Query hook files with optimistic updates
- [x] 8 API services (project, task, client, user, company, calendar, image, task-type)
- [x] Project-client cross-referencing (client names on project cards, project counts on client cards)
- [x] Unified Zustand auth store (OPS User model + Firebase auth sync)
- [x] Zustand stores (sidebar, setup, selection, page-actions)
- [x] Firebase Web App registered + all env vars configured
- [x] Firebase auth integration (Google Sign-In, email/password)
- [x] Bubble workflow auth endpoints (`/wf/login_google`, `/wf/generate-api-token`)
- [x] Workflow data extraction + Data API merge (handles Bubble privacy rules)
- [x] Auth middleware (route protection, redirects)
- [x] Duplicate auth call prevention (AuthProvider checks if login page already handled)
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
- [x] Live sync indicator (TanStack Query isFetching/isMutating)
- [x] Connectivity monitoring (online/offline with toast notifications)
- [x] Global 401 auto-logout (BubbleUnauthorizedError triggers redirect)
- [x] Team invite API wired (Bubble /wf/send_invite endpoint)
- [x] TaskType CRUD hooks (full service + hook layer)
- [x] SegmentedPicker component (sliding underline, no fill/border)
- [x] Single page title pattern (top-bar owns title, no in-page h1)
- [x] Ultrathinmaterial on all popovers/dropdowns/tooltips/selects

### Not Yet Done
- [ ] Sentry error tracking
- [ ] Vercel Analytics
- [ ] Stripe payment integration (hooks exist but UI flow incomplete)
- [ ] Email sending (estimates/invoices)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance optimization (code splitting beyond Next.js defaults)
- [ ] Role detection may need Bubble-side fix (admin field + employeeType hidden by privacy rules — diagnostic logging in place)
- [ ] Remove debug console.log statements from auth flow (after role issue confirmed fixed)

## Recent Changes (Feb 16)

### Critical API & Auth Fixes
- **Base URL fixed**: Changed from `version-test/api/1.1` (test environment) to `api/1.1` (live) — this was the root cause of missing fields, wrong data, and privacy rule issues
- **Server-side API proxy**: Replaced Next.js `rewrites()` with a proper API route handler (`/api/bubble/[...path]/route.ts`) that sets the Authorization header server-side — eliminates header forwarding issues and keeps API token off the client
- **CORS fix**: Browser requests go to same-origin `/api/bubble/*`, proxy forwards to Bubble server-side
- **Auth flow robustness**: `loginWithGoogle` now extracts ALL available fields from workflow response (which bypasses Bubble privacy rules) and merges with Data API response
- **Duplicate call prevention**: AuthProvider checks if login page already set the user in store before calling loginWithGoogle again

### Data Layer Fixes
- **Auto-pagination**: All list hooks (projects, clients, tasks, team members) now auto-paginate past Bubble's 100-item limit using `fetchAll*` methods — was only fetching first 100
- **Project-client linkage**: Fixed `ProjectDTO.client` type from `string` to `BubbleReference` and use `resolveBubbleReference()` — projects now correctly linked to clients
- **Client names on project cards**: Projects page fetches clients, builds lookup map, enriches project objects with client relationship data
- **Project counts on client cards**: Clients page fetches projects, counts per clientId, displays real counts instead of "--"
- **Sub-client auto-pagination**: `fetchSubClients` now auto-paginates (was hardcoded to 100)
- **Project task auto-pagination**: `fetchProjectTasks` now auto-paginates (was hardcoded to 100)

### Git Commits (Feb 16)
1. `196cf67` — CORS proxy fix (Next.js rewrites)
2. `ec0f836` — Auth fix: fetch user/company from Data API after workflow
3. `a408c93` — Debug logging for auth flow diagnosis
4. `4f70aac` — Auth fix: merge workflow + Data API data
5. `58cd14f` — Server-side API proxy route + comprehensive workflow extraction + duplicate call prevention
6. `e40f311` — Fix base URL: live API instead of version-test
7. `1f79725` — Auto-pagination on all data hooks
8. `ad60c9b` — Fix project-client BubbleReference linkage
9. `62b6554` — Wire project-client display (client names + project counts)

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
| API | Axios (Bubble.io REST) via server-side proxy |
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

- Role detection may default to "Field Crew" if Bubble privacy rules hide `admin` and `employeeType` fields — diagnostic logging in place, may need Bubble-side fix
- Address autocomplete is stubbed (Google Places API TODO)
- Project images not wired into project form (component exists)
- No inline task creation during project creation
- Revenue/Accounting pages need financial data model
- Some test mocks may need updating after auth flow changes and base URL change
- Debug console.log statements in auth flow should be cleaned up after role issue is confirmed fixed

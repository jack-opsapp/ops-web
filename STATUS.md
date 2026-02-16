# OPS Web - Project Status

> Last updated: 2026-02-15 (v2 redesign)

## Overview

OPS Web is a Jobber-competing field service management platform for trade businesses.
Built with Next.js 15, TypeScript, Tailwind CSS, TanStack Query, Zustand.
Deployed on Vercel at **app.opsapp.co**.

**Target**: Replace Jobber ($300+/month) at $90-190/month with clean, professional aesthetic.

## Build Stats

| Metric | Count |
|---|---|
| Source Files | 121 |
| Test Files | 6 |
| Total Files | 127 |
| Lines of Code | ~27,800 |
| Routes | 21 |
| Tests Passing | 262 |
| TypeScript Errors | 0 |
| Build Status | PASSING |

## Page Status

### Fully Wired to API Hooks
| Page | Route | Status |
|---|---|---|
| Projects List | `/projects` | Real hooks + bulk operations |
| Project Detail | `/projects/[id]` | Real hooks + tasks CRUD |
| New Project | `/projects/new` | React Hook Form + Zod + mutation |
| Dashboard | `/dashboard` | Real hooks (projects, tasks, clients, calendar, team) |
| Calendar | `/calendar` | `useCalendarEventsForRange` with date range computation |
| Clients List | `/clients` | `useClients` hook, filtered + mapped |
| Client Detail | `/clients/[id]` | `useClient` + `useSubClients` + `useProjects` + mutations |
| New Client | `/clients/new` | `useCreateClient` mutation + toast feedback |
| Team | `/team` | `useTeamMembers` hook |
| Job Board | `/job-board` | `useProjects` + DnD status update mutations |
| Map | `/map` | `useProjects` + Leaflet with status filtering |
| Pipeline | `/pipeline` | `useProjects` + `useClients` + DnD status mutations |
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
- [x] 52 UI components (shadcn/ui pattern + OPS-specific)
- [x] Bubble.io API client with rate limiting, retry, error types
- [x] 10 entity types with full DTO conversions (byte-perfect BubbleFields)
- [x] 7 TanStack Query hooks with optimistic updates
- [x] 8 API services (project, task, client, user, company, calendar, image, task-type)
- [x] Unified Zustand auth store (OPS User model + Firebase auth sync)
- [x] Zustand stores (sidebar, setup, selection)
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

### Not Yet Done
- [ ] Sentry error tracking
- [ ] Vercel Analytics
- [ ] Stripe payment integration
- [ ] Email sending (estimates/invoices)
- [ ] Real-time sync / polling
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance optimization (code splitting beyond Next.js defaults)

## Recent Changes (Feb 15)

### Auth Flow Rewrite
- Added `loginWithGoogle()` to UserService - calls Bubble `/wf/login_google` with Firebase ID token (matches iOS AuthManager.swift)
- Added `loginWithToken()` to UserService - calls Bubble `/wf/generate-api-token` for email/password auth (matches iOS)
- Rewrote AuthProvider to use Bubble workflow endpoints instead of searching by email
- Updated login page: Google sign-in gets ID token then calls Bubble, email sign-in uses generate-api-token

### UI Overhaul (iOS OPSStyle Parity)
- Replaced text "OPS" + "Command Center" with actual OPS logo image (`public/images/ops-logo-white.png`)
- Removed terminal green (#00FF41) - replaced with muted success color (#A5B368)
- Fixed status colors to match iOS: RFQ (#BCBCBC), Estimated (#B5A381), Closed (#E9E9E9), Archived (#A182B5)
- Added `ultrathin-material-dark` CSS class (iOS `ultrathinmaterialdark` equivalent)
- Applied backdrop-blur to sidebar, top bar, dropdown menus
- Removed grid-overlay background from all layouts
- Removed all `.live-dot`, `.live-dot-sm`, `.glow-live` CSS classes
- Fixed corner radii: sm=2.5px, DEFAULT=5px (was 2px, 4px)
- Added typewriter CSS animation for dashboard greeting
- Added `background.dark` (#090C15) color token
- Fixed text.secondary from #AAAAAA to #A7A7A7

### Other
- Consolidated auth stores, registered Firebase Web App
- Fixed sidebar/top-bar to use OPS `currentUser` fields
- Removed cliche "Command Center" text from sidebar and dashboard

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
| DnD | @dnd-kit |
| Testing | Vitest + RTL + MSW + Playwright |
| Deployment | Vercel |

## Design System (v2 - Defense-tech aesthetic)

- **Background**: #0B0D11 (dark charcoal with blue undertones, NOT pure black)
- **Panel**: #10131A, **Card**: #161A22, **Elevated**: #1C2028
- **Accent**: #417394 (steel blue) - near-invisible in resting state
- **Secondary**: #C4A868 (amber/gold) - active/selected state only
- **Text**: #E2E4E9 (primary), #8B8F9A (secondary), #5C6070 (tertiary)
- **Error**: #93321A (deep brick red)
- **Success**: #A5B368 (muted olive green)
- **Cards**: frosted glass - rgba(255,255,255,0.03) + backdrop-blur-md + 6% border
- **Material**: ultrathin-material-dark = rgba(14,17,23,0.7) + blur(16px)
- **Fonts**: Mohave (primary), Kosugi (captions), JetBrains Mono (data)
- **Corners**: 5px standard (iOS-matched)
- **Spacing**: 8-point grid
- **Borders**: white at 6% opacity (extremely subtle)
- **Shadows**: No glow effects. Subtle elevation only (card/elevated/floating)
- **Live indicator**: sage green (#6B8F71), 4px dot, 3s pulse
- **Active nav**: white left border at 20% + white bg at 6%, NOT blue

## Recent Changes (Feb 15 v2)

### Complete UI Redesign (Defense-tech aesthetic)
- **Backgrounds**: Pure black -> dark charcoal (#0B0D11) with blue undertones
- **Text**: Pure grey -> blue-grey tones (#E2E4E9, #8B8F9A, #5C6070)
- **Borders**: 10% opacity -> 6% opacity (much subtler)
- **Cards**: Frosted glass (rgba white 3% + backdrop-blur), no grid patterns
- **Buttons**: Ghost-like default (white 7%), removed all glow/scale effects
- **Sidebar**: Smaller logo (56px), neutral active states (white not blue), no kbd badges
- **Top bar**: Removed centered page title (breadcrumbs only), muted sync indicator
- **Dashboard**: Removed typewriter animation (simple fade-in), neutral stat icons, ghost quick actions
- **Live indicators**: Sage green (#6B8F71), smaller dots (4px), slower pulse (3s)
- **Notification badge**: Subtle white dot, not amber
- **Removed**: All glow shadows, grid backgrounds, scan-line animations, typewriter effect

### Bug Fixes
- **Sign-out -> blank screen**: Fixed by clearing auth cookie synchronously before navigation
- **User data not loading**: Fixed `setLoading(false)` always called (in `finally` + else branch)
- **Auth layout grid/glow**: Removed grid background and ambient glow blobs from login

## Known Issues

- Address autocomplete is stubbed (Google Places API TODO)
- Project images not wired into project form (component exists)
- No inline task creation during project creation
- Revenue/Accounting pages need financial data model
- Some test mocks may need updating after auth flow change
- Some pages still reference `shadow-glow-*` classes (harmless no-ops, no visual effect)

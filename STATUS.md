# OPS Web - Project Status

> Last updated: 2026-02-15

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

## Design System

- **Background**: #000000 (pure black)
- **Accent**: #417394 (steel blue) - < 10% of UI
- **Secondary**: #C4A868 (amber/gold) - active/selected state only
- **Text**: #E5E5E5 (primary), #A7A7A7 (secondary)
- **Error**: #93321A (deep brick red)
- **Success**: #A5B368 (muted olive green)
- **Cards**: `ultrathin-material-dark` (rgba(13,13,13,0.6) + blur(20px))
- **Fonts**: Mohave (primary), Kosugi (captions), JetBrains Mono (data)
- **Corners**: 5px standard (iOS-matched)
- **Spacing**: 8-point grid
- **Borders**: white at 8% opacity

## Known Issues

- Address autocomplete is stubbed (Google Places API TODO)
- Project images not wired into project form (component exists)
- No inline task creation during project creation
- Revenue/Accounting pages need financial data model
- Some test mocks may need updating after auth flow change

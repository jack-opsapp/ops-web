# OPS Web - Project Status

> Last updated: 2026-02-15

## Overview

OPS Web is a Jobber-competing field service management platform for trade businesses.
Built with Next.js 15, TypeScript, Tailwind CSS, TanStack Query, Zustand.

**Target**: Replace Jobber ($300+/month) at $90-190/month with command center aesthetic.

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
| Login | `/login` | Firebase auth wired |
| Register | `/register` | Firebase auth wired |
| PIN | `/pin` | UI complete, PIN verification placeholder |
| Setup/Onboarding | `/setup` | 5-step survey, saves to localStorage |
| Subscription Lockout | `/locked` | UI complete, Stripe links placeholder |

## Infrastructure Status

### Complete & Working
- [x] Next.js 15 App Router with TypeScript
- [x] Tailwind CSS with full OPS design system (dark theme, custom tokens)
- [x] 52 UI components (shadcn/ui pattern + OPS-specific)
- [x] Bubble.io API client with rate limiting, retry, error types
- [x] 10 entity types with full DTO conversions (byte-perfect BubbleFields)
- [x] 7 TanStack Query hooks with optimistic updates
- [x] 8 API services (project, task, client, user, company, calendar, image, task-type)
- [x] Unified Zustand auth store (OPS User model + Firebase auth sync)
- [x] Zustand stores (sidebar, setup, selection)
- [x] Firebase Web App registered + all env vars configured
- [x] Firebase auth integration (Google Sign-In, email/password)
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

### Not Yet Done
- [ ] Vercel deployment (push + redeploy with env vars)
- [ ] Sentry error tracking
- [ ] Vercel Analytics
- [ ] Stripe payment integration
- [ ] Email sending (estimates/invoices)
- [ ] Real-time sync / polling
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance optimization (code splitting beyond Next.js defaults)

## Recent Changes (Feb 15)

- Deleted duplicate `(onboarding)/page.tsx` that conflicted with root `/` route (Vercel build fix)
- Consolidated dual auth stores into single `lib/store/auth-store.ts` (OPS User model)
- Added `setFirebaseAuth()` method for Firebase auth state sync
- Updated sidebar/top-bar to use OPS `currentUser` fields
- Registered Firebase Web App, all env vars now configured
- Deleted old `stores/auth-store.ts` (Firebase-only, replaced)

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
| Auth | Firebase (Google, Email/Password) |
| API | Axios (Bubble.io REST) |
| Maps | Leaflet + react-leaflet |
| DnD | @dnd-kit |
| Testing | Vitest + RTL + MSW + Playwright |
| Deployment | Vercel |

## Design System

- **Background**: #000000 (pure black)
- **Accent**: #417394 (steel blue)
- **Secondary**: #C4A868 (amber/gold)
- **Text**: #E5E5E5 (primary), not pure white
- **Error**: #93321A (deep brick red)
- **Live**: #00FF41 (terminal green)
- **Fonts**: Mohave (primary), Kosugi (captions), JetBrains Mono (data)
- **Corners**: 2-4px (sharp, command center aesthetic)
- **Spacing**: 8-point grid

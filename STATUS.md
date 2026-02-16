# OPS Web - Project Status

> Last updated: 2026-02-15

## Overview

OPS Web is a Jobber-competing field service management platform for trade businesses.
Built with Next.js 15, TypeScript, Tailwind CSS, TanStack Query, Zustand.

**Target**: Replace Jobber ($300+/month) at $90-190/month with command center aesthetic.

## Build Stats

| Metric | Count |
|---|---|
| Source Files | 120 |
| Test Files | 13 |
| Total Files | 133 |
| Lines of Code | ~33,400 |
| Routes | 22 |
| Tests Passing | 262 |
| TypeScript Errors | 0 |

## Page Status

### Fully Wired to API Hooks
| Page | Route | Status |
|---|---|---|
| Projects List | `/projects` | Real hooks + bulk operations |
| Project Detail | `/projects/[id]` | Real hooks + tasks CRUD |
| New Project | `/projects/new` | React Hook Form + Zod + mutation |

### UI Complete, Using Mock Data
| Page | Route | What's Missing |
|---|---|---|
| Dashboard | `/dashboard` | Wire to real project/task/client hooks |
| Calendar | `/calendar` | Wire to `useCalendarEvents` hook |
| Clients List | `/clients` | Wire to `useClients` hook |
| Client Detail | `/clients/[id]` | Wire to `useClient` hook |
| New Client | `/clients/new` | Wire to `useCreateClient` mutation |
| Team | `/team` | Wire to `useTeamMembers` hook |
| Job Board | `/job-board` | Wire to `useProjects` hook + real DnD status updates |
| Map | `/map` | Wire to `useProjects` hook (Leaflet ready) |
| Pipeline | `/pipeline` | Needs pipeline data model + API |
| Invoices | `/invoices` | Needs invoice data model + API |
| Accounting | `/accounting` | Needs financial data model + API |
| Settings | `/settings` | Wire to `useCompany`/`useUpdateUser` hooks |

### Auth & System Pages
| Page | Route | Status |
|---|---|---|
| Login | `/login` | Firebase auth wired (needs env vars) |
| Register | `/register` | Firebase auth wired (needs env vars) |
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
- [x] Zustand stores (auth, sidebar, setup, selection)
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

### Not Yet Done
- [ ] Environment variables (Firebase, Bubble API token)
- [ ] Vercel deployment
- [ ] GitHub Actions CI/CD
- [ ] Sentry error tracking
- [ ] Vercel Analytics
- [ ] React error boundaries
- [ ] Setup flow -> dashboard customization link
- [ ] Stripe payment integration
- [ ] Email sending (estimates/invoices)
- [ ] Real-time sync / polling
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Performance optimization (code splitting beyond Next.js defaults)

## Priority Wiring Tasks

To go from prototype to functional app, wire pages in this order:

1. **Environment setup** - Set real Firebase + Bubble API credentials
2. **Dashboard** - Replace mock data with `useProjects`, `useTasks`, `useClients`
3. **Calendar** - Wire to `useCalendarEvents` hook (already exists)
4. **Clients** - Wire list/detail/new to existing client hooks
5. **Team** - Wire to `useTeamMembers` hook
6. **Job Board** - Wire to `useProjects` + status update mutations
7. **Map** - Wire to `useProjects` (Leaflet already set up)
8. **Settings** - Wire to `useCompany`, `useUpdateUser`

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
| Deployment | Vercel (planned) |

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

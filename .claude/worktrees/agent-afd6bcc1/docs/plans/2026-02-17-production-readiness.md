# OPS Web — Production Readiness Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire all 7 new lifecycle components into their pages, fix server-side auth for cron/API routes, verify production build, and document manual prerequisites.

**Architecture:** Next.js 15 App Router with Supabase (financial/CRM) + Bubble.io (operational). Firebase Auth bridges to Supabase via access tokens. New components (SendEstimateFlow, ReviewTasksModal, CreateSiteVisitModal, SiteVisitDetail, ActivityComment, ProjectPhotoGallery, InboxLeadsQueue) are fully built but not yet imported into any page.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase JS v2, TanStack Query v5, Zustand, Tailwind CSS, shadcn/ui, Firebase Auth, Bubble.io REST API.

---

## Phase 0: Manual Prerequisites (USER ACTION — Outside Claude's Capabilities)

These steps MUST be completed before any code changes will work at runtime.

### Task 0.1: Apply Supabase Migration

**What:** Run the migration file `supabase/migrations/002_lifecycle_entities.sql` against your Supabase project.

**How:**
1. Open Supabase Dashboard → SQL Editor
2. Paste the contents of `supabase/migrations/002_lifecycle_entities.sql`
3. Run it
4. Verify: check that tables `site_visits`, `task_templates`, `activity_comments`, `project_photos`, `gmail_connections`, `company_settings` exist
5. Verify: check that columns `from_email`, `attachments`, `email_thread_id`, `email_message_id`, `is_read`, `site_visit_id`, `project_id` exist on `activities` table
6. Verify: check that columns `project_id` exists on `estimates` table
7. Verify: check that columns `type`, `task_type_id`, `estimated_hours` exist on `line_items` table

**Prerequisite for:** Everything in Phases 1-5.

### Task 0.2: Add Bubble.io Fields (Manual — Bubble Editor)

Open Bubble.io editor and add these fields:

| Data Type | Field Name | Type | Notes |
|---|---|---|---|
| `TaskType` | `defaultTeamMemberIds` | list of text | User IDs for default crew |
| `Project` | `opportunityId` | text | Supabase Opportunity UUID |
| `ProjectTask` | `sourceLineItemId` | text | Supabase LineItem UUID |
| `ProjectTask` | `sourceEstimateId` | text | Supabase Estimate UUID |
| `CalendarEvent` | `eventType` | option set | Values: task, site_visit, other |
| `CalendarEvent` | `opportunityId` | text | Supabase Opportunity UUID |
| `CalendarEvent` | `siteVisitId` | text | Supabase SiteVisit UUID |

**Prerequisite for:** Task generation (Sprint 3), site visit calendar integration (Sprint 4).

### Task 0.3: Environment Variables

Add to `.env.local` (and Vercel project settings for production):

```
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard → Settings → API → service_role key>
GOOGLE_CLIENT_ID=<your Google Cloud Console OAuth client ID>
GOOGLE_CLIENT_SECRET=<your Google Cloud Console OAuth client secret>
CRON_SECRET=<random 32+ char string for securing cron endpoints>
```

**CRITICAL:** `CRON_SECRET` must NOT be prefixed with `NEXT_PUBLIC_` — it is server-only.

**Prerequisite for:** Gmail sync (Phase 1 service-role client), cron jobs (Phase 2 wiring).

### Task 0.4: Google Cloud Console — Gmail API

1. Go to Google Cloud Console → APIs & Services
2. Enable "Gmail API"
3. Configure OAuth consent screen (if not already done)
4. Create OAuth 2.0 Client ID (Web application)
5. Add authorized redirect URI: `https://your-domain.com/api/integrations/gmail/callback`
6. Copy Client ID and Client Secret to env vars above

**Prerequisite for:** Gmail integration (Sprint 8 components).

---

## Phase 1: Supabase Service-Role Client for Server Contexts

**Problem:** `requireSupabase()` depends on `getFirebaseAuth().currentUser.getIdToken()`. This works in browser but FAILS in API routes and cron jobs where there is no Firebase user session.

**Deliverable:** A `getServiceRoleClient()` utility for server-side contexts. Thread it through Gmail sync and cron routes.

### Task 1.1: Create service-role Supabase client utility

**Files:**
- Create: `src/lib/supabase/server-client.ts`

**Step 1: Create the server-only Supabase client**

Create `src/lib/supabase/server-client.ts`:

```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 0 errors (or same count as before)

**Step 3: Commit**

```
git add src/lib/supabase/server-client.ts
git commit -m "feat: add Supabase service-role client for server contexts"
```

### Task 1.2: Update Gmail sync route to use service-role client

**Files:**
- Modify: `src/app/api/integrations/gmail/sync/route.ts`
- Modify: `src/app/api/integrations/gmail/manual-sync/route.ts`

**Step 1: Update the cron sync route**

In `src/app/api/integrations/gmail/sync/route.ts`, replace any `requireSupabase()` or raw `createClient()` calls with `getServiceRoleClient()` from `@/lib/supabase/server-client`.

The route should:
1. Verify `CRON_SECRET` header
2. Use `getServiceRoleClient()` to query `gmail_connections` where `sync_enabled = true`
3. For each connection, call `GmailService.syncInbox(connection.id)`
4. Return summary JSON

**Step 2: Update the manual sync route**

In `src/app/api/integrations/gmail/manual-sync/route.ts`, same pattern — use `getServiceRoleClient()` instead of raw Supabase client creation.

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```
git add src/app/api/integrations/gmail/sync/route.ts src/app/api/integrations/gmail/manual-sync/route.ts
git commit -m "fix: use service-role client in Gmail sync routes"
```

### Task 1.3: Update follow-up cron route to use service-role client

**Files:**
- Modify: `src/app/api/automation/follow-up-check/route.ts`

**Step 1: Replace Supabase client usage**

The follow-up cron route needs `getServiceRoleClient()` for querying `company_settings` and `opportunities`. Update all Supabase calls to use the service-role client.

**Step 2: Verify TypeScript compiles**

**Step 3: Commit**

```
git add src/app/api/automation/follow-up-check/route.ts
git commit -m "fix: use service-role client in follow-up cron route"
```

### Task 1.4: Thread service-role client through GmailService for server calls

**Files:**
- Modify: `src/lib/api/services/gmail-service.ts`

**Step 1: Add optional `supabaseOverride` parameter to methods called from server**

The `syncInbox`, `getInboxLeads`, `ignoreInboxLead` methods currently call `requireSupabase()` which depends on Firebase Auth. For server contexts, add an optional parameter:

```typescript
async syncInbox(connectionId: string, supabase?: SupabaseClient): Promise<{ activitiesCreated: number }> {
  const db = supabase ?? requireSupabase();
  // ... rest uses `db` instead of calling requireSupabase() again
}
```

This keeps browser calls working (no arg passed = uses Firebase-backed client) while allowing server routes to pass in the service-role client.

**Step 2: Update sync routes to pass service-role client**

In both sync routes, pass `getServiceRoleClient()` as the second argument to `GmailService.syncInbox()`.

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
git add src/lib/api/services/gmail-service.ts src/app/api/integrations/gmail/sync/route.ts src/app/api/integrations/gmail/manual-sync/route.ts
git commit -m "feat: thread service-role client through GmailService for server contexts"
```

---

## Phase 2: Wire Components to Pages

**Deliverable:** All 7 new components are imported and rendered in their target pages. Users can interact with them.

### Task 2.1: Wire SendEstimateFlow into Estimates page

**Files:**
- Modify: `src/app/(dashboard)/estimates/page.tsx`

**Step 1: Read the current file**

Read `src/app/(dashboard)/estimates/page.tsx` fully.

**Step 2: Add SendEstimateFlow import and state**

At the top, add:
```typescript
import { SendEstimateFlow } from "@/components/ops/send-estimate-flow";
```

Add state:
```typescript
const [sendFlowEstimateId, setSendFlowEstimateId] = useState<string | null>(null);
```

**Step 3: Replace inline send action with SendEstimateFlow**

Find the existing "Send" button in the estimates table/list. Replace its `onClick` to:
```typescript
onClick={() => setSendFlowEstimateId(estimate.id)}
```

Add the component at the bottom of the JSX (inside the main fragment/div):
```tsx
<SendEstimateFlow
  estimateId={sendFlowEstimateId}
  open={!!sendFlowEstimateId}
  onOpenChange={(open) => { if (!open) setSendFlowEstimateId(null); }}
/>
```

**Step 4: Verify TypeScript compiles**

**Step 5: Commit**

```
git add src/app/(dashboard)/estimates/page.tsx
git commit -m "feat: wire SendEstimateFlow into estimates page"
```

### Task 2.2: Wire ReviewTasksModal into Estimates page

**Files:**
- Modify: `src/app/(dashboard)/estimates/page.tsx`

**Step 1: Add import and state**

```typescript
import { ReviewTasksModal } from "@/components/ops/review-tasks-modal";
```

State:
```typescript
const [reviewTasksEstimateId, setReviewTasksEstimateId] = useState<string | null>(null);
```

**Step 2: Trigger on estimate approval**

Find the existing "Approve" action. After the approval mutation succeeds, add:
```typescript
setReviewTasksEstimateId(estimate.id);
```

Add the component:
```tsx
<ReviewTasksModal
  estimateId={reviewTasksEstimateId}
  open={!!reviewTasksEstimateId}
  onOpenChange={(open) => { if (!open) setReviewTasksEstimateId(null); }}
/>
```

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
git add src/app/(dashboard)/estimates/page.tsx
git commit -m "feat: wire ReviewTasksModal into estimates page on approval"
```

### Task 2.3: Wire Pipeline page — SendEstimateFlow + CreateSiteVisitModal + InboxLeadsQueue

**Files:**
- Modify: `src/app/(dashboard)/pipeline/page.tsx`
- Modify: `src/app/(dashboard)/pipeline/_components/deal-detail-sheet.tsx` (if exists)

**Step 1: Read the pipeline page and deal detail sheet**

Read both files to understand current structure.

**Step 2: Add imports**

In the pipeline page:
```typescript
import { SendEstimateFlow } from "@/components/ops/send-estimate-flow";
import { CreateSiteVisitModal } from "@/components/ops/site-visit/create-site-visit-modal";
import { InboxLeadsQueue } from "@/components/ops/inbox-leads-queue";
```

**Step 3: Add InboxLeadsQueue**

Add state for visibility and render it (e.g., as a collapsible section above the pipeline board, or as a sheet triggered by a button):

```tsx
const [showInboxLeads, setShowInboxLeads] = useState(false);

// In JSX — button in header area:
<Button variant="ghost" onClick={() => setShowInboxLeads(true)}>
  Inbox Leads
</Button>

// The component:
<InboxLeadsQueue
  open={showInboxLeads}
  onOpenChange={setShowInboxLeads}
/>
```

**Step 4: Add site visit and send estimate triggers in deal detail**

In the deal detail sheet (or opportunity card), add buttons:
- "Schedule Visit" → opens `CreateSiteVisitModal` with `opportunityId` pre-filled
- "Send Estimate" → opens `SendEstimateFlow` with `estimateId`

**Step 5: Verify TypeScript compiles**

**Step 6: Commit**

```
git add src/app/(dashboard)/pipeline/page.tsx src/app/(dashboard)/pipeline/_components/deal-detail-sheet.tsx
git commit -m "feat: wire pipeline page with SendEstimateFlow, CreateSiteVisitModal, InboxLeadsQueue"
```

### Task 2.4: Wire SiteVisitDetail into Pipeline/Deal Detail

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/deal-detail-sheet.tsx`

**Step 1: Add import and state**

```typescript
import { SiteVisitDetail } from "@/components/ops/site-visit/site-visit-detail";
```

State:
```typescript
const [selectedSiteVisitId, setSelectedSiteVisitId] = useState<string | null>(null);
```

**Step 2: Add site visit list in deal detail**

In the opportunity timeline section, show existing site visits with a click handler that opens the detail:
```tsx
{siteVisits.map((sv) => (
  <button key={sv.id} onClick={() => setSelectedSiteVisitId(sv.id)}>
    Site Visit — {sv.scheduledAt.toLocaleDateString()}
  </button>
))}

<SiteVisitDetail
  siteVisitId={selectedSiteVisitId}
  open={!!selectedSiteVisitId}
  onOpenChange={(open) => { if (!open) setSelectedSiteVisitId(null); }}
/>
```

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
git add src/app/(dashboard)/pipeline/_components/deal-detail-sheet.tsx
git commit -m "feat: wire SiteVisitDetail into deal detail sheet"
```

### Task 2.5: Wire ActivityComment into Activity Timeline

**Files:**
- Modify: wherever the activity timeline is rendered (likely `deal-detail-sheet.tsx` or a shared `activity-timeline.tsx`)

**Step 1: Read the activity timeline rendering code**

Find where activities are mapped/rendered in the deal detail.

**Step 2: Add ActivityComment below each activity**

```typescript
import { ActivityComment } from "@/components/ops/activity/activity-comment";
```

Below each activity entry in the timeline:
```tsx
<ActivityComment activityId={activity.id} />
```

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
git add <affected files>
git commit -m "feat: wire ActivityComment into opportunity timeline"
```

### Task 2.6: Wire ProjectPhotoGallery into Project Detail page

**Files:**
- Modify: `src/app/(dashboard)/projects/[id]/page.tsx`

**Step 1: Read the current project detail page**

**Step 2: Replace legacy photos display**

Find where `project.projectImages` or photos are displayed. Replace with:

```typescript
import { ProjectPhotoGallery } from "@/components/ops/project-photo-gallery";
```

```tsx
<ProjectPhotoGallery projectId={project.id} />
```

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
git add src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "feat: wire ProjectPhotoGallery into project detail page"
```

---

## Phase 3: Settings UI Enhancements

**Deliverable:** Settings page has TaskType templates config, company lifecycle settings, and Gmail connection management.

### Task 3.1: Enhance TaskTypes settings with default crew + templates

**Files:**
- Modify: Settings page task types section (find exact file first)

**Step 1: Read the current task types settings**

Search for task type settings UI:
```
Grep for "TaskType" or "task-type" in src/app/(dashboard)/settings/
```

**Step 2: Add default crew multi-select**

In the TaskType edit form, add a team member multi-select for `defaultTeamMemberIds`. Use `useTeamMembers()` for the options list.

**Step 3: Add task templates sub-section**

Below the main TaskType form fields, add an inline editable table for task templates:
- Columns: Title, Estimated Hours, Order, Actions (edit/delete)
- "Add Template" button at bottom
- Uses `useTaskTemplates(taskTypeId)`, `useCreateTaskTemplate()`, `useUpdateTaskTemplate()`, `useDeleteTaskTemplate()`

**Step 4: Verify TypeScript compiles**

**Step 5: Commit**

```
git add <settings files>
git commit -m "feat: add default crew and task templates to TaskType settings"
```

### Task 3.2: Add Company Lifecycle Settings section

**Files:**
- Create or modify: settings page section for lifecycle config

**Step 1: Add lifecycle settings UI**

A new section in settings with:
- Toggle: "Auto-generate tasks on estimate approval" (`autoGenerateTasks`)
- Number input: "Follow-up reminder after X days" (`followUpReminderDays`)
- Toggle: "Auto-log Gmail emails" (`gmailAutoLogEnabled`)

Uses `useCompanySettings()` and `useUpdateCompanySettings()`.

**Step 2: Verify TypeScript compiles**

**Step 3: Commit**

```
git add <settings files>
git commit -m "feat: add company lifecycle settings section"
```

### Task 3.3: Enhance Gmail integration settings

**Files:**
- Modify: `src/components/settings/integrations-tab.tsx`

**Step 1: Read the current integrations tab**

**Step 2: Add Gmail connection management**

Show connected Gmail accounts with:
- Email address
- Connection type (company/individual)
- Last synced timestamp
- "Sync Now" button (calls `useTriggerGmailSync`)
- "Disconnect" button (calls `useDeleteGmailConnection`)
- "Connect Gmail" button for new connections (links to `/api/integrations/gmail?type=company`)

Uses `useGmailConnections()` hook.

**Step 3: Verify TypeScript compiles**

**Step 4: Commit**

```
git add src/components/settings/integrations-tab.tsx
git commit -m "feat: enhance Gmail integration settings with connection management"
```

---

## Phase 4: Production Build Verification

**Deliverable:** `next build` completes with zero errors.

### Task 4.1: Run production build

**Step 1: Run the build**

```bash
cd C:/OPS/ops-web && npx next build
```

**Step 2: Fix any build errors**

Common issues to watch for:
- Missing imports (components referenced but not imported)
- Server/client boundary violations (`"use client"` missing on components using hooks)
- Type mismatches between updated interfaces and page props
- Dynamic imports needed for heavy components

**Step 3: Iterate until zero errors**

**Step 4: Commit any fixes**

```
git add -A
git commit -m "fix: resolve production build errors"
```

---

## Phase 5: Runtime Browser Testing (USER ACTION)

These require a running dev server and browser interaction. Claude cannot perform these.

### Test 5.1: Send Estimate Flow

1. Start dev server: `npm run dev`
2. Navigate to Estimates page
3. Create a draft estimate (no client)
4. Click "Send" → should open SendEstimateFlow dialog
5. Verify: Step 1 shows client search/create
6. Verify: Step 2 shows project search/create
7. Verify: Step 3 shows confirmation + sends

### Test 5.2: Review Tasks Modal

1. On an estimate linked to an opportunity, click "Approve"
2. Verify: ReviewTasksModal opens with proposed tasks grouped by line item
3. Check/uncheck tasks, modify crew assignments
4. Click "Create Tasks"
5. Verify: tasks appear in Bubble.io ProjectTask table

### Test 5.3: Site Visit Lifecycle

1. Open pipeline → click on a deal → "Schedule Visit"
2. Fill in date, time, duration, assignees
3. Verify: site visit appears in deal timeline
4. Click the site visit → detail panel opens
5. Upload a photo, add notes
6. Click "Start Visit" → status changes to in_progress
7. Click "Complete Visit" → status changes to completed
8. Verify: activity created on opportunity timeline

### Test 5.4: Activity Comments

1. Open a deal with activities on its timeline
2. Click "Add comment" on any activity
3. Type a comment and submit
4. Verify: comment appears inline below the activity

### Test 5.5: Project Photo Gallery

1. Open a project detail page
2. Verify: photo gallery renders (may be empty)
3. Upload a photo with source selection
4. Verify: photo appears in correct group

### Test 5.6: Gmail Integration

1. Settings → Integrations → "Connect Gmail"
2. Complete OAuth flow
3. Verify: connection appears with email
4. Click "Sync Now"
5. Verify: emails from known clients appear as activities on their opportunities
6. Verify: unknown sender emails appear in Inbox Leads queue

### Test 5.7: Inbox Leads

1. Pipeline page → "Inbox Leads" button
2. Verify: queue shows unmatched emails
3. Click "Create Lead" on one → should open pre-filled opportunity form
4. Click "Ignore" on one → should disappear from queue

---

## Phase 6: Cleanup and Polish

### Task 6.1: Remove unused imports and dead code

Run `npx tsc --noEmit` one final time. Clean up any unused imports introduced during wiring.

### Task 6.2: Verify Vercel cron configuration

**File:** `vercel.json` (create if missing)

Ensure cron jobs are configured:
```json
{
  "crons": [
    { "path": "/api/automation/follow-up-check", "schedule": "0 * * * *" },
    { "path": "/api/integrations/gmail/sync", "schedule": "*/15 * * * *" }
  ]
}
```

### Task 6.3: Final commit

```
git add -A
git commit -m "chore: cleanup and production readiness polish"
```

---

## Dependency Graph

```
Phase 0 (Manual — USER)
  └─► Phase 1 (Service-role client)
        └─► Phase 2 (Wire components to pages)
              └─► Phase 3 (Settings UI)
                    └─► Phase 4 (Production build)
                          └─► Phase 5 (Runtime testing — USER)
                                └─► Phase 6 (Cleanup)
```

Phases 2 and 3 can run in parallel after Phase 1.
Phase 4 must come after all code changes (Phases 2+3).

---

## Summary

| Phase | Tasks | Who | Estimated Complexity |
|---|---|---|---|
| 0 | Migration, Bubble fields, env vars, Google OAuth | **USER** | Medium (manual steps) |
| 1 | Service-role client + threading | Claude | Low (3 files) |
| 2 | Wire 7 components to 4 pages | Claude | Medium (6 page files) |
| 3 | Settings UI enhancements | Claude | Medium (3 sections) |
| 4 | Production build verification | Claude | Low-Medium (fix-as-you-go) |
| 5 | Runtime browser testing | **USER** | Medium (7 test scenarios) |
| 6 | Cleanup | Claude | Low |

**Total new files:** 1 (`server-client.ts`)
**Total modified files:** ~10-12 (pages + settings + routes)
**No new components needed** — all 7 are already built.

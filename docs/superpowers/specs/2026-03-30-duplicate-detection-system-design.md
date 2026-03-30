# Duplicate Detection System — Design Spec

**Date**: 2026-03-30
**Status**: Approved
**Scope**: OPS-Web backend cron + notification + review sheet UI

---

## Problem

OPS has 5+ entry points for data (iOS manual, web manual, email import wizard, estimate send flow, Gmail auto-detection). The same client, opportunity, project, or task can be created multiple times with slight variations. There is no automated system to detect and surface these duplicates for resolution.

## Solution

A daily 5am Vercel cron job that scans all four entity types per company, stores detected duplicate groups in a `duplicate_reviews` table, and sends notifications to admin/owner/office users. Users resolve duplicates via a sheet that opens from the notification — picking a winner, smart-merging fields, and reassigning relationships.

---

## Entity Detection Rules

### 1. Clients (highest priority)

Duplicate signals, in confidence order:

| Signal | Confidence | Logic |
|--------|-----------|-------|
| Same email (exact, case-insensitive) | High | `lower(a.email) = lower(b.email)` where email is non-null |
| Same phone (normalized) | High | Strip all non-digit characters, compare last 10 digits |
| Fuzzy name match | Medium | Reuse `normalizeCompanyName()` from `consolidation-utils.ts` — strips business suffixes (Inc, Ltd, LLC, etc.), lowercases, removes non-alphanumeric. Match when normalized names are identical. |
| Same non-public email domain | Medium | `a.email.split('@')[1] === b.email.split('@')[1]` where domain is not in `PUBLIC_EMAIL_DOMAINS` set |
| Same address (normalized) | Low | Lowercase, strip unit/suite/apt numbers, trim whitespace. Only used as a supporting signal when combined with name or phone match. |

A pair is flagged when **any High signal matches** OR **two or more Medium/Low signals match together**.

### 2. Opportunities

| Signal | Confidence | Logic |
|--------|-----------|-------|
| Same contactEmail (exact, case-insensitive) | High | Only on active stages (not `won`, `lost`, `discarded`, `archived`) |
| Fuzzy contactName match + same company | Medium | Same `normalizeCompanyName()` logic applied to `contactName` |
| Similar title + same address | Medium | Normalized title comparison (lowercase, strip common prefixes like "RE:", "FW:") + normalized address match |

Only scan **active pipeline stages**: `new_lead`, `qualifying`, `quoting`, `quoted`, `follow_up`, `negotiation`.

### 3. Projects

| Signal | Confidence | Logic |
|--------|-----------|-------|
| Same clientId + fuzzy title match | High | Same client, normalized titles match (lowercase, strip "project", "job", common trade words) |
| Same address (normalized) + same clientId | High | Different title but same location for same client |
| Same address (normalized) + fuzzy title | Medium | No client link but address and title both match |

Only scan **active projects**: status not in `Completed`, `Closed`, `Archived`.

### 4. Tasks

| Signal | Confidence | Logic |
|--------|-----------|-------|
| Same projectId + same taskTypeId + overlapping date range | High | Two tasks of the same type on the same project with dates that overlap |
| Same projectId + fuzzy customTitle match + overlapping date range | High | Custom-titled tasks that overlap |

Only scan **active tasks**: status not in `Completed`, `Cancelled`.

---

## Database Schema

### `duplicate_reviews` table

```sql
create table duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  entity_type text not null check (entity_type in ('client', 'opportunity', 'project', 'task')),
  entity_a_id uuid not null,
  entity_b_id uuid not null,
  confidence text not null check (confidence in ('high', 'medium')),
  signals jsonb not null default '[]',
  -- e.g. [{"type": "same_email", "detail": "john@smith.com"}, {"type": "fuzzy_name", "detail": "smith roofing"}]
  status text not null default 'pending' check (status in ('pending', 'merged', 'dismissed')),
  winner_id uuid,           -- set on merge
  resolved_by uuid,         -- user who resolved
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  -- Prevent duplicate review pairs (unordered)
  unique (company_id, entity_type, entity_a_id, entity_b_id)
);

-- Index for cron lookup: "any pending reviews for this company?"
create index idx_duplicate_reviews_pending
  on duplicate_reviews (company_id, status) where status = 'pending';

-- Index for dismissed pair lookup during scan
create index idx_duplicate_reviews_dismissed
  on duplicate_reviews (company_id, entity_type, status) where status = 'dismissed';
```

**Ordering convention**: `entity_a_id < entity_b_id` (lexicographic UUID comparison) to prevent storing the same pair twice in different order.

### `duplicate_review_metadata` (optional future — not MVP)

For complex merges that need audit trail. Not building this now.

---

## Cron Job

### Route: `POST /api/cron/duplicate-scan`

**Schedule**: `0 5 * * *` (5:00 AM UTC daily)
**Max duration**: 300s (matches existing cron pattern)
**Auth**: `CRON_SECRET` bearer token (matches existing pattern)

### Algorithm per company:

```
1. Fetch all active (non-deleted) entities for this company
2. For each entity type (clients, opportunities, projects, tasks):
   a. Build comparison index (normalized names, emails, phones, addresses)
   b. Compare all pairs using detection rules
   c. For each detected pair:
      - Check if pair already exists in duplicate_reviews (any status)
      - If dismissed → skip (permanent dismissal)
      - If already pending → skip
      - If new → insert with status='pending'
3. Count new pending reviews for this company
4. If count > 0 → send notification to all admin/owner/office users
```

### Performance considerations:

- Clients/Opportunities/Projects: O(n^2) pairwise comparison is fine for trades businesses (typically <500 clients, <200 active opportunities, <100 active projects per company)
- Tasks: Scoped to per-project, so comparison is within each project's active tasks only
- Companies are processed sequentially to avoid DB connection pressure
- Skip companies with expired/cancelled subscriptions (matches email-sync pattern)

---

## Notification

**Type**: `"duplicates_found"` (new NotificationType to add)

**Content**:
- **Title**: "Potential duplicates found"
- **Body**: "{count} potential duplicate {entityType(s)} detected" — e.g. "3 potential duplicate clients and 1 duplicate project detected"
- **Persistent**: `false` (standard dismissible notification)
- **Action URL**: not used (sheet opens from notification click handler)
- **Action Label**: "Review"

**Recipients**: All users in the company with role `admin`, `owner`, or `office`.

**Deduplication**: The existing `NotificationService.create()` already deduplicates by (userId, type, title) — so if the user hasn't read yesterday's notification, a new one won't be created. This is correct behavior: the user still has pending reviews to look at.

---

## Review Sheet UI

Triggered by clicking the "duplicates_found" notification. Opens a full-height sheet (Vaul drawer or Radix Dialog) over the current page.

### Sheet structure:

```
┌─────────────────────────────────────────────────┐
│  Potential Duplicates                        ✕  │
│─────────────────────────────────────────────────│
│                                                 │
│  CLIENTS (2)              ← entity type tabs    │
│  OPPORTUNITIES (1)                              │
│  PROJECTS (0)                                   │
│  TASKS (1)                                      │
│                                                 │
│─────────────────────────────────────────────────│
│                                                 │
│  ┌─── Duplicate Pair ──────────────────────┐    │
│  │                                         │    │
│  │  "Smith Roofing"    "Smith Roofing Inc" │    │
│  │  john@smith.com     john@smithroof.com  │    │
│  │  (555) 123-4567     —                   │    │
│  │  123 Main St        123 Main Street     │    │
│  │  3 projects         1 project           │    │
│  │                                         │    │
│  │  Match: same phone, fuzzy name          │    │
│  │                                         │    │
│  │  [Merge ←]  [→ Merge]  [Not a Match]   │    │
│  │                                         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌─── Duplicate Pair ──────────────────────┐    │
│  │  ...next pair...                        │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Card layout per pair:

- Side-by-side comparison of the two records
- Key fields displayed per entity type:
  - **Client**: name, email, phone, address, project count, created date
  - **Opportunity**: title, contactName, contactEmail, contactPhone, stage, estimatedValue
  - **Project**: title, client name, address, status, task count
  - **Task**: displayTitle, project name, taskType, date range, team members
- Match signals shown as badges (e.g. "same phone", "fuzzy name match")
- Confidence badge: "High" or "Medium"

### Actions:

- **Merge ← / → Merge**: Arrow indicates which record becomes the winner. The clicked side is the winner. Triggers smart merge (see below).
- **Not a Match**: Sets `status = 'dismissed'`, removes the card from the list. Permanent — pair never resurfaces.

---

## Smart Merge Logic

When user picks a winner:

### 1. Backfill missing fields

For each field on the winner that is null/empty, copy the loser's value if it exists.

**Client merge fields**: `email`, `phoneNumber`, `address`, `latitude`, `longitude`, `profileImageURL`, `notes`
**Opportunity merge fields**: `contactEmail`, `contactPhone`, `description`, `estimatedValue`, `address`
**Project merge fields**: `address`, `latitude`, `longitude`, `notes`, `projectDescription`
**Task merge fields**: `taskNotes`, `customTitle`

### 2. Reassign relationships

| Entity Type | Relationships to Reassign |
|------------|--------------------------|
| **Client** | `projects.client_id`, `sub_clients.client_id`, `opportunities.client_id`, `estimates.client_id`, `invoices.client_id` |
| **Opportunity** | `activities.opportunity_id`, `follow_ups.opportunity_id`, `stage_transitions.opportunity_id`, `estimates.opportunity_id`, `opportunity_email_threads.opportunity_id` |
| **Project** | `project_tasks.project_id`, `estimates.project_id`, `invoices.project_id`, `project_notes.project_id`, `site_visits.project_id`, `calendar_user_events.project_id` |
| **Task** | No child relationships to reassign — tasks are leaf entities |

### 3. Soft-delete loser

Set `deleted_at = now()` on the loser record.

### 4. Update review record

Set `status = 'merged'`, `winner_id`, `resolved_by`, `resolved_at` on the `duplicate_reviews` row.

### 5. Cascade cleanup

After merging, check if the loser appeared in any other pending `duplicate_reviews` pairs. If so, replace the loser's ID with the winner's ID in those pairs (or delete the pair if it would become a self-reference).

---

## Shared Utilities

### Extract from `consolidation-utils.ts`

Move `normalizeCompanyName()` and the `BUSINESS_SUFFIXES` regex to a shared location: `src/lib/utils/name-normalization.ts`. This allows both the import wizard consolidation and the duplicate scanner to reuse the same logic.

Add new normalization functions:

```typescript
// Phone normalization — strip non-digits, take last 10
function normalizePhone(phone: string): string

// Address normalization — lowercase, strip unit/suite/apt, normalize whitespace
function normalizeAddress(address: string): string

// Title normalization — lowercase, strip common prefixes (RE:, FW:, "project", "job")
function normalizeTitle(title: string): string
```

---

## Service Layer

### `src/lib/api/services/duplicate-detection-service.ts`

Exports:

```typescript
export const DuplicateDetectionService = {
  // Called by cron — scans one company, returns count of new duplicates found
  async scanCompany(companyId: string): Promise<number>,

  // Called by UI — fetches all pending reviews for a company
  async getPendingReviews(companyId: string): Promise<DuplicateReview[]>,

  // Called by UI — smart merge two entities
  async mergeEntities(reviewId: string, winnerId: string, resolvedBy: string): Promise<void>,

  // Called by UI — permanently dismiss a pair
  async dismissPair(reviewId: string, resolvedBy: string): Promise<void>,
}
```

### `src/lib/hooks/use-duplicate-reviews.ts`

TanStack Query hook:

```typescript
export function useDuplicateReviews() {
  // Fetches pending reviews grouped by entity type
  // Returns { clients: DuplicateReview[], opportunities: DuplicateReview[], ... }
  // Includes entity data for both sides of each pair
}
```

---

## API Routes

### `POST /api/cron/duplicate-scan`
- Cron endpoint, CRON_SECRET auth
- Iterates all active-subscription companies
- Calls `DuplicateDetectionService.scanCompany()` for each
- Sends notifications where new duplicates found

### `GET /api/duplicates`
- Authenticated user route
- Returns pending duplicate reviews for the user's company
- Includes full entity data for both sides of each pair

### `POST /api/duplicates/[id]/merge`
- Body: `{ winnerId: string }`
- Calls smart merge, updates review status

### `POST /api/duplicates/[id]/dismiss`
- Calls dismiss, updates review status

---

## Notification Integration

### Changes to `notification-service.ts`:

Add `"duplicates_found"` to the `NotificationType` union.

### Notification click handler:

In the notification rail component, when `type === "duplicates_found"`, instead of navigating to `actionUrl`, open the duplicate review sheet. This requires:
1. A Zustand store or context to control sheet open state: `useDuplicateReviewStore`
2. The sheet component mounted at the layout level (like existing modals)

---

## Vercel Config

Add to `vercel.json` crons array:

```json
{
  "path": "/api/cron/duplicate-scan",
  "schedule": "0 5 * * *"
}
```

---

## File Inventory

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/utils/name-normalization.ts` | Create | Shared normalization: names, phones, addresses, titles |
| `src/lib/api/services/duplicate-detection-service.ts` | Create | Core scan + merge + dismiss logic |
| `src/lib/hooks/use-duplicate-reviews.ts` | Create | TanStack Query hook for UI |
| `src/stores/duplicate-review-store.ts` | Create | Zustand store for sheet open state |
| `src/app/api/cron/duplicate-scan/route.ts` | Create | Cron endpoint |
| `src/app/api/duplicates/route.ts` | Create | GET pending reviews |
| `src/app/api/duplicates/[id]/merge/route.ts` | Create | POST merge action |
| `src/app/api/duplicates/[id]/dismiss/route.ts` | Create | POST dismiss action |
| `src/components/ops/duplicate-review-sheet.tsx` | Create | Full review sheet UI |
| `src/components/ops/duplicate-pair-card.tsx` | Create | Individual pair comparison card |
| `src/lib/api/services/notification-service.ts` | Modify | Add `duplicates_found` type |
| `src/components/settings/wizard-steps/consolidation-utils.ts` | Modify | Extract shared normalization to new util |
| `vercel.json` | Modify | Add cron entry |
| `supabase/migrations/XXXXXXX_duplicate_reviews.sql` | Create | Table + indexes |
| `src/i18n/dictionaries/en/duplicates.json` | Create | English strings |
| `src/i18n/dictionaries/es/duplicates.json` | Create | Spanish strings |

---

## Out of Scope (future)

- AI-powered detection (semantic name matching, entity resolution)
- Bulk merge (resolve all pairs at once)
- Auto-merge for very high confidence matches
- Dashboard widget showing duplicate count
- Audit trail for merge history
- Undo merge

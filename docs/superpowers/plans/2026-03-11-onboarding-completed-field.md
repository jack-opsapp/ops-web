# Onboarding Completed Field — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared `has_completed_onboarding` boolean with `onboarding_completed JSONB` containing per-platform sub-fields (`ios`, `web`), so iOS users are directed to web setup on first web login.

**Architecture:** New JSONB column with backfill migration. All 6 files that map `has_completed_onboarding` are updated to use `onboarding_completed`. Login redirects check `.web` sub-field. Setup gate checks `.web` sub-field. Dashboard layout redirects to `/setup` when `.web` is falsy.

**Tech Stack:** Supabase (Postgres migration), TypeScript, Next.js App Router

**Spec:** `docs/superpowers/specs/2026-03-11-onboarding-completed-field-design.md`

---

## Chunk 1: Database Migration

### Task 1: Create migration to add `onboarding_completed` JSONB, backfill, and drop old column

**Files:**
- Create: `supabase/migrations/026_onboarding_completed_jsonb.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 026_onboarding_completed_jsonb.sql
-- Replace has_completed_onboarding boolean with onboarding_completed JSONB
-- containing per-platform sub-fields: { ios: boolean, web: boolean }

-- 1. Add new JSONB column
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed JSONB DEFAULT '{}';

-- 2. Backfill from existing data
--    - has_completed_onboarding=true WITH starfield step → both platforms done
--    - has_completed_onboarding=true WITHOUT starfield → only iOS done
--    - otherwise → empty object
UPDATE users
SET onboarding_completed = CASE
  WHEN has_completed_onboarding = true
    AND setup_progress->'steps'->>'starfield' = 'true'
    THEN '{"ios": true, "web": true}'::jsonb
  WHEN has_completed_onboarding = true
    THEN '{"ios": true, "web": false}'::jsonb
  ELSE '{}'::jsonb
END;

-- 3. Drop the old boolean column
ALTER TABLE users DROP COLUMN IF EXISTS has_completed_onboarding;
```

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase MCP `execute_sql` tool against project `ijeekuhbatykdomumfjx`.

- [ ] **Step 3: Verify migration**

Run SQL: `SELECT id, onboarding_completed FROM users LIMIT 10;`
Expected: All rows have `onboarding_completed` JSONB, no `has_completed_onboarding` column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/026_onboarding_completed_jsonb.sql
git commit -m "feat: replace has_completed_onboarding with onboarding_completed JSONB

Adds per-platform onboarding tracking (ios/web sub-fields).
Backfills existing data and drops old boolean column."
```

---

## Chunk 2: Type System + Data Mapping Layer

### Task 2: Update User type and OnboardingCompleted interface

**Files:**
- Modify: `src/lib/types/models.ts:404` — replace `hasCompletedAppOnboarding: boolean` with `onboardingCompleted`
- Modify: `src/lib/schemas/index.ts:168` — update zod schema

- [ ] **Step 1: Add OnboardingCompleted interface and update User type**

In `src/lib/types/models.ts`, add the interface before `SetupProgress` (around line 374):

```typescript
/** Per-platform onboarding completion tracking */
export interface OnboardingCompleted {
  ios?: boolean;
  web?: boolean;
}
```

In the `User` interface, replace line 404:
```typescript
// OLD:
hasCompletedAppOnboarding: boolean;

// NEW:
onboardingCompleted: OnboardingCompleted;
```

- [ ] **Step 2: Update zod schema**

In `src/lib/schemas/index.ts`, replace line 168:
```typescript
// OLD:
hasCompletedAppOnboarding: z.boolean(),

// NEW:
onboardingCompleted: z.object({
  ios: z.boolean().optional(),
  web: z.boolean().optional(),
}).default({}),
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: Type errors in the 6 consumer files (sync-user, join-company, user-service, login, useSetupGate, schemas). This is expected — we fix them in Tasks 3-5.

### Task 3: Update all DB→User mapping functions

Three files have identical `mapUserFromDb` / `mapFromDb` patterns. All must change `has_completed_onboarding` → `onboarding_completed`.

**Files:**
- Modify: `src/app/api/auth/sync-user/route.ts:60` — mapUserFromDb
- Modify: `src/app/api/auth/sync-user/route.ts:234` — newRow for user creation
- Modify: `src/app/api/auth/join-company/route.ts:56` — mapUserFromDb
- Modify: `src/lib/api/services/user-service.ts:35` — mapFromDb
- Modify: `src/lib/api/services/user-service.ts:71-72` — mapToDb

- [ ] **Step 1: Update `sync-user/route.ts` mapUserFromDb (line 60)**

```typescript
// OLD:
hasCompletedAppOnboarding: (row.has_completed_onboarding as boolean) ?? false,

// NEW:
onboardingCompleted: (row.onboarding_completed as User["onboardingCompleted"]) ?? {},
```

- [ ] **Step 2: Update `sync-user/route.ts` new user creation (line 234)**

```typescript
// OLD:
has_completed_onboarding: false,

// NEW:
onboarding_completed: {},
```

- [ ] **Step 3: Update `join-company/route.ts` mapUserFromDb (line 56)**

```typescript
// OLD:
hasCompletedAppOnboarding: (row.has_completed_onboarding as boolean) ?? false,

// NEW:
onboardingCompleted: (row.onboarding_completed as User["onboardingCompleted"]) ?? {},
```

- [ ] **Step 4: Update `user-service.ts` mapFromDb (line 35)**

```typescript
// OLD:
hasCompletedAppOnboarding: (row.has_completed_onboarding as boolean) ?? false,

// NEW:
onboardingCompleted: (row.onboarding_completed as User["onboardingCompleted"]) ?? {},
```

- [ ] **Step 5: Update `user-service.ts` mapToDb (lines 71-72)**

```typescript
// OLD:
if (data.hasCompletedAppOnboarding !== undefined)
  row.has_completed_onboarding = data.hasCompletedAppOnboarding;

// NEW:
if (data.onboardingCompleted !== undefined)
  row.onboarding_completed = data.onboardingCompleted;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/models.ts src/lib/schemas/index.ts src/app/api/auth/sync-user/route.ts src/app/api/auth/join-company/route.ts src/lib/api/services/user-service.ts
git commit -m "refactor: update User type and DB mappers for onboarding_completed JSONB

Replace hasCompletedAppOnboarding boolean with onboardingCompleted { ios?, web? }.
Update all three DB mapping locations (sync-user, join-company, user-service)."
```

---

## Chunk 3: Login Redirect + Setup Complete API

### Task 4: Update login page redirect logic

**Files:**
- Modify: `src/app/(auth)/login/page.tsx:67-69` — Google/Apple provider redirect
- Modify: `src/app/(auth)/login/page.tsx:114-117` — email sign-in redirect

- [ ] **Step 1: Update provider sign-in redirect (line 67-69)**

```typescript
// OLD:
if (!result.user.hasCompletedAppOnboarding) {
  router.push(result.user.companyId ? "/setup" : "/account-type");

// NEW:
if (!result.user.onboardingCompleted?.web) {
  router.push(result.user.companyId ? "/setup" : "/account-type");
```

- [ ] **Step 2: Update email sign-in redirect (line 114-117)**

```typescript
// OLD:
if (!result.user.hasCompletedAppOnboarding) {
  router.push(result.user.companyId ? "/setup" : "/account-type");

// NEW:
if (!result.user.onboardingCompleted?.web) {
  router.push(result.user.companyId ? "/setup" : "/account-type");
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/login/page.tsx
git commit -m "fix: login redirect checks onboardingCompleted.web instead of shared boolean

iOS users who haven't done web setup are now correctly redirected to /setup."
```

### Task 5: Update `/api/setup/complete` to set web sub-field

**Files:**
- Modify: `src/app/api/setup/complete/route.ts:54-60`

- [ ] **Step 1: Change the update to JSONB merge**

```typescript
// OLD:
await db
  .from("users")
  .update({
    has_completed_onboarding: true,
    updated_at: new Date().toISOString(),
  })
  .eq("id", userId);

// NEW:
// Read current onboarding_completed, merge web: true
const currentOnboarding = (userRow as Record<string, unknown>).onboarding_completed as Record<string, boolean> | null;
await db
  .from("users")
  .update({
    onboarding_completed: { ...currentOnboarding, web: true },
    updated_at: new Date().toISOString(),
  })
  .eq("id", userId);
```

Note: The `findUserByAuth` call on line 42 currently selects only `"id"`. Change it to `"id, onboarding_completed"` so we can read the current value:

```typescript
// OLD:
const userRow = await findUserByAuth(verifiedUser.uid, verifiedUser.email, "id");

// NEW:
const userRow = await findUserByAuth(verifiedUser.uid, verifiedUser.email, "id, onboarding_completed");
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/setup/complete/route.ts
git commit -m "feat: /api/setup/complete sets onboarding_completed.web via JSONB merge"
```

---

## Chunk 4: Setup Gate + Dashboard Redirect

### Task 6: Update `useSetupGate` to check `onboardingCompleted.web`

**Files:**
- Modify: `src/hooks/useSetupGate.ts`

- [ ] **Step 1: Rewrite the hook**

```typescript
"use client";

import { useAuthStore } from "@/lib/store/auth-store";

/**
 * useSetupGate — checks whether the current user has completed
 * web onboarding (identity, company, starfield).
 *
 * Returns:
 * - `isComplete` — true when web onboarding is done
 * - `needsWebSetup` — true when user should be redirected to /setup
 * - `missingSteps` — granular steps missing (for interception modal)
 * - `needsEmployeeOnboarding` — true for invited users who haven't
 *   completed employee setup (handled separately)
 */
export function useSetupGate() {
  const { currentUser } = useAuthStore();

  // Web onboarding completed = authoritative flag
  const webComplete = !!currentUser?.onboardingCompleted?.web;

  // Granular missing steps (for SetupInterceptionModal on action-gated pages)
  const missingSteps: ("identity" | "company")[] = [];
  const progress = currentUser?.setupProgress;

  const hasIdentity =
    progress?.steps?.identity ||
    (currentUser?.firstName && currentUser?.lastName);
  if (!hasIdentity) missingSteps.push("identity");

  const hasCompany =
    progress?.steps?.company ||
    !!currentUser?.companyId;
  if (!hasCompany) missingSteps.push("company");

  // Employee onboarding: required if user joined via invite
  const joinedViaInvite =
    !!currentUser?.companyId && !progress?.steps?.company;
  const needsEmployeeOnboarding =
    joinedViaInvite && !progress?.steps?.employee_onboarding;

  return {
    isComplete: webComplete,
    needsWebSetup: !webComplete,
    missingSteps,
    needsEmployeeOnboarding,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSetupGate.ts
git commit -m "fix: useSetupGate checks onboardingCompleted.web as authoritative flag

Removes OR-fallback that let iOS-populated fields bypass web setup."
```

### Task 7: Add `/setup` redirect in dashboard-layout

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx:94,98-103`

- [ ] **Step 1: Destructure `needsWebSetup` and add redirect**

```typescript
// OLD (line 94):
const { needsEmployeeOnboarding } = useSetupGate();

// NEW:
const { needsWebSetup, needsEmployeeOnboarding } = useSetupGate();
```

```typescript
// OLD (lines 98-103):
// Redirect to employee onboarding if incomplete
useEffect(() => {
  if (needsEmployeeOnboarding) {
    router.push("/employee-setup");
  }
}, [needsEmployeeOnboarding, router]);

// NEW:
// Redirect to web setup or employee onboarding if incomplete
useEffect(() => {
  if (needsWebSetup) {
    router.push("/setup");
  } else if (needsEmployeeOnboarding) {
    router.push("/employee-setup");
  }
}, [needsWebSetup, needsEmployeeOnboarding, router]);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layouts/dashboard-layout.tsx
git commit -m "feat: dashboard-layout redirects to /setup when web onboarding incomplete

Catches bookmark/session-restore bypasses of login redirect."
```

---

## Chunk 5: Verification

### Task 8: Type-check and verify all references updated

- [ ] **Step 1: Run TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: No errors. All references to `hasCompletedAppOnboarding` and `has_completed_onboarding` should be gone.

- [ ] **Step 2: Search for any remaining references to the old field**

Run: `grep -r "hasCompletedAppOnboarding\|has_completed_onboarding" src/`
Expected: Zero matches.

- [ ] **Step 3: Verify the dev server starts**

Run: `npm run dev` and confirm no runtime errors on login page load.

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: final cleanup for onboarding_completed migration"
```

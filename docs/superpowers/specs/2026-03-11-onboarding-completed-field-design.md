# Onboarding Completed Field — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Problem

The `has_completed_onboarding` boolean on the `users` table is shared between iOS and web. iOS sets it to `true` after iOS onboarding, which causes the web app to skip web setup (starfield questionnaire + dashboard personalization) for iOS users logging in for the first time.

## Solution

Replace `has_completed_onboarding` with `onboarding_completed JSONB` — a structured field with per-platform sub-fields.

### Schema

```json
{
  "ios": true,
  "web": true
}
```

- `ios` — set by iOS app after completing iOS onboarding
- `web` — set by web `/api/setup/complete` after completing web setup (identity → company → starfield)

### Migration

1. Add `onboarding_completed JSONB DEFAULT '{}'` to `users`
2. Backfill existing rows:
   - `has_completed_onboarding = true` AND `setup_progress.steps.starfield` exists → `{"ios": true, "web": true}`
   - `has_completed_onboarding = true` without starfield step → `{"ios": true, "web": false}`
   - Otherwise → `{}`
3. Drop `has_completed_onboarding` column

### Web Changes

| File | Change |
|------|--------|
| `User` type in `models.ts` | Replace `hasCompletedAppOnboarding: boolean` with `onboardingCompleted: { ios?: boolean; web?: boolean }` |
| `sync-user/route.ts` | Map `onboarding_completed` JSONB → `onboardingCompleted` |
| `join-company/route.ts` | Same mapping |
| `user-service.ts` | Same mapping (read + write) |
| `login/page.tsx` | Redirect to `/setup` when `!user.onboardingCompleted?.web` |
| `/api/setup/complete` | JSONB merge: `onboarding_completed \|\| '{"web": true}'` |
| `useSetupGate.ts` | Check `onboardingCompleted.web` — if false, `needsWebSetup = true` |
| `dashboard-layout.tsx` | Redirect to `/setup` if `needsWebSetup` |
| `setup/page.tsx` | No changes (already pre-fills from auth store) |

### iOS Agent Instruction

> The `has_completed_onboarding` boolean column on the `users` table has been replaced with `onboarding_completed JSONB`. Instead of writing `has_completed_onboarding = true`, write a JSONB merge: `onboarding_completed = onboarding_completed || '{"ios": true}'::jsonb`. Read the `ios` sub-field for your gate checks. The column name in Supabase is `onboarding_completed`. The web app writes `{"web": true}` to the same field independently.

### Setup Flow for iOS Users on First Web Login

1. Login page detects `onboardingCompleted.web` is falsy → redirects to `/setup`
2. Setup page pre-fills identity fields (firstName, lastName, phone) from auth store
3. Setup page pre-fills company fields (name, industries, size, age) from auth store
4. User clicks through pre-filled steps quickly, arrives at starfield
5. Starfield questionnaire personalizes dashboard widgets
6. `/api/setup/complete` sets `onboarding_completed.web = true`
7. User arrives at personalized dashboard

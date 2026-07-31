# Permission Hold Refresh Remount Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Keep an authenticated dashboard mounted while already-initialized permissions refresh in hold mode, without weakening first-boot or error fail-closed behavior.

**Architecture:** Treat `loading` as a render-blocking initial/authority load, not every background refresh. A hold refresh keeps existing grants and leaves an already-initialized store ready; an uninitialized hold refresh still blocks until canonical permissions arrive. Any failed refresh still clears grants and completes in a denied state.

**Tech Stack:** TypeScript, Zustand, Vitest

**Design System:** `.interface-design/system.md` reviewed. No UI, copy, motion, or design-token changes.

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`

---

## Task 1: Capture the render-readiness regression

**Files:**

- Modify: `tests/unit/permissions/permissions-store-authority-refresh.test.ts`

1. Change the initialized hold-refresh test to require `loading=false` and `selectPermissionsReady=true` while the canonical request is pending.
2. Add a first-boot hold-refresh test requiring `loading=true` and `selectPermissionsReady=false` when no permission set has been initialized.
3. Run the focused test and confirm the initialized case fails against current production code.

## Task 2: Preserve readiness during initialized hold refreshes

**Files:**

- Modify: `src/lib/store/permissions-store.ts`
- Test: `tests/unit/permissions/permissions-store-authority-refresh.test.ts`

1. In hold mode, inspect the current `initialized` state before publishing loading state.
2. Set `loading=true` only when hold mode is performing the first canonical load.
3. Keep the existing success, generation, and fail-closed error behavior unchanged.
4. Run the focused permission-store and realtime suites.

## Task 3: Verify and release

**Files:**

- Verify: `src/lib/store/permissions-store.ts`
- Verify: `src/lib/hooks/use-lead-assignment-realtime.ts`

1. Run the permission, realtime, and Catalog Setup regression suites.
2. Run TypeScript and the production build.
3. Run `git diff --check`, review the scoped diff, and commit atomically.
4. Push the fast-forward commit to production.
5. Confirm the production deployment is ready, the live request loop stops after refresh, and the active Canpro catalog session remains unchanged.

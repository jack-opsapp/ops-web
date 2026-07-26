# Catalog Setup Refresh Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Stop a previously handled permission delivery from repeatedly unmounting the dashboard while preserving fail-closed permission refresh behavior.

**Architecture:** Keep the latest claimed permission-delivery ID per recipient for the lifetime of the browser JavaScript runtime. Claim the ID before awaiting permission reconciliation so an immediate dashboard unmount cannot replay it. Release the claim only when reconciliation rejects the row. A full page load resets the guard, while a genuinely new delivery ID still applies.

**Tech Stack:** React 19, TypeScript, Zustand, TanStack Query, Supabase Realtime, Vitest

**Design System:** `.interface-design/system.md` reviewed. This is a lifecycle fix with no visual, copy, token, or component changes.

---

## Task 1: Capture the remount regression

**Files:**

- Create: `src/lib/hooks/__tests__/use-lead-assignment-realtime.test.ts`
- Modify: `tests/unit/hooks/use-lead-permission-realtime.test.tsx`
- Test: `src/lib/hooks/__tests__/use-lead-assignment-realtime.test.ts`
- Test: `tests/unit/hooks/use-lead-permission-realtime.test.tsx`

1. Add a test that submits the same permission-delivery row twice in the same module runtime, representing the realtime hook being unmounted and mounted again.
2. Hold the first reconciliation promise open and prove the second call does not enter reconciliation while the first is in flight.
3. Add a hook-level remount regression using the durable permission backlog.
4. Run the focused test and confirm it fails before the guard exists.

## Task 2: Make permission replay idempotent across remounts

**Files:**

- Modify: `src/lib/hooks/use-lead-assignment-realtime.ts`
- Test: `src/lib/hooks/__tests__/use-lead-assignment-realtime.test.ts`

1. Add a bounded module-lifetime map keyed by recipient user ID.
2. Add a reconciliation wrapper that claims the delivery ID before awaiting the destructive permission refresh.
3. Restore the prior claim only if the row is rejected, without overwriting a newer concurrent claim.
4. Route both backlog and realtime permission deliveries through the wrapper.
5. Add coverage proving a new delivery ID still applies and a rejected row can be retried.

## Task 3: Verify and release

**Files:**

- Verify: `src/lib/hooks/__tests__/use-lead-assignment-realtime.test.ts`
- Verify: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`

1. Run the focused realtime regression suite.
2. Run the guided Catalog Setup suite.
3. Run TypeScript checking and the production build with an 8 GB Node heap.
4. Run `git diff --check`, review only scoped changes, and commit atomically.
5. Deploy the committed state to production.
6. Confirm the production deployment is ready and the active Canpro setup session remains intact.

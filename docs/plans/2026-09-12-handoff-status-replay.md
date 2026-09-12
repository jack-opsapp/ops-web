# Handoff status replay implementation plan

**Goal:** Repair bug 5db8422f-0be1-4918-9e89-9a49c452dfdb without changing appointment or provider records.

**Architecture:** The live record RPC validates the immutable proposal and returns the handoff's current lifecycle. Validate `initial_status` and `initial_review_reason` against the evaluation, retain current status/review reason, and acknowledge the actual handoff outcome. Review stays review; cancellation stays skipped; ready/consumed confirms only the handoff component.

**Tech stack:** TypeScript, Vitest, existing Supabase RPCs.

**Design system:** N/A; no UI or user-facing copy changes. Existing interface design reference consulted.

**Required skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:using-git-worktrees, superpowers:test-driven-development, superpowers:verification-before-completion, supabase:supabase.

1. Reproduce live ready-to-review replay through `persistPhaseCBilateralEventHandoff` with a realistic RPC response. Cover consumed/cancelled replays, mismatched immutable status/reason/key, missing fields, invalid current state and RPC error. Preserve all proposal/tenant/evidence guards.
2. Add runtime assertions that current review and cancellation are acknowledged truthfully for the exact claimed event; no provider call or queue replay.
3. Run the focused tests red; modify only `src/lib/email/phase-c-bilateral-event-handoff.ts` and `src/lib/api/services/phase-c-lead-intelligence-work-runtime.ts` to pass. Keep the existing evaluator/recipient changes intact.
4. Run focused handoff/runtime/consumer/work-service/lifecycle tests, modified-source lint and formatting, production-source TypeScript and `git diff --check`. Compare relevant failures with the untouched base if necessary.
5. Commit named task files; safely integrate into clean local main and independently rerun focused checks on the merged commit. Update the Bible contract and guarded bug completion with exact source/local-main proof. Deployment and natural production verification remain separate.

Live evidence: adb94ea2-1da9-41f5-8691-fd4e165be807 has initial_status=ready, status=review, review_reason=event_time_unresolved. Required event c925b29e-1e1f-47ce-9184-c07b6066b917 fails only event_handoff. No live RPC mutation was used to reproduce the defect.

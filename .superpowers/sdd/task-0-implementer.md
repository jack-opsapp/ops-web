# Task 0 Implementer Report

**Task:** Reconcile the branch, live schema, and service costs
**Date:** 2026-07-24
**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/lead-intake-api`
**Branch:** `feat/lead-intake-api`
**Result:** complete, with paid-resource and account-contract gates still closed

## Outcome

- Proved the prepared checkout is an isolated linked worktree and began from the
  clean recorded base `5f066c5aff0d8c5960f8418213756037e963d731`.
- Fetched and cleanly merged `origin/main`
  (`998211dfa910a2ff7a16462b68fd191f8974b4a2`) without a conflict or discarded
  lifecycle/email behavior.
- Recorded merge commit
  `b4fe78042e629b461c5d8d38f6f82083c1101b23`.
- Ran the full suite twice and established the second unchanged run as the
  commit-specific known-red baseline.
- Read the affected sync, summary, correspondence-classification,
  relationship-matching, and migration paths end-to-end.
- Completed targeted live Supabase reads without applying DDL.
- Recorded current official service rates, three volume scenarios, formulas,
  conditional allowances, account gaps, and the approval boundary.
- Changed no feature code, design, infrastructure, external account, paid
  tier, deployment, migration, or pilot state.

## Verification evidence

Accepted full-suite command:

```bash
npm test -- --run
```

Accepted result at merged commit:

```text
Test Files  4 failed | 951 passed | 1 skipped (956)
Tests       12 failed | 9068 passed | 5 skipped (9085)
Duration    82.42s
Exit code   1
```

The exact four files, 12 tests, assertion output, and transient first-run
worker-timeout investigation are in
`docs/runbooks/external-api-test-baseline.md`. Both first-run-only failures
passed together in a focused unchanged rerun (two files, 11 tests), and the
second full run returned to the historical known-red set.

Runtime evidence:

- bundled local runtime: Node `v24.14.0`;
- repository engine: Node `22.x`;
- connected Vercel project: Node `24.x`;
- CI workflow: Node 20, now unsupported by Supabase and recorded as a separate
  readiness gap.

## Reconciled implementation seam

The approved design remains correct and was not changed.

Current main moved the correspondence write boundary:

- `public.record_opportunity_correspondence_event(...)` now owns company and
  opportunity lock order, exact activity validation, provider-message
  idempotency, and event/counter projection atomically;
- recruiting-provider noise is classified before ordinary correspondence and
  remains non-meaningful;
- exact-message recovery now runs through separate reparent and create-target
  wrappers/private delegates;
- the relationship matcher remains provider-thread authoritative and must not
  turn external intake into a dedupe decision: each genuine external inquiry
  still creates a fresh lead.

Task 13 in the implementation plan now carries one narrow reconciliation note
to extend that command in place, preserve the new invariants, and prove both
recovery wrappers. It explicitly forbids restoring the old two-request
insert/apply seam.

## Live database evidence and gap

Supabase project `ijeekuhbatykdomumfjx` (`ops-app`) read back
`ACTIVE_HEALTHY`, `us-west-2`, PostgreSQL `17.6.1.063`.

Targeted live reads confirmed:

- core customer/opportunity, lifecycle-event, invoice/payment, notification,
  and assignment column contracts;
- current correspondence columns and the absence of planned versioned
  first-response evidence;
- RLS on relevant lifecycle, finance, notification, email-thread, and
  assignment tables;
- forced RLS with no direct policy on
  `unassigned_lead_assignment_deliveries`;
- currently applied relevant migrations and no applied collision in the
  reserved external API sequence.

The live migration inventory continues through
`20260723233348 operator_one_tap_lead_follow_up`. Relevant current migrations
for atomic correspondence projection, exact-message lifecycle recovery, and
company-mailbox intake ownership are applied.

Repeated broader catalog/routine queries ended with the exact connector error:

```text
Connection terminated due to connection timeout
```

Therefore complete live index/constraint/grant/routine-definition readback is
recorded as unavailable, not inferred. The checked-in applied migrations were
read for those definitions, and every migration task remains required to
repeat narrow live reads before SQL is written.

## Cost gate

The expected scenario is approximately:

- 1,000 leads, 2,000 files, 9.8 GiB scanned;
- 100,000 API requests and 1,000,000 Redis commands;
- `$3.70/month` modeled variable infrastructure in month one if shared
  allowances are unused;
- approximately `$6.78/month` variable by month 12 if accepted files
  accumulate with no shorter retention;
- approximately `+$200/month` for production-grade Upstash Prod Pack, making
  Redis availability the dominant fixed decision.

AWS account resources/usage, GuardDuty eligibility, CloudFront
plan/allowances, Upstash contract, Vercel credits/function sizing, Supabase
headroom, and the Supabase Data API default-privilege setting were not exposed
by the available safe read-only paths. The runbook lists every gap and formula.

Status remains:

> **NOT APPROVED — DO NOT PROVISION, DEPLOY, APPLY A MIGRATION, CHANGE A PAID
> TIER, OR ENABLE A PILOT.**

## Files owned by Task 0

- `.superpowers/sdd/task-0-implementer.md`
- `docs/runbooks/external-api-cost-and-service-gate.md`
- `docs/runbooks/external-api-test-baseline.md`
- `docs/plans/2026-07-23-external-lead-intake-and-analytics-api.md` (nine-line
  Task 13 seam reconciliation only)

The approved design file is unchanged. No feature source, migration, lockfile,
dependency manifest, generated type, or infrastructure file changed.

## Self-review

- Scope is documentation/reconciliation only.
- Every price is labeled as a public planning input or conditional allowance.
- No credential value, secret, or signed URL is present.
- Account contract gaps are explicit.
- Baseline failures are exact, not summarized as green.
- The plan delta is limited to the moved seam required by Task 0.
- No push, deploy, migration apply, provisioning, tier change, or pilot action
  occurred.
- Intended atomic commit message:
  `chore(api): reconcile external api branch baseline`.

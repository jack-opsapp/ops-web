# Phase 19 site-visit parent integration plan

> Required execution skill: `custom-skills:executing-plans` (OPS override).

**Goal:** Integrate the complete accepted site-visit vertical with current local main and the deployed deck-geometry successor, preserving unrelated work and all release/authority gates.

**Architecture:** Merge into the existing isolated phase worktrees without rewriting history. Preserve active V23/V9 public MCP behavior and historical immutable pins; V22/V17 site-visit discovery and preparation remain dormant. Preserve all released SwiftData V1–V27 shapes and add only V28, without inventing actor authority for old queued work.

**Tech stack:** Node 22.23.2, TypeScript/Vitest, PostgreSQL 17 synthetic fixtures, SwiftData/XCTest.

**Design system:** Existing `.interface-design/system.md` read; no design, styling, copy or animation changes planned. Existing reviewed UI is preserved.

**Required skills:** `custom-skills:writing-plans`, `custom-skills:executing-plans`, `superpowers:using-git-worktrees`, `superpowers:verification-before-completion`, `supabase:supabase`, and `superpowers:finishing-a-development-branch`. Load debugging/test-driven-development skills if integration reveals a product defect; load relevant visual skills before any presentation change.

## Boundaries

- No push, deployment, production SQL mutation, policy reseal, enrollment, host grant/consent change, company activation, provider message, device installation or iOS release.
- Preserve the shared web checkout's tracked UI work and untracked artifacts; never stash, restore or stage it.
- Existing private phase branches are parent-owned after the accepted handoff. Keep them and their original commits intact.
- The iOS Bugs coordinator released the build baton. Independently check processes and use only the existing private P19 simulator, caches and a new result-bundle suffix. No competing build.
- No broad-suite or production readiness claims from bounded local proof.

## Task 1 — Freeze inputs and integrate

1. Refresh all three remote main references read-only. Record exact phase/local/remote heads and shared-checkout dirty-file hashes before mutations.
2. Web phase head `33af1aaf686af928fe52480cd55fef3fb10e0f1f`; local main snapshot `cabebb8caf9e8c19b5e2ee8f315391dd89af5ff7`; remote/deployed deck successor `4f6f49f1ec541627df4ab5aa5f7826dde2f9a902` is already an ancestor of local main. Merge the exact local snapshot into the phase branch, preserving both sides of the four shared registry/factory/scope files.
3. iOS phase head `b028aa553f52a1fb8c0ee123c95e937a2a4bd98a`; local main snapshot `b08de1042bed5d272d52daa83ef1bc30a501fa86`. Merge that exact snapshot. There are no overlapping changed paths from phase base `8553b1b4`; retain the calendar-address, toast/PIN, and full-receipt repairs.
4. Bible phase head `41d76a13e81e639f8bdf1b0c59f37399d63af317`; local main snapshot `91b52e679980a0b9c60a2fd4a2ab71716d5a4d36`. Merge that snapshot, retaining both append-only sections in chapters 03/04/07. Preserve existing anchors and separate applied deck SQL from six unapplied site-visit candidates.
5. Use merge commits, not rebase/cherry-pick subsets. Explicitly stage only resolved owned files. Run `git diff --check` and inspect the merge diff before committing.

## Task 2 — Prove the combined boundaries

1. Fresh baseline workflow run: Node 22.23.2 with `tests/site-visit-workflow.vitest.config.ts`; require 115 passing cases before merge.
2. Rerun workflow/read tests and the four focused protocol/runtime/limiter/approval suites after integration. Reconcile stale snapshot expectations against the actual V23 default without weakening dormant-site-visit or authority assertions.
3. Run deck successor/OAuth/server factory/exposure regression suites and focused production/protocol TypeScript. Verify old V14 pins still use their old contract; public registration remains V23/V9 with no new site-visit permissions or tools. Verify V22 remains unselectable through the public factory.
4. Verify each of the six site-visit SQL files against its committed hash and Bible mirror; run existing synthetic workflow, phone and rate fixtures if their integration inputs changed. No live business query/write is needed for local integration.
5. Run one serial, app-hosted iOS batch against the merged source: released schema fingerprints, populated V27→V28 independent reopen, site-visit migration/write/recovery/field paths and overlapping calendar boundary tests. Reuse private cache paths but a fresh result bundle. Report optional private-device-copy skips separately.
6. Independently compare V1–V27 fixture values to baseline and verify V28 remains the sole new schema. Preserve exact prior scalar/payload custody rather than rewriting fixtures to bless changed historical shapes.

## Task 3 — Record and hand off local integration

1. Commit a bounded integration proof index under `docs/artifacts/phase19/`, referencing exact merged heads and fresh commands/results. Preserve earlier failure/review provenance.
2. Update Bible chapters 03/04/07 plus the handoff to state the verified integration outcome and still-unapplied/unreleased state.
3. Recheck current local mains and dirty hashes. Only fast-forward local main where it is still the inspected base and does not overwrite tracked/untracked work or conflict with an active owner; otherwise retain the tested integration branch and identify the exact remaining integration boundary.
4. Release the shared iOS build baton after the owned process exits. Preserve worktrees and verification artifacts.
5. Report local integration separately from deployment, migrations, exposure/enrollment, native-host acceptance, physical-device canaries and App Store release. Request only the genuine next release authority, never a technical review from Jackson.

## Progress

- Baseline workflow tests: 115/115 passed on Node 22.23.2 before integration.
- Remote refs refreshed; exact dirty-file hashes retained in the parent tool evidence.
- Implementation/integration and post-merge proof are not yet complete.

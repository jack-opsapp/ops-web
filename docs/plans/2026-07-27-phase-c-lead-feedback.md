# Phase C Lead Feedback — Implementation Plan

**Date:** 2026-07-27
**Design:** `docs/superpowers/specs/2026-07-27-phase-c-lead-feedback-design.md`

## 1. Lock the database contract with failing tests

- Add a migration contract test for the feedback and review tables, RLS/grants, actor/company derivation, Phase C gate, canonical mappings, lifecycle/disposition writes, retry identity, and guarded Undo.
- Add the generated migration with the two tables and three guarded RPCs.
- Update generated database types.

## 2. Build the bounded classifier prior with failing tests

- Add pure tests for normalization, exact evidence, sender bounds, independent domain threshold, positive evidence, duplicate/neutral deferral, uncertainty behavior, and free-text exclusion.
- Implement the pure policy and the bounded service-role loader.
- Add a durable review writer that stores identifiers and structured numeric evidence only.

## 3. Integrate future-message ingestion

- Add `AISyncReviewer` tests proving Phase C gating, prior application, manual-result preservation, and deferred-review output.
- Apply feedback after the model result and before new-lead persistence.
- Persist deferred cases to the review queue and mark ordinary inbox threads `require_human_review`.
- Apply the same bounded policy to unmatched initial-import triage while leaving strong deterministic platform/pattern recognition intact.

## 4. Build the iOS correction flow with failing tests

- Add reason/outcome and interaction-policy tests first.
- Add DTOs and repository RPC methods for context, apply, and Undo.
- Replace Phase C discard confirmation with the tokenized one-tap reason sheet and optional context disclosure.
- Preserve the existing disabled-mode education/confirmation while routing its final write through the neutral authoritative contract.
- Update every discard entry point and local opportunity state.
- Add an Undo toast that calls the guarded retraction RPC.

## 5. Document the live architecture

- Update the Software Bible data, lifecycle/email intelligence, and iOS interaction sections after code behavior is final.
- Record migration status as local/not applied.

## 6. Verify from narrow to full

- Run focused Web unit/migration tests, Web type-check, formatting, and the full relevant test suite.
- Run focused iOS unit tests, a generic-device build, and the full OPS test target on the mandated simulator with worktree-local package and DerivedData paths.
- Run design-system source audit and inspect the reason sheet at the required phone frame.
- Run a read-only shadow evaluation against representative recent live contexts; make zero writes.
- Review diffs for secrets, unrelated files, unsafe live actions, and missing docs.
- Commit atomic local changes in each repository. Do not push.

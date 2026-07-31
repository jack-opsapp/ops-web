# Phase C Capability-Safe Conversation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make Phase C fail closed around released OPS capabilities while turning Guided Catalog Setup into a compact, full-height conversation that safely accepts quick follow-ups and corrections.

**Architecture:** A build-owned capability manifest and server-owned question policy sit between model output and all durable state. Operator input is acknowledged through a revisioned session ledger before generation; Phase C may publish only through a compare-and-set fence covering session version, input revision, and capability-manifest revision. The Guided Catalog screen uses one transcript scroll owner with a measured floating composer/control overlay.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, Supabase/Postgres migrations, Framer Motion, Lucide, Vitest, Testing Library, Playwright

**Design System:** `.interface-design/system.md` and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`

**Required Skills:** `custom-skills:ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:wizard-audit`, `ops-copywriter:ops-copywriter`, `animation-studio:animation-architect`, `animation-studio:web-animations`, `custom-skills:Elite Animations`, `superpowers:test-driven-development`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`

---

### Task 1: Establish the executable-capability manifest

**Skills:** Systematic debugging and test-driven development.

**Files:**
- Create: `src/lib/catalog-setup/phase-c/catalog-capability-manifest.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/catalog-capability-manifest.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/schemas.ts`
- Modify: `src/lib/catalog-setup/phase-c/types.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/schemas.test.ts`

**Design tokens:** N/A.

1. Write failing tests proving the manifest exposes only released catalog operations, marks dynamic material rules/capability bindings/supplier automation/Deck Designer geometry unavailable, and treats unknown references as unavailable.
2. Run the focused manifest and schema tests. Confirm failure because no manifest or strict capability revision exists.
3. Add the immutable manifest revision, supported question intents, supported blueprint action types, and unavailable capability declarations.
4. Extend the question and blueprint contracts with stable intent/capability and manifest-revision fields while retaining normalization support for pre-migration interview rows.
5. Run the focused tests and confirm they pass.
6. Commit the manifest and schema contract.

### Task 2: Make operator-visible questions server-owned

**Skills:** OPS copywriter, interface design, and test-driven development.

**Files:**
- Create: `src/lib/catalog-setup/phase-c/question-policy.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/question-policy.test.ts`
- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Modify: `src/lib/catalog-setup/agent/__tests__/setup-agent-service.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/semantic-validator.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/semantic-validator.test.ts`

**Design tokens:** Product copy only; no visual tokens.

1. Write failing tests proving unavailable and unknown intents never produce question text/options, supported intents resolve to exact server-owned copy, hallucinated capability references fail without a turn, and unsupported blueprint actions fail validation.
2. Run the focused policy, agent-service, and semantic-validator tests. Confirm the expected capability-safety failures.
3. Change guided model output so question turns select a bounded intent and context rather than writing operator-visible behavior/options.
4. Resolve every accepted question through localized, server-owned templates for service, supplier identity, product identity/options, pricing, quote display, tax, storefront, task type, and static material quantities.
5. Pass the current manifest and allowed decisions into generation, reject unavailable capability references, and stamp review blueprints with the manifest revision.
6. Reject dynamic material rules, capability bindings, supplier-cost automation, Deck Designer geometry, arbitrary measure sources, and arbitrary capability keys at semantic validation.
7. Run the focused tests and confirm they pass.
8. Commit the generation and validation boundary.

### Task 3: Add the revisioned operator-input ledger

**Skills:** Test-driven development and wizard failure-mode auditing.

**Files:**
- Create: `supabase/migrations/20260727210000_phase_c_input_revision_fence.sql`
- Create: `src/lib/catalog-setup/phase-c/input-ledger.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/input-ledger.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/schemas.ts`
- Modify: `src/lib/catalog-setup/phase-c/types.ts`
- Modify: `src/lib/catalog-setup/phase-c/conversation-history.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/conversation-history.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/session-service.ts`
- Modify: `src/lib/catalog-setup/phase-c/__tests__/session-service.test.ts`

**Design tokens:** N/A.

1. Write failing tests for append, quick follow-up, edit-latest, remove-latest, bounded superseded audit history, visible-conversation filtering, and refusal to edit/remove an accepted input.
2. Run the focused ledger/conversation/session tests and confirm they fail because session input revisions do not exist.
3. Add `input_revision`, `processed_input_revision`, `input_ledger`, and `capability_manifest_revision` with bounded shape/range checks and a safe backfill.
4. Implement pure ledger reducers that use stable input IDs, preserve raw answers and display messages, allow changes only to the newest queued input, and keep superseded/removed entries hidden from the normal transcript.
5. Normalize new and legacy session rows without discarding existing operator-visible history.
6. Run the focused tests and confirm they pass.
7. Commit the migration and ledger primitives.

### Task 4: Persist input immediately and fence stale generation

**Skills:** Test-driven development, systematic debugging, and wizard failure-mode auditing.

**Files:**
- Create: `src/lib/catalog-setup/phase-c/input-service.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/input-service.test.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/messages/route.ts`
- Create: `src/app/api/catalog/setup/sessions/[sessionId]/messages/__tests__/route.test.ts`
- Modify: `src/lib/catalog-setup/phase-c/turn-service.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/turn-service-revision.test.ts`
- Modify: `src/app/api/catalog/setup/sessions/[sessionId]/turn/route.ts`
- Modify: `src/app/api/catalog/setup/sessions/[sessionId]/turn/__tests__/route.test.ts`

**Design tokens:** N/A.

1. Write failing service/route tests proving append returns before generation, edit/remove require the newest queued input, two quick messages share one next Phase C answer, stale generation performs no state update, and retrying the current revision remains safe.
2. Add failing tests proving an input or manifest revision change after review makes commit produce zero writes.
3. Run the focused input, turn, route, and commit tests and confirm the expected failures.
4. Implement authenticated append/edit/remove operations with session-version compare-and-set and immediate session readback.
5. Make turn generation read queued inputs from the durable ledger instead of browser-supplied answers.
6. Apply generated facts/question/review only when session version, input revision, and manifest revision still match; otherwise return the current session as a superseded generation without publishing stale output.
7. Mark accepted ledger/conversation inputs processed in the same atomic update as the assistant response.
8. Revalidate manifest revision and supported actions before commit journal creation or catalog writes.
9. Run the focused tests and confirm they pass.
10. Commit the input API and generation/commit fences.

### Task 5: Write the visual and interaction regressions before changing the UI

**Skills:** Test-driven development, interface design, UI/UX accessibility guidance, and wizard audit.

**Files:**
- Modify: `src/components/catalog/setup/__tests__/guided-catalog-setup.test.tsx`
- Modify: `src/components/catalog/setup/__tests__/catalog-setup-route.test.tsx`
- Modify: `tests/e2e/catalog-setup-viewport.spec.ts`
- Update: `tests/e2e/support/catalog-setup-*` only if the existing fixture cannot express queued/long-transcript states.

**Design tokens:** `control-32`, `icon-16`, `rounded-modal`, `rounded-chip`, `glass-dense`, `surface-input`, `surface-hover`, `text`, `text-2`, `text-3`, `agent`, `line`, `ops-accent`, `EASE_SMOOTH`.

1. Add component tests for sending while Phase C works, queued follow-up rendering, edit/remove availability, stale-response suppression, upload inside the composer, paper-airplane plus `SEND`, loader semantics, typewriter accessibility, and reduced-motion fallbacks.
2. Add browser assertions at 915 × 685, 1280 × 720, 1440 × 900, and a narrow viewport for the single scroll owner, full-height transcript, compact overlay, complete latest question, and transcript bottom clearance equal to or greater than the measured floating overlay.
3. Add a long-conversation browser case proving transcript-local follow behavior and stationary ancestor/page scroll positions.
4. Run the focused component and viewport tests against the current UI. Confirm they fail for the existing in-flow composer, blocking input, spinner, abrupt response, separate upload row, and normal-flow footer.
5. Capture the current implementation at the four required viewports under `docs/artifacts/guided-catalog-setup/capability-safe-before-*.png`.
6. Commit only the failing regression tests and before artifacts.

### Task 6: Build the full-height conversation and floating composer

**Skills:** OPS design, interface design, frontend design, UI/UX Pro Max, OPS copywriter, and design-system token discipline.

**Files:**
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Modify: `src/components/catalog/setup/catalog-setup-route.tsx`
- Modify: `src/lib/catalog-setup/motion.ts`
- Modify: `tailwind.config.ts` only if the active design system lacks an explicit required composer geometry token.
- Modify: `src/i18n/dictionaries/en/catalog-setup.json`
- Modify: `src/i18n/dictionaries/es/catalog-setup.json`

**Design tokens:** Existing OPS canvas, glass, line, text hierarchy, compact web control, icon, focus, radius, spacing, z-index, and motion tokens. No raw colors, radii, font sizes, icon dimensions, or fixed overlay clearance.

1. Replace local optimistic-only turns with the durable message API; keep the composer enabled while generation runs and cancel only the obsolete client request.
2. Render accepted, queued, edited, removed, superseded, retry, and error states from the session ledger without exposing hidden audit entries in the normal transcript.
3. Make the section full width/full height, preserve one transcript scroller, and keep message text at a readable inner measure.
4. Float a compact dense-glass composer over the transcript. Use `ResizeObserver` to drive transcript bottom clearance from the actual overlay height.
5. Use the shared `Textarea` at one-line initial height with bounded auto-growth; keep upload inside the field and render the 16px Lucide paper airplane with localized `SEND`.
6. Float `START OVER`, `USE ANOTHER METHOD`, and `BACK TO CATALOG` as compact neutral chips outside the composer surface.
7. Pause auto-follow when the operator scrolls away from the bottom and show a localized latest-message chip; never scroll an ancestor.
8. Keep choice, review, commit, attention, upload, start-over, alternate-method, inventory-list, and exit paths reachable.
9. Run the focused component/route tests and confirm they pass.
10. Commit the conversation layout and interaction behavior.

### Task 7: Add Phase C motion without adding noise

**Skills:** Animation Architect, Web Animations, Elite Animations, accessibility, and OPS design.

**Files:**
- Create: `src/components/catalog/setup/phase-c-activity.tsx`
- Create: `src/components/catalog/setup/phase-c-typewriter.tsx`
- Create: `src/components/catalog/setup/__tests__/phase-c-activity.test.tsx`
- Create: `src/components/catalog/setup/__tests__/phase-c-typewriter.test.tsx`
- Modify: `src/components/catalog/setup/guided-catalog-setup.tsx`
- Modify: `src/lib/catalog-setup/motion.ts`

**Design tokens:** `agent`, `agent-text-2`, `fill-neutral-dim`, `EASE_SMOOTH`, existing fast/normal durations, and the 150ms opacity-only reduced-motion fallback.

1. Write failing tests for a semantic full-text accessibility copy, character reveal only for newly accepted responses, animation cancellation, static reduced-motion loader, and immediate reduced-motion response.
2. Run the motion component tests and confirm they fail because the components do not exist.
3. Implement the bar-ripple intelligence indicator with transform/opacity animation only, existing Motion infrastructure, no spring, and no new dependency.
4. Implement requestAnimationFrame-driven typewriter reveal with cleanup, stable full-text screen-reader exposure, and progress callbacks for transcript-local follow.
5. Seed existing/persisted assistant IDs as already revealed so history never retypes after reload.
6. Run the focused motion and Guided Catalog component tests and confirm they pass.
7. Commit the Phase C motion components.

### Task 8: Make the prevention rules permanent

**Skills:** OPS design, interface design, OPS copywriter, and design-system audit.

**Files:**
- Modify: `.interface-design/system.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/07_SPECIALIZED_FEATURES.md`

**Design tokens:** The same compact composer, 16px/20px icon, dense-glass, chip, motion, and reduced-motion tokens used in production.

1. Replace the obsolete icon-only composer rule with the founder-approved compact paper-airplane plus `SEND` rule and retain the prohibition on mobile touch-target inflation.
2. Document measured floating-composer clearance, one transcript scroll owner, and explicit semantic icon tokens.
3. Document the Phase C capability boundary: metadata does not establish runtime behavior, Deck Designer geometry remains unavailable to Phase C, and future activation requires a released consumer plus manifest revision.
4. Run the design-system audit against every changed UI file and fix all scoped violations.
5. Commit the versioned interface guidance and Bible update. If the loose design-system project is not in Git, report its exact changed file separately.

### Task 9: Verify the complete customer-visible outcome

**Skills:** Verification before completion, design-system audit, wizard audit, and finishing a development branch.

**Files:**
- Update: `docs/artifacts/guided-catalog-setup/capability-safe-after-*.png`

1. Run Guided Catalog Setup component tests and record the exact count.
2. Run all Phase C/capability/input/API focused tests and record the exact count.
3. Run the complete catalog-related Vitest suite and record files/tests/failures.
4. Run the four required browser viewport cases plus long-conversation and reduced-motion cases. Inspect bounding boxes and every screenshot.
5. Confirm page/route scroll positions remain stationary and the transcript bottom message clears the measured composer overlay.
6. Run type-check, full lint, production build, `git diff --check`, and a scoped hardcoded-token/icon-dimension scan.
7. Re-read this design and verify each capability, interaction, layout, control, motion, accessibility, and authorization requirement line by line.
8. Capture after screenshots at 915 × 685, 1280 × 720, 1440 × 900, and the narrow viewport.
9. Commit only scoped source, tests, migrations, documentation, and proof artifacts.
10. Do not push, merge, apply the migration, touch live tenant data, or deploy without Jackson's explicit authorization.

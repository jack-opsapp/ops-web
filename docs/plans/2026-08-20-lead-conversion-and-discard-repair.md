# Lead Conversion, Discard, and Lifecycle Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make lead-to-project conversion reliably load projects, use the canonical tokenized address field, let an operator choose settled lead photos, make every discard reason actually discard, restore lead-detail actions, and archive future-timing deferrals as `not_now`.

**Architecture:** Keep `convert_opportunity_to_project` backward-compatible by carrying explicit photo-selection arrays inside `p_evidence`; old clients that omit the arrays retain today's select-all behavior. The database validates selections against the locked lead, records them on the conversion event, and makes both direct lead-photo copying and durable email-photo materialization respect that immutable selection. The shared discard RPC remains the lifecycle authority, with `duplicate`, `not_a_fit`, `other`, and new neutral reason `created_by_error` mapped atomically to `discarded`. The guarded email deferral RPC archives with `not_now` instead of writing Lost, while preserving its immutable evidence and future follow-up date.

**Tech Stack:** SwiftUI, MapKit, Supabase Swift, Next.js/React, TypeScript, PostgreSQL/PLpgSQL, Vitest, XCTest.

**Design System:** iOS `OPSStyle` + `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md` + `mobile/MOBILE.md`; web `.interface-design/system.md`.

**Required Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `supabase:supabase`, `custom-skills:ops-design`, `custom-skills:interface-design`, `custom-skills:mobile-ux-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`.

---

### Task 1: Pin the broken contracts with failing tests

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`.

**Files:**
- Modify: `ops-ios-lead-conversion-repair/OPSTests/Pipeline/ConvertSheetMatchingTests.swift`
- Modify: `ops-ios-lead-conversion-repair/OPSTests/Pipeline/LeadAssignmentFoundationTests.swift`
- Modify: `ops-ios-lead-conversion-repair/OPSTests/Pipeline/LeadDispositionFeedbackTests.swift`
- Create: `ops-web-lead-disposition-repair/tests/unit/supabase/lead-conversion-selection-contract.test.ts`
- Modify: `ops-web-lead-disposition-repair/tests/unit/pipeline/discard-feedback-toast.test.tsx`
- Modify: `ops-web-lead-disposition-repair/tests/unit/pipeline/use-stage-transition-discard.test.tsx`
- Modify: `ops-web-lead-disposition-repair/tests/unit/services/lead-disposition-feedback-service.test.ts`

**Steps:**
1. Add an XCTest that decodes a manual project candidate with `same_client: null` and expects `false` while preserving the row.
2. Add encoding tests that distinguish omitted photo-selection keys from explicit empty arrays and exact selected URL/attachment arrays.
3. Add discard vocabulary tests for `created_by_error`; change `duplicate`, `not_a_fit`, and `other` expectations to `.discarded` and lifecycle-changing.
4. Add TypeScript tests for the new reason, dictionary key, chip order, and discarded outcome handling.
5. Add migration-source assertions for non-null project flags, locked photo subset validation, immutable event payload selection, selection-aware email materialization, and neutral discard learning.
6. Run the focused tests and record the expected failures before implementation.

### Task 2: Repair the iOS conversion model and address state

**Skills:** `custom-skills:ops-design`, `custom-skills:mobile-ux-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`.

**Files:**
- Modify: `ops-ios-lead-conversion-repair/OPS/Services/LeadConversionService.swift`
- Modify: `ops-ios-lead-conversion-repair/OPS/Views/Leads/Sheets/ConvertToProjectSheet.swift`
- Modify: `ops-ios-lead-conversion-repair/OPSTests/Pipeline/LeadFormCoordinateTests.swift`

**Design tokens:** `OPSStyle.Colors.surfaceInput`, `line`, `text`, `text2`, `text3`, `textMute`, `oliveFillM`, `oliveLineM`, `oliveTextM`; `OPSStyle.Layout.spacing*`, `buttonRadius`, `touchTargetStandard`; `OPSStyle.Typography.*`.

**Steps:**
1. Give `ManualProjectLinkCandidate` a custom decoder using `decodeIfPresent(Bool.self) ?? false` for ranking flags.
2. Replace dictionary-only evidence with a typed `ConversionEvidence` that encodes `surface`, optional `selected_lead_photo_urls`, and optional `selected_email_attachment_ids`.
3. Add a small pure conversion-address state that owns address text, the coordinate pair, and the exact resolved-address fingerprint.
4. Replace the plain `LeadTextInput` with the shared `AddressAutocompleteField` and route autocomplete selection through that state.
5. Encode explicit null coordinates when an address no longer matches its resolved coordinate, preventing stale map pins.
6. Run the focused XCTest targets until green.

### Task 3: Add the settled-photo picker to the iOS conversion sheet

**Skills:** `custom-skills:ops-design`, `custom-skills:mobile-ux-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`.

**Files:**
- Modify: `ops-ios-lead-conversion-repair/OPS/Services/LeadConversionService.swift`
- Modify: `ops-ios-lead-conversion-repair/OPS/Views/Leads/Sheets/ConvertToProjectSheet.swift`
- Reuse: `ops-ios-lead-conversion-repair/OPS/Views/Leads/Components/LeadAttachmentContentLoader.swift`
- Reuse: `ops-ios-lead-conversion-repair/OPS/Views/Leads/Components/LeadPhotosSection.swift`
- Modify: `ops-ios-lead-conversion-repair/OPSTests/Pipeline/LeadAssignmentFoundationTests.swift`

**Design tokens:** Existing conversion-sheet field/card tokens only; 84pt tile density from `LeadPhotosSection`; 44pt minimum controls; semantic olive selected state plus checkmark for color independence.

**Steps:**
1. Add a read-only conversion-photo candidate fetch that returns manual lead URLs plus server-eligible email attachments in authoritative order.
2. Add a pure selection reducer: all settled candidates selected initially, tap toggles one, ALL/NONE are idempotent, refresh preserves surviving choices and selects genuinely new candidates only before the operator first changes the set.
3. Render `// PHOTOS TO PROJECT` between project identity and estimates, with mono `[selected/total]`, horizontal photo tiles, visible checkmarks, ALL/NONE actions, haptics, and accessibility labels.
4. Exclude local queued uploads from the selectable set and show `PHOTOS STILL SYNCING · NOT INCLUDED` only when needed.
5. Pass explicit arrays on every new conversion commit; hidden/idempotent recovery paths omit them so prior committed selections cannot be overwritten.
6. Verify zero-photo, select-none, mixed-source, refresh, offline-candidate-failure, and queued-upload states.

### Task 4: Correct shared discard behavior and web parity

**Skills:** `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter:ops-copywriter`.

**Files:**
- Modify: `ops-ios-lead-conversion-repair/OPS/DataModels/Enums/LeadDispositionFeedback.swift`
- Modify: `ops-web-lead-disposition-repair/src/lib/api/services/lead-disposition-feedback-service.ts`
- Modify: `ops-web-lead-disposition-repair/src/app/(dashboard)/pipeline/_components/discard-feedback-toast.tsx`
- Modify: `ops-web-lead-disposition-repair/src/app/(dashboard)/pipeline/_components/use-stage-transition.ts`
- Modify: `ops-web-lead-disposition-repair/src/i18n/dictionaries/en/pipeline.json`
- Modify: `ops-web-lead-disposition-repair/src/i18n/dictionaries/es/pipeline.json`

**Design tokens:** Existing discard reason rack and reason-sheet tokens; no new styling or motion.

**Steps:**
1. Add `created_by_error` as `CREATED BY ERROR` / `Creado por error` in the established reason order immediately before the catch-all.
2. Map `duplicate`, `not_a_fit`, `created_by_error`, and `other` to discarded in iOS expected behavior.
3. Remove the web review-deferred copy branch; a server `discarded` receipt keeps the existing discarded stage line.
4. Keep these ambiguous record/business-fit reasons neutral for classifier learning so they do not poison sender/domain priors.
5. Run focused iOS and web tests until green.

### Task 5: Implement the guarded database migration

**Skills:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:test-driven-development`.

**Files:**
- Create: `ops-web-lead-disposition-repair/supabase/migrations/20260820*_lead_conversion_photo_selection_and_discard_contract.sql`

**Steps:**
1. Replace `get_manual_project_link_candidates` ranking flags with `coalesce(..., false)` in both returned values and ordering.
2. Create `get_opportunity_conversion_photo_candidates(uuid)` as a read-only, tenant/permission-guarded RPC returning only settled manual lead photos and email attachments that pass the canonical conversion eligibility predicate.
3. Validate new evidence keys under the locked opportunity: JSON arrays only, strings/UUIDs only, unique, and exact subsets of current eligible candidates; raise a refreshable serialization error on drift.
4. Filter direct `project_photos` inserts by selected lead URLs when the key is present; absent key means legacy select-all.
5. Merge evidence into the immutable conversion-event payload and make both initial enqueue and later reconciliation respect `selected_email_attachment_ids`; absent key means legacy select-all.
6. Extend the feedback reason constraint with `created_by_error`; map `duplicate`, `not_a_fit`, `created_by_error`, and `other` to discarded while keeping learning polarity neutral.
7. Preserve function owners, security-definer search paths, grants, existing signatures, idempotency, and old-client behavior.
8. Run migration source tests and SQL formatting/static assertions.

### Task 6: Repair lead-detail taps and Phase C `not_now`

**Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `custom-skills:mobile-ux-design`, `supabase:supabase`.

**Files:**
- Modify: `ops-ios-lead-conversion-repair/OPS/Views/Leads/Components/LeadFieldEdit.swift`
- Modify: `ops-ios-lead-conversion-repair/OPSTests/Views/LeadFieldEditTests.swift`
- Modify: `ops-web-lead-disposition-repair/src/lib/email/terminal-stage-decision.ts`
- Modify: `ops-web-lead-disposition-repair/src/lib/api/services/conversation-state/acceptance-evaluation.ts`
- Modify: `ops-web-lead-disposition-repair/tests/unit/email/commercial-outcome-decision.test.ts`
- Extend the database migration from Task 5.

**Steps:**
1. Replace the gesture composition that swallows ordinary taps with a single interaction primitive that reliably distinguishes tap from hold.
2. Cover CONTACT and ASSIGNED TO through the shared reducer/interaction contract.
3. Add Kayla Creighton's exact customer deferral and operator acknowledgement as a commercial-outcome regression fixture.
4. Recognize firm hold/save/future-season language as budget/timing deferral.
5. Change the guarded deferral write from Lost to archived `not_now`, preserving follow-up timing, evidence, idempotency, and stage history.
6. Keep explicit permanent declines on the Lost path.

### Task 7: Document and verify end to end

**Skills:** `custom-skills:audit-design-system`, `superpowers:verification-before-completion`, `supabase:supabase`.

**Files:**
- Mirror applied SQL: `ops-software-bible-lead-conversion-repair/migrations/<ledger-version>_lead_conversion_photo_selection_and_discard_contract.sql`
- Modify: `ops-software-bible-lead-conversion-repair/03_DATA_ARCHITECTURE.md`
- Modify: `ops-software-bible-lead-conversion-repair/04_API_AND_INTEGRATION.md`
- Modify: `ops-software-bible-lead-conversion-repair/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

**Steps:**
1. Use lightweight source-contract checks during implementation, then run one combined simulator XCTest/build with worktree-local DerivedData and `.spm-local` as the final iOS gate.
2. Run focused Vitest suites, TypeScript checking, lint on touched web files, and `git diff --check` in all repos.
3. Audit new SwiftUI and React code for hardcoded color, spacing, radius, and font values; verify accessibility labels and non-color selected state.
4. Apply the migration through Supabase's migration tool only after all local contract tests pass.
5. Read back function definitions, constraints, grants, and safe zero-write probes; run security/performance advisors.
6. Mirror the exact ledger-stamped migration into the Bible and update canonical chapters with code/migration references.
7. Commit iOS, web, and Bible changes atomically. Do not push or release without explicit approval.

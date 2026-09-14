# Email routing continuation repair

**Goal:** Route valid new inquiries, replies on new provider threads, and third-party referrals to the correct customer and opportunity; complete downstream work without weakening safety checks.

**Architecture:** Separate proof of an existing conversation from authorization to create a new lead. Require exact identity for automatic relationship reuse, preserve uncertain mail, and keep new-work evidence mandatory for creation. Apply existing guarded recovery contracts to separately reviewed live records after code verification.

**Tech stack:** TypeScript, Vitest, Next.js, Supabase/Postgres, Gmail.

**Design system:** N/A; backend correction only.

**Required skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:requesting-code-review, superpowers:verification-before-completion, supabase:supabase.

## 1. Refresh evidence

Re-read affected activities, opportunities, customer identities, thread bindings, and Phase C work. Retain customer evidence only in the private incident directory. Verify deployed code before editing. Work in the existing isolated checkout, starting integrated revision `63f1d3f6b5285d5a9345640c32717b9b2609db5c`.

## 2. Remove weak name-only false conflicts

Files: `src/lib/api/services/email-matching-service-v2.ts`, `tests/unit/email/email-matching-service-v2.test.ts`.

Add a failing regression with distinct full names sharing a surname and different email identities. Reject surname-only suggestions while retaining review for plausible complete-name matches and exact identity conflicts. Run matcher regressions, including prior duplicate-prevention cases.

## 3. Attach existing-lead correspondence before checking permission to create

Files: `src/lib/api/services/sync-engine.ts`, `src/lib/email/opportunity-relationship-matching.ts`, focused behavioral tests.

Reproduce an existing customer's reply on a new provider thread without a new quote request. Resolve exact, unambiguous existing relationships before the new-work creation gate; this path cannot create customers or leads. Test ambiguous identity, terminal projects, operator identities, persistence failure, and replay.

## 4. Preserve the referred customer's identity

Files: the current effective-sender resolver and relationship matcher, `src/lib/api/services/sync-engine.ts`, tests at the real boundary.

Reproduce a known former customer's introduction of a different customer. Resolve referral evidence using the current introduction and independently corroborated participant/source data. Do not let the referrer's completed job own a distinct inquiry. Verify normal replies and existing-job service correspondence retain correct ownership.

## 5. Complete downstream work safely

Files: current Phase C lifecycle/handoff and commercial evaluation services, with focused tests.

Review the failing work against deployed September 12 fixes. Add failing behavioral tests for remaining defects. Preserve immutable decision evidence, expected-state guards, and client/project proof requirements. Separate exact data repairs from code that generates incorrect decisions.

## 6. Verify and recover

Run focused behavioral suites, scoped type checking, and independent review. Record unrelated baseline failures separately. Prepare exact idempotent recovery with current ownership checks, original provider dates/content, no provider sends or labels, and independent readback. Update the bible and sanitized proof; commit related files only. Verify deployment and live routing separately.

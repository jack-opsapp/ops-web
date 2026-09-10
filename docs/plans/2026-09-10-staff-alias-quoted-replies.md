# Staff alias quoted-reply repair

> Use custom-skills:executing-plans to implement this plan task by task, per OPS instructions.

**Goal:** Keep quoted staff signatures from suppressing customer correspondence, and preserve pending identity reviews durably.

**Architecture:** Staff alias evidence must come from the current author's unquoted signature, using shared strict quote handling plus a conservative quote-prefix boundary. Pending aliases retain the existing outbound review contract, but bypass internal-mail discard, learning, matching, and lead creation. Existing activity identity remains immutable.

**Tech stack:** TypeScript, Vitest, Supabase, Gmail/Microsoft 365.

**Design system:** N/A; backend only.

**Required skills:** systematic-debugging, custom-skills:writing-plans, custom-skills:executing-plans, test-driven-development, requesting-code-review, verification-before-completion, supabase.

## 1. Reproduce and correct quoted signature authority

- Add synthetic regression fixtures in `tests/unit/email/email-ingestion-routing.test.ts` for prefixed Apple Mail replies, line-wrapped Gmail headers, nested quotes, localized headers, short/quote-only bodies, forwards, and genuine unquoted signatures.
- Run the focused Vitest file and confirm the regression fails.
- Fix `authorControlledSignatureText` in `src/lib/email/email-ingestion-routing.ts`; keep the sender's signature, exclude quoted/forwarded history, and never resurrect a snippet when an explicitly empty body exists.
- Re-run routing, effective-identity, and conversation-state identity tests.

## 2. Preserve pending staff review messages

- Export an exact pending-alias predicate from routing.
- In `processSentEmail`, check new and existing pending aliases before the internal recipient short circuit. Capture the provider source, deduplicate, and retain an unlinked `staff_alias_pending` activity for review; do not learn from it, match a lead, update thread state, or create a customer.
- Preserve the immutable direction for already-ingested messages and stop on durable persistence failures.
- Add behavioral coverage for new candidates, later signature-free replies, verified/rejected identities, retry dedupe, and failures; verify wiring before internal discard/learning.

## 3. Verify and prepare exact recovery

- Run targeted regression suites for inquiry evidence, existing-job routing, staff identity, provider chronology, and recovery.
- Run scoped TypeScript and diff checks; request an independent review of the patch.
- Update the software bible and a sanitized proof note. No customer source bodies or identities enter public repository artifacts.
- Prepare private exact alias decisions and missing-message recovery inputs using current live schema and the established recovery service. No writes, replay, push, or deployment before production approval.
- Commit the coherent repair locally. Report verified findings, test results, and the concrete release/recovery approval needed.

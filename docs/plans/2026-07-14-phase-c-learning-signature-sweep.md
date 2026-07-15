# Phase C Draft-Learning and Email-Signature Sweep

**Goal:** Make every OPS-generated email visibly use the operator's effective signature while ensuring Phase C learns only the operator's authored style and durable edits, never signature/footer boilerplate.

**Hard constraints:** Never send email during audit or verification. Gmail and Microsoft 365 inspection is read-only. Do not apply migrations or mutate production rows. OPS signature wins over any provider signature.

## Implemented state (local, not deployed)

- Final sent subject/body and draft provenance flow through the durable outbound-outcome queue, with database-verified human authority and autonomous outcomes excluded from learning. Full-body writing/profile learning is restricted to verified operator-authored messages; operator-approved AI drafts contribute only the operator's durable edits.
- Repeated human-confirmed edits promote receipted writing-profile preferences; subject preferences require three examples and store de-identified templates only.
- Replies retain one normalized `Re:` subject. New-thread precedence is operator input, configured template, qualifying learned template filled from the current lead, contextual generation, then `Your inquiry`.
- OPS now has company/mailbox/operator-scoped signature records and deterministic precedence: operator OPS signature, mailbox OPS signature, exact provider identity, then none.
- Gmail `sendAs` signatures are imported read-only for the exact connected identity. Microsoft Graph does not expose the user's Office signature, so Microsoft users save or paste an OPS signature.
- One persistent notification per operator/mailbox deep-links to Email Settings while no effective signature exists, resolves when one becomes available, and reopens if all fallbacks are removed.
- Provider draft round trips strip all exact known signature revisions before appending the current signature, so signatures do not duplicate or enter learning samples. Historical scans fail closed and skip learning unless an exact connection-scoped signature revision is removed.
- This implementation remains isolated: migrations have not been applied and the application has not been pushed or deployed.

## Sweep 1: Audit learning from real draft outcomes

1. Reconcile a read-only sample of generated drafts with their final sent versions by immutable draft/provider-message identity.
2. Measure missing outcomes, unchanged sends, body edits, subject edits, discards, duplicate receipts, and incorrect profile types.
3. Trace every OPS, mailbox-draft, approval, lifecycle, manual-compose, and auto-send path into the canonical outcome owner.
4. Verify `learnFromEdits` behavior against the stored original/final pair, including repeated corrections, profile promotion, and milestone hooks.
5. Keep signatures, quoted replies, legal footers, and provider-added formatting outside both sides of the learning diff.

## Sweep 2: Add one effective-signature model

1. Verify the live Supabase schema before writing the migration.
2. Store a company/user/mailbox-scoped OPS signature plus an optional confirmed provider signature and source metadata.
3. Resolve deterministically: OPS signature, then imported Gmail signature or user-confirmed Office signature, then none.
4. Import the matching Gmail `sendAs` signature read-only. For Microsoft 365, require an OPS signature or an explicitly confirmed pasted/imported Office signature.
5. Sanitize allowed HTML, retain a plain-text equivalent, and audit who changed the OPS signature and when.

## Sweep 3: Render signatures without polluting learning

1. Keep the canonical authored body signature-free in draft history, edit diffs, writing profiles, and memories.
2. Render the effective signature as a separate, visible composer/draft-preview region and append it to provider draft/send bodies at one shared rendering boundary.
3. Add a stable marker/hash so a provider draft round trip can strip a known rendered suffix before re-rendering.
4. Apply the same resolver to AI drafts, manual drafts, approval/lifecycle drafts, provider-draft updates, auto-send, and final send.
5. Fail safely when signature lookup fails; never duplicate a signature or treat a post-delivery signature reconciliation error as permission to resend.

## Sweep 4: Prompt once when no signature exists

1. Create one persistent, deduplicated setup notification per user/mailbox when no effective signature exists.
2. Deep-link to Email Settings and resolve the notification only after an OPS signature is saved or a provider signature is successfully imported/confirmed.
3. Re-open the notification only if the effective signature is removed and no fallback remains.

## Required proof

- Resolver precedence and tenant/mailbox isolation tests.
- Gmail signature import fixtures and Microsoft no-signature fallback tests.
- HTML sanitization, plain-text rendering, marker/hash, and duplicate-prevention tests.
- Signature-free learning diff tests for unchanged, edited, discarded, provider-draft, and auto-send outcomes.
- Persistent notification dedupe/resolve/re-open tests.
- Full TypeScript, focused lint/format, changed email suites, and non-production PostgreSQL migration execution.
- Read-only provider-draft verification only. No email sends.

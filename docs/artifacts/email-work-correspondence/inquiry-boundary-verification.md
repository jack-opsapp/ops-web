# Inquiry-gated automatic lead creation — 2026-09-09

Status: implemented, tested, independently reviewed, and ready for explicit production release approval. This correction is not live. It builds on released ops-web `d86d5664b479d6ea8dfe1ae334a03645aa137efb` in the existing isolated workspace.

## Incident and correction

The [post-release production audit](post-release-audit-2026-09-09.md) found one new lead after the first release: Wix's “You've been assigned as a post author” notice created both an empty client and a lead. The recognized-platform shortcut bypassed classification when customer/project context was absent.

Automatic mailbox sync now has one client/lead creation path. Every unowned inbound candidate must have a classified `new_work` intent and a verbatim current-message excerpt before creating either record. The opportunity helper independently rechecks the source excerpt. Recognized domains, sender/subject patterns, forms, and outbound estimate subjects cannot authorize creation. Quoted old requests cannot supply current-message evidence.

Existing owned conversations and authenticated external-intake markers still link to the existing opportunity. Existing-job messages route through the already-released project/review RPC without creating sales records. Unclassified parsed forms and message-scoped forwards remain readable in Email Review. Borderline forms persist their classification audit before a final review receipt; replay creates no duplicate body/receipt.

Forms and forwards use the effective customer sender for classifier input and feedback. Shared transport threads cannot contribute full-thread reclassification or thread-level correction priors. Exact-message correction authority remains. Exact recovery passes the authoritative message scope even when a persisted source has no original wrapper headers. Eligible project suggestions remain after actual accepted creation and keep their assignment, feature, and execution guards.

Feature behavior: the existing `phase_c` classifier switch remains authoritative. When disabled, automatic sync does not create a lead without classification; ordinary messages remain in the inbox and parsed forms/forwards remain in review. `inbox_ui` still controls screen visibility only. Explicit operator-approved imports, manual lead creation, and authenticated external intake are separate unchanged entry points. The legacy raw-email webhook is already retired with HTTP 410.

## Reproduction and final proof

Before correction, the corrected authentic-form regression fixture reproduced seven unwanted creation failures while its genuine inquiry case passed. Added tests separately reproduced the unreadable deferred-form receipt, cross-customer transport/feedback contamination, and recovery losing message scope. Each failed before its corresponding correction and passed afterward.

The final run passed **320 tests in 20 files** (2026-09-09 16:48 PDT; exit 0). This includes 17 real `SyncEngine.runSync` cases with isolated provider/database doubles, 24 reviewer-thread cases, and 21 feedback-prior cases. It covers the exact Wix notice, Google review notice, configured patterns and forwards, quoted history, missing/null/invented evidence, genuine form creation and replay, readable deferred review and replay, inbound/outbound replies, warranty forms, and subcontact crew-damage correspondence. Separate matching, source identity, external-intake, import-review, classifier contract, and recovery suites also pass.

Commands (run from the worktree; `node` is the bundled runtime):

```sh
node node_modules/vitest/vitest.mjs run \
  tests/unit/email/email-work-routing.test.ts \
  tests/unit/email/contact-form-lead-gate.test.ts \
  tests/unit/email/email-opportunity-title-live-pattern.test.ts \
  tests/unit/email/sync-engine-*.test.ts \
  tests/unit/email/ai-sync-reviewer-*.test.ts \
  tests/unit/email/email-ai-classifier-thread-context.test.ts \
  tests/unit/email/external-intake-correlation-routing.test.ts \
  tests/unit/email/email-ingestion-effective-identity.test.ts \
  tests/unit/email/email-ingestion-routing.test.ts \
  tests/unit/email/import-email-work-review.test.ts \
  tests/unit/email/opportunity-relationship-matching.test.ts \
  tests/unit/services/lead-feedback-prior-service.test.ts \
  --maxWorkers=1 --minWorkers=1
node node_modules/typescript/bin/tsc --noEmit \
  --project docs/artifacts/email-work-correspondence/inquiry-tsconfig.json
git diff --check
```

Scoped TypeScript covers every changed TypeScript source/test and their transitive imports: exit 0. ESLint over the same 11 files: exit 0, zero errors, six existing `no-console` warnings in the reviewer/sync engine. Independent read-only review found no remaining actionable issues after the recovery correction.

## Proof limits and release

The full-repository TypeScript attempt exhausted Node's default approximately 4 GB heap and is not counted as a pass. No production build was run for this correction. Test doubles model provider/database state and use controlled classifier responses; they do not establish live model accuracy or replace a post-release production audit. Existing test setup emits nonfatal Firebase/provider-capture warnings; persistence assertions still pass.

No schema changes: the existing correspondence RPC and its prior SQL proofs are unchanged. No customer rows were repaired, no email was sent, no paid model evaluation was performed, and no inbox was replayed. Historical bad records remain unchanged.

Release requires Jackson's explicit approval under OPS root instructions. After approval, integrate against current main, run release checks, deploy, verify the exact customer-live commit, and perform a read-only audit of subsequent leads against their source messages and customer/project history. Do not treat a deployment or passing fixtures as proof of future model classification accuracy.

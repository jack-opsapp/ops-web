# Financial trial activation boundary

Local implementation and fictional protocol acceptance are complete. This document proposes the remaining real release and business actions; it grants none of them.

## Release and effect approval

1. Approve the exact Phase16 web/Bible commits for release and both generated migrations, in order: `20260908024426_financial_policy_readiness.sql`, then `20260908033425_financial_trial_oauth.sql`. The second migration pins the reviewed production OAuth/financial function definitions by MD5 and aborts on drift. Neither migration creates business records, clients, bindings or grants.
2. After the exact release, review the complete public/private function and trigger graph and approve its resulting exact SHA256 before installing that literal financial effect seal. Never replace review with an automatic `effect_revision = current()` production update. Read the installed and computed values back independently.
3. Public registration remains v14/v9. Financial v17/v12/v23 is limited to `get_company_context`, `inspect_financial_document`, and `prepare_financial_document`, with exactly `ops.company.read ops.customers.read ops.financial_documents.prepare ops.financial_documents.read ops.jobs.read`. Existing clients/grants are never upgraded.
4. A service-only nine-argument overload of `provision_mcp_oauth_canary_as_system` binds one exact client, current user, company, enrolled policy ID/hash, reviewed effect hash and absolute expiry (maximum two hours). The six-argument v3 function retains its existing purpose. No route automatically provisions a financial trial. A host-created ordinary DCR client remains on the public path.
5. Authorize preview/decision, code exchange, bearer, refresh, insert triggers and financial inspection/preparation/approval/replay all check current authority. Disable the exact binding with `disable_mcp_oauth_canary_as_system(client,user,company)`; it disables that client and revokes its grants/tokens. Wrong-subject disable cannot disable a financial client. Expiry, source/tax/owner/policy/effect drift also close the path. Nothing releases financial holds.

## Exact proposed first real trial

Use one new, clearly fictional isolated company named **OPS MCP FINANCIAL ACCEPTANCE — FICTIONAL**, CAD, with one dedicated signed-in fixture owner. Do not use Canpro, MAVERICK, PERSONA TEST POOL, or transfer an existing real user's company membership. Creating the company, owner login/OPS membership and the records below requires direct fixture-creation approval. Creation may not send an invitation, email, invoice or notification outside the fixture account. Record all returned company/user/client/project/note/tax/estimate/line IDs and hashes before requesting activation against those exact identities.

Fixture facts are fully specified:

- Customer: **Fictional Acceptance Customer**, with no deliverable email/address.
- Completed project: **Fictional Deck History**. One approved historical estimate in CAD: two hours of **Deck labour** at CAD100.00/hour; 0% discount, 0 minimum charge, taxable, 5% GST; subtotal CAD200.00, tax CAD10.00, total CAD210.00. Explicit historical currency and units are required.
- New project: **Fictional Deck Quote** for that same fictional customer. No existing estimate or official number.
- One active default tax: **GST**, exact rate 0.0500.
- One attributable source note on the new project: **Fictional trial only. Currency CAD. Unit hour. Historical line prices and explicit operator prices are permitted. Terms: Payment on completion. Every save requires exact approval in OPS. No delivery or issue is permitted.**
- Owner review: revision `phase16-fictional-host-1`; currency CAD; terms **Payment on completion**; units `hour`; price sources `historical_line` and `operator`. Enroll through the actual owner preview/decision UI; never bypass it with SQL.
- Golden request: a new private estimate for the new project, two hours at the exact historical price plus an explicitly approved 8% adjustment to unit prices/minimum charges. Quantity, unit, discount and tax remain unchanged. Expected unit price CAD108.00, subtotal CAD216.00, tax CAD10.80, total CAD226.80. Terms above, inclusions **Replace damaged boards**, exclusions **Railing**, empty client message.
- One fresh exact client/binding per host: **OPS Phase16 Fictional Claude Acceptance** with an allowlisted Claude callback; **OPS Phase16 Fictional ChatGPT Acceptance** with its allowlisted callback. Host setup must support the exact pre-registered client; an unrelated DCR registration cannot inherit this binding. Use the five scopes above, v17/v12, the actual enrolled policy hash and approved effect hash. Proposed duration: 30 minutes per binding, never more than two hours.
- Proposed financial-save ceiling: **one held estimate per host, two total**, each through a separate exact named-owner OPS approval and independent readback. Same-request and same-approval retries must return the same document/number. No automatic approval, delivery, PDF/portal publication, accounting synchronization, payment, hold release, extra revision, or change-order save is authorized by this proposal.

The local fixture uses engineering-only identities and is not the proposed production fixture. Production IDs, owner credentials and absolute trial times do not exist yet. After approved fixture creation, record them and obtain exact binding/financial-save approval before activation. This is a concrete isolated trial, not a request to choose a real customer's policy.

## Per-host acceptance evidence and cleanup

Keep Claude and ChatGPT records separate: authenticated host/version, exact user/company/client/grant and revision/ceiling, visible fresh consent labels, note/policy/history/effect hashes, request key, action/change-set/preview IDs, exact named OPS approval, durable receipt and independent header/line/number/hold/no-distribution readback. Never store bearer or refresh credentials.

Before approval, assert no estimate or official number exists. After approval, assert one held `draft` with exact cents/lines. Reconcile identical retries. Reject missing/changed policy, tax/source/owner drift, bad currency/unit/history, altered confirmation, scope expansion, stale consent, expiry, revocation and competing/uncertain attempts without number or document leakage. Instruction-like source content remains evidence only. Existing local Phase15/16 SQL proof covers immutable revisions and accepted change-order baselines; real host revision/change-order saves require separately specified authority.

Stop on any identity mismatch, unexpected tool/scope, failed receipt reconciliation or distribution effect. Disable both exact bindings and independently confirm inactive clients/grants/tokens and preserved holds. A local protocol pass, deployment READY, SQL receipt or unrelated Codex read never substitutes for either real host's acceptance.

## Current production evidence

At 2026-09-08 04:03:39 UTC, both Phase16 migrations are absent; financial policies, proposals, held estimates, v17 grants and financial bindings are all zero. Installed/current Phase15 effect hashes match `sha256:1dbb20f58a47881a7838a77a2ae69cb55aea8142ba41e5c9b62c0b73a21ae4c5`. See `production-closeout-readonly.json`. No production mutation occurred.

Canpro source evidence remains in `source-readiness.json`. Canpro is CAD with owner Jackson Sweet; it has no current tax, usable product or saved estimate. Two deleted historical products exist. Its source conflicts and exact price band remain owner decisions. The connected Codex account is MAVERICK PROJECTS LTD; its read-only company lookup provides no financial authority for this proposed trial.

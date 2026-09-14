# Phase 19 verification and local handoff

State: local implementation complete; final independent web and phone reviews accepted with no remaining actionable findings in scope. No push, deployment, production migration, company activation, OAuth consent/grant/exposure change, enrollment, customer message, or signed iOS release was performed. Parent task owns integration and release.

## Web and database evidence

- Final project Node runtime: `/Users/jacksonsweet/.nvm/versions/node/v22.23.2/bin/node` (22.23.2). No engine/runtime setting or existing schedule-change timezone guard was changed.
- `node node_modules/vitest/vitest.mjs run --config tests/site-visit-workflow.vitest.config.ts`:115 passing form, civil-time, service, approval and existing site-visit read tests. [Output](forms-and-civil-tests.log).
- Final local legacy/modern candidate protocol, dedicated limiter adapter, rendered approval and constructed runtime tests:146 passing (111 protocol +17 adapter +14 UI +4 runtime). [Output](candidate-discovery-final.log). This supersedes the earlier111-test protocol/UI run.
- Focused production TypeScript graph: exit0 with6GB maximum heap. Configuration: [tsconfig.focused.json](tsconfig.focused.json). The graph includes runtime, server factory, approval backend, review component and queue. This is not a claim that the repository's unrelated full suite was rerun.
- The separate focused protocol TypeScript graph (`tests/tsconfig.site-visit-protocol.json`) also exits0 under the same Node22 runtime.
- Combined PostgreSQL17 harness:24 passing groups, including the independent in-flight task writer test. It installs final phone protocol/discard and canonical/MCP migrations into a disposable fixture using captured live catalog definitions. [Summary](workflow-combined-proof.log), [cases](workflow-tests.log), [canonical booking](workflow-booking-tests.log), [concurrent lock](workflow-race-lock.log).
- All37 actual PostgreSQL outputs pass Node22 schemas, timezone arithmetic and proposal-to-receipt value binding. Includes proposals and receipts for all7 operations plus8 direct timezone outputs. [Counts](sql-output-contracts.log), [raw synthetic output](workflow-outputs.jsonl).
- Phone SQL protocol:69 checks including real simultaneous sessions, current authority, conflict custody, uploaded media, discard and cleared/unknown/untouched intent. The final phone report identifies the exact last regression and hosted result.
- Dedicated rate PostgreSQL harness:26 checks, including simultaneous requests and company aggregate bound. Task4 commit `ea5ca1b71` contains implementation and fixture; final rate report is retained with reviews.
- [Approval/timezone re-review](reviews/task-5-approval-re-review.md): all5 findings closed; independent24 PG groups and37 actual outputs revalidated. [Canonical booking review](reviews/task-3-booking-review.md), [earlier SQL boundary closure](reviews/task-3-workflow-boundary-re-review.md).
- [Final web integration review](reviews/final-web-integration-review.md): PASS, including closure of inherited unrelated catalog tools. The dormant candidate lists ten necessary existing discovery reads plus eleven site-visit operations, with only their required read/prepare scopes. Every retained discovery read exercises the actual constructed runtime's current-authority facade and generic durable limiter across both protocols; missing current membership denies before source access. Unrelated catalog/customer/financial preparations are absent and cannot dispatch.
- [Visual review](visual-review.md): actual component, English/Spanish tests, narrow320/390 browser layouts, expanded untrusted evidence. Static component proof only. No authenticated production queue or native-host acceptance claimed.

## Important proof boundaries

Phone implementation through `b15bf20f` preserves every releasedV1–V27 checksum and adds reservedV28 only. A populated V27 store migrates and independently reopens with full template/answer/outbox scalar custody intact and all seven new nullable properties nil. The final checksum, Deck migration and adjacency run passes7/7. Two optional private-device-copy fixtures were skipped; no customer device store was modified. [Phone evidence](../../../../ops-mcp-site-visits-ios-p19/docs/artifacts/phase19/phone-verification.md) records all hosted run counts and the separately corrected field/migration subsets.

[Final independent phone review](reviews/final-phone-integration-review.md) closes blank clearing, packet discard, media dependency order, markup hydration, cleared/unknown state preservation and historical schema compatibility. The reviewer independently compared all three frozen stored shapes to baseline and all27 old checksum entries. Its proof is source/artifact review; it did not repeat builds or claim a physical-device canary.

The locally hosted iOS tests use an isolated simulator, DerivedData and package cache and a test-only Mapbox placeholder. They establish the changed phone workflows, not a signed App Store client or a real production upload. Compile/fixture failures and their corrected reruns remain documented; passing subsets are not misrepresented as an uninterrupted full green run.

SQL fixtures use actual read-only catalog definitions and synthetic business records. Unrelated trigger/FK families omitted from a fixture are described in its builder. The workflow tests call the captured canonical booking/completion bodies; metadata reads and local receipts are not a customer-live canary.

Both local MCP wire protocols exercised the actual SDK handler and candidate service with controlled authority/RPC adapters. No signed-in Claude, ChatGPT, Codex, or other native host performed the complete live workflow. No provider reconciliation was performed. `calendar_reconciled:false` is intentional and truthful.

The candidate-discovery regression first failed on the inherited unsupported tool list, then passed after the restricted allowlist. The expanded runtime test initially used a matcher unavailable in this Vitest version; replacing it with equivalent call-count and argument assertions produced the146-test final pass. The original regression and test-harness failure logs are retained separately and are not counted as product-success evidence.

## Release prerequisites owned by parent

1. Integrate the complete local web/iOS/Bible phase changes, reconciling shared candidate registries with P17/P18 and the separate P19 deck phase. Reserved P19 site-visit snapshots remain v27/v22/v17; do not publish another phase's dormant tools incidentally.
2. Review and explicitly authorize the six [unapplied migrations and exact hashes](migration-hashes.md). Re-read deployed schemas/function graphs and compare compatibility before applying; hashes here identify source bytes, not a production ledger entry.
3. Ship and verify the compatible phone client, including the reserved SwiftData V28 store upgrade, before enabling shared-write companies. Preserve V1–V27 historical fingerprints and queued customer work through migration. Legacy clients must receive safe conflicts rather than overwrite newer values. Company enrollment and the effect seal remain separate from exact operator approval.
4. Separately authorize candidate exposure/consent and exact actor/company/client/grant enrollment, then conduct the full native-host and signed-device canaries under that authority. Existing read-only connection authority does not authorize those writes.
5. Verify actual provider processing and customer-live state separately. Queued calendar work and an archive/upload are not successful provider reconciliation or an iOS release.

No new purchase or paid API fallback was used. Eventual activation consumes existing web/database resources; this local task did not estimate production invocation cost.

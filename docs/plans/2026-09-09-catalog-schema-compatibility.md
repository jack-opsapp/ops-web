# Catalog schema compatibility implementation plan

**Goal:** Repair catalog row visibility in normal Codex MCP tool declarations without changing accepted business requests or granting new authority.

**Architecture:** Retain the canonical JSON Schema, discriminated union and all request/domain/transaction validation byte-for-byte. Include the exact generated request JSON Schema in each of the three inspect/prepare tool descriptions. Normal native discovery then supplies the missing reference without user scaffolding. Internal commit descriptions remain separate and commit tools remain unexposed.

**Tech stack:** Existing Zod v4, MCP SDK 2, Vitest, installed Codex/Astra subscription evaluator.

**Design system:** `.interface-design/system.md` inspected; no UI, styling or motion changes.

**Required skills:** systematic-debugging, test-driven-development, custom-skills:writing-plans, custom-skills:executing-plans, using-git-worktrees, verification-before-completion, requesting-code-review. Existing owned linked worktree is clean at `00729a114`; preserve shared checkouts. Jackson has approved building the repair; execute locally without a technical review gate.

## 1. Reproduce the boundary

- Existing evidence: `docs/artifacts/phase17/personas/schema-probe/00.json` renders seven unknown row alternatives; complete schema controls work. A oneOf/anyOf rename did not repair it.
- Add a failing `tools/list` regression in `src/lib/agent-control-plane/mcp/__tests__/catalog-candidate-protocol.test.ts`: rows/items must expose an object, common identifiers, entity names and typed values while retaining seven exact alternatives.
- Run that test and record failure before modifying production code.

## 2. Repair schema delivery, not authority

- Modify only `src/lib/agent-control-plane/contracts/catalog-authoring.ts` initially. Use Zod metadata to add a compatible object view without replacing the union.
- Add validation tests covering all seven row kinds, nullability, disallowed cross-kind fields, malformed money/references, identity/version pairing and mixed inventory/catalog requests. Verify JSON Schema as well as Zod to catch accidental narrowing or weakening.
- Run native diagnostic scenario 0 in a new artifact directory. Inspect actual tool declaration output; reject this hypothesis if fields remain unknown.

**Observed hypothesis result:** The conjunctive metadata projection passed SDK field checks but installed Codex still rendered seven unknown alternatives. Evidence: `compatibility-native-probe/00.json`. Removed the entire experimental production change. This is not a fix.

**Revised implementation:** Change `registry/catalog-authoring-capability.ts` only. Generate each description reference directly from its existing `inputSchema`; no advertised or runtime validation change. The revised protocol regression first failed because no reference existed, then passed after implementation. Native positive/denial conversations must consume only ordinary tool descriptions, never the earlier `--schema-reference` diagnostic.

Since the final approach leaves JSON Schema unchanged, verify exact equality against the pre-change native snapshot instead of adding a new JSON Schema validator dependency. Existing strict boundary tests plus protocol-level malicious-input cases verify rejection before business calls.

## 3. Verify normal conversations

- Rerun cases 1, 2, 3, 5, 18, 22 and denial cases 23, 27 with `--native`, no `--schema-reference`. Existing ChatGPT subscription only, no API fallback; real external servers disabled and checked before every turn.
- Inspect real arguments/results and truthful no-save claims. Preserve missing costs, corrections, units, source provenance, exact approval and refusal of permission bypass.
- Rerun the complete 30-persona matrix once the narrow controls pass. Do not label simulations as live database or cross-host acceptance.

## 4. Verify, review, document

- Run targeted catalog contract/domain/protocol suites, evaluator tests and relevant TypeScript checks.
- Independent Astra code review under requesting-code-review; fix important findings and rerun affected proof.
- Update `docs/artifacts/phase17/personas/REPORT.md` with new evidence while preserving the historical failed baseline. Update owned Bible `04_API_AND_INTEGRATION.md` in the same session after the code commit.
- Commit only named owned files. No migration, trial reactivation, public rollout or customer business mutation is necessary for this repair. Distinguish local completion from release and separate-host acceptance.

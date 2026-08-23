# Complete MCP Read Catalogue Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:subagent-driven-development` for domain slices. Do not apply a migration, push, deploy, alter an OAuth grant, or expose a P2 capability without Jackson's separate explicit authorization.

**Goal:** Add twenty-three purpose-built, permission-preserving OPS reads so the remote MCP has a complete thirty-four-tool business-read catalogue while production remains on its existing eleven exposed reads.

**Architecture:** Preserve the complete v7 surface byte-for-byte, build a parallel P2 contract/cursor/proof/repository kernel, and implement each new domain as a strict vertical slice: candidate capability definition → nominal authorization → fixed service-role RPC → nominal repository → pure bounded service. Mint immutable manifest v8 only after every slice is green, and keep external registration in a separate immutable exposure catalogue whose v1 revision remains exactly the current eleven tools and seven scopes.

**Tech Stack:** Next.js 15, TypeScript 5.9, Node 22.22.3, Zod 4, Vitest, Supabase/PostgreSQL 17, MCP Streamable HTTP, OAuth 2.1/DCR/PKCE, HMAC-SHA-256 cursors and evidence tokens.

**Design System:** N/A. This plan changes backend contracts, database reads, OAuth policy, and MCP transport only. It adds no OPS-Web product UI; the existing data-driven consent panel receives scope labels but no new layout or styling.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `superpowers:subagent-driven-development`, `superpowers:dispatching-parallel-agents`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `plugin-dev:mcp-integration`, `ops-copywriter:ops-copywriter` for OAuth consent labels only, `superpowers:systematic-debugging` for any failure, `superpowers:verification-before-completion`, and `superpowers:requesting-code-review`.

**Approved design:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/mcp-read-catalogue-p2/docs/superpowers/specs/2026-08-22-mcp-read-catalogue-p2-design.md`

**Isolated worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/mcp-read-catalogue-p2`

**Execution mode:** Subagent-driven in this session. One integration owner controls aggregate manifest/exposure/OAuth/runtime files; domain owners touch only their vertical slice until the final integration task.

---

## Non-negotiable execution boundary

- Production stays on manifest v7, exactly eleven externally exposed reads, and seven grantable scopes throughout local development.
- Keep all writes unavailable and absent from the exposure catalogue.
- Preserve old v6/v7 RPC behavior, cursor bytes, result shapes, ordering, limits, and business strings exactly.
- Do not extend `services/operational-read-cursor.ts`; P2 uses a parallel cursor bound to a sorted domain-revision vector.
- Do not use the generic entity authorizer for estimate, invoice, payment, expense, artifact, deck-design, catalogue, company, team, or integration reads.
- Every domain gets strict contracts, nominal authorization, a fixed RPC, a nominal repository, a pure service, source/index and RPC migrations, focused tests, PostgreSQL runtime proof, and an independent P0/P1 review.
- Generate every migration filename with `supabase migration new <stem>` at execution time. Never invent or reuse a timestamp.
- The v8 compatibility migration is generated first for eventual ledger order but finalized and committed last, after all twenty-three implementations are green.
- No local plan step authorizes a database apply, production data mutation, push, deploy, consent operation, or exposure-catalogue revision beyond v1.

## Shared ownership

Only the integration owner may edit:

- `src/lib/agent-control-plane/registry/capability-types.ts`
- `src/lib/agent-control-plane/registry/capability-manifest.ts`
- `src/lib/agent-control-plane/registry/read-tools.ts`
- `src/lib/agent-control-plane/registry/read-capabilities/index.ts`
- `src/lib/agent-control-plane/registry/read-capabilities/current-production.ts`
- `src/lib/agent-control-plane/registry/read-capabilities/p2/{index,candidate-policy}.ts`
- `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- `src/lib/agent-control-plane/contracts/index.ts`
- `src/lib/agent-control-plane/contracts/p2-common.ts`
- `src/lib/agent-control-plane/contracts/p2-proof.ts`
- `src/lib/agent-control-plane/services/p2/shared/**`
- `src/lib/agent-control-plane/services/domain-service.ts`
- `src/lib/agent-control-plane/services/repositories.ts`
- `src/lib/agent-control-plane/services/create-domain-service.ts`
- `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- `src/lib/agent-control-plane/mcp/server-factory.ts`
- `src/lib/agent-control-plane/mcp/runtime.ts`
- `src/lib/agent-control-plane/mcp/rate-limit.ts`
- `src/lib/agent-control-plane/mcp/oauth/**`
- `src/app/api/mcp/oauth/**`
- shared compatibility, revision, consent, limiter, and evidence-redemption migrations.

Domain owners receive only their contract, their exact `registry/read-capabilities/p2/<domain>.ts` candidate-definition file, `services/p2/<domain>/**`, fixtures/tests, and domain source/RPC migration pair. The integration owner alone owns candidate aggregation and atomic promotion. Shared-file changes are handed back as an explicit required mapping, not edited concurrently.

## Domain map

| Domain       | Capabilities                                      | Contract                            | Service directory           | Source migration stem                 | RPC migration stem                |
| ------------ | ------------------------------------------------- | ----------------------------------- | --------------------------- | ------------------------------------- | --------------------------------- |
| Customer     | `get_customer_context`                            | `contracts/customer-context.ts`     | `services/p2/customer/`     | `agent_customer_context_sources`      | `agent_customer_context_read`     |
| Tasks        | `list_tasks`, `get_task_context`                  | `contracts/tasks.ts`                | `services/p2/tasks/`        | `agent_task_sources`                  | `agent_task_reads`                |
| Work queue   | `list_work_queue`                                 | `contracts/work-queue.ts`           | `services/p2/work-queue/`   | `agent_work_queue_sources`            | `agent_work_queue_read`           |
| Artifacts    | `list_job_artifacts`, `get_job_artifact_evidence` | `contracts/job-artifacts.ts`        | `services/p2/artifacts/`    | `agent_artifact_sources`              | `agent_artifact_reads`            |
| Site visits  | `list_site_visits`, `get_site_visit_context`      | `contracts/site-visits.ts`          | `services/p2/site-visits/`  | `agent_site_visit_sources`            | `agent_site_visit_reads`          |
| Deck design  | `get_deck_design_geometry`                        | `contracts/deck-design-geometry.ts` | `services/p2/deck-design/`  | `agent_deck_design_sources`           | `agent_deck_design_geometry_read` |
| Sales docs   | `list_sales_documents`, `get_sales_document`      | `contracts/sales-documents.ts`      | `services/p2/sales/`        | `agent_sales_document_sources`        | `agent_sales_document_reads`      |
| Payments     | `list_payments`                                   | `contracts/sales-documents.ts`      | `services/p2/payments/`     | `agent_payment_sources`               | `agent_payment_read`              |
| Expenses     | `list_expenses`, `get_expense_context`            | `contracts/expenses.ts`             | `services/p2/expenses/`     | `agent_expense_reimbursement_sources` | `agent_expense_reads`             |
| Catalogue    | `search_catalog_items`, `get_catalog_item`        | `contracts/catalog-purchasing.ts`   | `services/p2/catalog/`      | `agent_catalog_sources`               | `agent_catalog_reads`             |
| Purchasing   | `list_purchase_orders`, `get_purchase_order`      | `contracts/catalog-purchasing.ts`   | `services/p2/purchasing/`   | `agent_purchasing_sources`            | `agent_purchase_order_reads`      |
| Company      | `get_company_context`                             | `contracts/company-operations.ts`   | `services/p2/company/`      | `agent_company_sources`               | `agent_company_context_read`      |
| Team         | `list_team_members`                               | `contracts/company-operations.ts`   | `services/p2/team/`         | `agent_team_sources`                  | `agent_team_members_read`         |
| Availability | `list_team_availability`                          | `contracts/company-operations.ts`   | `services/p2/availability/` | `agent_availability_sources`          | `agent_team_availability_read`    |
| Integrations | `get_integration_health`                          | `contracts/company-operations.ts`   | `services/p2/integrations/` | `agent_integration_health_sources`    | `agent_integration_health_read`   |
| Overview     | `get_operational_overview`                        | `contracts/operational-overview.ts` | `services/p2/overview/`     | none; binds all selected revisions    | `agent_operational_overview_read` |

## Standard RED/GREEN loop

For every task:

1. Write one failing invariant test at a time.
2. Run the exact focused command and confirm it fails for the intended missing or incorrect boundary.
3. Implement the minimum production behavior.
4. Run the focused test, adjacent domain tests, and relevant compatibility tests.
5. Run Prettier on owned files and `git diff --check`.
6. Request independent P0/P1 review; close every finding.
7. Stage only exact owned paths and make the named atomic commit.

Use the direct Node 22 binaries in this worktree:

```bash
/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  node_modules/vitest/vitest.mjs run <focused-test-paths>

/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  --max-old-space-size=8192 node_modules/typescript/bin/tsc \
  --noEmit --pretty false

/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  node_modules/prettier/bin/prettier.cjs --check <owned-paths>
```

---

### Task 1: Freeze the current v7 control plane

**Files:**

- Create: `src/lib/agent-control-plane/registry/__tests__/v7-compatibility.test.ts`
- Modify: `src/lib/agent-control-plane/registry/__tests__/manifest.test.ts`
- Modify: `src/lib/agent-control-plane/registry/__tests__/site-visit-capabilities.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/transport.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/oauth/__tests__/scopes.test.ts`
- Test references: `src/lib/agent-control-plane/services/__tests__/task13-manifest-v6-task12-repository-compatibility.test.ts`

**Step 1: Write RED/characterization tests**

Pin the full serialized v7 manifest projection, exact definition ordering, two dark site-visit shells, exact eleven external tool names, seven scope names/labels, all dark writes, current method map, and old cursor/result snapshots. The first new assertion should fail because no single v7 characterization exists.

**Step 2: Run RED**

Run the five focused suites. Expected: only the new characterization assertions fail.

**Step 3: Add fixtures only**

Add independently derived expected literals; do not change production behavior.

**Step 4: Run GREEN and the full 1,916-test baseline**

**Step 5: Commit**

```bash
git commit -m "test(mcp): freeze v7 control-plane surface"
```

---

### Task 2: Split the registry and separate immutable exposure

**Files:**

- Create: `src/lib/agent-control-plane/registry/read-capabilities/{index,current-production,schedule,communication,job-catalog,discovery,v7-site-visits}.ts`
- Create: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Create: `src/lib/agent-control-plane/registry/mcp-scope-catalog.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts`
- Create: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Create: `src/lib/agent-control-plane/mcp/__tests__/domain-dispatch.test.ts`
- Modify: `src/lib/agent-control-plane/registry/{capability-types,read-tools,capability-manifest,write-tools}.ts`
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`

**Step 1: Write RED invariants**

Require `2026-08-22.mcp-exposure.v1` to contain exactly the current eleven capability IDs and seven scopes; require every entry to resolve to an implemented read and a typed domain method; reject duplicates, writes, missing methods, and missing scopes. Add one fail-closed `resolveActiveMcpExposure()` composition dependency returning the same frozen `{ revision, toolIds, grantableScopes }` object for registration and OAuth. Preserve the legacy `externalExposure` field byte-for-byte in frozen v7 definitions, but prove it is ignored by registration. V8 candidate/final definitions use implementation availability only. Registered scope vocabulary lives in the neutral scope registry consumed by both manifest/exposure invariants and OAuth.

**Step 2: Run RED**

Expected: missing exposure catalogue/domain map and old external-exposure coupling.

**Step 3: Move definitions behavior-identically**

Keep `read-tools.ts` as a compatibility aggregator. Preserve v7 definition bytes, order, and legacy availability shape. Introduce a v8 implementation-only availability shape without rewriting v7; exposure v1 becomes the sole registration source for every active revision.

**Step 4: Move static dispatch into the typed map**

`server-factory.ts` consumes the resolved active exposure object, verifies every manifest entry is an implemented read, and resolves the typed method. DCR/authorization/token/refresh later receive this exact same object rather than resolving a revision independently. Unknown revision or any tool/scope mismatch fails startup. Exposure v1 must still list exactly eleven tools.

**Step 5: Run GREEN plus every existing registry/MCP suite**

**Step 6: Commit**

```bash
git commit -m "refactor(mcp): separate policy manifest from exposure"
```

---

### Task 3: Reserve migration order and freeze P2 common contracts

**Files:**

- Create via `supabase migration new`: empty ordered files for `agent_manifest_v8_compatibility`, `agent_read_domain_revisions`, `mcp_oauth_consent_catalog_versioning`, `agent_mcp_durable_rate_limit`, and `agent_mcp_evidence_nonce_ledger`
- Create: `src/lib/agent-control-plane/contracts/{p2-common,p2-proof}.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/{p2-common,p2-proof}.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/{index,candidate-policy}.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/p2-candidate-capabilities.test.ts`
- Modify: `src/lib/agent-control-plane/contracts/index.ts`
- Test: `src/lib/agent-control-plane/contracts/__tests__/schemas.test.ts`

**Step 1: Reserve the final manifest identity and generate the five filenames in exact eventual apply order**

Add a non-active `RESERVED_P2_MANIFEST_REVISION = "2026-08-22.capability-manifest.v8"` constant used only by the candidate harness, nominal authorization, repositories, and new v8-only RPC tests. It cannot enter `CAPABILITY_MANIFEST`, dispatch, OAuth, or exposure. Do not populate or commit the v8 compatibility file. Record the generated paths at the top of this plan's execution log.

**Step 2: Write RED common-contract tests**

Pin: strict list page 25/26, 501 source sentinel, fifteen-minute P2 cursor TTL, sorted domain-revision vector, explicit-vs-default component semantics, canonical UUID/time/Unicode, `MoneySchema` only, fixed warnings/gaps, evidence identities, exact 60,000-character serializer budget, and forbidden-field scans.

**Step 3: Implement the common schemas and candidate-policy test harness**

No domain candidate exists before its strict domain contract. The harness nominally mints one isolated policy against the reserved final v8 identity from a supplied definition, but it cannot aggregate, dispatch, grant, or enter `CAPABILITY_MANIFEST`. Preserve the two v7 site-visit shells separately. Each later domain task creates its contract first, proves RED, then creates exactly its candidate-definition file and tests it end-to-end through its real v8-only RPC. Task 25 atomically copies the already-tested policy bytes into the v8 aggregate and asserts byte identity; it does not remint semantically new policies.

**Step 4: Run GREEN and registry invariants**

**Step 5: Commit only common code and populated non-v8 work when coherent**

```bash
git commit -m "feat(mcp): freeze P2 candidate contracts"
```

---

### Task 4: Build the parallel P2 read kernel

**Files:**

- Create: `src/lib/agent-control-plane/services/p2/shared/{authorize-read,composite-authorization,cursor,domain-revisions,proof,repository-boundary,result-budget}.ts`
- Create: `src/lib/agent-control-plane/services/p2/shared/{legacy-attention-projections,private-projection-contracts}.ts`
- Create: `src/lib/agent-control-plane/services/p2/shared/__tests__/*.test.ts`
- Generate/populate: `agent_p2_legacy_attention_projections`
- Create: `tests/unit/supabase/agent-p2-legacy-attention-projections-migration.test.ts`
- Create: `tests/sql/agent-p2-legacy-attention-projections-runtime.sql`
- Leave unchanged: `src/lib/agent-control-plane/services/operational-read-cursor.ts`
- Reuse: `src/lib/agent-control-plane/services/operational-read-projection.ts`

**Step 1: Write RED kernel tests**

Prove nominal WeakSet brands, exact declared/satisfied OAuth policy binding, explicit-component zero-read failure, domain-vector canonicalization including only the three frozen legacy atom families, HMAC cursor round trip/tamper/TTL/cross-tool rejection, predecessor order witness, collection/child proof coupling, exact serializer measurement, atomic proof/item reduction, abort-before/after-await, and privacy-safe repository failures. Freeze private card/attention-summary projection signatures, bounds, revision outputs, ACLs, and runtime fixtures. Add canonical same-statement adapters for the existing lead, correspondence, and schedule sources; they re-prove their own authority and never call multiple public RPCs.

**Step 2: Implement the smallest reusable kernel**

Shared helpers may validate and canonicalize but cannot mint a domain authorization or repository brand. Do not add generic table/entity dispatch. Populate the integration-owned legacy projection migration with fixed private lead, correspondence, and schedule attention helpers, service-role outer-RPC use only, exact source bounds/revisions, and PostgreSQL runtime fixtures; generate it before any domain source migration. Every later source-domain task must deliver its capability-specific private card/attention-summary projection beside the public RPC so work queue and overview can reuse the exact query/authority logic inside one outer statement.

**Step 3: Run RED mutation checks then GREEN**

**Step 4: Commit**

```bash
git commit -m "feat(mcp): add bounded P2 read kernel"
```

---

### Task 5: Persist consent revisions and enforce DCR scope ceilings

**Skills:** Load `ops-copywriter:ops-copywriter`, `/Users/jacksonsweet/.codex/plugins/cache/custom-skills-plugin/ops-copywriter/1.0.0/skills/ops-copywriter/references/brand-voice-bible.md`, and the in-app section of `/Users/jacksonsweet/.codex/plugins/cache/custom-skills-plugin/ops-copywriter/1.0.0/skills/ops-copywriter/references/format-playbooks.md` before writing the thirteen new consent labels. Labels must remain terse, concrete, and read-only-honest.

**Files:**

- Populate generated migration: `mcp_oauth_consent_catalog_versioning`
- Create: `tests/unit/supabase/agent-mcp-oauth-consent-catalog-migration.test.ts`
- Create: `src/lib/agent-control-plane/mcp/oauth/scope-catalog.ts`
- Modify: `src/lib/agent-control-plane/mcp/oauth/{scopes,clients,grants,tokens,index}.ts`
- Modify: `src/app/api/mcp/oauth/{register,authorize/context,authorize/decision,token}/route.ts`
- Modify: `src/app/.well-known/oauth-authorization-server/route.ts`
- Modify tests: `src/lib/agent-control-plane/mcp/oauth/__tests__/*.test.ts`, `tests/unit/mcp/oauth-{consent,routes,grants-route}.test.ts`

**Step 1: Write RED consent tests**

Prove registered vocabulary vs exposure-grantable scopes, blank requests resolving only the exact injected active-exposure object, exact stored client ceiling, old-client rejection of new scopes, fresh DCR eligibility, immutable code/grant consent+exposure revisions, refresh non-widening, and unchanged existing grants. Registration, DCR, authorization, token issuance, and refresh all receive the same object returned by `resolveActiveMcpExposure()`; no OAuth module selects a revision independently.

**Step 2: Write RED migration contract and PostgreSQL fixture**

Pin columns, backfill of existing clients/codes/grants to v1 without scope changes, service-only RPC arguments, ACLs, constraints, and replay behavior.

**Step 3: Implement SQL and TypeScript**

The consent panel remains data-driven; add only exact new labels and no UI styling.

**Step 4: Run OAuth, route, migration, and v7 compatibility GREEN**

**Step 5: Commit**

```bash
git commit -m "feat(mcp-oauth): enforce immutable consent ceilings"
```

---

### Task 6: Add domain-scoped source revisions

**Files:**

- Populate generated migration: `agent_read_domain_revisions`
- Create: `tests/unit/supabase/agent-read-domain-revisions-migration.test.ts`
- Create: `tests/sql/agent-read-domain-revisions-runtime.sql`
- Implement: `src/lib/agent-control-plane/services/p2/shared/domain-revisions.ts`

**Step 1: Write RED SQL and adapter tests**

Pin closed domains `customer`, `tasks`, `artifacts`, `site_visits`, `deck_designs`, `sales_documents`, `payments`, `expenses`, `work_queue`, `catalog`, `purchasing`, `company`, `team`, `availability`, and `integrations`; same-company keying; safe integer monotonic revisions; canonical sorted vectors; private table/helper ACLs; and trigger-call contracts. The TypeScript revision vector also recognizes only the exact existing legacy atoms `operational_read_revision/private.agent_operational_read_revisions`, `job_history_read_revision/private.agent_job_history_revisions`, and the current address-scoped `contactability_revision`; it rejects every other generic source-version tuple.

**Step 2: Implement the private table and helpers**

No application role may read/write the revision table. Trigger functions cover INSERT, UPDATE, and DELETE, safely resolve legacy text company keys, seed every current company/domain pair, and advance both distinct OLD and NEW company revisions when a row is reassigned. Runtime tests prove insertion, deletion, same-company updates, cross-company moves, malformed legacy identifiers, initial seeding, replay, and no application-role table access.

**Step 3: Run PostgreSQL 17 compile/runtime and adapter GREEN**

**Step 4: Commit**

```bash
git commit -m "feat(mcp): add domain-scoped read revisions"
```

---

### Task 7: Add and wire the durable limiter

**Files:**

- Populate generated migration: `agent_mcp_durable_rate_limit`
- Create: `tests/unit/supabase/agent-mcp-rate-limiter-migration.test.ts`
- Create: `tests/sql/agent-mcp-rate-limiter-runtime.sql`
- Create: `src/lib/agent-control-plane/mcp/durable-rate-limit.ts`
- Modify: `src/lib/agent-control-plane/mcp/{rate-limit,server-factory,runtime}.ts`
- Modify: `src/app/api/mcp/route.ts`
- Test: `src/lib/agent-control-plane/mcp/__tests__/{rate-limit,runtime,transport}.test.ts`

**Step 1: Write RED limiter tests**

Pin the private keyed-digest bucket, atomic multi-instance increments, actor/company/grant/capability/policy/window binding, fixed units, expiry/cleanup bound, service-only ACL, strict response parsing, limiter-unavailable fail-closed behavior, and privacy-safe audit coupling.

**Step 2: Implement the migration and nominal adapter**

`consume_agent_mcp_rate_limit_as_system` is `VOLATILE SECURITY DEFINER` because it atomically mutates security bookkeeping. Every business read remains `STABLE`. Keep the current process/KV limiter only as an additional burst guard; it cannot turn a durable denial/failure into allow.

**Step 3: Wire transport and run adversarial concurrency GREEN**

**Step 4: Commit**

```bash
git commit -m "feat(mcp): enforce durable capability limits"
```

---

### Task 8: Implement customer context

**Files:**

- Create: `src/lib/agent-control-plane/contracts/customer-context.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-customer-context.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/customer-context.ts`
- Create: `src/lib/agent-control-plane/services/p2/customer/{customer-context-authorization,customer-context-repository,get-customer-context}.ts`
- Create: `src/lib/agent-control-plane/services/p2/customer/__tests__/*.test.ts`
- Generate/populate: `agent_customer_context_sources`, `agent_customer_context_read`
- Create: `tests/unit/supabase/agent-customer-context-{sources,read}-migration.test.ts`

**Step 1: RED contracts and authorization**

Pin closed sections, untrusted notes, exact contact consent, parent/current duplicate semantics, explicit job-kind rollup AND-authority, and no unauthorized rows/counts.

**Step 2: RED repository/service**

Pin the literal `read_agent_customer_context_as_system` args, customer+selected operational revisions, exact proof, strict wire, source tampering, and 60k reduction. Deliver `private.agent_p2_customer_summary_v1(...)`, a fixed bounded same-authority projection with its exact revision vector for overview composition; it is not executable by application roles.

**Step 3: RED SQL, then implement source/index and RPC migrations**

Use `clients`, `sub_clients`, `duplicate_reviews`, and only independently authorized job rollup projections. Reuse existing customer/job indexes unless PostgreSQL plans prove a missing symmetric duplicate-review path.

**Step 4: Run focused and adjacent GREEN, review, commit**

```bash
git commit -m "feat(mcp): add customer context read"
```

---

### Task 9: Implement task reads

**Files:**

- Create: `src/lib/agent-control-plane/contracts/tasks.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-tasks.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/tasks.ts`
- Create: `src/lib/agent-control-plane/services/p2/tasks/**`
- Generate/populate: `agent_task_sources`, `agent_task_reads`
- Create: `tests/unit/supabase/agent-task-{sources,reads}-migration.test.ts`

**Step 1: RED both tool contracts and nominal variants**

Pin list views, task detail sections, all/assigned project intersection, safe team display, schedule authority, material readiness revision vector, note opt-in, and hidden estimate/line identity without finance authority.

**Step 2: RED list/detail repositories and pure services**

Pin `read_agent_tasks_as_system` and `read_agent_task_context_as_system`, 25/26 and 501 bounds, canonical ordering, the `tasks` projection revision plus already-live exact job atoms, and strict source identities. The `agent_task_sources` trigger matrix advances `tasks` for every projected task, safe team-display, and material-readiness dependency; it does not wait for or borrow the later team/catalogue revisions.

**Step 3: Implement indexed sources and fixed RPCs**

Use `project_tasks`, task/team/material relations, and stock readiness. Add only EXPLAIN-proven deterministic keysets. Any expression helper gets writer-role DML/ACL proof. Deliver the frozen private task-attention projection consumed later by work queue and overview.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add task reads"
```

---

### Task 10: Implement artifact metadata and evidence-source reads

**Files:**

- Create: `src/lib/agent-control-plane/contracts/job-artifacts.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-job-artifacts.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/artifacts.ts`
- Create: `src/lib/agent-control-plane/services/p2/artifacts/**`
- Generate/populate: `agent_artifact_sources`, `agent_artifact_reads`
- Create: `tests/unit/supabase/agent-artifact-{sources,reads}-migration.test.ts`

**Step 1: RED metadata and exact-evidence contracts**

Pin source-specific permissions, current/deleted rules, safe metadata, forbidden paths/provider/identity/annotation fields, bounded untrusted text, and opaque evidence identities.

**Step 2: RED repositories, fixed reads, and private evidence projection**

Pin the literal metadata/evidence-source RPCs, source-specific revisions, strict private wire, content availability/safe-scan state, 25/26/501 bounds, and the frozen private artifact-attention/evidence projection consumed later by site visits, work queue, overview, and redemption. It independently re-proves artifact authority and is not executable by application roles.

**Step 3: Implement source/index and RPC migrations**

Project only from `project_photos`, current `project_notes`, `site_visit_artifacts`, `deck_designs`, attributed `email_attachments`, safe inspection status, generated-document identities, and expense receipt identity/availability from current `expenses` rows. Expense evidence never returns a raw receipt URL or OCR/source payload. The `agent_artifact_sources` trigger matrix advances `artifacts` for every projected source change—including expense receipt identity/availability—so this slice does not depend on the later `expenses` revision. Add per-source canonical time/ID keysets only after plan proof.

**Step 4: GREEN, adversarial review, commit**

```bash
git commit -m "feat(mcp): add job artifact reads"
```

---

### Task 11: Implement single-use evidence issuance and redemption

**Ownership:** Integration owner only. The artifact owner hands off the frozen private evidence projection and source migration signatures from Task 10.

**Files:**

- Populate the reserved `agent_mcp_evidence_nonce_ledger` migration
- Generate/populate after Task 10: `agent_mcp_evidence_redemption_rpc`
- Create: `src/lib/agent-control-plane/mcp/{evidence-token,evidence-redemption}.ts`
- Create: `src/app/api/mcp/evidence/[token]/route.ts`
- Create: `src/lib/agent-control-plane/mcp/__tests__/{evidence-token,evidence-redemption}.test.ts`
- Create: `tests/unit/mcp/evidence-route.test.ts`
- Create: `tests/unit/supabase/agent-mcp-evidence-{nonce-ledger,redemption-rpc}-migration.test.ts`

**Step 1: RED nonce, token, redemption, and route security**

Prove dedicated-key signing, five-minute maximum, actor/company/client/audience/grant/parent/artifact/source binding, one-way nonce persistence, single use, wrong bearer/client rejection, immediate revocation, same-statement artifact/scan reproof through Task 10's private projection, no redirect/cache/range, MIME/length caps, and privacy-safe logs/audit. The ledger contains only private table/helpers; the redemption RPC compiles only after the artifact source exists.

**Step 2: Implement the guarded delivery boundary**

`consume_agent_mcp_rate_limit_as_system` and `redeem_agent_mcp_evidence_as_system` are `VOLATILE SECURITY DEFINER`; all non-mutating artifact readers remain `STABLE`. The route performs no business mutation; nonce consumption and audit are security bookkeeping. Startup under exposure v1 must not require the evidence signing key.

**Step 3: GREEN, adversarial review, commit**

```bash
git commit -m "feat(mcp): add guarded evidence redemption"
```

---

### Task 12: Implement site-visit reads on the artifact boundary

**Files:**

- Create: `src/lib/agent-control-plane/contracts/site-visits.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-site-visits.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/site-visits.ts`
- Create: `src/lib/agent-control-plane/services/p2/site-visits/**`
- Generate/populate: `agent_site_visit_sources`, `agent_site_visit_reads`
- Create: `tests/unit/supabase/agent-site-visit-{sources,reads}-migration.test.ts`

**Step 1: Write RED P2 tests against the frozen v7 characterization**

Task 2 already extracted and froze the v7 definitions; this task does not edit integration-owned v7 files. P2 requires `ops.site_visits.read`, `booked_at`-only appointments, `created_at` history, exact linked/unlinked permission variants, opt-in untrusted visit sections, and artifact authority.

**Step 2: RED repositories/services and SQL**

Pin the two literal RPCs, canonical UUID/legacy-text validation, site/artifact revisions, safe checklist/measurement projection, active visit-linked opaque deck-design references, and no deck geometry/attendee/provider/internal-note/raw-photo fields. The exact visit context never composes a second public statement to discover its deck references. Deliver `private.agent_p2_site_visit_attention_v1(...)` with a fixed booked/history selector, bound, revision output, and identical visit authority for work queue, availability, and overview composition.

**Step 3: Add exact booked/history keysets and runtime plan proof**

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): implement site visit reads"
```

---

### Task 13: Implement authoritative deck-design geometry

**Ownership:** The OPS-Web deck-domain owner consumes immutable fixture artifacts only. Fixture producers work in separate isolated worktrees and make separate local commits in their own repositories; they never touch the dirty primary checkouts and are never pushed by this plan.

**Files:**

- Create: `src/lib/agent-control-plane/contracts/deck-design-geometry.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-deck-design-geometry.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/deck-design.ts`
- Create: `src/lib/agent-control-plane/services/p2/deck-design/**`
- Create: `src/lib/agent-control-plane/services/p2/deck-design/__fixtures__/**`
- Generate/populate: `agent_deck_design_sources`, `agent_deck_design_geometry_read`
- Create: `tests/unit/supabase/agent-deck-design-{sources,geometry-read}-migration.test.ts`
- Create in isolated OPS iOS worktree `/Users/jacksonsweet/Projects/OPS/ops-ios/.worktrees/mcp-read-catalogue-p2-fixtures`: `OPSTests/DeckBuilder/MCPDeckGeometryGoldenFixtureTests.swift`
- Create in isolated standalone DeckKit worktree `/Users/jacksonsweet/Projects/OPS/ops-decks-ios/.worktrees/mcp-read-catalogue-p2-fixtures`: `Packages/DeckKit/Tests/DeckKitTests/MCPDeckGeometryGoldenFixtureTests.swift`

**Step 1: RED exact-ref contract and nominal authorization**

Pin exactly one of `{ source: "job_artifact", job_ref: { kind: "opportunity" | "project", id }, deck_design_ref }` and `{ source: "site_visit_artifact", site_visit_ref, deck_design_ref }`, using only opaque values returned by `list_job_artifacts` or `get_site_visit_context`. Every branch requires `ops.files.read`; `photos.view` never substitutes. A design with a current project/opportunity parent requires `ops.jobs.read`, `deck_builder.view=assigned`, and exact current project/pipeline visibility. A site-visit source additionally requires `ops.site_visits.read`, the exact visit variant, and the active tenant-equal artifact bridge, but that bridge never manufactures assigned deck authority. A parentless design always requires `deck_builder.view=all`; when its visit is also genuinely unlinked, require `pipeline.view=all` with no assigned branch. A conflicting inaccessible non-null design parent fails closed. No customer/title search, caller company, arbitrary sections, raw UUID route, or photo permission is accepted.

**Step 2: RED bounded topology and calculator parity**

Pin one-result output and the exact rejection sequence: source JSON bytes `<= 1 MiB`; planes `<=16`, vertices `<=160`, edges `<=240`, surfaces `<=64`, level/surface connections `<=32`, directed outer/hole boundary references `<=320`; duplicate/reference/finite validation; then `topology_units = planes + vertices + edges + surfaces + connections + directed_boundary_references <= 500`; then exact `serializeUntrustedPromptData(result).length <= 60_000`. Nothing truncates. Generated fixtures prove every individual ceiling, an accepted exact-500 mixed topology, a rejected 501 topology, and the exact serializer boundary.

Freeze calculator revision `deck-geometry-calculator:2026-08-22.v1`. Area is DeckKit's closed detected-face total across every level with holes subtracted, using `effectiveScaleFactor`, divided by `144`; a valid closed-footprint fallback is allowed only when that geometry source has no detected faces. Flat/parapet guard length considers only `deck_edge` rows with a finite positive authoritative `dimension` and a railing configuration, subtracts the exact `stairConfig.width` and `36` inches for each `assignedItems.isGate`, then clamps to zero. It never substitutes canvas distance. Edge stair railing uses two sides of `StairConfig.stringerLength`: a positive explicit `totalRiseInches` first, otherwise owning-surface absolute elevation, otherwise the midpoint of the two exact endpoint elevations resolved vertex then level then overall; a positive explicit tread count wins, otherwise `ceil(totalRise / risePerStep)`, and `runPerTread` is exact. Level-connection stair railing uses the positive exact upper/lower level elevation difference, its positive explicit tread count or the same tread calculation, its exact run, and two stringer sides. Non-parapet flat, parapet flat, edge-stair, level-connection-stair, and combined totals accumulate full-precision inches and round only at the final public boundary.

Measurement states are independent. Area depends only on finite topology and a finite positive scale. Flat and parapet railing each depend only on every configured contributing edge's finite positive stored dimension, gate count, and stair opening. Edge- and level-stair railing depend only on their own finite positive rise, tread count, and run. The combined guard total is authoritative only when every included rail subtype is authoritative; one unavailable subtype never silently disappears. A failure in one metric leaves unrelated valid metrics available with their own fixed state and warning. Coordinates may be negative and require only finiteness; positivity applies only to scale, authoritative dimensions, openings, rises, tread counts, and runs.

Persisted `components` is a separate consistency witness. When present, independently recompute each emitted surface and rail component with DeckKit's exact per-surface/per-edge two-decimal persistence rounding and compare component identities and values one by one. Never compare a sum of those rounded components with the final-only-rounded authoritative total. A recognized legacy design without components yields the fixed witness-unavailable warning; a present mismatch fails closed.

**Step 3: Produce and freeze cross-language golden fixtures**

Create both isolated worktrees from each repository's current local `main`; do not modify either primary checkout. Copy the gitignored OPS iOS `Secrets.xcconfig` into its isolated worktree as required by that repository, without staging it. First commit only each fixture producer and its tests. Then run that immutable producer commit to emit canonical sorted-key JSON containing `fixture_revision`, `producer_repository`, `producer_code_commit`, the exact minimal input drawing JSON, expected full-precision square inches, flat/stair/parapet inches, per-metric quality states, and per-component witness values. Commit the generated artifacts separately in each producer repository. Hash every JSON file in one checked-in OPS-Web SHA-256 manifest, record both the producer-code and generated-artifact commit hashes there, and copy the reviewed immutable artifacts into `src/lib/agent-control-plane/services/p2/deck-design/__fixtures__/`.

Run OPS iOS with:

```bash
xcodebuild test -project OPS.xcodeproj -scheme OPS \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' \
  -derivedDataPath .derived-data-mcp-deck \
  -clonedSourcePackagesDirPath .spm-local \
  -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO \
  -only-testing:OPSTests/MCPDeckGeometryGoldenFixtureTests
```

Run standalone DeckKit with:

```bash
swift test --package-path Packages/DeckKit --filter MCPDeckGeometryGoldenFixtureTests
```

Before either Swift command, inspect active `xcodebuild`/Swift processes and verify no sibling owns the selected DerivedData or package-cache path. The producer-code commit precedes generation; the generated-artifact commit follows it, so no fixture contains the hash of a commit that contains itself. Record all four commit hashes in the OPS-Web fixture manifest and do not push them.

**Step 4: RED source/link integrity, revision fan-out, and fixed RPC**

Pin `read_agent_deck_design_geometry_as_system`, service-role-only ACL, exact grant/actor/company/policy reproof, active artifact/design/visit/job relationships, `deck_designs` + `artifacts` + `site_visits` + selected legacy job revision vector, canonical content hash, and privacy-safe unavailable/invalid states. Add a write-path trigger that rejects a cross-company design/artifact link without requiring direct opportunity equality, because converted project provenance is valid. Add only exact visit/design lookup indexes after plan proof.

The trigger matrix is literal and covers INSERT, DELETE, active/deleted transitions, and distinct OLD/NEW companies. Any selected `deck_designs` change to `company_id`, `project_id`, `opportunity_id`, `title`, `drawing_data`, `version`, `created_at`, `updated_at`, or `deleted_at` advances `deck_designs`. The RPC binds the existing job revision and re-proves the current parent relation, but a design-parent change does not advance that frozen legacy counter. Any canonical deck bridge change to `site_visit_artifacts.company_id`, `site_visit_id`, `deck_design_id`, `opportunity_id`, `kind`, `source`, `captured_at`, `included_in_project_review`, `updated_at`, or `deleted_at` advances `artifacts`, `site_visits`, and `deck_designs`. Any selected site-visit authority/identity field change advances `site_visits`. Runtime tests prove every field, INSERT/DELETE, reparenting, activation/deactivation, both-company fan-out, no v6/v7 cursor change, and no revision bump for irrelevant columns.

**Step 5: Implement the private parser and safe public projection**

Return deterministic `deck-local-ref:2026-08-22.v1` references, normalized coordinates, levels, directed surface outer/hole loops, boundary roles, stored dimension source/staleness, and separate area, flat rail, stair rail, parapet, and combined-guard measurements with fixed quality warnings. Planes order by level sort order then source ID; vertices, edges, surfaces, and connections order by source ID within their plane and expose compact ordinals only. Exclude raw `drawing_data`, components, assigned product/catalog IDs, prices/costs, recovery/future blocks, framing/terrain/footings/house openings/photo overlay/permit/zoning/compliance payloads, storage/provider paths, creator identity, and private notes. Safe boundary/railing/finish family values remain untrusted design data.

Every result carries an opaque `geometry_source_fence` bound to actor, company, OAuth grant, deck-design identity, canonical drawing-content hash, exact selected anchor, sorted source-revision vector, calculator revision, and local-reference revision. It is not write authority; a future prepare call must decode it, reauthorize, and reject it when any bound source changed. Add round-trip tests proving every exposed local ref maps to exactly one source element and that reorder-only source changes cannot retarget an edge or surface.

**Step 6: GREEN, cross-language review, commit**

```bash
git commit -m "feat(mcp): add authoritative deck geometry read"
```

---

### Task 14: Implement sales-document reads

**Files:**

- Create: `src/lib/agent-control-plane/contracts/sales-documents.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-sales-documents.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/sales.ts`
- Create: `src/lib/agent-control-plane/services/p2/sales/**`
- Generate/populate: `agent_sales_document_sources`, `agent_sales_document_reads`
- Create: `tests/unit/supabase/agent-sales-document-{sources,reads}-migration.test.ts`

**Step 1: RED estimate/invoice variants**

Pin document/job authority, `projects.view_financials=all`, strict `MoneySchema`, currency-exponent validation, ordered safe lines/milestones, and all forbidden notes/provider/cost/configuration/reference fields.

**Step 2: RED list/detail repositories and services**

Pin `read_agent_sales_documents_as_system` and `read_agent_sales_document_as_system`, exact sales-document/job revision vectors, and unlike-currency aggregates failing closed. Deliver `private.agent_p2_sales_document_attention_v1(...)`, returning only bounded due/expired/approval-safe cards under the exact public-read authority and revision contract.

**Step 3: Implement SQL with canonical money conversion and keysets**

Reuse `private.agent_money_to_minor_units`. Add invoice history and line/milestone indexes only where current indexes cannot prove the bound.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add sales document reads"
```

---

### Task 15: Implement payment reads

**Files:**

- Reuse: `src/lib/agent-control-plane/contracts/sales-documents.ts`
- Extend: `src/lib/agent-control-plane/contracts/__tests__/p2-sales-documents.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/payments.ts`
- Create: `src/lib/agent-control-plane/services/p2/payments/**`
- Generate/populate: `agent_payment_sources`, `agent_payment_read`
- Create: `tests/unit/supabase/agent-payment-{sources,read}-migration.test.ts`

**Step 1: RED full-scope payment contract and authorization**

Pin exact invoice/job visibility, `ops.payments.read`, `invoices.view=all|assigned`, mandatory `finances.view=all`, strict money/currency, void/reconciliation states, and exclusion of references, provider IDs, actor identity, raw methods, and instruments. Assigned invoice authority never substitutes for full finance authority.

**Step 2: RED repository/service and fixed RPC**

Pin `read_agent_payments_as_system`, 25/26/501 bounds, canonical date/ID ordering, payment + sales-document + selected job revision vector, unlike-currency failure, atomic proofs, and privacy-safe stale/hidden behavior. Deliver `private.agent_p2_payment_attention_v1(...)`, a bounded reconciliation-state summary with the same mandatory full-finance authority and exact revision output.

**Step 3: Implement source/index and RPC migrations**

Use canonical money conversion and only EXPLAIN-proven payment date/ID keysets. Prove current invoice/job scope again in the same statement.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add payment reads"
```

---

### Task 16: Implement expense and reimbursement reads

**Files:**

- Create: `src/lib/agent-control-plane/contracts/expenses.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-expenses.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/expenses.ts`
- Create: `src/lib/agent-control-plane/services/p2/expenses/**`
- Generate/populate: `agent_expense_reimbursement_sources`, `agent_expense_reads`
- Create: `tests/unit/supabase/agent-expense-{sources,reads}-migration.test.ts`

**Step 1: RED all own/all/approval variants**

Pin `mine`, `company`, `job`, `pending_approval`, and `reimbursement_batches`; require exact assigned approval for every disclosed allocation; forbid cross-employee aggregate counts; reuse `MoneySchema`.

**Step 2: RED list/detail repositories and services**

Pin `read_agent_expenses_as_system` and `read_agent_expense_context_as_system`, safe category/merchant/allocation/batch projection, bounded review reason, and no receipt/OCR/accounting/payment-method/private identity fields. Deliver `private.agent_p2_expense_attention_v1(...)`, a bounded approval/reimbursement card projection with the exact selected authority and revision output.

**Step 3: Implement source/index and RPC migrations**

Add only the proven company/status/date, own/date, batch/period, and allocation keysets. Receipt evidence remains in the artifact capability.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add expense reads"
```

---

### Task 17: Implement bounded work queue after source domains

**Files:**

- Create: `src/lib/agent-control-plane/contracts/work-queue.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-work-queue.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/work-queue.ts`
- Create: `src/lib/agent-control-plane/services/p2/work-queue/**`
- Generate/populate: `agent_work_queue_sources`, `agent_work_queue_read`
- Create: `tests/unit/supabase/agent-work-queue-{sources,read}-migration.test.ts`

**Step 1: RED composite authorization**

For every explicitly selected task, lead, correspondence, commitment, match-review, financial-document, payment, or expense source, prove the complete OAuth/permission union before one repository call. One denied explicit source causes zero reads; a default-omitted source yields one fixed warning and no row, count, or inferred existence signal.

**Step 2: RED source fence and repository/service**

Add the dedicated `work_queue` revision over `activities.match_needs_review`, `email_threads.next_commitment_due_at/has_unresolved_commitments`, opportunity follow-up/action fields, and every other queue-only source not already fenced. Compose only bounded private projections from the proven task, lead, correspondence, schedule, sales, payment, and expense sources; never read durable queue/lease/retry/error/audit tables. Bind the exact sorted revision vector and retain typed card proofs atomically.

**Step 3: Implement fixed outer RPC and bounded source gates**

The one statement authorizes all selected variants first, then unions canonical typed cards with deterministic priority/time/type/ID order and 25/26/501 bounds. No component may lend authority or revision completeness to another.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add bounded work queue"
```

---

### Task 18: Implement catalogue reads

**Files:**

- Create: `src/lib/agent-control-plane/contracts/catalog-purchasing.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-catalog-purchasing.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/catalog.ts`
- Create: `src/lib/agent-control-plane/services/p2/catalog/**`
- Generate/populate: `agent_catalog_sources`, `agent_catalog_reads`
- Create: `tests/unit/supabase/agent-catalog-{sources,reads}-migration.test.ts`

**Step 1: RED catalogue search/detail variants**

Pin family/SKU/category/tag matching, stock filters, 25/26/501 bounds, safe description/image state, stock aggregates, supplier labels, and separate supplier-cost OAuth+financial authority. Forbid internal notes, contacts, import/setup/provider/source JSON, raw paths, and cost without the selected cost section.

**Step 2: RED search/detail repositories and services**

Pin `read_agent_catalog_items_as_system` and `read_agent_catalog_item_as_system`, the catalogue revision vector, canonical ordering, exact cost money, and proof-atomic result reduction. Deliver `private.agent_p2_catalog_attention_v1(...)`, a bounded low/critical/untracked stock projection that never includes supplier cost unless that exact component authority was selected.

**Step 3: Implement source/index and RPC migrations**

Reuse existing company/category/SKU/stock indexes; add only EXPLAIN-proven normalized name/tag and current-cost ordering. Any normalization helper gets transitive writer-role ACL/DML tests.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add catalog item reads"
```

---

### Task 19: Implement purchase-order reads

**Files:**

- Reuse: `src/lib/agent-control-plane/contracts/catalog-purchasing.ts`
- Extend: `src/lib/agent-control-plane/contracts/__tests__/p2-catalog-purchasing.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/purchasing.ts`
- Create: `src/lib/agent-control-plane/services/p2/purchasing/**`
- Generate/populate: `agent_purchasing_sources`, `agent_purchase_order_reads`
- Create: `tests/unit/supabase/agent-purchasing-{sources,reads}-migration.test.ts`

**Step 1: RED list/detail and cost variants**

Pin status/supplier/delivery selectors, snapshot lines, 25/26/501 bounds, `ops.purchasing.read` + `catalog.orders.view=all`, and the separate supplier-cost OAuth/finance union. Exclude supplier contact, payment/provider/source JSON, unrestricted notes, and cost unless explicitly authorized.

**Step 2: RED repositories/services and fixed RPCs**

Pin `read_agent_purchase_orders_as_system` and `read_agent_purchase_order_as_system`, purchasing + selected catalogue-cost revision vectors, canonical delivery/time/ID ordering, strict money, and atomic proofs. Deliver `private.agent_p2_purchase_order_attention_v1(...)`, a bounded overdue/due-soon projection with the same cost redaction and revision contract.

**Step 3: Implement source/index and RPC migrations**

Add only EXPLAIN-proven PO delivery/status/ID and line ordering. Reprove current supplier-cost state in the same statement when selected.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add purchase order reads"
```

---

### Task 20: Implement company context

**Files:**

- Create: `src/lib/agent-control-plane/contracts/company-operations.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-company-operations.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/company.ts`
- Create: `src/lib/agent-control-plane/services/p2/company/**`
- Generate/populate: `agent_company_sources`, `agent_company_context_read`
- Create: `tests/unit/supabase/agent-company-{sources,context-read}-migration.test.ts`

**Step 1: RED safe company projection contract**

Company excludes billing/admin/raw settings and returns only the approved operating profile, locale/timezone/currency, working window, inventory/catalog state, and public display assets.

**Step 2: RED exact nominal permission and repository variants**

Pin `ops.company.read`, `settings.company=all`, exact company revision, strict source validity, and forbidden billing/account-holder/admin/rollout fields. Deliver `private.agent_p2_company_summary_v1(...)`, a single-row safe operating-profile projection with the exact company revision for overview composition.

**Step 3: Implement fixed source and context RPC**

Project from `companies` and closed safe settings only. Add no generic setting-key or JSON selector.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add company context read"
```

---

### Task 21: Implement team directory

**Files:**

- Reuse: `src/lib/agent-control-plane/contracts/company-operations.ts`
- Extend: `src/lib/agent-control-plane/contracts/__tests__/p2-company-operations.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/team.ts`
- Create: `src/lib/agent-control-plane/services/p2/team/**`
- Generate/populate: `agent_team_sources`, `agent_team_members_read`
- Create: `tests/unit/supabase/agent-team-{sources,members-read}-migration.test.ts`

**Step 1: RED active-member projection and authority**

Pin `ops.team.read`, `team.view=all`, stable opaque display identity, active-only rows, 25/26/501 bounds, and exclusion of contact/home/emergency/location/device/authentication/admin-role data.

**Step 2: RED repository/RPC and implement bounded indexes**

Pin `read_agent_team_members_as_system`, canonical display-name/ID ordering, company+team revisions, same-statement active membership, strict text/image/color validation, and proof-coupled empty results. Deliver `private.agent_p2_team_summary_v1(...)`, a bounded active-display-only projection with the same authority and revision output.

**Step 3: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add team directory read"
```

---

### Task 22: Implement team availability

**Files:**

- Reuse: `src/lib/agent-control-plane/contracts/company-operations.ts`
- Extend: `src/lib/agent-control-plane/contracts/__tests__/p2-company-operations.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/availability.ts`
- Create: `src/lib/agent-control-plane/services/p2/availability/**`
- Generate/populate: `agent_availability_sources`, `agent_team_availability_read`
- Create: `tests/unit/supabase/agent-availability-{sources,read}-migration.test.ts`

**Step 1: RED all-team and self-only variants**

Pin bounded date windows, `ops.team.read`, team authority, `calendar.view=all` for company availability, and the explicit self-only `calendar.view=own` branch. Output derived capacity/busy blocks only; exclude event text, provider IDs, private location, leave narratives, and hidden members.

**Step 2: RED repository/RPC and deterministic aggregation**

Pin `read_agent_team_availability_as_system`, team+availability+tasks+site-visits revision vector, server timezone/date handling, canonical member/day ordering, DST boundaries, and fixed unavailable states without calendar-detail leakage. Deliver `private.agent_p2_availability_summary_v1(...)`, a bounded capacity-only projection with no event detail and the identical revision vector.

**Step 3: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add team availability read"
```

---

### Task 23: Implement integration health

**Files:**

- Reuse: `src/lib/agent-control-plane/contracts/company-operations.ts`
- Extend: `src/lib/agent-control-plane/contracts/__tests__/p2-company-operations.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/integrations.ts`
- Create: `src/lib/agent-control-plane/services/p2/integrations/**`
- Generate/populate: `agent_integration_health_sources`, `agent_integration_health_read`
- Create: `tests/unit/supabase/agent-integration-health-{sources,read}-migration.test.ts`

**Step 1: RED provider-specific nominal variants**

Pin `ops.integrations.read`, `settings.integrations=all`, mailbox `email.view=own|all`, accounting `accounting.view=all`, and explicit selected-provider fail-closed behavior. Return only coarse configured/active/reconnect/disabled/sync state, last healthy progress, consent boolean, and closed reason codes.

**Step 2: RED repository/RPC and privacy exclusions**

Pin `read_agent_integration_health_as_system`, company+integrations revision vector, bounded canonical provider/type order, and zero credential/token/cursor/webhook/client-state/filter/autonomy/queue/lease/raw-error/provider-ID fields. Deliver `private.agent_p2_integration_health_summary_v1(...)`, a bounded closed-code projection with the same provider-specific authority and revision output.

**Step 3: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add integration health read"
```

---

### Task 24: Implement operational overview last

**Files:**

- Create: `src/lib/agent-control-plane/contracts/operational-overview.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/p2-operational-overview.test.ts`
- Create: `src/lib/agent-control-plane/registry/read-capabilities/p2/overview.ts`
- Create: `src/lib/agent-control-plane/services/p2/overview/**`
- Generate/populate: `agent_operational_overview_read`
- Create: `tests/unit/supabase/agent-operational-overview-read-migration.test.ts`

**Step 1: RED complete composite authorization**

Every explicitly selected component must be authorized before one repository call. Default-omitted components produce one fixed warning and no row/count/existence signal.

**Step 2: RED repository/service**

Bind the exact sorted revision vector and invoke only the versioned private projections delivered by the source-domain tasks and Task 4's legacy adapters. Every helper signature, component limit, policy identity, and revision output is pinned literally; a missing or mismatched helper fails the migration/runtime test. Preserve strict counts/health codes and prevent any component from lending authority or completeness to another.

**Step 3: Implement the one outer-statement RPC**

No broad overview scan or independent synthetic source counter is allowed.

**Step 4: GREEN, review, commit**

```bash
git commit -m "feat(mcp): add operational overview"
```

---

### Task 25: Mint v8 once and wire all thirty-four domain methods

**Files:**

- Populate/finalize generated migration: `agent_manifest_v8_compatibility`
- Create: `tests/unit/supabase/agent-manifest-v8-compatibility-migration.test.ts`
- Modify: `src/lib/agent-control-plane/registry/{capability-manifest,read-tools}.ts`
- Modify: `src/lib/agent-control-plane/services/{domain-service,repositories,create-domain-service}.ts`
- Modify: `src/lib/agent-control-plane/mcp/{domain-dispatch,runtime,server-factory}.ts`
- Modify: `src/lib/agent-control-plane/adapters/internal-runtime.ts`
- Create/modify: manifest v8, domain facade, runtime, transport, dependency-boundary, and old-revision compatibility tests.

**Step 1: Verify every candidate slice is green before changing the active revision**

No missing repository, method, RPC, or runtime test is permitted.

**Step 2: Write RED v8 integration tests**

Pin exactly thirty-four read definitions, exact candidate policies, all dark writes, exact v6/v7/v8 wrapper behavior, and exposure v1 still exactly eleven tools/seven scopes. Prove v8 does not make a new scope grantable or a new method externally dispatchable.

**Step 3: Mint immutable `2026-08-22.capability-manifest.v8` once**

Byte-copy the already-tested candidate policy objects into the canonical aggregate and assert identical canonical serialization and hashes for all twenty-three entries. Do not reconstruct, normalize, or semantically remint them. V8 site visits use the new scope; the frozen v7 definitions remain in compatibility tests.

**Step 4: Finalize the first-ledger compatibility migration**

Preserve literal v6/v7 outputs; v8 recursively re-proves only proof metadata; reject null/unknown/mixed revisions; never rewrite business strings. New RPCs accept v8 only.

**Step 5: Wire nested nominal repository bundles and static domain dispatch**

Both MCP and internal composition roots construct all repositories. Exposure v1 remains the only active external catalogue.

**Step 6: PostgreSQL 17 cutover runtime and prepared-call continuity**

Run pre/post v6/v7 byte equality, v8 recursive proof, ACL, old cursor, old result, and prepared-call tests.

**Step 7: GREEN, independent full review, commit**

```bash
git commit -m "feat(mcp): mint immutable read manifest v8"
```

---

### Task 26: Full local verification and Bible closeout

**Worktree safety:** Create a fresh isolated `ops-software-bible` worktree from its current local `main` before any Bible edit. Never edit or stage the dirty primary Bible checkout, `.worktrees/`, or `specs/future/`. Stage only the exact documentation and byte-exact migration-mirror paths owned by this programme.

**Files:**

- Create/modify: `tests/integration/agent-control-plane/p2-postgres-runtime.test.ts`
- Modify exact local-status sections in:
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/00_EXECUTIVE_SUMMARY.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/03_DATA_ARCHITECTURE.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/specs/2026-08-07-ops-agent-control-plane-mcp-foundation.md`
  - `/Users/jacksonsweet/Projects/OPS/ops-software-bible/specs/2026-08-18-mcp-mount-claude-first-scope.md`
  - Add the approved P2 design/current local implementation record.

**Step 1: Run every focused P2 suite and old v7 suite**

**Step 2: Run full agent-control-plane and affected MCP/OAuth/migration suites**

Expected: zero failures.

**Step 3: Run PostgreSQL 17 runtime/ACL/DML/EXPLAIN matrix**

Cover all 23 P2 capabilities and their fixed RPCs, deck-geometry parity/complexity/quality cases, empty/25/26/500/501, stale revisions, invalid sources, assigned noise, writer-role DML, limiter races, token replay/revocation, and v6/v7/v8 continuity. Use a disposable database only; do not apply to production.

**Step 4: Run type, format, diff, status, and secret scans**

**Step 5: Run two independent reviews**

One reviewer audits authorization/privacy/proofs; one audits SQL plans/ACL/compatibility/exposure. Close every P0/P1.

**Step 6: Update the Bible with exact local-only status**

State that code/migrations are committed locally, unapplied, unpushed, undeployed, and P2 absent from exposure v1. Do not claim host or production proof.

**Step 7: Commit**

```bash
git commit -m "docs(mcp): record complete read catalogue build"
```

---

## Final local completion proof

Before reporting the build complete locally, capture:

- exact branch and commit series;
- exact migration filenames and SHA-256 hashes;
- 34-read v8 manifest count and exact 11-read exposure-v1 count;
- full Node 22 test/type/format results;
- PostgreSQL 17 compile/runtime/ACL/DML/EXPLAIN results;
- independent P0/P1 review verdicts;
- clean worktree and exact Bible commit.

Do not include any rollout command in the completion report. Production rollout remains a separate, explicitly authorized phase: database first while v7 stays live, exact ledger/readback, dark-v8 code deploy, old-eleven canary, then a separately approved exposure-catalogue revision and host acceptance.

No new paid vendor or subscription is expected. The only incremental costs after a future rollout are bounded Supabase query/index work, Vercel function execution, immutable audit rows, and authorized object-storage egress; escalate any plan-tier change before incurring it.

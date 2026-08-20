# MCP Customer and Job Discovery Reads Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change. Do not apply a database migration, push, deploy, or externally expose a capability without Jackson's explicit authorization.

**Goal:** Add safe, bounded `search_customers` and `search_jobs` read-only capabilities so Claude can resolve ordinary customer/job language into stable OPS references and compose the existing nine reads.

**Architecture:** Two strict AgentResult capabilities sit behind the existing ActorContext → closed manifest policy → nominal authorization → nominal repository → pure service → domain facade → MCP transport chain. Service-role JSONB RPCs re-prove actor, company, permissions, entity visibility, source revision, ordered claims, and empty collections in one statement. Search uses deterministic exact/prefix/token tiers, signed keyset cursors, hard source/output bounds, and no raw contact or narrative content.

**Tech Stack:** Next.js 15, TypeScript 5.9, Node 22, `zod-v4`, Vitest, Supabase Postgres 17, `pg_trgm`, the existing AgentResult/proof/cursor/MCP infrastructure.

**Design System:** N/A. This wave has no product UI or user-facing OPS-Web surface.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `plugin-dev:mcp-integration`, `superpowers:systematic-debugging` if a failure appears, `superpowers:verification-before-completion`, and `superpowers:requesting-code-review`.

**Approved design:** `/Users/jacksonsweet/Projects/OPS/ops-software-bible/specs/2026-08-20-ops-mcp-discovery-reads.md`

**Isolated worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/mcp-discovery-reads`

---

## Non-negotiable boundaries

- Add only `search_customers` and `search_jobs`.
- Keep all writes and site-visit capabilities dark.
- Customer email/phone are exact lookup keys only and never appear in output.
- Job customer-name lookup composes through `search_customers` + `list_customer_jobs`.
- No notes, descriptions, correspondence, OCR, URLs, private employee data, financials, or generic search.
- Every returned row is current, same-company, actor-visible, proof-bound, and source-fenced in one SQL statement.
- Hidden and nonexistent records have indistinguishable empty behavior.
- A new manifest revision must preserve all nine current reads through an exact v6→v7 database reproof bridge.
- New capabilities remain unavailable/dark until their complete implementation and database runtime gates are green.

---

## Task 1: Freeze strict discovery contracts

**Files:**

- Create: `src/lib/agent-control-plane/contracts/discovery.ts`
- Modify: `src/lib/agent-control-plane/contracts/index.ts`
- Test: `src/lib/agent-control-plane/contracts/__tests__/discovery.test.ts`

### Step 1: Write RED behavior tests

Pin independently derived literals for:

- the three closed customer lookup modes;
- NFKC/whitespace/control/bidi/token/length rules;
- strict exact email and NANP phone inputs;
- unique/default customer/job kinds and query fields;
- job status/kind/date-window coupling;
- strict customer/job match unions;
- no contact fields in customer matches;
- no forbidden narrative/contact/financial fields in job matches;
- result count/evidence/source/proof coupling;
- one mandatory collection claim even when matches are empty;
- fixed ranking revisions and 25/60k bounds.

Run and prove the module is absent:

```bash
/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  node_modules/vitest/vitest.mjs run \
  src/lib/agent-control-plane/contracts/__tests__/discovery.test.ts
```

Expected: collection/import failure for the missing production contract.

### Step 2: Implement the minimum strict schemas

Reuse shared UUID, timestamp, evidence, job status/lifecycle/conversion, and AgentResult primitives. Export parsed/input/data/result types. Deep constraints belong in schemas, not callers.

### Step 3: Run GREEN and mutation-check

Mutate each lookup branch, kind/status refinement, result count, and forbidden field expectation mentally; at least one test must fail for each realistic break.

### Step 4: Commit

```bash
git add src/lib/agent-control-plane/contracts
git commit -m "feat(agent-control-plane): define discovery read contracts"
```

---

## Task 2: Mint manifest v7 and closed authorization policies

**Files:**

- Modify: `src/lib/agent-control-plane/registry/capability-types.ts`
- Modify: `src/lib/agent-control-plane/registry/read-tools.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Create: `src/lib/agent-control-plane/services/customer-discovery-authorization.ts`
- Create: `src/lib/agent-control-plane/services/job-discovery-authorization.ts`
- Test: `src/lib/agent-control-plane/registry/__tests__/discovery-capabilities.test.ts`
- Test: `src/lib/agent-control-plane/services/__tests__/discovery-authorization.test.ts`
- Modify compatibility tests that intentionally pin the active manifest revision.

### Step 1: Write RED policy tests

Prove:

- v7 is immutable and every capability policy carries it;
- name customer search requires `ops.customers.read` + `clients.view`;
- exact email/phone additionally requires `ops.customer_contacts.read`;
- job opportunity/project variants are independently AND-selected;
- a selected kind cannot borrow the other kind's permission;
- invalid input causes zero capability authorization calls;
- nominal WeakSet proofs reject clones/forgeries/mixed actors/duplicates;
- discovery entries are dark at this checkpoint;
- all existing capability policies remain identical except the manifest revision.

### Step 2: Implement closed selectors and nominal authorizers

Add selectors for customer discovery lookup mode and selected job kinds. Authorizers return exact scopes needed by the RPCs and wrap all selected proofs in one domain-specific nominal object.

### Step 3: Verify current reads under v7 at the TypeScript policy layer

Run registry/authorization suites before touching SQL.

### Step 4: Commit

```bash
git add src/lib/agent-control-plane/registry src/lib/agent-control-plane/services
git commit -m "feat(agent-control-plane): authorize discovery reads"
```

---

## Task 3: Extend the signed operational cursor

**Files:**

- Modify: `src/lib/agent-control-plane/services/operational-read-cursor.ts`
- Modify: `src/lib/agent-control-plane/services/__tests__/operational-read-cursor.test.ts`

### Step 1: Write RED cursor tests

Add nominal claim variants for customer/job discovery and prove:

- correct round trip;
- exact capability/schema/manifest/ranking binding;
- actor/company/query/permission/source/read-at binding;
- customer rank/name/kind/id keyset binding;
- job rank/field/value/date/kind/id keyset binding;
- one-hour TTL;
- stale permission is distinguished from malformed/tampered cursor;
- cross-capability replay fails.

### Step 2: Implement the two closed cursor variants

Do not add caller-selected sort fields or generic cursor payloads.

### Step 3: Commit

```bash
git add src/lib/agent-control-plane/services/operational-read-cursor.ts \
  src/lib/agent-control-plane/services/__tests__/operational-read-cursor.test.ts
git commit -m "feat(agent-control-plane): bind discovery cursors"
```

---

## Task 4: Freeze repository wire/proof behavior

**Files:**

- Create: `src/lib/agent-control-plane/services/customer-discovery-repository.ts`
- Create: `src/lib/agent-control-plane/services/job-discovery-repository.ts`
- Create: `src/lib/agent-control-plane/services/__tests__/fixtures/discovery-fixtures.ts`
- Create: `src/lib/agent-control-plane/services/__tests__/discovery-repositories.test.ts`

### Step 1: Write substantive RED repository tests

Test exact RPC names/args and the real repository boundary:

- capture-once client/input getters;
- zero caller authority fields;
- no caller `as_of`, raw limit beyond contract, column, sort, or SQL input;
- strict parse and deep freeze;
- actor/company/permission/capability/schema/manifest/source/ranking/input/read-at binding;
- child and collection independent canonical hashes;
- unique exact source/evidence/locator identities;
- ordered retained proof-source coupling including empty results;
- privacy-safe not-found/forbidden/read-failed mapping;
- abort before call, cooperative transport abort, and fail-closed after-await cancellation;
- 26th sentinel/count/next-cursor coupling;
- duplicate, foreign, deleted/merged/hidden-parent, and conversion mirror cases;
- fully rehashed tampering of any field, proof, order, rank, cursor, or locator;
- forbidden contact/narrative/private fields rejected by strict wire schemas.

### Step 2: Implement only the two nominal repositories

Use direct shared schemas, existing canonical projection hashing, source fence parsing, and the signed cursor codec. Do not derive product output in the repository.

### Step 3: Commit

```bash
git add src/lib/agent-control-plane/services/*discovery-repository.ts \
  src/lib/agent-control-plane/services/__tests__/discovery-repositories.test.ts \
  src/lib/agent-control-plane/services/__tests__/fixtures/discovery-fixtures.ts
git commit -m "feat(agent-control-plane): verify discovery snapshots"
```

---

## Task 5: Implement pure bounded discovery services

**Files:**

- Create: `src/lib/agent-control-plane/services/search-customers.ts`
- Create: `src/lib/agent-control-plane/services/search-jobs.ts`
- Create: `src/lib/agent-control-plane/services/__tests__/discovery-services.test.ts`

### Step 1: Write RED service tests

Prove:

- strict public mapping for every customer/job variant;
- contact lookup returns match basis but no contact value;
- deterministic ordered-prefix reduction under 60,000 characters;
- claim/proof/evidence/source removal is atomic;
- counts and omission metadata remain truthful;
- collection proof is always retained;
- minimum result that cannot fit returns `RESULT_TOO_LARGE` rather than malformed partial output;
- prompt-injection strings remain structured untrusted values;
- repository errors map to fixed AgentResult errors without leaking SQL/detail.

### Step 2: Implement pure services

No Supabase client, service-role creation, clock, or policy resolution is permitted in service code.

### Step 3: Commit

```bash
git add src/lib/agent-control-plane/services/search-customers.ts \
  src/lib/agent-control-plane/services/search-jobs.ts \
  src/lib/agent-control-plane/services/__tests__/discovery-services.test.ts
git commit -m "feat(agent-control-plane): derive bounded discovery results"
```

---

## Task 6: Build the v7 database compatibility bridge and discovery RPCs

**Files:**

- Create: `supabase/migrations/20260820220000_agent_discovery_reads.sql`
- Create: `tests/unit/supabase/agent-discovery-reads-migration.test.ts`
- Modify: only prior static assertions that intentionally pin the active manifest wrapper.

### Step 1: Write RED migration contract tests

Pin behavior, not arbitrary source formatting:

- transactional/prerequisite boundary;
- no extension version pin;
- immutable NFKC search normalizer and strict email/NANP phone normalizers;
- active partial trigram/keyset indexes;
- fixed RPC signatures and service-role-only grants;
- v6 cores preserved privately and every current reader re-proved under v7;
- Phase C context wrapper remains coherent under v7;
- same-statement actor, permission, entity, source-fence, and DB-clock capture;
- exact selected capability/OAuth/permission arguments;
- 26th source sentinel before expensive aggregation;
- deterministic exact/prefix/token ranking and literal wildcard escaping;
- per-source filtering before opportunity/project pairing;
- no raw contact values or forbidden fields in JSON;
- mandatory child/collection proofs and canonical locators;
- fixed error codes for invalid/bound/absence states;
- 1 MiB internal wire and 60k public boundary separation.

Run RED and prove the migration is absent.

### Step 2: Implement the v7 compatibility bridge first

Preserve each v6 public reader as a private frozen core, revoke it from callable roles, and replace the public name with a v7-only wrapper. Reuse/correct the recursive database projection reproof so every nested manifest field, content hash, version string, and retained proof source is rebound under v7 in the same statement.

Never accept a v6 proof as v7 in TypeScript and never relabel without rehashing.

### Step 3: Implement search indexes and RPCs

Use `SECURITY DEFINER`, fixed search paths, hard source gates, current revisions, current row visibility, canonical ordering, and privacy-safe empty behavior. The RPC returns raw authorized atomic claims, not final prompt copy.

### Step 4: Verify SQL structurally

```bash
/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  node_modules/vitest/vitest.mjs run \
  tests/unit/supabase/agent-discovery-reads-migration.test.ts \
  tests/unit/supabase/job-readiness-rpc-contract.test.ts \
  tests/unit/supabase/agent-job-catalog-reads-migration.test.ts
```

Run SQL grammar/catalog-equivalent verification if a disposable Postgres is available. Do not substitute regex tests for an executable catalog proof.

### Step 5: Commit

```bash
git add supabase/migrations/20260820220000_agent_discovery_reads.sql \
  tests/unit/supabase/agent-discovery-reads-migration.test.ts \
  tests/unit/supabase/job-readiness-rpc-contract.test.ts \
  tests/unit/supabase/agent-job-catalog-reads-migration.test.ts
git commit -m "feat(agent-control-plane): add discovery read RPCs"
```

---

## Task 7: Wire the trusted bundle, facade, and MCP transport

**Files:**

- Modify: `src/lib/agent-control-plane/services/repositories.ts`
- Modify: `src/lib/agent-control-plane/services/domain-service.ts`
- Modify: `src/lib/agent-control-plane/services/create-domain-service.ts`
- Modify: the production repository/runtime factory that creates all repositories.
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`
- Modify: `src/lib/agent-control-plane/mcp/rate-limit.ts`
- Test: `src/lib/agent-control-plane/services/__tests__/discovery-domain-facade.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/transport.test.ts`
- Modify: rate-limit/audit tests.

### Step 1: Write RED integration tests

Prove:

- the trusted repository bundle is all-or-nothing and clone-resistant;
- both methods use the same authorization/repository/service path internally and over MCP;
- dark entries are not listed or dispatchable;
- after an explicit test-only availability fixture, tools list/dispatch correctly;
- actor/company/grant/capability audit fields and result bytes are recorded;
- actor + grant + company rate ceilings apply in `evidence_search`;
- all business values pass through untrusted JSON serialization;
- no write method or generic search appears;
- all existing nine methods remain callable under v7.

### Step 2: Wire with dark availability

Add exact domain methods and the static MCP map. Do not add dynamic method lookup or generic dispatch.

### Step 3: Flip internal availability only after the complete local path is green

Keep `externalExposure=disabled`. Run facade and compatibility suites before and after the internal flip.

### Step 4: Commit

```bash
git add src/lib/agent-control-plane/services src/lib/agent-control-plane/mcp \
  src/lib/agent-control-plane/registry
git commit -m "feat(mcp): wire internal discovery reads"
```

---

## Task 8: Full verification and independent review

### Step 1: Focused verification

Run all new contract/auth/cursor/repository/service/facade/MCP/SQL suites plus the existing Task 9–13 compatibility suites.

### Step 2: Full agent-control-plane verification

```bash
/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  node_modules/vitest/vitest.mjs run src/lib/agent-control-plane
```

### Step 3: Type, format, and diff proof

```bash
/Users/jacksonsweet/.nvm/versions/node/v22.22.3/bin/node \
  --max-old-space-size=8192 node_modules/typescript/bin/tsc \
  --noEmit --pretty false
npx prettier --check <owned TypeScript test/source files>
git diff --check
git status --short --branch
```

### Step 4: Independent review

Request independent P0/P1 review of:

- exact contact lookup privacy;
- same-statement tenant/permission proof;
- v6→v7 compatibility reproof;
- rank/cursor/source bounds;
- opportunity/project conversion pairing;
- MCP exposure/rate/audit path;
- existing nine-read regressions.

Close every finding before completion.

### Step 5: Commit verification-only corrections atomically

Do not squash unrelated logical changes.

---

## Task 9: Update the Bible and prepare the rollout gate

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/03_DATA_ARCHITECTURE.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/specs/2026-08-20-ops-mcp-discovery-reads.md`

Record separately:

- local implementation commit and test proof;
- migration unapplied/applied state;
- internal availability;
- external exposure;
- push/deploy state;
- real Claude workflow proof.

Commit only the exact Bible files; preserve `specs/future/` and any sibling WIP.

---

## Production rollout — separately authorized

No step below is authorized by this implementation plan alone:

1. Push the reviewed ops-web branch.
2. Apply the migration in an authorized environment.
3. Read back exact functions, grants, indexes, manifest compatibility, and rollback artifacts.
4. Run query-plan proofs on production-shaped data.
5. Exercise internal canaries and audit readback.
6. Make a separate manifest change enabling external exposure.
7. Deploy and verify alias/runtime/tool listing.
8. Run real Claude workflows for known customer/job discovery, assigned scope, duplicate names, exact contact lookup, cursors, revocation, and downstream existing reads.
9. Revoke/rollback and prove the prior nine-read surface remains healthy.

No new paid vendor or plan is expected. Escalate any discovered plan/tier cost before incurring it.

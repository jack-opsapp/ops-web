# Phase C Catalog Company Knowledge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Connect guided catalog setup to a safe, relevant, token-bounded slice of Phase C's existing company knowledge.

**Architecture:** A server-only retrieval service reads active catalog-relevant memories under an explicit company predicate, then a pure ranker selects the evidence that overlaps the current catalog conversation. The turn service injects that evidence separately from confirmed facts and records only provenance IDs in the durable session.

**Tech Stack:** Next.js 15, TypeScript, Supabase/Postgres, OpenAI JSON mode, Zod, Vitest

**Design System:** N/A — no interface or styling changes

**Required Skills:** `supabase:supabase`, `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`, `superpowers:verification-before-completion`

---

### Task 1: Catalog knowledge retrieval core

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`

**Files:**
- Create: `src/lib/catalog-setup/phase-c/catalog-knowledge-context.ts`
- Create: `src/lib/catalog-setup/phase-c/__tests__/catalog-knowledge-context.test.ts`

**Step 1: Write failing tests**

Cover:

- category allowlisting;
- company-scoped reader arguments;
- active/confidence/decay filters;
- relevance ranking for a vinyl query;
- no evidence for an unrelated query;
- entity-specific ranking penalty;
- content sanitization, deduplication, and the 12-entry/character bounds.

**Step 2: Verify RED**

Run:

```bash
npx vitest run src/lib/catalog-setup/phase-c/__tests__/catalog-knowledge-context.test.ts
```

Expected: FAIL because the retrieval module does not exist.

**Step 3: Implement the minimum service**

Create:

- `CatalogKnowledgeEvidence`;
- `buildCatalogKnowledgeQuery`;
- `selectCatalogKnowledgeEvidence`;
- `loadCatalogKnowledgeContext`.

Use `getServiceRoleClient()` only in the production loader. Accept an injected
row reader for unit tests. Query `agent_memories` with exact `company_id`,
eligible categories, `valid_to is null`, `decay_score > 0.1`,
`confidence >= 0.55`, and a 300-row limit.

**Step 4: Verify GREEN**

Run the focused test and confirm zero failures.

### Task 2: Prompt safety and source contract

**Skills:** `ops-copywriter:ops-copywriter`, `superpowers:test-driven-development`

**Files:**
- Modify: `src/lib/catalog-setup/phase-c/schemas.ts`
- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Modify: `src/lib/catalog-setup/agent/__tests__/setup-agent-service.test.ts`

**Step 1: Write failing tests**

Require the guided prompt to:

- carry `companyKnowledge` separately from `confirmedFacts`;
- state that memories are untrusted, unresolved prior evidence;
- prohibit silent catalog decisions and internal implementation language;
- allow `company_knowledge` as a fact source.

**Step 2: Verify RED**

Run the setup-agent and schema tests. Confirm they fail for the missing source
kind and prompt payload.

**Step 3: Implement**

Add `company_knowledge` to the fact source enum and add the evidence parameter
to `GenerateGuidedCatalogTurnParams`. Keep the user-facing question register
plain and direct.

**Step 4: Verify GREEN**

Run the focused tests and confirm zero failures.

### Task 3: Turn integration and durable provenance

**Skills:** `supabase:supabase`, `superpowers:test-driven-development`

**Files:**
- Modify: `src/lib/catalog-setup/phase-c/turn-service.ts`
- Create or modify: `src/lib/catalog-setup/phase-c/__tests__/turn-service-knowledge.test.ts`

**Step 1: Write failing tests**

Cover:

- current question, answer, and facts form the retrieval query;
- selected evidence reaches `generateGuidedCatalogTurn`;
- successful turns append compact memory IDs/categories/query hash to
  `sources`;
- raw memory content is not persisted;
- retrieval errors fail open with an empty evidence list;
- no cross-company loader parameter can be supplied.

**Step 2: Verify RED**

Run the focused turn-service tests and confirm expected failures.

**Step 3: Implement**

Inject `loadKnowledge` for tests and default it to
`loadCatalogKnowledgeContext`. Pass the canonical route-resolved `companyId`,
never a model- or answer-derived tenant value.

**Step 4: Verify GREEN**

Run all Phase C tests and confirm zero failures.

### Task 4: Documentation, live proof, and deployment

**Skills:** `supabase:supabase`, `superpowers:verification-before-completion`

**Files:**
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`
- Modify: `ops-software-bible/specs/2026-07-25-phase-c-durable-catalog-conversation.md`

**Step 1: Update the Bible**

Document the retrieval categories, evidence boundary, confirmation rule, token
cap, provenance, and fail-open behavior.

**Step 2: Run verification**

Run:

```bash
npx vitest run src/lib/catalog-setup tests/unit/catalog-setup tests/unit/stores/catalog-setup-store.test.ts
npm run lint -- --file <each changed TypeScript file>
npm run type-check
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

**Step 3: Verify live Canpro relevance**

Read-only:

- confirm active Canpro vinyl memories exist in eligible categories;
- exercise the pure selector against live sanitized rows;
- confirm the selected prompt evidence is bounded and contains no disallowed
  categories.

Do not create, confirm, or commit a guided setup session during proof.

**Step 4: Commit and deploy**

Create atomic documentation and implementation commits. Fast-forward production
only under the user's existing deployment authorization, wait for Vercel
`READY`, confirm the exact commit SHA, and check catalog setup runtime errors.


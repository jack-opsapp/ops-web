# OPS MCP Sales Truth — Phase 5 Implementation Plan

> **For Codex:** Required skills: `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `ops-copywriter:ops-copywriter`, `superpowers:verification-before-completion`, and `superpowers:requesting-code-review`.

**Goal:** Add one dormant, read-only `analyze_sales_truth` MCP capability that answers golden task 15 with exact versioned metrics, honest data-quality bounds, and ranked non-causal recommendations.

**Architecture:** A strict empty-input tool authorizes company-wide pipeline and correspondence reads, re-resolves MCP authority, and calls one bounded service-role-only PostgreSQL RPC. PostgreSQL returns a typed source snapshot; TypeScript owns metric definitions, statistics, normalization, confidence, and recommendation ranking. Manifest v13 and exposure v7 add the tool without changing active v2 or prior dormant exposure bytes.

**Tech stack:** Next.js 15, TypeScript, Zod v4 alias, Vitest, Supabase/PostgreSQL 17, disposable local PostgreSQL, MCP SDK.

**Design system:** Not applicable; no visual interface is changed. User-facing MCP descriptions and recommendations follow the OPS voice contract.

## 1. Lock contract behavior with failing tests

Create contract and service fixtures/tests for strict input, schema invariants, metric math, Wilson interval, unresolved-outcome sensitivity, source attribution, loss-reason normalization, response time, stage velocity, coverage/confidence, bounds, prompt safety, and deterministic recommendation order. Run only the new tests and prove they fail because implementation is absent.

## 2. Implement the typed sales-truth domain

Add the contract, trusted repository, service, source/result validation, reauthorization, statistics, evidence references, and fixed recommendation copy. Run the focused tests until green, then refactor only while green.

## 3. Add dormant manifest v13 and exposure v7

Write failing registry/dispatch/server/runtime tests first. Add the capability definition, manifest resolver, additive exposure, domain method, runtime composition, and server instruction. Prove v1-v6 byte stability and active v2 identity.

## 4. Add and prove the bounded PostgreSQL read

Write SQL-contract and disposable-runtime tests first. Add the next non-conflicting migration with exact prerequisites, service-role-only authority checks, limits, snapshot JSON, `sales_truth` revision triggers, and verified indexes. Prove wrong tenant/grant/scope/permission/revision failures, source bounds, canonical fixture output, index use, replay, and migration parity.

## 5. Run full local verification

Run focused and broad tests, TypeScript, lint, format check, migration parity, and production build under Node 22. Inspect the resulting diff for unrelated files, secret material, activation changes, and accidental v1-v6 drift.

## 6. Independent review and repair

Request a read-only independent review against the approved design, authority boundary, metric correctness, data-quality honesty, prompt safety, and test evidence. Reproduce each valid finding, repair test-first, and rerun the complete verification suite.

## 7. Update the Software Bible and commit atomically

Update the canonical MCP architecture and feature catalogue with Phase 5’s exact contract, revision state, verification evidence, and dormant/local-only boundary. Commit OPS-Web and Bible changes separately on their isolated Phase 5 branches. Do not push, deploy, apply migrations, register grants, or activate exposure v7.

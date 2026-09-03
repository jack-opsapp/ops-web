# OPS MCP Phase 3 — Hiring What-If Implementation Plan

**Goal:** Add the first complete read-only Invisible Office what-if vertical: `If I hire a second [role] at $X/hour, when does it stop costing me money?`

**Release boundary:** Build and verify locally from released `origin/main`. Add a dormant immutable MCP exposure only. Do not change the active v2 exposure, activate v3/v4, create a client or grant, push, deploy, or apply the migration.

**Architecture:** One MCP read capability accepts only a tenant role name and an all-in employer hourly cost. The existing MCP actor context owns tenant, actor, grant, scopes, permissions, revisions, timezone, and currency. A single service-role-only PostgreSQL statement re-proves current authority and returns a bounded 13-complete-week analytical source snapshot. The application service validates the snapshot and calculates the server-owned utilization, cash contribution margin, productive yield, weekly cost, required utilization, break-even hours/revenue/date, observed-quartile sensitivity, completeness, confidence, assumptions, and supporting records. No scenario, snapshot, action, notification, or customer record is persisted.

## Server-owned metric definition

- `hourly_cost` means all-in employer cost per paid hour in the company's currency. The tool never invents payroll burden, benefits, overtime, hiring fees, or a wage-to-cost multiplier.
- The observation window is the 13 complete company-local ISO weeks immediately before the current local week.
- The comparison population is the current active company members assigned to the one exact case-insensitive canonical role. No legacy `users.role`, fuzzy role match, or company-wide fallback is allowed.
- Paid capacity is the company's default work window on configured working days. Any approved/current time-off event removes that member-day from observed capacity.
- Productive minutes are non-cancelled project tasks and non-cancelled booked site visits assigned to the population, clipped to work windows and merged so overlaps never double count utilization. Personal calendar events are not treated as productive work.
- Project cash revenue is non-void payment cash received during the window on project-linked invoices. Direct cost is the eligible company-currency expense allocation during the window. The cash contribution margin is revenue minus allocated direct expense before existing labour, payroll burden, and overhead.
- Each project's cash contribution is allocated to the selected role by its share of merged scheduled project minutes among active assigned members, then distributed across observed weeks by that role's scheduled minutes on the project.
- Base utilization and cash contribution per productive hour use the complete-window aggregates. Low/base/high sensitivity uses the 25th/50th/75th percentiles of complete weekly contribution yield per paid-capacity hour.
- Weekly hire cost is standard weekly paid hours times the submitted all-in hourly cost. Required productive hours equal weekly cost divided by observed contribution per productive hour. Required revenue equals weekly cost divided by observed cash contribution margin. Required utilization equals hourly cost divided by observed contribution per productive hour.
- A break-even date is returned only when the scenario's observed contribution yield per paid-capacity hour is at least the hourly cost. It is the first company working date in the next standard workweek on which cumulative modeled contribution covers that entire week's hire cost. No ramp curve or hiring fee is invented.
- Missing/ambiguous roles, zero comparable members, bounds, fewer than eight complete usable weeks, fewer than three financially observed role projects, non-positive cash contribution, or invalid source/currency coverage return an explicit insufficient-data state instead of a numeric claim.

## Task 1: Freeze the public contract in failing tests

**Files:**

- Create `src/lib/agent-control-plane/contracts/hiring-what-if.ts`
- Create `src/lib/agent-control-plane/contracts/__tests__/hiring-what-if.test.ts`

**RED:** Test strict two-field input, bounded canonical role text, positive safe money, immutable definition revisions, ready/insufficient result union, exact timezone/currency/window coupling, ratio/rate bounds, break-even coupling, ordered sensitivity, confidence/completeness, assumptions, source revisions, and unique bounded supporting records. Run only the new contract test and observe failure before implementation.

**GREEN:** Implement the smallest strict Zod 4 contract and pure calculation helpers needed by later service tests. Re-run the contract test.

## Task 2: Freeze dormant manifest and exposure compatibility in failing tests

**Files:**

- Create `src/lib/agent-control-plane/registry/hiring-what-if-capability.ts`
- Create `src/lib/agent-control-plane/registry/__tests__/hiring-what-if-capability.test.ts`
- Modify `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify `src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts`
- Modify `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify `src/lib/agent-control-plane/mcp/__tests__/domain-dispatch.test.ts`

**RED:** Require immutable manifest v11 and inactive exposure v5 with exactly `analyze_hiring_break_even`; read-only annotations; no prepare scope; exact read scopes; all-scope current permissions; domain dispatch; unchanged v1-v4 bytes; and active exposure still v2.

**GREEN:** Add the implementation-only definition, reminted manifest, exposure resolution, and one dispatch entry without altering existing revision objects.

## Task 3: Build the bounded repository and analytical service test-first

**Files:**

- Create `src/lib/agent-control-plane/services/hiring-what-if/hiring-what-if-repository.ts`
- Create `src/lib/agent-control-plane/services/hiring-what-if/hiring-what-if-service.ts`
- Create `src/lib/agent-control-plane/services/hiring-what-if/__tests__/hiring-what-if-repository.test.ts`
- Create `src/lib/agent-control-plane/services/hiring-what-if/__tests__/hiring-what-if-service.test.ts`

**RED:** Prove strict v11/v5 actor binding, one abortable RPC, no caller-supplied actor/company/timezone/currency/window/definition, initial and current reauthorization before the read, authority loss before source access, exact input semantics, role-not-found/ambiguous/empty/bound states, base calculations, quartile sensitivity, no-break-even handling, date projection over configured working days, explicit completeness/confidence thresholds, inert source text, and result bounds.

**GREEN:** Implement a trusted repository and trusted service. Keep every calculation deterministic and side-effect-free. Map invalid inputs to the existing safe contract error shape and storage ambiguity to a non-disclosing temporary failure.

## Task 4: Define the single read-only database boundary in failing SQL contract tests

**Files:**

- Create `supabase/migrations/20260901045000_agent_hiring_what_if_read.sql`
- Create `src/lib/agent-control-plane/services/hiring-what-if/__tests__/hiring-what-if-sql-contract.test.ts`
- Create `tests/sql/agent-hiring-what-if-setup.sql`
- Create `tests/sql/agent-hiring-what-if-runtime.sql`
- Create `tests/integration/agent-control-plane/hiring-what-if-postgres-runtime.test.ts`

**RED:** Require transaction atomicity, prerequisite and source-shape checks, exact v11/v5 tenant/grant/client/revision/scope binding, all required company-wide permissions, service-role-only execution, pinned search paths, one read-only RPC, no table/policy/write/rate-bucket creation, fixed 13-week/server clock semantics, exact role resolution through `roles` + `user_roles`, capacity/time-off rules, task/site-visit overlap merging, project-minute allocation, payment/expense populations, company-currency treatment, hard source bounds, stable ordering, source revisions, and zero mutation vocabulary.

**GREEN:** Implement the migration with one private authority assertion and one public analytical read RPC. Use existing canonical time, money, authority, and domain-revision helpers. Add only source-query indexes that a current schema/index audit proves missing and necessary; otherwise add no schema object beyond the functions. Seal the migration and golden/failure fixtures by SHA-256, then execute them in one uniquely named disposable PostgreSQL 17 database with guaranteed cleanup.

## Task 5: Compose the dormant service without widening active runtime

**Files:**

- Modify `src/lib/agent-control-plane/services/capability-service.ts`
- Modify `src/lib/agent-control-plane/mcp/runtime.ts`
- Modify `src/lib/agent-control-plane/mcp/server-factory.ts`
- Modify focused runtime/host tests under `src/lib/agent-control-plane/mcp/__tests__/`

**RED:** Require construction to fail without a trusted what-if service, v5 discovery to expose exactly one tool, v5 calls to reach only the analytical method, output to traverse the untrusted-data serializer and audit boundary, and v1-v4 instructions/discovery to remain unchanged.

**GREEN:** Compose the repository/service at the existing service-role transport and add the v5 server-owned instruction string. Do not add a route, UI, notification, action, worker, scheduler, persistence, or model/provider call.

## Task 6: Update the Software Bible in lockstep

**Files:**

- Add `specs/2026-08-31-ops-mcp-hiring-what-if-vertical.md`
- Mirror the source migration under `supabase/migrations/`
- Update `03_DATA_ARCHITECTURE.md`
- Update `04_API_AND_INTEGRATION.md`
- Update `09_FINANCIAL_SYSTEM.md`

Record the exact definitions, authority, source populations, exclusions, bounds, sensitivity/confidence rules, result semantics, no-persistence decision, local-only release state, test evidence, migration-not-applied state, and explicit activation/deployment gates. Preserve the approved vision handoff in the Bible history.

## Task 7: Verify and commit locally

Run on Node 22:

1. every new test at RED, then GREEN;
2. focused contract/service/registry/runtime/SQL suites;
3. the full agent-control-plane suite, reporting inherited loopback/timezone baseline failures separately;
4. TypeScript typecheck;
5. touched-file lint and formatting checks;
6. production build if the repository can complete it within the isolated worktree;
7. migration static safety checks, read-only mutation scan, and byte-exact Bible mirror comparison;
8. current Supabase security/performance advisors as a production baseline only, clearly noting the migration was not applied;
9. final `git diff --check`, status, and existing-revision compatibility audit.

Create atomic conventional commits in OPS-Web first, then the Bible. Do not push, deploy, apply the migration, create OAuth authority, or claim customer-live proof.

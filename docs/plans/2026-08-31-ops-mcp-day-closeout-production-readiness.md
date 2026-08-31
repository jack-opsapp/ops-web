# OPS MCP Day Closeout Production Readiness Plan

**Goal:** Turn the dormant Foundation Zero closeout vertical into a locally release-ready production candidate without activating v3, applying migrations, pushing, deploying, or creating customer routines.

**Architecture:** Keep the active MCP exposure pinned to read-only v2. Add a private-table/service-role configuration boundary for the signed-in operator's own v3 grant, a minimal setting on the existing Connected agents surface, a dormant Vercel scheduler registration, and a privacy-safe authenticated host acceptance runner. Current OPS authority is re-resolved by PostgreSQL on configuration and again by the worker on every run.

**Safety invariants:**

- Actor and company IDs come only from the verified OPS session; the request body cannot choose either.
- Enabling or changing a routine requires a live, internally consistent v3 grant with the exact closeout scope set, all seven closeout permissions at `all`, and `settings.integrations: all`.
- The company timezone is server-owned. The UI accepts only one local time and an on/off state.
- The routine runs daily, including weekends, because trades owner-operators do not share a universal Monday-Friday week. A clear day stays quiet.
- Identical PUTs are true no-ops. Authority, grant, schedule, or timezone changes increment `schedule_revision` and invalidate any in-flight lease.
- OAuth revocation disables the bound routine in the same transaction before future work can be claimed.
- All routine state remains in `private`; browser and OAuth roles receive no table access. Public configuration RPCs remain service-role-only with a pinned `search_path` and defense-in-depth role check.
- v3 remains dormant after this branch: the active exposure constant stays v2, the worker flag stays off, and no routine rows or customer authority are created.

## Product presentation decision

Four layouts were considered before implementation:

1. **Dedicated routine settings page** — rejected because one time and one switch do not deserve permanent navigation acreage.
2. **Global Automation settings card** — rejected because it separates authority from the connected agent that owns it.
3. **Inline control inside each eligible Connected agent row** — selected. The operator sees the routine beside the exact grant, and revocation and schedule remain one coherent authority surface.
4. **Setup wizard or modal** — rejected because this is a reversible two-field preference, not an onboarding ceremony.

The selected row uses existing Card, Button, Switch, and time-input patterns. It introduces no new color, spacing, radius, font, icon, or motion values and all new copy ships through the English and Spanish settings dictionaries.

## Task 1: Repair the pre-existing SQL CI fixture

**Files:**

- Modify: `tests/sql/contact-form-provenance-gate-contract.sql`

1. Reproduce the current PostgreSQL compile failure.
2. Move column-faithful composite-row fixtures ahead of the first migration so each `%rowtype` resolves when the function is created.
3. Keep the fixture transactional and production migrations unchanged.
4. Run the exact CI SQL contract command and prove all assertions pass.

## Task 2: Add exact routine configuration storage authority

**Files:**

- Add: `supabase/migrations/20260831120000_agent_day_closeout_routine_configuration.sql`
- Add: `tests/sql/agent-day-closeout-routine-configuration-runtime.sql`
- Modify: `.github/workflows/ci.yml`
- Add/modify TypeScript SQL-contract tests under `src/lib/agent-control-plane/services/day-closeout/__tests__/`

1. Write failing contract tests for tenant isolation, signed-in actor binding, exact v3 grant/scope/revision checks, granular permission checks, server-owned timezone, all-days scheduling, idempotent replay, schedule-revision invalidation, immediate revocation disablement, and exact ACLs.
2. Add service-role-only list/upsert configuration RPCs over the private routine table.
3. Replace both OAuth grant-revocation functions so grant or token revocation disables matching routines atomically.
4. Add the SQL runtime contract to CI and run it against isolated PostgreSQL.

## Task 3: Add a typed settings API

**Files:**

- Add: `src/lib/agent-control-plane/services/day-closeout/day-closeout-routine-config.ts`
- Add: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-config.test.ts`
- Add: `src/app/api/mcp/routines/day-closeout/route.ts`
- Add: `tests/unit/mcp/day-closeout-routine-route.test.ts`

1. Write failing repository and route tests first.
2. Validate every RPC row with a strict schema.
3. Expose only GET and PUT; reject malformed grant IDs, times, extra properties, and unauthenticated requests.
4. Map denied current authority to 403, invalid input to 400, and unavailable storage to a non-disclosing 500 response. Never return business contents or permission internals.

## Task 4: Add the minimal operator control

**Files:**

- Modify: `src/components/settings/connected-agents-section.tsx`
- Modify: `tests/unit/settings/connected-agents-section.test.tsx`
- Modify: `src/i18n/dictionaries/en/settings.json`
- Modify: `src/i18n/dictionaries/es/settings.json`

1. Write failing interaction and accessibility tests.
2. Render the control only for an eligible v3 grant returned by the server.
3. Show one daily local time input, one neutral switch, the authoritative timezone, and concise last-run state.
4. Save on an explicit button so time edits cannot silently change authority.
5. Refetch from the server after saving or revoking; never assume the optimistic state is authoritative.

## Task 5: Make release and host acceptance repeatable

**Files:**

- Add: `src/lib/agent-control-plane/mcp/host-acceptance.ts`
- Add: `src/lib/agent-control-plane/mcp/__tests__/host-acceptance.test.ts`
- Add: `scripts/mcp-day-closeout-host-acceptance.ts`
- Modify: `package.json`
- Modify: `vercel.json`

1. Write failing tests for initialize, exact one-tool v3 discovery, prepare response validation, bearer redaction, timeout, non-JSON, protocol errors, and safe summary output.
2. Add a CLI that accepts endpoint and bearer only through environment variables, prints no token or business contents, and exits non-zero on any contract drift.
3. Register the existing cron endpoint at a five-minute cadence but keep execution behind `OPS_DAY_CLOSEOUT_ROUTINES_ENABLED=true`. Confirm the project plan supports the cadence and report the invocation cost before release.
4. Keep the active exposure v2. The runner is executed against v3 only after Jackson completes a dedicated synthetic-company OAuth consent during the later activation gate.

## Task 6: Verification and Bible handoff

**Files:**

- Update the corresponding day-closeout specification in an isolated Software Bible worktree after the web implementation is proven.

1. Run focused unit and SQL contracts, then the relevant MCP/OAuth/routine suite.
2. Run type-check, lint-equivalent checks, formatting check, and a clean Node 22 production build.
3. Start the webpack development server and verify the settings surface at desktop and mobile widths, including keyboard labels, loading, empty, eligible, saved, failure, and revoked states.
4. Run the design-system audit and inspect the final diff for hardcoded visual values or user-facing strings.
5. Update the Bible with the exact configuration contract, scheduler/cost posture, host acceptance runbook, and remaining activation gates.
6. Commit atomic changes on the isolated local branch. Do not push, deploy, apply the new migration, activate v3, enable the worker, or create routines.

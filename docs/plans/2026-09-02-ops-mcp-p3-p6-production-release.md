# OPS MCP Phases 3–6 Production Release Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to execute this plan task-by-task.

**Goal:** Publish the verified Phase 3–6 read-only MCP verticals and their database functions to production while leaving every new exposure dormant.

**Architecture:** Reconcile the authoritative Phase 6 lineage with current `origin/main` in an isolated release worktree. Apply the four additive migrations before deploying the application, verify every database and authorization boundary independently, then push the matching Bible record.

**Tech Stack:** Next.js, TypeScript, Vitest, PostgreSQL 17, Supabase, Vercel.

**Design System:** N/A — no interface changes are introduced by this release.

**Required Skills:** `custom-skills:executing-plans`, `supabase:supabase`, `superpowers:using-git-worktrees`, `superpowers:finishing-a-development-branch`, `superpowers:verification-before-completion`, `vercel:deployments-cicd`, `vercel:verification`.

---

### Task 1: Seal the release lineage

**Files:**
- Base Web commit: `50bd43bcaee080de310eee9ad7d18325b37d0738`
- Base Bible commit: `c791ac1ce14ef2b19da8204b9a43520b2c58f42e`

1. Fetch both current remote main branches.
2. Merge current OPS-Web `origin/main` into the isolated release branch.
3. Resolve overlaps semantically and preserve both histories.
4. Prove current main and the authoritative Phase 6 commit are ancestors.
5. Confirm the release diff contains Phases 3–6 and excludes Phase 7.

### Task 2: Verify the combined application candidate

**Files:**
- `src/lib/agent-control-plane/**`
- `supabase/migrations/20260901045000_agent_hiring_what_if_read.sql`
- `supabase/migrations/20260901122000_agent_promise_recovery_read.sql`
- `supabase/migrations/20260901153000_agent_sales_truth_read.sql`
- `supabase/migrations/20260901190000_agent_payroll_readiness.sql`

1. Verify Web/Bible migration hashes are byte-identical.
2. Run all focused Phase 3–6 contract, service, SQL, runtime, and exposure tests.
3. Run the complete agent-control-plane regression suite.
4. Run TypeScript with an 8 GB heap, targeted lint/format checks, and the production build.
5. Record unrelated inherited failures separately; do not attribute them to this release.

### Task 3: Preflight production

1. Verify Supabase project identity and health.
2. Read the live migration ledger and confirm all four migrations are absent.
3. Read the live schema and function definitions required by the migrations.
4. Confirm v5–v8 have zero clients and zero grants; confirm active production remains v2.
5. Confirm no Phase 3–6 RPC or schema addition already exists unexpectedly.
6. Run security and performance advisors and classify only release-relevant findings.

### Task 4: Apply and prove the database release

1. Apply the four migrations in chronological order using their exact committed SQL.
2. After each migration, read back its ledger row, function definition, ACL, search path, and expected schema additions.
3. Confirm no anonymous or authenticated execution privilege was introduced.
4. Confirm v5–v8 still have zero clients and grants and no synthetic/customer records were created.
5. Re-run advisors and release-specific database probes.

### Task 5: Deploy and verify OPS-Web

1. Push the isolated reconciled Web head to `origin/main`.
2. Wait for the exact commit deployment to become `READY` and own the production alias.
3. Verify OAuth metadata still advertises the established active read scopes only.
4. Verify protected MCP routes reject unauthenticated callers.
5. Scan deployment-scoped runtime errors and logs for all affected routes.
6. Re-read database state to prove the deployed code did not activate v5–v8.

### Task 6: Publish the authoritative Bible record

1. Add the production migration ledger names, Web commit, deployment ID, and dormant-state proof to the Phase 3–6 Bible specifications and canonical chapters.
2. Mirror the exact applied SQL files in `migrations/`.
3. Verify hashes, links, and release-state language.
4. Commit, push to Bible main, and independently read back the remote ancestry.

### Task 7: Final release closeout

1. Verify exact Web/Bible remote heads or descendant ancestry.
2. Verify the production alias points to a deployment containing the release commit.
3. Verify live migration ledger, RPC ACLs, active v2 state, and dormant v5–v8 state.
4. Report deployment, database, runtime, activation, and cost states separately.

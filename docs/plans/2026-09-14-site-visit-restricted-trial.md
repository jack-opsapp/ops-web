# Site-visit restricted trial implementation plan

**Goal:** Finish the approved MAVERICK-only native-host trial without changing Canpro, public exposure, frozen tool contracts, or exact OPS save approval.

**Architecture:** Extend the existing subject-bound OAuth trial lifecycle for frozen site-visit V22 / consent V17. Use a separate owner-only, immutable two-hour binding sealed to the reviewed company effect and installed-client compatibility. Resolve, issue, refresh, revoke, and domain reauthorization must all enforce the same binding. No migration seeds clients, companies, effects, or business records.

**Tech stack:** Existing Next.js routes, TypeScript, PostgreSQL, native MCP OAuth.

**Design system:** `.interface-design/system.md` reviewed; no UI, styling, animation, or new consent copy. Reuse the frozen site-visit consent labels.

**Required skills:** custom-skills:executing-plans; superpowers:using-git-worktrees; superpowers:test-driven-development; supabase:supabase; superpowers:requesting-code-review; superpowers:verification-before-completion.

## 1. Exact host selection and refresh

- Test `src/lib/agent-control-plane/mcp/oauth/__tests__/site-visit-canary.test.ts`: exact 21-tool / scope snapshot is selected only for a current binding; absent, expired, mismatched, malformed, disabled and cross-subject cases fail closed. Public registration remains V23.
- Observe the successful-binding case fail against existing `oauth/canary.ts`.
- Add V22 to that existing subject resolver and the refresh route's restricted-trial branch; retain all prior branches and frozen labels.
- Run the new tests plus existing OAuth/candidate protocol regressions with one worker.

## 2. Database lifecycle

- Verify live table shapes/RLS and baseline function fingerprints through narrow read-only Supabase queries; derive function definitions from checked-in migration sources, not a new broad production export.
- Create `tests/sql/site-visit-trial-*` with a disposable socket-only PostgreSQL fixture using real checked-in OAuth/permission/workflow functions. Observe the missing restricted binding failure.
- Generate a new migration filename through Supabase CLI. Add private binding/current/authorize/provision/revoke behavior, then exact fingerprint-guarded updates to labels, consent/code/grant/token issuance, lookup, refresh, and workflow reauthorization. Existing immutable pins and prior trial functions remain intact.
- Test exact-subject isolation, expiry, revocation, stale effects/compatibility/permissions, no fallback/internal write escape, idempotent lifecycle behavior, no business seed, and public/grant preservation. Preserve stored unrelated effect seals; do not reseal other domains.

## 3. Review and release

- Independently review the full diff and run focused TypeScript, OAuth/protocol and real SQL tests, including existing public V14/V23 and catalog/financial trial cases.
- Update the Bible with exact authority, expiry, migration, and readiness evidence; preserve unrelated work.
- Release only the approved scoped code/migration after fresh integration/live drift checks. Separately verify a compatible phone's pending-work recovery before enrolling MAVERICK compatibility/effect policy.
- Establish only a fresh exact MAVERICK actor/client trial; never repin an existing Canpro grant. Fresh host consent remains required. Run native prepare → exact OPS review/save → independent readback/revocation. Do not describe modeled transport, service-role SQL or READY as native acceptance.

## Exclusions and honest stop conditions

No Canpro writes/activation, customer/provider messages, financial/catalog resealing, phone queue edits, purchases, paid fallback, App Store release, or broad public activation. If phone recovery or fresh host consent requires Jackson's interaction, stop at that exact boundary after finishing safe implementation and verification. Deployment approval does not authorize shipping unrelated main-branch commits.

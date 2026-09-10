# Deck geometry and perimeter estimating implementation plan

**Goal:** Read valid native multilevel decks without losing stairs; expose a measured perimeter scenario separate from configured railing.
**Architecture:** Preserve frozen v1 input/result and policy. A v2 result with its own calculator revision represents absent/null lower-edge links, native stair placement, and explicit estimated coverage. An isolated exposure v23 candidate selects v2 from the server-pinned exposure; existing v1 pins retain v1 and get an actionable compatibility error for unrepresentable geometry. Both use the existing nominal v8 authorization and source repository. No business writes or authority changes.
**Tech stack:** TypeScript, Zod, Vitest; native Swift models read-only.
**Design system:** N/A; no UI.
**Required skills:** systematic-debugging, test-driven-development, brainstorming, custom-skills:writing-plans, custom-skills:executing-plans, using-git-worktrees, ops-copywriter, requesting-code-review, verification-before-completion.
**Approved scope:** Local implementation/tests/atomic commits/Bible updates. Parent owns integration/release. No push, deployment, live migration, grant changes, or native builds.
**Bases:** Web 23ffe646a77effba851fe063c68c15e93114b9cb; Bible 03da8c1. Primary shared working trees preserved. Dependencies cloned locally.
**Reservations:** P19-2 exclusively reserves 2026-09-10.capability-manifest.v28, 2026-09-10.mcp-exposure.v23, 2026-09-10.mcp-consent-catalog.v18. Reservation does not activate anything. Manifest/consent revisions are unnecessary unless audit finds an authority change; v23 is a dormant projection selector.

## 1. Native optional destination, test first
- Add synthetic native-shaped regression fixtures for ops-ios and ops-decks-ios; no production IDs/data. Confirm absent and null currently reject.
- Preserve null lowerEdgeId, validate any named edge, retain lower plane and native destination/placement evidence, stair width/rise/run. Keep old v1 strict.
- Run parser/calculator and both golden producers. Commit one geometry change.

## 2. Perimeter scenario, test first
- Cover configured versus unconfigured edges, measured inches versus drawing units, stale/missing dimensions, house/wall, shared/internal edges, holes, stair openings and gates.
- Enumerate every edge with inclusion/exclusion/unknown status; use boundary membership and persisted dimensions. Do not guess house attachment. Unknown gate widths block that edge (native 36-inch component allowance is not a measured gate). Distinguish measured flat lengths from assumed two-sided sloped stair rails; no compliance/pricing/stock/order quantity.
- Sum only fully resolved selected edges; keep partial known coverage explicit and no complete total when a candidate edge is unresolved. Report assumptions/missing facts.

## 3. Authorized v2 service and proof, test first
- Select explicit result revision internally; source proof/fence binds revision and full result. Preserve v1 representable output quantities.
- Invalid native references return stable nonretryable geometry error; v1 unrepresentable geometry returns a nonretryable INTERNAL compatibility error requiring an approved release and compatible connection transition. Retain repository failures, stale and source size behavior.
- Test actual repository authorization, immutable source/hash coupling, source freshness, both input anchors, and output budget/privacy.

## 4. Dormant host-neutral dispatch, test first
- Coordinate shared files with parent before edits. Candidate exposure v23 selects v2; normal pinned exposure selects v1. No active catalogue insertion.
- Real MCP in-memory protocol test must exercise actual domain read with nominal fixture actor/repository, verify exact original args, scope rejection, tenant/stale failure, and v1 compatibility behavior.

## 5. Independent review and release handoff
- Request a bounded independent review; fix findings and rerun affected checks.
- Update Bible numbered API and deck chapters with local status, exact commits and compatibility/host acceptance gates. Commit after code.
- Handoff exact commits, tests, candidate activation requirements, and replay requirement to parent. Local tests are not Claude acceptance.

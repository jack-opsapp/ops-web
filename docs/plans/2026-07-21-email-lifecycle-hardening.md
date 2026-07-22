# Email ingestion to lead lifecycle hardening

**Goal:** Make newly ingested customer correspondence drive a monotonic, retry-safe opportunity lifecycle across fragmented threads without provider writes, historical backfills, duplicate opportunities, or duplicate projects.

## Behaviour contract

- Email automation may never reset an established or terminal lead to `new_lead`; every other active-stage loop uses an exact stage/assignment snapshot, and no automated write may replace a manual or terminal stage.
- The newest decisive commercial signal wins: explicit acceptance, confirmed scheduling, a deposit/payment request, or confirmed payment converts through the canonical guarded conversion event; a later explicit budget/timing deferral records a lost/deferred disposition and a future follow-up instead.
- A model-only `likely_won` classification is review-only; it cannot authorize actorless conversion without the deterministic complete-conversation evidence contract.
- Every meaningful inbound or outbound event refreshes the opportunity summary from the complete current opportunity conversation, including revised price, scope, schedule, objections, and next action.
- Linked CUSTOMER threads retain deterministic categorization but receive a real current-state summary, not a relationship placeholder.
- Matching considers canonical provider links, all external From/To/CC participants, strict forwarded-contact evidence, alternate client contacts, exact addresses, and active existing projects. Ambiguous evidence remains separate.
- Existing accepted projects are linked only through the guarded conversion RPC after company, client/address, assignment snapshot, provider evidence, manual override, and unlinked-project checks pass under lock.
- Explicit budget/timing deferrals use a guarded service-role RPC that atomically records stage, transition, reason, follow-up, and disposition. No direct `assigned_to` write is permitted.

## Implementation sequence

1. Add RED scenario tests for Camille Ottenhof, Erick Pay, Layla Nouraee, and Owen Schellenberger, plus SQL contract tests for monotonic stages and guarded deferred outcomes.
2. Add a pure commercial-outcome detector with newest-signal precedence and deterministic follow-up calculation.
3. Replace the thread-local acceptance call with one retry-safe opportunity decision boundary invoked after every durable meaningful correspondence event.
4. Harden active-stage transition and correspondence projection RPCs; route stale-stage movement through the same transition RPC.
5. Extend relationship matching across external participants and exact unlinked-project evidence; add the narrow actorless existing-project conversion authorization.
6. Make complete-context summary refresh target the affected opportunities immediately; retain the cron as fallback only, without invoking or extending any historical backfill path.
7. Replace deterministic CUSTOMER placeholder summaries with classifier-produced current-state summaries plus a deterministic fallback.
8. Run focused tests, lifecycle suites, TypeScript checks, the production build, and a read-only shadow evaluation against the four live conversations.
9. Inspect the OPS Software Bible checkout; update it only if the relevant files are free of parallel work, then commit atomic product changes and stop without push, deployment, migration apply, Gmail writes, or live lead writes.

## Verification gates

- All four scenario fixtures produce their expected stage/disposition, summary facts, project link decision, and next action.
- Replaying every scenario produces no second transition, disposition, conversion event, opportunity, project, or attachment attribution.
- Manual-stage fixtures remain unchanged.
- No code path updates `opportunities.assigned_to` directly.
- The final live check is SELECT/read-only and provider-read-only.

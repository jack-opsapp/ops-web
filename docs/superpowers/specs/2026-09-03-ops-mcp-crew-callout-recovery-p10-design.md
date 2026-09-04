# OPS MCP Phase 10 — Crew Call-Out Recovery

## Outcome

Phase 10 adds one dormant MCP prepare capability for the question: “Mike is sick tomorrow. Who can cover his work?” The capability resolves one current crew member and one company-local civil date, returns every affected authorized task and site visit, and prepares the smallest evidence-backed recovery plan it can prove. It does not change assignments, schedules, calendars, provider drafts, messages, or delivery state.

The active production exposure remains the read-only v2 catalogue. Phase 10 is implemented in the v18 manifest and registered only in dormant exposure v12. No client or grant is moved to v12 by this release.

## Exact request boundary

The tool is `prepare_crew_callout_recovery` with strict input:

```json
{
  "crew_member_name": "Mike",
  "target_date": "2026-09-04"
}
```

- `target_date` means the exact half-open civil-day window `[00:00, next 00:00)` in the company timezone. The response reports the resolved UTC instants and the company working-hours interval.
- Crew identity uses canonical, case-insensitive exact matching only: exact full name, or an exact first/last name only when it identifies exactly one active member. Prefix, fuzzy, nickname, and inferred matches are forbidden.
- Zero or multiple matches return a structured unresolved result. OPS never chooses a person by likelihood.
- The date must be current or upcoming and within the bounded recovery horizon.

## Authoritative source snapshot

One service-role-only, stable, security-definer RPC reads and hashes a single tenant-scoped snapshot. It rechecks the actor, OAuth grant/client binding, consent labels, v18 manifest, v12 exposure, required scopes, permission revision, and exact entity access in the same statement that reads business data.

The snapshot includes:

- company timezone, working hours, weekend policy, and source revisions;
- the resolved unavailable member and canonical role assignments;
- every active task and scheduled/in-progress site visit assigned to that member in the civil-day window, plus each linked authorized project;
- every active replacement candidate, canonical roles, exact relevant task-type completion counts, time off, personal events, scheduled tasks, and site visits across the recovery horizon;
- exact current schedule/version material required to detect stale preparation;
- exact internal recipient identity for a replacement candidate and exact client/sub-client recipient identity only where OPS can prove a unique, unsuppressed, authorized recipient.

Missing, malformed, over-bound, cross-tenant, inaccessible, or internally inconsistent source data fails closed. The RPC has no business-table write path and is executable only by `service_role`.

## Qualification truth

OPS has no workforce licence, trade-certificate, or skill-endorsement system tied to `public.users`. The unrelated `public.certificates` table belongs to OPS Learn identities and cannot prove field qualifications for an OPS crew member.

Phase 10 therefore returns only evidence OPS can prove:

- canonical role overlap from `user_roles` and `roles`;
- count of completed assignments for the exact affected task type;
- active same-company membership.

Historical completion is labelled `same_task_history`, never “licensed,” “certified,” or “qualified.” A task with an explicit task type may be reassigned only to a candidate with role overlap and at least one completed assignment for that exact task type. A site visit has no modelled qualification requirement; it is labelled `no_requirement_recorded`, not proof of a skill. Any future qualification requirement must be backed by a first-class source before it can affect coverage.

## Recovery policy

The deterministic planner uses this lexicographic order:

1. Preserve every date and time.
2. Replace only the called-out member; preserve every other assignee.
3. Use the fewest replacement members possible.
4. Prefer exact same-project continuity, then more same-task history, then lower committed minutes, then canonical member ID.
5. Never give one person overlapping work.
6. For an item without provable same-day coverage, try the earliest later company working day where the original crew composition is free and the item is safe to move.
7. Keep unresolvable items explicitly uncovered with machine-readable reasons.

The assignment search is exact and bounded. If a globally smallest plan cannot be proved within the published item/candidate/search bounds, the tool returns an unresolved bounded result instead of presenting a heuristic as optimal.

Locked, recurring, dependency-bearing, malformed, unlinked, or unauthorized work is never silently moved. Existing personal events, approved time off, tasks, site visits, company hours, weekend policy, project conflicts, and other assigned-member conflicts all participate in availability.

## Proposal and drafts

The result separates source facts, candidate evidence, proposed changes, uncovered work, and draft previews. Canonical ordering plus SHA-256 hashes make identical authorized snapshots produce identical proposal state on any host.

- An internal draft is prepared only for an exact chosen current team member with one canonical internal email.
- A client draft is prepared only when the plan would move client-facing work and OPS resolves one exact authorized, unsuppressed client/sub-client recipient.
- Missing or ambiguous recipients become explicit draft blockers; no recipient is inferred.
- Drafts are returned in the response only. They are not written to OPS or a provider and nothing is sent.

Every business or recipient string is marked as untrusted data. Draft copy is terse, factual, and says that nothing has changed.

## Future change boundary

Phase 10 intentionally implements no commit sibling. A future assignment, task schedule, site-visit schedule, provider calendar, OPS/provider draft placement, or send requires a separately shipped guarded contract with:

1. the exact unexpired Phase 10 preview hash;
2. current actor and OAuth reauthorization;
3. current source and permission revisions;
4. row-version and expected-assignee checks;
5. an explicit confirmation naming the exact changes and recipients;
6. idempotency, partial-failure reconciliation, and truthful committed receipts.

No downstream caller may treat a Phase 10 preview as permission to mutate.

## Release and cost

The release is additive: TypeScript contract/service/registry wiring, one read-only Supabase migration, runtime and replay tests, and Bible updates. It uses existing Supabase, Vercel, and Open-Meteo-independent infrastructure. It introduces no paid service, new subscription, or per-call provider charge.

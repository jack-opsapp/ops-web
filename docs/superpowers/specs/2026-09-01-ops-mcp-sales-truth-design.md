# OPS MCP Sales Truth — Phase 5 Design

**Date:** 2026-09-01
**Status:** Approved for local implementation by the Phase 5 build directive
**Golden task:** “Why are we losing leads, and what should I fix first?”

## Product outcome

One read-only MCP call returns an evidence-bounded diagnosis of recent lead performance. It answers five questions together: close rate, attribution, loss reasons, first-response time, and pipeline velocity. It then ranks the first operational repair without presenting correlation as causation.

The capability is additive and dormant. Production keeps MCP exposure v2 active. Existing dormant v3 and v4 contracts and local dormant v5 and v6 contracts remain byte-stable. Phase 5 adds local manifest v13 and exposure v7 only; it does not deploy, apply a migration, register a client or grant, or activate an exposure.

## Verified source reality

The live OPS production schema was inspected before design. The source-of-record tables are:

- `public.opportunities` for lead creation, current stage, canonical source, and legacy loss reason;
- `public.stage_transitions` for completed time in stage and qualification-to-close chronology;
- `public.opportunity_dispositions` for the active structured outcome and loss reason;
- `public.activities` for exact linked inbound and outbound email/text chronology;
- `public.companies` for company timezone and currency context.

Production currently has materially incomplete transition, response, disposition, and loss-reason coverage. The contract therefore reports separate coverage for every metric and returns `insufficient` instead of manufacturing precision.

## Capability and authority

- Tool: `analyze_sales_truth`
- Operation: read
- Input: strict empty object
- OAuth scopes: `ops.operations.read`, `ops.correspondence.read`
- Permission requirements: `pipeline.view` and `email.view`, both company-wide (`all`)
- Runtime: the existing fixed service-role RPC transport
- RPC: one `SECURITY DEFINER`, empty-search-path, service-role-only function
- Side effects: none; no drafts, notifications, writes, messages, or money movement

Tenant, actor, scope ceiling, grant revision, permission snapshot revision, capability manifest revision, and exposure revision remain server-bound. The model cannot select a company, actor, window, metric definition, or authority policy.

## Versioned metric contract

The response pins a schema revision and a metric-definition revision. It discloses the observation instant, company timezone, company currency (context only), exact local-date window, population rules, numerator and denominator, coverage, confidence, missing-data reasons, source revisions, and supporting record references.

### Cohort

The cohort is every non-deleted, non-merged opportunity created during the 180 company-local calendar days ending on the company business date at `observed_at`.

Qualified stages are `qualifying`, `quoting`, `quoted`, `follow_up`, `negotiation`, `won`, and `lost`. `new_lead` and `discarded` are excluded from the qualified population. Resolved outcomes are current `won` or `lost`; open qualified opportunities are disclosed and excluded from the canonical close-rate denominator.

### Close rate

- Canonical rate: `won / (won + lost)`.
- Denominator: resolved qualified opportunities only.
- Open-qualified sensitivity: lower bound `won / (won + lost + open)`; upper bound `(won + open) / (won + lost + open)`.
- Statistical interval: Wilson 95% interval on the canonical resolved population.
- Minimum usable resolved sample: 10.

The sensitivity band is a scenario range, not a forecast.

### Attribution

Attribution uses only the constrained canonical `opportunities.source` value. It never infers a source from correspondence, names, or notes. Each source segment reports cohort count, qualified count, won/lost/open counts, resolved close rate where usable, and exact missing/unmapped counts.

### Loss reasons

For current lost opportunities, the latest non-superseded `opportunity_dispositions.reason_code` wins. The legacy `opportunities.lost_reason` is used only when structured disposition evidence is absent and is explicitly counted as legacy coverage.

Raw reason labels are normalized by a versioned code-owned map into `price`, `timing_or_budget`, `competition`, `scope_mismatch`, `no_response`, `customer_declined`, `other`, `unmapped`, or `missing`. No note body is returned.

### First-response time

The measurable population is cohort opportunities with an exact linked inbound `email` or `text_message` activity at or after lead creation. Response time is elapsed minutes from the first such inbound event to the first later linked outbound email/text event. Opportunities without a later outbound event are disclosed as unresponded. No business-hours inference is made.

The result separately discloses how many cohort opportunities have any linked correspondence so missing linkage cannot masquerade as fast response performance.

### Pipeline velocity

Per-stage velocity uses non-negative `stage_transitions.duration_in_stage` observations when a transition exits a qualified, non-terminal stage. Qualification-to-close velocity uses the first transition into a qualified stage and the first later transition to `won` or `lost`. Current-stage timestamps are not silently substituted for missing transition history.

Each duration reports sample size, median, p75, coverage, confidence, and supporting transition references.

## Confidence and insufficient-data rules

Metric confidence is deterministic:

- `high`: sample at least 30 and relevant coverage at least 90%;
- `medium`: sample at least 20 and coverage at least 80%;
- `low`: sample at least 10 and coverage at least 70%;
- `insufficient`: any smaller or less complete population.

A source bound, invalid company timezone/currency, malformed source row, or inconsistent chronology fails the analysis closed. Partial arrays never become a confident answer.

## Recommendation engine

Recommendations are fixed codes with fixed, terse actions. Each includes rank, confidence, structured basis facts, supporting record references, and `causal_claim: false`. At most three are returned.

Priority order:

1. repair a hard source bound or invalid source state;
2. capture resolved outcomes when the close-rate sample is insufficient;
3. capture loss reasons when structured/legacy reason coverage is below 70%;
4. repair stage history when transition coverage is below 70%;
5. repair correspondence linkage when lead linkage or observed-response coverage is below 70%;
6. reduce first-response delay when median exceeds 24 hours or p75 exceeds 48 hours;
7. review the leading loss reason when it represents at least 30% of observed reasons with at least 10 observations;
8. review an underperforming source when it has at least 10 resolved outcomes and trails the overall rate by at least 15 percentage points;
9. clear the slowest measured stage when it has at least 10 completed observations;
10. preserve the current process when no material, supportable repair signal exists.

The first returned item is the answer to “what should I fix first?” The tool never says a source or process caused a loss.

## Bounded read and freshness

The RPC caps opportunities, transitions, dispositions, activities, and supporting references independently. It uses explicit company-first composite/partial indexes where the live schema lacks the access path. Same-named index drift fails the migration rather than being accepted silently.

A new private `sales_truth` read-domain revision is seeded for every company. Row-level triggers on the four source tables bump that revision; existing company-context revisioning covers timezone and currency changes. The response carries both revisions.

## Prompt safety

Only opaque IDs, constrained enums, timestamps, counts, rates, and normalized categories cross the MCP boundary. Arbitrary activity bodies, notes, titles, client names, and disposition notes do not. Legacy reason text is normalized inside the service and is never echoed. The result remains marked as untrusted business data with an explicit instruction-safety directive.

## Verification standard

Implementation is complete only after:

- red/green contract, repository, service, manifest, exposure, dispatch, runtime, and server registration tests;
- a disposable PostgreSQL run proving authority, tenant isolation, bounds, metric fixture output, revision triggers, grants, index shape/use, replay, and full migration parity;
- focused and broad Vitest regression;
- TypeScript, lint, format, and production build checks;
- independent code review with every valid finding repaired or disproven;
- matching architecture and feature-catalog updates in the Software Bible;
- atomic local commits in both Phase 5 worktrees.

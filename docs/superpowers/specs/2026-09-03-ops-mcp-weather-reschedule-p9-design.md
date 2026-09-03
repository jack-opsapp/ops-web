# OPS MCP Weather Reschedule Phase 9 Design

## Outcome

Phase 9 adds one dormant, prepare-only MCP capability for the golden task:

> Rain Thursday. Slide the outdoor work, keep the indoor job, tell everyone.

The capability returns one exact weather-bound schedule proposal and one deterministic email draft for every affected project recipient. It never changes a task, project, calendar event, provider draft, message, or delivery state.

## Immutable surface

- Capability: `prepare_weather_reschedule`
- Schema revision: `2026-09-03.v1`
- Capability manifest: additive v17
- MCP exposure: additive dormant v11
- Active production exposure: unchanged v2
- Operation: `prepare`
- Risk: high
- Input: one canonical `target_date` in `YYYY-MM-DD`
- Tenant, actor, company, timezone, weather, projects, tasks, assignments, recipients, permissions, scopes, and revisions: derived from the OAuth grant and current OPS records only

No commit or send sibling exists. The response is an ephemeral preview; ordinary MCP transport audit and rate-limit metadata remain the only writes.

## Authority

The grant must carry all of:

- `ops.company.read`
- `ops.communications.prepare`
- `ops.customer_contacts.read`
- `ops.customers.read`
- `ops.jobs.read`
- `ops.schedule.prepare`
- `ops.schedule.read`

The current actor must hold `all` scope for:

- `calendar.view`
- `calendar.edit`
- `clients.view`
- `inbox.view`
- `inbox.send`
- `projects.view`
- `projects.edit`
- `tasks.view`
- `tasks.edit`

The PostgreSQL snapshot boundary revalidates the actor, tenant, grant, client, exposure, manifest, capability, scope ceiling, registered scope labels, registered permission keys, permission snapshot, and entity authority in one statement. The service reauthorizes before the read and immediately before returning. A second database assertion proves the exact source revision is still current.

## Supported scheduling shape

The first vertical is deliberately exact rather than broad:

- only active, non-deleted project tasks that overlap the target company-local date are considered;
- at least one target task must exist;
- each target task must be a single civil day with a valid local interval;
- every task must have a same-company task type;
- outdoor status comes only from `companies.schedule_settings.outdoor_task_type_ids`;
- task names, notes, project text, weather condition text, and the caller's phrasing never determine outdoor status or authority;
- a task selected to move must not be locked, recurring, paired, or dependency-bearing;
- moved work must have one or more valid active same-company assignees;
- candidate dates are searched deterministically from the next day through the company's bounded `optimization_window_days`;
- a candidate must have complete, fresh, same-project Open-Meteo cache evidence and must be clear under the server-owned rain policy;
- a candidate must not overlap another active task for the same project or any assigned crew member;
- tasks from the same project move together to one candidate date, preserving their local times, durations, order, and assignments;
- indoor tasks remain unchanged.

Any unsupported dependency, malformed setting, stale or incomplete forecast, ambiguous schedule interval, missing recipient, shared recipient address, result bound, or source drift fails the whole request closed. Partial proposals and partial correspondence are forbidden.

## Server-owned rain policy

`rain-reschedule-policy:v1` is code-owned:

- rain-affected: precipitation probability at least 60 percent, or precipitation at least 10 millimetres;
- clear destination: precipitation probability below 60 percent and precipitation below 10 millimetres;
- evidence freshness: retrieved no more than 12 hours before `observed_at`, never from the future;
- accepted provider source: exact `open-meteo`;
- maximum scheduling window: 14 days.

Numeric fields drive the policy. Human-readable `conditions` is returned only as marked untrusted forecast text.

## Recipient rule

Each scheduled project resolves exactly one recipient:

1. use the project's explicit `primary_sub_client_id` when present and valid for its client;
2. otherwise use the project's primary client;
3. require one normalized, syntactically valid, non-suppressed email address;
4. reject an address shared by any other active client or sub-client in the company;
5. bind the recipient kind, ID, address, contact revision, and source hash into the proposal revision.

Drafts group all target-day tasks for the same exact recipient and project. Every returned schedule item must appear in exactly one draft. A draft names forecast evidence as a forecast, proposed moves as proposals, and unchanged indoor work as current schedule fact. It explicitly says that nothing has changed yet.

## Determinism and revision binding

The database returns one bounded canonical snapshot plus:

- company/settings hash;
- weather row hashes;
- project/client/task/task-type/assignment hashes;
- conflict-schedule hashes;
- permission snapshot revision;
- aggregate source revision.

TypeScript sorts every source and result by stable IDs, applies the fixed policy, creates canonical drafts, and seals the preview with SHA-256. The final assertion recomputes the authority and aggregate source revision from current rows. Identical input and identical source snapshot produce identical proposal and draft bytes.

## Output states

The response keeps four concepts separate:

- `facts`: current company-local schedule and recipient records;
- `forecast`: source, retrieval time, target/candidate measurements, and policy classification;
- `proposal`: exact before/after task intervals with no mutation;
- `drafts`: exact recipient-bound email draft text with no provider artifact.

Every source-derived label or condition is marked `untrusted_business_data` or `untrusted_external_data`. The response includes explicit zero-effect guarantees for task writes, project writes, calendar writes, provider-draft writes, message writes, and sends.

## Rejected alternatives

- Free-text indoor/outdoor classification: rejected because business text cannot steer authority.
- Calling the weather provider during the MCP request: rejected because it makes replay and final revision proof open-world and non-atomic. The current OPS cache is the authority; stale cache fails closed.
- Reusing the existing optimization writer: rejected because it can enqueue approvals and has a broader, older contract.
- Creating OPS or provider draft rows: rejected because Phase 9 is prepare-only.
- Moving each task independently: rejected because it can fragment one project's day. Project work moves as a group.

## Verification

Proof requires strict Zod contract tests, capability/exposure/grant-pinning tests, repository cancellation and envelope tests, golden-task service tests, ambiguity/drift/adversarial tests, SQL source-contract tests, disposable PostgreSQL 17 runtime and replay tests, targeted type checking, changed-file lint/format checks, migration mirror hashing, and a final production readback proving v2 remains active and v11 has zero clients and grants.

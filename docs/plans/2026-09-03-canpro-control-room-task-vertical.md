# Canpro control-room task vertical implementation plan

**Goal:** Build the first dormant, end-to-end control-room vertical on the host-neutral OPS agent capability layer: starting from the operational overview and work queue, prepare exactly one evidence-backed internal task for an unacknowledged dispatch, require an exact immutable approval, commit only that task, and return a truthful receipt proven by independent readback.

**Product boundary:** This is a proving vertical for one tenant, not a Canpro fork. The domain rule is company policy data. The capability remains unavailable to every live MCP client until separate migration, deployment, OAuth, grant, and activation approvals are given. The active read-only v2 MCP exposure does not change.

**Architecture:** Add one additive v13 MCP exposure and v19 capability manifest. `prepare_dispatch_confirmation_task` is the only host-facing write-preparation tool. Both MCP hosts and the OPS approval queue call the same domain/repository authority. PostgreSQL owns policy resolution, tenant/actor/grant/permission validation, idempotency, immutable proposal storage, stale-input detection, single-use confirmation, atomic task creation, receipt truth, readback, redaction, retention, and tombstones. Host orchestration remains responsible for calling the existing overview/work-queue/task reads and choosing when to ask for the narrow preparation capability.

**Interface intent:** Jackson is verifying one consequential internal mutation while operating the existing approval queue. The screen should feel like a sealed operations order: scheduling evidence first, exact policy identity second, a single before-to-after task change, and an explicit truth boundary. The visual language remains the existing OPS tokenized queue—black/graphite surfaces, steel authority action, tan attention, olive committed state. This adds no parallel UI system and no generic editable task form.

**Policy slice:** Store only the minimum structured, versioned rule required for this vertical: schedule source, `confirmation_required` reason, confirmation deadline, internal task type, exact task title, assignment policy, retention, and the source document IDs/versions/SHA-256 identities. The prepare operation fails closed when the applicable policy is absent, duplicated, inactive, unresolved, or hash-invalid. Raw Canpro documents are not ingested.

## Implementation

1. Add `dispatch-confirmation-task` Zod contracts for strict prepare, preview, action binding, receipt, evidence, policy identity, and truth-boundary responses. Treat all source labels as untrusted business data.
2. Add the capability definition, consent labels, v19 manifest, dormant v13 exposure, domain dispatch mapping, server-factory binding, OAuth scope resolution, and rate-limit classification. Preserve active v2 byte-for-byte.
3. Add a trusted domain service and Supabase repository. Reauthorize the MCP actor at call time, validate the capability manifest, canonicalize the proposal, and persist only through the security-definer RPC.
4. Add an additive migration with private policy, run, evidence, change-set, confirmation, and receipt tables. Revoke public execution and table access. Implement prepare, reject, commit, and retention/tombstone RPCs with fixed empty `search_path`, schema-qualified objects, row locks, idempotency conflicts, changed-input rejection, stale approval rejection, single-use confirmation, atomic task creation, and independent readback.
5. Reuse `public.agent_actions` and `public.notifications` for the exact `approve_dispatch_confirmation_task` review. Exclude this action from bulk approval. Add a sealed tokenized preview to `ActionDetail`, with terse OPS copy and no editing.
6. Add a deterministic shadow-run fixture representing the selected Canpro SOP slice and a host-neutral orchestration evaluation proving the existing overview/work-queue/task reads feed one proposal without granting the host policy authority.
7. Add tests first for contracts, capability/exposure immutability, service/repository boundaries, SQL security and transaction contracts, policy failure modes, injection resistance, replay/change/stale/double-commit behavior, notification behavior, receipt/readback truth, queue bulk exclusion, exact approval dispatch, and preview rendering.
8. Run focused Vitest suites, TypeScript checks, ESLint on changed files, SQL static-contract verification, and the broader agent-control-plane suite as capacity allows. Run the OPS design-system audit before completion.
9. Update the OPS Software Bible with the capability, data model, authority boundary, dormant rollout state, Canpro policy provenance, operational workflow, and explicit accounting non-authority. Commit web and Bible changes atomically in their isolated worktrees. Do not push, deploy, migrate production, register OAuth clients, grant scopes, activate exposure, seed production policy, schedule work, or write customer-live data.

## Proof matrix

- Tenant isolation: company-bound source, policy, run, action, task, and receipt; cross-tenant IDs fail closed.
- Scope and permissions: live grant/client/revision/scope ceiling plus current `projects.view`, `tasks.view`, `tasks.create`, `tasks.assign`, and `agent.review` are rechecked at prepare and commit.
- Idempotency: same key and same input replay; same key and changed input reject.
- Approval freshness: exact action/change-set/preview hash/source revision/policy version binding; stale or already-used confirmation rejects.
- Atomicity: one transaction creates the internal task, receipt, action completion, and notification resolution; any failed assertion leaves no partial task.
- Prompt injection: business labels are untrusted data and never select policy, authority, SQL, action type, task type, assignee, or truth claims.
- Truth: receipt states one OPS internal task created, zero messages sent, zero money moved, and zero financial documents issued, with a stored independent task readback.
- Notification: one persistent approval notification is created for a new proposal, replay does not duplicate it, rejection/commit resolves it.
- Retention: evidence stores structured references only, honors per-policy retention and legal hold, and supports redaction/tombstones without deleting audit identity.

# OPS MCP Promise Recovery — Phase 4 Design

**Status:** Approved for implementation by the Phase 4 build instruction

**Golden task:** “Did I ever get back to [customer] about [thing]?”

**Boundary:** Read-only, dormant MCP exposure; no production activation or database application

## Outcome

Add one server-owned MCP read, `check_customer_reply`, that resolves one exact OPS customer, inspects the authoritative delivered-correspondence ledger, and answers only what the readable record proves. It returns exact chronology and stable OPS source references. It never drafts, sends, updates, schedules, or infers a reply from thread metadata.

The capability is complete only when it can distinguish:

- a relevant customer request;
- an explicit OPS promise to follow up;
- a later OPS reply;
- a reply that also contains a defined resolution signal;
- an unanswered promise or request; and
- a record whose gaps make the answer unsafe.

## Live facts that shape the design

The production read-only audit found 309 provider-delivery source records: 238 readable normalized projections and 71 conservatively rejected projections. The readable set totals 675,955 body characters, its largest body is 39,000 characters, and none exceed the new aggregate snapshot budget. Twenty-one readable sources began as real HTML, six of those retain stable attachment evidence references, and 16 hash-bound conversation turns still contain an old placeholder even though their authoritative source projection is now readable. Every currently readable HTML source is inbound; production has no readable outbound HTML example yet.

Therefore this vertical must read `private.agent_provider_delivery_sources` as the body authority. Conversation turns remain useful stable evidence links, but their copied body is not authoritative. Rejected bodies stay rejected; the tool must not remove bidirectional controls or CSS to manufacture readability.

The same audit found two Foundation Zero defects in the existing active-v2 wrapper chain. `get_job_conversation_context` fails while re-proving nested historical manifest revisions, and `get_correspondence_evidence` suppresses a readable body when its attachment row lacks optional verified content metadata. The Phase 4 migration repairs both paths in place without widening their signatures: it re-proves only a complete known predecessor lineage, overlays context/evidence from the exact provider row, and retains a stable attachment reference with `metadata_state: incomplete` when richer metadata is unavailable. All transformations are guarded against source-definition drift and abort the migration if the expected production function body changes.

## Product contract

### Input

```json
{
  "customer_query": "Exact customer name",
  "topic": "the quote",
  "as_of": "optional RFC 3339 UTC timestamp"
}
```

The server normalizes the query and resolves exactly one active, unmerged client inside the actor’s company. Zero or multiple matches produce an explicit insufficient-evidence result, never a guessed customer.

### Answer states

- `replied`: a readable, topic-matching outbound delivery attributable to the current operator exists after the latest qualifying request or promise.
- `outstanding`: the complete readable record contains a qualifying request or promise with no later qualifying outbound reply.
- `not_found`: complete readable retained history contains no qualifying request, promise, or reply. This does not claim the event never happened outside OPS’s captured history.
- `insufficient_evidence`: unreadable, unattributed, attachment-incomplete, ambiguous-customer, or bounded source coverage could change the answer.

### OPS-owned definitions

All definitions are versioned as `promise-recovery:2026-08-31.v1`.

- **Topic match:** every significant normalized topic term occurs as a whole token in the readable safe body. Stop words never create a match. Subject text and other metadata never establish a match. Inputs with more than 12 significant terms fail instead of silently dropping terms.
- **Customer request:** an inbound, exactly attributed customer delivery that matches the topic and contains either a question mark or a defined request marker: `can/could/would/will you`, `any update`, `let me know`, or `please` plus a follow-up verb. Acknowledgements and statements are topic mentions, not new requests.
- **Promise:** an outbound delivery attributable to the current operator that matches the topic and contains a first-person future commitment plus an OPS-owned follow-up verb such as `get back`, `follow up`, `send`, `confirm`, `check`, `call`, `email`, `reply`, `update`, `provide`, or `share`.
- **Reply:** the first later readable, exactly customer-attributed, current-operator-attributed, topic-matching outbound delivery after the latest request or promise.
- **Resolution:** a qualifying reply that also contains an OPS-owned completion/delivery marker such as `confirmed`, `sent`, `attached`, `scheduled`, `completed`, `fixed`, `ordered`, `approved`, `provided`, or `resolved`. A marker preceded by a nearby negation does not prove resolution. A reply without a positive marker is reported as replied but not proven resolved.
- **Unanswered commitment:** an explicit promise with no later qualifying reply as of the requested cutoff.

The definitions operate only on normalized safe text. Thread direction, `last_message_at`, snippets, summaries, routing state, and attachment presence alone can never prove a reply or resolution.

## Authoritative population and chronology

The database read resolves the customer’s active client/sub-client email identities and selects delivered sources in the same company where:

1. the customer identity is the sender for inbound mail or a recipient for outbound mail; or
2. the provider thread is linked to the customer but exact participant attribution is missing.

The second group is counted as an attribution gap and forces `insufficient_evidence`; it is never classified as a reply. Duplicate contact identities across active customers also force insufficient evidence.

Rows are ordered by `(delivered_at, provider_delivery_source_id)`. The source ledger’s current `normalization_status`, `normalized_plain_text`, normalization revision, attachment enumeration flag, attachment evidence IDs, and source hash are read together. A matching conversation turn is included only when its company, source ID, and captured source hash all agree.

The internal read is bounded to 500 source rows, 100,000 safe characters per body, 2,000,000 safe body characters across the snapshot, and 100 stable attachment references across the snapshot. The aggregate budgets retain the newest complete evidence first, mark older source bodies or attachment enumeration incomplete when the corresponding envelope is exhausted, and force `insufficient_evidence`; they cannot silently turn omitted older evidence into a confident answer. Exceeding any bound is a coverage gap, not a partial answer.

“Did I” means the current authenticated operator, not merely the company mailbox. Outbound evidence is attributable only when it came through that operator's individual mailbox or its exact hash-bound activity was created by that operator. Company-mailbox direction alone is never authorship. The live tenant currently has 90 outbound provider sources and none satisfy this stricter operator rule, so a production run today must return `insufficient_evidence` rather than claim Jackson personally replied. This is a truthful current data gap, not a relaxed product definition.

## Evidence and prompt safety

Each returned chronology item contains:

- `provider_delivery_source:<uuid>` as the source record reference;
- `job_conversation_turn:<uuid>` and its `ops://evidence/...` locator when a hash-bound turn exists;
- delivery direction and timestamp;
- the classified role;
- a bounded safe excerpt marked `untrusted_business_data`;
- the normalization revision and source SHA-256;
- exact participant attribution state; and
- stable attachment evidence IDs plus enumeration completeness.

Returned business text is untrusted data and carries the existing prompt-safety directive. Raw HTML, raw provider payloads, email addresses, and transport secrets never leave the repository boundary.

## Authorization and exposure

`check_customer_reply` requires all three OAuth scopes:

- `ops.customers.read`
- `ops.customer_contacts.read`
- `ops.correspondence.read`

It requires current `clients.view` and `email.view` permissions. The service authorizes the original actor, re-resolves current grant and permission authority against the new manifest revision, then the database RPC independently verifies actor, company, OAuth client/grant, exact grant revision, scope ceiling, permission snapshot revision, capability revision, manifest revision, and dormant exposure revision.

The new immutable exposure is additive to Phase 3: it preserves the complete dormant hiring what-if v5 tool/scope set and adds only `check_customer_reply` plus its required read scopes. It remains dormant. `ACTIVE_MCP_EXPOSURE_REVISION` remains v2. Existing dormant v3 day-closeout and v4 collections definitions remain behaviorally unchanged.

## Failure behavior

Invalid inputs fail before a read. Authority drift fails closed. Storage errors return a generic unavailable error. Customer ambiguity and evidence gaps return a valid `insufficient_evidence` result with enumerated machine-readable reasons. No branch returns a confident negative from incomplete data.

## Verification

Verification consists of:

- schema and definition tests for each answer state and forbidden inference;
- repository tests for exact binding, source-body authority, hash-bound turn references, bounds, and malformed rows;
- service tests for initial and current-actor authorization, chronology, unreadable/ambiguous/attachment gaps, and no mutation calls;
- manifest/exposure/runtime tests proving the additive promise-recovery exposure is read-only and dormant while v2 stays active;
- SQL contract tests for tenant predicates, current authority, service-role-only execution, no DML, source-ledger body selection, and deterministic ordering;
- existing MCP regression suites; and
- read-only live discovery proving real HTML body readability, chronology, attachment references, and provider/turn attribution without exposing customer content;
- live `pg_get_functiondef` transformation emulation proving both repaired wrapper branches resolve provider body/subject/hash/attachments, remove copied-body reads, preserve exact source bindings, and fail closed, without applying DDL; and
- explicit not-live reporting: the current wrappers still fail until the unapplied migration is separately approved and released.

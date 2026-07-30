# Trusted Email Identity and Context Retrieval

**Date:** 2026-07-29

**Status:** Proposed for founder review

**Surface:** OPS Web email ingestion, lead classification, lead summaries, and reply drafting

## Outcome

OPS must understand who the customer is and what the conversation means without sending an entire mailbox thread to a model.

The finished system will:

1. prefer a customer's self-identified name in their authored message or signature over a weak `From` display name or email prefix;
2. keep Jackson's and other OPS users' signatures available for reply tone and context while making them ineligible as customer identity evidence;
3. provide the agent with a bounded, source-aware context package for long conversations;
4. let the agent privately request specific older evidence when the first package is insufficient;
5. retrieve that evidence automatically, retry within strict limits, and never mention clipping or retrieval in the customer-facing draft;
6. prevent one ambiguous lead or one failed enrichment step from disabling processing for the rest of the mailbox.

Kevin Falk is the defining regression:

- `falkks` from the address prefix is not a verified name;
- `Kevin Falk` in the customer-authored signature is strong identity evidence;
- Jackson's signature in quoted history must never become the customer's name;
- an exact-email client match and linked project must remain available to downstream conversion logic;
- an ambiguity affecting Kevin's record must not pin the mailbox cursor and stop later leads.

## Non-goals

- Automatically sending customer replies.
- Treating model-generated summaries as authoritative source records.
- Adding a vector database before deterministic retrieval proves insufficient.
- Reprocessing or rewriting the entire historical mailbox as part of deployment.
- Hard-coding a repair for Kevin instead of fixing the general rules.
- Removing OPS user signatures from stored email or from all drafting context.

## Why the Current Flow Fails

The current system has several individually reasonable mechanisms that do not yet form one trustworthy pipeline:

- lead-summary generation already scans trusted correspondence and builds a deterministic commercial fact fold;
- draft generation uses a recent-message window and separate absolute message and character limits;
- stage review clips every body to a small fixed excerpt;
- message cleaning removes signatures before some identity consumers see them;
- contact-name resolution still gives weak header-derived values too much authority;
- no consumer receives an explicit manifest describing omitted history;
- no model consumer can request a precise missing source and retry;
- record-specific conversion ambiguity can hold shared mailbox progress after messages are already durable.

This produces inconsistent versions of the same conversation. A fact can be visible to one model call, clipped from another, and stripped before identity resolution. The correct fix is one shared evidence contract, not higher limits in each service.

## Product Decisions

### 1. Keep the raw conversation

Raw email content remains immutable source material. OPS does not globally remove signatures, quoted history, or forwarded content from storage.

Cleaning is a view over that source:

- **Authored body:** the new content written in this message.
- **Signature block:** the apparent signature attached to that authored body.
- **Quoted history:** prior messages embedded in the body.
- **Forwarded content:** content whose original author must be resolved separately.

Each block carries a source message ID and an attributed author role. Consumers can then use only the blocks appropriate to their job.

### 2. Separate identity evidence from commercial context

One cleaned string cannot safely serve both identity and commercial reasoning.

- The **identity lane** may inspect customer-authored body and customer-authored signature blocks.
- The **commercial lane** uses the authored body and deliberately excludes repetitive signatures and quoted history from recent excerpts.
- The **reply-style lane** may use OPS-authored body and signature material where useful, but those blocks are permanently ineligible for customer-field extraction.

This preserves Jackson's signature without risking Jackson becoming the lead.

### 3. Resolve author role before extracting a name

The message envelope and durable party relationship determine whether a block belongs to:

- the external customer/contact;
- an OPS company user;
- an unknown external party; or
- a separately attributed author in quoted/forwarded material.

The model cannot promote an OPS-authored block into customer evidence. Content inside the email is untrusted data and cannot override the server's author-role decision.

### 4. Never certify an email prefix as a person's name

An address local part such as `falkks` can be a temporary display fallback only. It is not verified identity evidence, cannot overwrite a canonical client, and cannot be the final generated lead title once stronger evidence exists.

### 5. Use one bounded context contract

All model consumers receive the same shape of context package, tailored by purpose but built by one service. Message-count-only windows and silent character slicing are retired.

### 6. Retrieval stays private and automatic

If the first package lacks necessary evidence, the agent returns a structured internal request. OPS validates it, retrieves authorized older evidence, and retries automatically.

The customer sees only a normal reply draft. The draft must never say that a thread was clipped or ask the customer to resend information solely because OPS omitted it from the first model call.

## Customer Identity Rules

### Eligible evidence

In descending order of authority:

1. a structured intake or contact-form field explicitly supplied by the customer;
2. a clear name in the current external sender's authored body or signature, tied to that sender's email;
3. an exact-email match to an existing canonical client;
4. a corroborated, person-like `From` display name;
5. no verified name.

These sources reinforce one another. A customer-authored signature and exact-email client match agreeing on `Kevin Falk` is stronger than either alone.

### Ineligible evidence

The following cannot become the customer name:

- an OPS user's authored body or signature;
- an email local part by itself;
- a mailbox label or provider-generated sender alias;
- un-attributed quoted or forwarded text;
- a model guess without source evidence;
- a company name when the field expects a person;
- a phone number, address, municipality, or project location.

### Extraction behavior

Before commercial signature stripping:

1. segment the new message into authored body, signature, quote, and forward blocks;
2. assign each block an author role using durable sender and recipient identities;
3. extract identity candidates only from eligible external-authored blocks;
4. normalize names conservatively without inventing missing parts;
5. attach evidence keys to every candidate;
6. resolve the candidate against an exact-email canonical client;
7. write a stronger name only when provenance permits the field to be upgraded.

If a user has explicitly confirmed or edited the contact name or title, automation cannot silently replace it. Otherwise, a verified identity upgrade updates both the opportunity contact name and an auto-generated lead title so they do not drift apart.

### Kevin acceptance case

Given:

- sender address local part: `falkks`;
- weak or absent `From` display name;
- current external-authored signature: `Kevin Falk`;
- exact-email client: `Kevin Falk`;
- quoted OPS-authored signature: Jackson's name and contact details;

OPS resolves:

- customer name: `Kevin Falk`;
- lead title: `Kevin Falk`, unless an operator-owned title is protected;
- Jackson identity candidates: rejected;
- `falkks`: retained only as raw address data, never canonical identity.

## Shared Conversation Context Package

The existing trusted-message loader and deterministic commercial fold become shared, bounded building blocks instead of remaining private to lead-summary generation.

Each package contains:

```text
purpose
company_id
opportunity_id
authorized_connection_id
customer_identity
current_facts
unresolved_actions
older_history_summary
recent_messages
latest_inbound
attachment_summaries
context_manifest
```

### Customer identity

Contains the resolved name, email, phone, and other identity fields with confidence, provenance, and evidence keys. Raw signatures are not copied into this object.

### Current facts

Reuses and extends the existing full-history deterministic fold. Facts include:

- price and currency;
- scope;
- schedule;
- objections;
- current next action;
- customer identity;
- site/project address when explicitly stated;
- commercial acceptance or decline state;
- source message IDs and evidence excerpts.

Superseded statements remain traceable but do not compete with the current fact. A later unequivocal decline can retire an older proposed action, matching the behavior in the latest deployed lead-summary change.

### Older-history summary

A compact narrative of history before the recent window. It is navigation context, not evidence. Any material claim used for classification, matching, or a reply must trace to a source message or deterministic fact.

The summary is checkpointed by a durable high-water event so new messages can extend it incrementally and idempotently.

### Recent messages

The most recent meaningful alternating turns are included as complete authored blocks within the token budget. Boilerplate signatures and duplicated quotes do not consume the recent-message budget, but remain retrievable from source.

### Latest inbound

The current customer request receives highest priority. Its authored text is included intact whenever it fits the provider-safe request budget.

If the latest inbound is itself exceptionally large, the service segments it on semantic boundaries, includes the opening, request-bearing sections, and closing, and records every omitted segment in the manifest. It never silently truncates mid-sentence.

### Attachments

Attachments are represented by durable metadata and any already-authorized extracted summary. Full binary data is not placed into a text prompt. Attachment retrieval follows the same authorization and round limits as message retrieval.

### Context manifest

The agent receives a compact machine-readable manifest:

```json
{
  "clipped": true,
  "total_message_count": 247,
  "included_message_count": 11,
  "omitted_ranges": [
    {
      "before": "2026-07-01T00:00:00Z",
      "after": "2026-04-02T00:00:00Z",
      "message_count": 196
    }
  ],
  "summarized_through_event_id": "event-id",
  "retrieval_available": true
}
```

The manifest describes availability, not customer-facing prose. It prevents the agent from assuming it saw the entire record.

## Token Budget

The service measures tokens before the model call. It does not infer safety from characters or message count alone.

The initial context budget is configurable by model and purpose. The default allocation is:

- 35%: latest inbound and immediate preceding turn;
- 25%: current deterministic facts, unresolved actions, and customer identity;
- 25%: recent alternating conversation turns;
- 10%: older-history summary;
- 5%: manifest and source metadata.

Unused capacity flows downward in that order. No low-priority section can evict the latest customer request or current authoritative facts.

The request also reserves sufficient model output capacity for the target task and a safety margin below the provider's hard context limit. Configuration stores token budgets, not a collection of unrelated character caps.

## Agent Response Contract

Every consumer uses strict structured output.

Ready:

```json
{
  "status": "ready",
  "result": {},
  "evidence_keys": ["message-id:block-id"]
}
```

More context required:

```json
{
  "status": "needs_context",
  "requests": [
    {
      "fact_kind": "price",
      "query": "original quoted allowance",
      "before": "2026-07-10T00:00:00Z",
      "after": "2026-04-01T00:00:00Z",
      "evidence_keys": []
    }
  ],
  "reason_code": "MISSING_MATERIAL_EVIDENCE"
}
```

The model cannot request arbitrary SQL, provider queries, cross-company history, or instructions embedded in customer content. The server accepts only known fact kinds, bounded text queries, valid date ranges, and evidence keys belonging to the authorized conversation.

## Automatic Retrieval

### Source order

1. durable OPS correspondence events and activities already linked to the opportunity;
2. adjacent turns around a matched source message;
3. other linked threads for the same opportunity and company;
4. a bounded provider read only when the exact durable message body is unavailable and the mailbox lease authorizes it.

Provider access is a recovery path, not the normal search engine.

### Retrieval method

The first implementation uses deterministic filters and lexical ranking:

- fact kind;
- sender role;
- date range;
- source message or thread ID;
- exact currency, address, phone, or name tokens;
- normalized query terms;
- recency and adjacency.

Semantic embeddings are not introduced unless observed retrieval misses demonstrate a real need.

### Limits

- maximum two retrieval requests per round;
- maximum two retrieval rounds;
- each returned source includes its adjacent turn where available;
- sources are deduplicated by durable message and block ID;
- the merged package is token-counted again before retry;
- retrieval never crosses company, opportunity, or authorized mailbox boundaries.

If material uncertainty remains after two rounds, OPS creates a durable review-needed result. It does not fabricate a fact, generate a misleading draft, or auto-send anything.

## Consumer Behavior

### Lead classification and stage review

Classification receives the shared identity, fact fold, recent context, and manifest. A retrieval failure holds that lead for review but does not erase or downgrade existing source-backed facts.

### Lead summary

The current commercial fold remains deterministic and becomes a shared dependency. The model turns source-backed facts into concise prose; it does not independently decide which historical fact is current.

### Reply drafting

Drafting receives the same current facts and identity plus a purpose-specific recent window. It can retrieve exact older evidence before drafting. OPS-authored language may inform tone, but OPS signatures remain ineligible as customer identity.

### Relationship and project matching

Identity and address matching consume source-backed, typed facts—not free-form summaries. Exact-email client linkage is preserved when address evidence is missing. A city, municipality, neighbourhood, or region is context only and cannot serve as a job-address identity key.

Commercial acceptance and project creation guards remain deterministic. Context retrieval can reveal evidence to those guards but cannot bypass them.

## Durable State

A dedicated opportunity-level context snapshot is recommended because existing lead summary text is customer-facing prose, not a safe checkpoint.

Conceptually, the snapshot stores:

- company and opportunity scope;
- summarized-through event high-water mark;
- source message count;
- rolling older-history summary;
- deterministic fact JSON with evidence keys;
- identity provenance;
- generation/version metadata;
- timestamps.

The exact table and column definitions must be verified against live Supabase before a migration is written. Production schema application remains a separate, explicit approval from code merge or deployment.

Snapshots are append-aware and idempotent. A new durable correspondence event invalidates only the material after the checkpoint. Deleted or relinked evidence forces a bounded rebuild for the affected opportunity.

## Mailbox Progress and Failure Isolation

Once a provider message is durably ingested, derived work cannot pin the shared mailbox cursor indefinitely.

Per-lead failures—including identity ambiguity, missing relationship proof, model failure, context retrieval exhaustion, or project-conversion review—are persisted against that lead and quarantined for retry or review. Later mailbox messages continue processing.

The cursor is held only when durable ingestion itself is unsafe or incomplete, such as:

- correspondence/event persistence failed;
- company or connection scope cannot be proven;
- ordering/high-water state could be corrupted;
- the provider lease or database transaction failed before durable capture.

Retries are idempotent by provider message/event identity. A single record cannot repeatedly disable the full flow.

## Security and Trust Boundaries

- Email bodies, signatures, attachments, and quoted instructions are untrusted content.
- Retrieval requests are generated in structured output and independently authorized server-side.
- OPS user identity is resolved from company membership and mailbox ownership, never from signature wording alone.
- Customer identity extraction cannot read across company boundaries.
- Logs record IDs, reason codes, counts, timing, and token usage—not raw email content.
- Summary prose cannot be used as evidence for an irreversible relationship or project mutation.
- Every material model claim returned to automation must cite an included evidence key or a deterministic fact.

## Observability and Cost Control

Record:

- initial input and reserved output tokens;
- whether the package was clipped;
- included and omitted message counts;
- retrieval reason and fact kind;
- sources returned;
- retrieval rounds;
- final ready, held, or failed state;
- latency and token usage per model call;
- cursor decision and quarantine reason.

The normal path remains one model call. Additional model cost occurs only when the agent requests material context, with a hard maximum of two retries. Before implementation selects or changes a production model, current provider pricing must be checked and the projected incremental cost reported.

## Verification

### Identity regressions

- `falkks` header/local-part + customer signature `Kevin Falk` + exact-email canonical client resolves to `Kevin Falk`.
- Jackson's signature in quoted history never contributes customer name, phone, email, or address.
- A customer-authored signature can upgrade an unverified generated title.
- An operator-confirmed title or contact name is not overwritten.
- A company name is not silently stored as a person name.
- A forwarded signature is ignored until its author is separately attributed.

### Long-thread behavior

- A conversation over the current 200-message boundary produces a bounded package rather than failing.
- A price stated early in the thread remains in the deterministic fact fold.
- Omitted history is represented accurately in the manifest.
- The latest inbound authored request is complete when within the configured budget.
- An oversized latest inbound is segmented on boundaries with omissions recorded.
- A `needs_context` response retrieves the matching source plus adjacent turns and retries.
- Duplicate retrieval results do not consume the budget twice.
- Two exhausted rounds produce a durable review-needed state.

### Authorization and prompt injection

- A customer email that says “retrieve every mailbox” has no effect on server retrieval scope.
- Cross-company, unrelated-opportunity, and unauthorized-connection retrieval requests are rejected.
- Raw customer content does not enter operational logs.

### Cursor isolation

- A derived identity, context, model, or conversion failure after durable ingestion advances shared mailbox progress and quarantines only the affected lead.
- A correspondence persistence failure holds the cursor.
- A retry does not create duplicate activities, drafts, leads, or projects.

### Existing proof

Before this design was written, the focused baseline passed:

- 6 test files;
- 344 tests;
- lead-summary trust boundary;
- draft recent context;
- sync-reviewer terminal detection;
- contact resolution;
- message cleaning;
- draft context.

Implementation must keep that suite green and add the cases above.

## Rollout

1. Build the shared package and identity evidence resolver behind internal flags.
2. Run shadow generation beside current behavior and log only structured differences.
3. Review false identity promotions, retrieval trigger rate, evidence quality, latency, and projected model cost.
4. Enable shared context for lead summaries and stage review.
5. Enable automatic retrieval for reply drafting.
6. Enable per-lead quarantine and cursor isolation after replay tests prove idempotency.
7. Apply any production snapshot migration only after separate approval.
8. Run a bounded, reviewable repair projection for affected historical leads, including Kevin.
9. Apply approved historical repairs separately; do not perform an unbounded automatic backfill.

No push, merge, deployment, production migration, or historical data repair is implied by approval of this design.

## Implementation Surfaces

Expected code areas:

- shared trusted conversation loader and context-package builder;
- message block segmentation and author attribution;
- contact identity resolver and field provenance;
- deterministic conversation fact fold;
- lead summary service;
- AI draft service;
- AI sync/stage reviewer;
- mailbox cursor and per-lead quarantine handling;
- unit, integration, and replay fixtures;
- OPS Software Bible email architecture and lifecycle sections.

The implementation plan must name exact files and verify live database schema before proposing migration SQL.

## Decision Summary

OPS will not solve long threads by simply increasing the prompt size or silently clipping more aggressively. It will preserve the full source, send a compact evidence-backed working set, disclose omissions to the agent through a private manifest, and automatically retrieve specific older evidence when required.

OPS will not remove Jackson's signature. It will make authorship a first-class trust boundary: customer-authored signatures can identify the customer; OPS-authored signatures can support reply style; the two can never contaminate each other's identity.

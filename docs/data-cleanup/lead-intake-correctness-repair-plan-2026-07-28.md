# Lead Intake Correctness — Guarded Production Repair Plan

**Prepared:** 2026-07-28  
**Target:** Supabase `ijeekuhbatykdomumfjx`  
**Company:** `a612edc0-5c18-4c4d-af97-55b9410dd077`  
**Mailbox:** `5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3`  
**Authorized actor for an approved run:** Jackson Sweet,
`283d49df-90a1-4abb-b94c-3e9f17f02c0d`

This is an approval-only runbook. Preparing or committing this file does not
authorize a production migration, data repair, Gmail mutation, release, or
deploy. Every repair is database-only. No provider message, thread, label,
draft, or mailbox setting may be changed.

## Release gate

The repair must not run until all three application migrations are reviewed,
applied in order, and the compatible application release is live:

1. `20260728160000_property_address_identity_boundary.sql`
2. `20260728161000_authoritative_staff_email_aliases.sql`
3. `20260728162000_guarded_customer_decline_lifecycle.sql`

Immediately before approval, export a fresh read-only manifest containing
every row and expected value named below. Canonicalize the JSON and record its
SHA-256. The apply runner must accept that reviewed manifest, derive one
per-entry SHA-256, and abort the whole entry on any snapshot mismatch. It must
also verify that the production functions and `user_email_aliases` table exist,
the application release is healthy, and no newer correspondence has appeared.

## Entry 1 — move Paul Holmes out of Sandra Dunford

### Frozen identity

- Source opportunity: `63ae2578-d3bc-40c4-bcec-77c980b407ed`
- Activity: `eab06500-d04a-4e51-b4af-8d254258f5df`
- Correspondence event: `64ce0130-2974-4531-b6a0-481c0473de11`
- Provider thread/message: `19fa65dc37089a99`
- Customer: Paul Holmes, `pwholmes64@icloud.com`, `2508883674`
- Scope: New deck, stair railings, and vinyl decking
- Regional context: Victoria — metadata only, never a property address
- Canonical target source key:
  `email:gmail:5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3:message:19fa65dc37089a99`

### Required preconditions

- Sandra still matches the reviewed stage, manual-stage, assignment, project,
  and `updated_at` snapshot.
- The activity and correspondence event still belong to Sandra and still carry
  the exact mailbox/thread/message identity above.
- The event remains meaningful inbound customer correspondence with
  `opportunity_projection_applied=true`.
- No active client, sub-client, or opportunity exists for Paul's exact email or
  phone. If one now exists, stop and generate a new reviewed target manifest.
- The activity still has zero attachments; the event/activity still have zero
  dependent follow-up drafts, approved email intents, and assignment contact-
  form draft rows.

### Guarded apply

Call
`create_target_and_reparent_opportunity_email_message_guarded(...)` as service
role with Jackson as the audited actor and the exact reviewed source snapshot.
The target is one message-scoped lead:

- Title/contact name: `Paul Holmes — Email Inquiry` / `Paul Holmes`
- Contact email: `pwholmes64@icloud.com`
- Source/stage: `email` / `new_lead`
- Property address: `NULL`
- Source key: the canonical key above

The RPC must create-or-converge on that one key, move only the exact activity
and event, recompute Sandra/Paul correspondence and lifecycle high-water
projections, and retain the provider evidence. After the RPC returns, update
only blank target fields under the same manifest guard:

- `contact_phone = '2508883674'`
- `description = 'New deck, stair railings, and vinyl decking'`

Do not write `Victoria` into `opportunities.address`, client address, an
address identity set, or match provenance. Retain it only in source/activity
context. Run the normal lead-summary refresh for both Sandra and Paul.

### Readback

- Paul owns exactly the activity and event above.
- Sandra no longer owns either row and her last inbound/high-water no longer
  points to Paul.
- Paul has one source-key opportunity, is routed through the canonical mailbox
  assignment path, and receives at most one assignment delivery/notification.
- Paul has a null property address; the source evidence still contains
  Victoria as contextual location.
- Replaying the same manifest reports already applied and creates nothing.

## Entry 2 — close Sandra Dunford as Lost

Run this only after Entry 1 has removed Paul's later false correspondence.

### Frozen identity

- Opportunity: `63ae2578-d3bc-40c4-bcec-77c980b407ed`
- Decisive event: `cf07a4f8-1921-4be5-9b02-5cb03f12ab3e`
- Decisive activity: `ce26d471-d174-4b5e-bfd0-b7fb1a7ad3b4`
- Provider thread: `19e6faaf405c13ae`
- Provider message: `19f9973b88cc3cc0`
- Decisive time: `2026-07-25T13:25:09Z`
- Post-decline high-water event after Paul is detached:
  `a39bcb5d-fc50-443b-9ed2-9fbdf38736d2`
- Expected stage/snapshot before apply: `quoted`, assignment version `0`
- Lost reason: `price`
- Lost note: `Customer chose another provider for financial reasons.`

### Required preconditions

- The decisive event remains meaningful inbound customer correspondence from
  Sandra's persisted customer identity.
- The exact message still states that she chose someone else and cites
  financial reasons.
- No meaningful event exists after the reviewed high-water event.
- The opportunity is still nonterminal and not assigned since the manifest.
- The earlier repaired false-Won disposition remains superseded.

### Guarded apply

Call `apply_email_opportunity_declined_disposition(...)` as service role with:

- the exact company/opportunity/mailbox/message identity above
- expected assignment version `0`
- expected stage `quoted`
- evidence:
  `reason_code=price`,
  `signals=["customer_declined"]`,
  `evidence_message_ids=["19f9973b88cc3cc0"]`,
  `evaluated_through_event_id=a39bcb5d-fc50-443b-9ed2-9fbdf38736d2`

The transaction must produce `stage=lost`, `stage_manually_set=false`,
`win_probability=0`, `lost_reason=price`, the factual lost note above, a null
next follow-up, a Lost disposition with exact evidence provenance, and one
stage transition. Run the normal summary refresh after commit.

### Readback

- Sandra is Lost for price, with no open next action.
- The active Lost disposition points to the exact decisive provider message and
  event; the prior false-Won disposition remains superseded.
- The generated summary describes the customer rejection and does not attribute
  Paul's deck scope to Sandra.
- An exact retry returns `already_applied`; stale, reassigned, newer-message, or
  manual-terminal snapshots fail closed.

## Entry 3 — correct Jason Zavarella staff mail

This entry requires a separately reviewed, service-role-only repair function.
The ordinary customer-message reparent function must not be used: these are
staff-authored outbound messages and must first change direction/party
authority. The repair function must be additive, idempotent, manifest-bound,
company-serialized, and revoked from `public`, `anon`, and `authenticated`.

### Establish authoritative alias first

Insert-or-verify one active `user_email_aliases` row:

- User: Jason Zavarella,
  `11cd7606-8af1-4611-949b-21d92a0f8fef`
- Alias: `info.jzconstruct@gmail.com`
- Authority: `operator_verified`
- Verified by: Jackson Sweet,
  `283d49df-90a1-4abb-b94c-3e9f17f02c0d`
- Evidence: reviewed Gmail messages, Jason's exact registered email in CC, and
  exact team phone `2506619544` in signature

The repair must not create an alias from name similarity, a phone fragment,
domain similarity, or message text alone.

### Frozen false-lead identity

- False opportunity: `c89933a7-c07f-4d71-9d7a-0d85bfa7d965`
- False client: `fdfbfa95-c48c-4be9-8674-30a2f2466bc8`
- Current false assignment event:
  `d90ec5af-129d-4b56-8abf-bab5579e926b`
- Delivery: `2d560bf5-2c98-4c1e-a330-907b95dcc5ba`
- Notification: `31f77324-7c75-4812-851b-f7735d32c7b3`
- Expected child inventory: two activities, two correspondence events, two
  opportunity-thread joins, one inbox thread, one lifecycle state, one
  assignment event/delivery/notification, one stored attachment, and no
  dispositions, transitions, follow-ups, drafts, suggestions, approved email
  intents, or contact-form draft rows.

Any count or row-identity difference aborts the entry and requires a new
read-only review.

### Message A — Darrell and Jane

- Activity: `901a54e0-69f1-443b-9558-8443dcd8d64c`
- Correspondence event: `1699055b-4237-463c-8e86-7d1d85d33e07`
- Provider thread/message: `19f05da45dbcf41b`
- Inbox thread: `8aeb7804-dce4-4e31-a6a2-c2a7b371d3be`
- External recipient: `eyans2@telus.net`
- Attachment: `9f065064-b1da-4621-85d8-a2118152e7e4`,
  `Quote_-_177_Hampshire_Road.pdf`
- Current production has no active exact client/opportunity for the recipient.

Create one message-scoped customer/client opportunity for Darrell and Jane,
using only exact recipient and quote/property evidence. Reclassify the activity
to outbound and the event to `direction=outbound`, `party_role=ops`, preserving
provider identity and meaningfulness. Reparent the exact activity, event,
attachment, inbox thread, and opportunity-thread join to the new target.
Recompute attachment attribution, correspondence/lifecycle projections,
summary, assignment, and notification delivery through the canonical paths.

### Message B — Maureen and Wayne

- Activity: `5d7dd1be-f1d8-4a41-a1b0-58933c99ec49`
- Correspondence event: `a0fde647-b381-498c-84e3-45b1aad6d213`
- Provider thread: `19f1a9ee5b87f53d`
- Provider message: `19f3aea55b9570ce`
- Inbox thread: `2ccb3cfc-e206-4268-adbd-6ffdcc9c66de`
- External recipient: `ohmygarden@shaw.ca`
- Existing client: Maureen McKimm,
  `8ec1b295-0f38-4664-9ad3-2ee02bebd4d7`
- Existing Won opportunity:
  `c67ec551-16ba-4d30-8d58-a1f9397293d7`

Reclassify the activity to outbound and the event to
`direction=outbound`, `party_role=ops`. Reparent the exact activity/event and
thread link to Maureen's existing opportunity. The guarded transaction must
allow this reviewed Won target without changing its stage, manual-stage flag,
project links, close fields, assignment, or customer identity. Recompute its
correspondence/lifecycle projection and summary.

### Retire the false Jason records

Only after both messages and every child row have moved:

- Resolve the false assignment notification with an explicit data-correction
  reason; retain the delivery/event as audit history and mark it corrected
  through repair metadata rather than deleting it.
- Soft-delete/discard the false opportunity and record a correction disposition
  naming both destination opportunity IDs and the reviewed manifest hash.
- Soft-delete the false JZ Construction client only if a final company-wide
  reference scan proves no remaining active relationship. Otherwise retain it
  as an auditable corrected shell with no active lead identity.
- Assert zero remaining activity, correspondence, attachment, inbox-thread,
  lifecycle, opportunity-thread, follow-up, draft, assignment, conversion,
  notification, estimate/invoice, project, and suggestion references to the
  false opportunity except the explicitly retained correction audit rows.

### Readback

- `info.jzconstruct@gmail.com` resolves to Jason only through the verified alias
  record.
- Both activities/events are outbound OPS correspondence.
- Darrell/Jane remain eligible customer contacts; Maureen remains linked to her
  existing Won job without terminal-state changes.
- The false Jason opportunity is absent from active lead views and its
  assignment notification is resolved.
- The quote attachment is still stored and now attributed to the Darrell/Jane
  target.
- Exact replay is a no-op. Any new message, changed target snapshot, changed
  child count, changed attachment state, or alias conflict aborts.

## Final production proof

After all three entries, capture one read-only closeout artifact showing:

1. exact activity/event/thread/attachment ownership and directions;
2. opportunity/client active, deleted, stage, disposition, assignment,
   correspondence, lifecycle, and summary state;
3. resolved/reissued assignment notifications;
4. zero municipality-only identity matches in a shadow replay;
5. authoritative alias resolution for Jason and review deferral for an
   unverified public-domain lookalike;
6. exact-retry idempotency for all repair keys.

Observe at least one normal sync and one recovery cycle before declaring the
release healthy. Rollback is forward-only: disable the new ingestion release if
needed, preserve the audit/alias rows, and use a newly reviewed inverse manifest
to reparent exact evidence. Never delete provider history or overwrite an
operator terminal decision to simulate rollback.

# Phase C Lead Feedback — Design

**Date:** 2026-07-27  
**Status:** Approved for local implementation  
**Surfaces:** OPS iOS, OPS Web ingestion, Supabase contract, Software Bible

## Outcome

When OPS creates a lead that should not have been created, a Phase C operator can correct it in seconds. The correction records a structured, company-scoped learning signal and applies the correct lifecycle outcome without allowing automation to erase a plausible lead or override a later human decision.

No historical lead is reinterpreted. The feature only changes the lead the operator is acting on and the classification of future inbound messages.

## Verified Current State

- iOS discard changes an opportunity to `discarded` through `move_opportunity_stage` but records no reason or learning evidence.
- Inbox category correction writes `email_thread_category_corrections` and protects the chosen category with `category_manually_set`.
- `ThreadClassifier` consumes sender/domain category priors, but its free-text correction note is not used.
- New lead ingestion uses `EmailAIClassifier` through `AISyncReviewer`; it does not consume inbox category corrections.
- Live opportunity stages are `new_lead`, `qualifying`, `quoting`, `quoted`, `follow_up`, `negotiation`, `won`, `lost`, and `discarded`.
- There is no live `disqualified` stage. A genuine inquiry that is unsuitable must end at `lost`; the existing disposition model can additionally record `disqualified`.
- Existing opportunity duplicate handling is review/merge based. A duplicate is never a discard.

## Interaction

### Phase C enabled

Tapping **Discard** opens one compact reason sheet. Tapping a standard reason performs the mapped action immediately. There is no second confirmation. The success toast includes **Undo**.

The optional **Add context** control expands a short note field before the user chooses a reason. The note is never required.

### Phase C disabled

The existing first-use education and subsequent lightweight confirmation remain. The lifecycle change still goes through the new authoritative RPC with a neutral `legacy_unspecified` reason so the stage change, actor, and idempotency record remain atomic. It never becomes learning evidence.

### Reason map

| Reason | Operator label | Canonical outcome | Learning use |
|---|---|---|---|
| `spam` | Spam or scam | `discarded` | Negative |
| `job_applicant` | Job applicant | `discarded` | Negative |
| `vendor_sales` | Vendor or sales pitch | `discarded` | Negative |
| `internal` | Internal message | `discarded` | Negative |
| `platform_notification` | Platform notification | `discarded` | Negative, never domain-wide |
| `test_traffic` | Test or automated traffic | `discarded` | Negative |
| `duplicate` | Duplicate | `duplicate_review` | Exact item is held for duplicate review; no lifecycle change |
| `not_a_fit` | Not a fit | `lost` | Positive lead evidence; disposition is `disqualified` |
| `other` | Something else | `review_deferred` | Neutral; no lifecycle change |
| `legacy_unspecified` | Not shown in Phase C | `discarded` | Neutral; accepted only while Phase C is disabled |

## Layout Decision

Four structures were considered:

1. **Action-first confirmation:** fast, but hides why the reason matters and makes optional context awkward.
2. **Chip grid:** compact, but labels wrap unpredictably and scanning is poor in sunlight.
3. **Grouped cards:** expressive, but adds visual acreage to a seconds-long correction.
4. **Flow-focused list:** a terse title, stacked 44-point reason rows, and one optional context disclosure.

The flow-focused list is the chosen design. The operator scans a single column, the destructive consequence is explained in each row subtitle, and the common path is one tap after the sheet appears. It uses `OPSStyle` typography, surfaces, spacing, radii, colors, and SF Symbols only. No new animation is introduced.

## Authoritative Contract

### Data

`lead_disposition_feedback` is the append-history source of truth for the correction. It stores:

- company, opportunity, actor, and apply idempotency key;
- structured reason, canonical outcome, learning polarity/state, and resolution state;
- optional note, stored as untrusted evidence and never selected by classifier code;
- prior and applied lifecycle state, disposition references, and the exact applied row timestamp used by Undo;
- internal/provider thread, message, source key, normalized sender/domain, and participant hash;
- server-owned model and policy context;
- retraction actor, key, and timestamp.

`lead_classification_reviews` is the service-only durable queue for future messages that a feedback prior moves into the uncertainty band. It stores identifiers and numeric/structured evidence only, never message content.

### Apply

`apply_lead_disposition_feedback`:

1. resolves the actor and company from the current JWT;
2. checks row-specific `pipeline.edit` authorization;
3. locks the opportunity;
4. replays an existing idempotency result or rejects key reuse against another opportunity;
5. re-checks Phase C and validates the reason;
6. derives source/sender/model evidence on the server;
7. atomically applies the lifecycle transition, stage-transition audit, active opportunity disposition, and feedback row;
8. returns the feedback ID, canonical outcome, prior/current stage, and whether lifecycle changed.

The client cannot submit a company, actor, sender, domain, lifecycle target, model context, or learning polarity.

### Undo

`undo_lead_disposition_feedback`:

- is actor-authorized and idempotent;
- retracts the learning signal;
- for lifecycle-changing outcomes, restores the prior stage, lost fields, close date, manual-stage flag, and prior active disposition;
- writes a reverse stage-transition audit;
- refuses to overwrite the opportunity if anything changed after the original action.

That conflict is intentional: Undo never wins over a later human decision.

## Learning Policy

The classifier consumes active structured feedback only. It does not select or interpolate the optional note.

Each future candidate starts with the model's lead probability. Feedback applies a bounded adjustment:

- exact provider message: strongest;
- exact provider thread: strong but bounded;
- normalized sender: moderate;
- domain: weak and only after at least three independent threads and two independent senders.

`platform_notification` is excluded from domain-wide evidence because a platform domain can carry both real inquiries and status mail. Positive `not_a_fit` evidence protects future genuine inquiries from suppression. Duplicate and neutral exact matches are deferred, not discarded.

The final adjustment is capped. One sender correction can move a borderline model answer to human review but cannot automatically suppress a future lead. Automatic `not_lead` requires either exact-message/thread evidence or repeated independent sender/domain evidence and a score safely below the threshold. The uncertainty band is routed to `require_human_review`.

## Safety Boundaries

- Phase C is checked in both the context RPC and the atomic apply RPC.
- RLS is company- and opportunity-scoped; direct writes are revoked.
- Manual category and opportunity-stage overrides are never rewritten by the learner.
- Existing leads are never scanned, backfilled, converted, discarded, disqualified, or updated.
- Classification notes and email content are untrusted data. The feedback prior service receives structured identifiers and reason codes only.
- Duplicate feedback does not change lifecycle stage or merge anything automatically.
- A plausible lead remains a lead unless bounded, independent evidence safely clears the negative threshold; otherwise it is held for review.
- Safe retries replay prior results and cannot double-transition or double-retract.
- The iOS success event uses the existing local toast/notification convention. No notification-rail event is added for this immediate, reversible action.

## Verification Contract

Local proof must include:

- migration contract tests for authorization, tenant isolation, mapping, persistence, idempotency, and Undo conflict safety;
- prior-policy tests for exact/sender/domain bounds, independence thresholds, positive evidence, ambiguity deferral, manual-override non-interference, duplicate behavior, and prompt-injection resistance;
- sync-review integration tests for Phase C gating and durable review routing;
- iOS tests for reason mapping, Phase C routing, immediate selection, optional note, feedback persistence decoding, Undo, and disabled-mode preservation;
- full relevant Web and iOS test/build checks;
- a read-only, zero-write shadow evaluation against recent live thread/lead evidence, with false-positive, false-negative, deferral, and uncertain-case reporting.


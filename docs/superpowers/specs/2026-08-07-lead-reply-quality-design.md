# Lead Reply Quality Design

**Date:** 2026-08-07
**Status:** Approved for local implementation under the existing technical-ownership mandate

## Outcome

Lead drafting must behave like a capable operator continuing a real conversation:

1. It stays silent when the customer did not ask for or require a response.
2. It reads the complete opportunity conversation, including split provider threads.
3. It makes the first reply complete and makes later replies progressively shorter.
4. It never invents availability, repeats stale facts, or acknowledges old/signature attachments as newly sent.
5. It uses operator edits that already say replies should be shorter and more direct.
6. It follows up without claiming a quote was sent when the conversation does not prove that.

## Deterministic response decision

The model will no longer decide whether a reply is warranted. A pure response-disposition layer will inspect the latest clean customer message and return one of:

- `reply_required`: a question, request, explicit acceptance, or actionable new information needs an answer.
- `no_reply_required`: a thanks, acknowledgement, conversational sign-off, or completion notice closes the loop without asking OPS to act.
- `operator_input_required`: a scheduling or availability request cannot be answered without verified calendar context.

The existing router consumes this result:

- `reply_required` may route to `draft` when the current safety gates pass.
- `no_reply_required` routes to `update_lead_only` and Phase C records a deliberate no-op instead of creating a mailbox draft.
- `operator_input_required` routes to `require_human_review` with an exact reason.

Questions, requests, and high-confidence accept signals always outrank acknowledgement language. For example, “Thanks — can you come Tuesday?” requires a reply, while “Ok thanks” does not.

## Response modes and progression

Every reply-required message is assigned a semantic mode:

- `answer`: answer a direct question or request.
- `clarify`: ask for the one missing fact needed to proceed.
- `schedule`: respond only when verified schedule context exists; autonomous drafting otherwise holds.
- `acknowledge_and_advance`: acknowledge genuinely new material and state the next step.
- `close_loop`: confirm a real acceptance or commitment and advance the work.

Variation comes from the mode and conversation position, not randomized synonyms.

- First operator reply: complete but direct; greeting and sign-off may be used; enough context to establish the relationship.
- Ongoing reply: no fresh small talk or reintroduction; one to three short sentences; one question maximum; no generic call to action; do not recap the thread.
- Late quick exchange: answer only the new semantic delta. If nothing new requires action, produce no draft.

The learned voice profile remains authoritative for vocabulary and cadence, but conversation progression overrides global average email length. A 100-word historical average must not force a 100-word reply to “What time works?”

## Context contract

Phase C will bind each autonomous draft to the exact latest inbound activity and use the already-existing source-bound opportunity query. That query loads every authorized email activity linked to the opportunity, not only the current provider thread.

The prompt receives:

- the exact latest inbound clean body;
- the complete opportunity conversation in chronological order;
- the deterministic response mode and progression guidance;
- verified sent commitments;
- only current-message, genuinely new customer attachments;
- safe business context.

`opportunities.ai_summary` is omitted from the drafting prompt because it is derived, can be stale, and is redundant with the immutable conversation. Project title and stage may remain as reference metadata.

## Attachment contract

Attachment references carry their source message, inline flag, content id/hash, and whether the content is new to the conversation.

- Repeated content hashes/content ids are not treated as newly sent.
- Small inline assets are treated as decorative signature content.
- The drafting acknowledgement block includes only new, inspectable attachments on the latest real customer message.
- Prior-message attachments never trigger “thanks for sending those over” on a later text-only reply.

## Voice learning contract

The prompt builder consumes both the base 12-dimension profile and edit-derived preferences already stored in profile JSON:

- tone shift such as `more_direct`;
- structure/length preference such as `shorter`;
- learned substitutions and punctuation reductions.

Edit-derived preferences are explicit override directives, not passive metadata.

## Follow-up contract

The legacy default follow-up is recognized at runtime and replaced with sequence-aware neutral copy:

- first follow-up asks whether the customer still wants to move ahead;
- second follow-up says this is the last check-in and leaves a simple reply path.

Neither variant mentions a quote unless quote delivery is proven. Custom company templates continue to render unchanged.

## Safety and release boundary

This implementation requires no database migration and no live mailbox rewrite. It will be developed and verified in an isolated worktree. Push, production deployment, and any cleanup of existing mailbox drafts remain separate explicit approvals.

## Verification

Tests must reproduce the observed failures:

- “I appreciate it,” “Ok thanks,” and conversational sign-offs produce no autonomous draft.
- a question appended to thanks still produces a reply.
- Jobber transactional notifications classify as provider noise.
- repeated/signature attachments do not trigger acknowledgement.
- a current new attachment does trigger acknowledgement.
- scheduling requests hold without verified calendar context.
- subsequent-reply prompt guidance is short and direct.
- learned `more_direct` and `shorter` edits appear as active directives.
- Phase C passes the exact source activity and complete opportunity authorization to drafting.
- legacy default follow-ups no longer claim a quote was sent and vary by sequence.

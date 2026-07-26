# Phase C Durable Conversation Design

## Outcome

Guided catalog setup behaves like a trustworthy conversation with the Phase C
agent. The operator can see what they said, what the agent asked, and whether
OPS is working. Refreshing or returning to the setup restores that conversation.
The final catalog proposal remains a separate review step.

Canpro vinyl is an acceptance case, not a product-specific flow. The interface
and persistence model apply to any trade or service catalog.

## Interaction contract

- Phase C messages appear on the left; operator messages appear on the right.
- Message copy uses readable sentence-case Mohave body typography. Cake Mono is
  reserved for compact provenance labels and controls.
- The current prompt is part of the transcript rather than an oversized form
  heading.
- A tokenized multiline composer remains anchored below the transcript.
- The optional source-document action is integrated with the composer.
- Submitting immediately adds the operator message to the transcript and clears
  the composer.
- While the turn runs, the submit control reads `Working…`, cannot hover or be
  activated, and the transcript announces that Phase C is working.
- A failed turn leaves the operator message visible and provides an inline retry
  that resubmits the same answer without adding a duplicate message.
- The transcript scrolls independently while the composer remains available.
- Reaching review replaces the interview with the existing dedicated,
  page-scrollable review surface. Approval and commit stay explicit.
- Responses appear when complete. Token streaming is intentionally omitted
  because these turns are short and correctness matters more than theatrical
  output.

## Durable state

`catalog_guided_setup_sessions` gains a bounded JSONB `conversation` array.
Conversation state is stored on the session because it must advance atomically
with the session version, facts, unresolved question, and proposed plan.

Each entry contains:

- stable message ID;
- role: `assistant` or `operator`;
- message kind: `text` or `source_document`;
- display content;
- session version at which it became visible;
- optional source filename.

New sessions begin with the first assistant question. Existing active sessions
without conversation history are repaired in memory by seeding their current
question, then persist the normalized conversation on the next successful turn.
The transcript is presentation and audit state; it is not added to the language
model prompt, avoiding unnecessary token cost and keeping facts as the canonical
interview memory.

## Submission and recovery

The browser owns one optimistic pending message while a request is in flight.
The server owns confirmed messages.

1. The operator submits an answer.
2. The browser immediately shows a pending operator message.
3. The request includes the session ID and expected version.
4. The server generates the next turn and atomically saves the new transcript
   alongside the updated interview state.
5. The response replaces the optimistic view with the confirmed session.

If the request fails, the pending message remains visible with a retry action.
Retry sends the original structured answer and expected session version. It
does not append another optimistic copy. A version conflict reloads the latest
session rather than overwriting another tab.

## Accessibility and motion

- The transcript is a labelled log with polite live announcements.
- Working and failure states use explicit text, not motion alone.
- Focus remains predictable: successful turns return focus to the composer;
  errors focus the recovery message.
- Enter submits a single-line answer; Shift+Enter creates a newline.
- New messages use the OPS 200 ms panel entrance curve. Reduced-motion mode uses
  a short opacity transition only.
- Disabled controls remove hover feedback and pointer interaction.

## Out of scope

- No supplier-specific questions or prescribed trade walkthroughs are added.
- No DekSmart reference content is embedded in the interface.
- No inventory quantities are collected in catalog setup.
- No catalog changes are committed until the operator approves the separate
  review.

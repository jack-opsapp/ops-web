# Phase C Capability-Safe Conversation Design

## Outcome

Guided Catalog Setup behaves like a focused conversation and speaks only about
behavior OPS can execute in a released product. Phase C may gather ordinary
catalog facts, build supported catalog records, and explain what those records
will do. It may not turn a database label, planned integration, or model guess
into a claimed product capability.

The conversation owns the available vertical space. A compact composer floats
over the transcript, the transcript alone scrolls, and measured bottom clearance
keeps the newest exchange above the floating controls.

## Capability truth

The current Phase C contract is unsafe:

- the generation prompt invites purchasing, inventory, material-rule, and
  specialized-tool proposals without an executable-capability boundary;
- behavioral actions accept free-form payloads, capability keys, and measure
  sources;
- review validation checks catalog completeness but not whether a released OPS
  client consumes the proposed behavior;
- commit and readback can store and verify metadata that no runtime executes.

Deck Designer's vinyl cut-list engine is real, but Phase C is not connected to
it. The current iOS flow selects a vinyl catalog item through Deck Designer's
own catalog selection and heuristics. No released web or iOS consumer reads
Phase C's capability-binding or dynamic material-rule tables. Therefore
`deck_geometry/v1`, quoted-area waste rules, roll/offcut tracking, and automatic
Deck Designer purchasing are unavailable to Phase C until a released client
integration exists.

## Fail-closed capability contract

### Build-owned manifest

Production code owns a versioned catalog capability manifest. Every entry
declares:

- a stable capability reference and revision;
- whether the capability is available to Guided Catalog Setup;
- the released runtime consumer;
- the decisions Phase C may ask about;
- the blueprint action types and exact configuration shape it may emit;
- required company state and fallback behavior.

Database rows and model output never establish availability. Unknown
capabilities are unavailable.

The initial manifest exposes only released catalog behavior:

- products and their real quote/storefront fields;
- product options and fixed option values;
- catalog families, options, variants, and mappings;
- task-type reuse/creation;
- tax rates;
- static product-material relationships already consumed by OPS.

It explicitly disables dynamic material quantity rules, capability bindings,
supplier-cost automation, Deck Designer geometry, and physical roll/offcut
inventory. Those records may remain readable for compatibility, but Phase C
cannot ask about, review, or commit them.

### Server-owned questions

The model selects a stable question intent and supplies only bounded context.
The server owns the operator-visible prompt, help text, answer kind, and any
choice labels. This prevents an unavailable option from reaching the
conversation even if the model requests it.

Initial supported intents cover:

- service selection;
- manufacturer or supplier identity as a catalog fact;
- product identity;
- customer-facing versus staff-only option handling;
- fixed option values;
- base price, pricing unit, and minimum charge;
- quote display behavior;
- tax treatment;
- storefront visibility;
- task-type association;
- static material quantities;
- review readiness.

An unknown intent, unavailable capability reference, or manifest failure rejects
the generated turn without advancing the session.

### Review and commit enforcement

The same manifest validates:

1. the generated question before it is persisted;
2. every review action before review is shown;
3. the approved blueprint before any journal or catalog write.

The session and blueprint record the manifest revision. A revision mismatch
after review invalidates approval and produces a zero-write conflict. Behavioral
action payloads use strict schemas; arbitrary capability keys, measure sources,
fallbacks, and configuration cannot pass.

## Follow-up and correction model

The composer remains usable while Phase C is working.

1. A sent operator message is persisted immediately and appears in the
   transcript as queued input.
2. Phase C starts generation against an exact input revision.
3. A quick follow-up creates a newer revision and invalidates the older
   generation.
4. A stale result cannot publish an assistant message, change facts, create a
   review, or write catalog data.
5. The newest queued message can be edited or removed while no assistant result
   has been accepted for its revision.
6. Edits and removals preserve a bounded superseded audit record, hidden from
   the normal transcript.
7. Once a Phase C response is accepted, a correction is a new operator message
   beginning a new revision.

Replacing in-flight work may consume one extra model call. It never causes two
accepted answers or two catalog mutations.

The session stores:

- `input_revision`: increments for each append, edit, or remove;
- `processed_input_revision`: the newest revision accepted into Phase C state;
- a bounded input ledger containing the raw answer, display message, state,
  timestamps, and supersession relationship.

Generation reads the queued ledger entries after
`processed_input_revision`. Its final compare-and-set update requires the same
session version, input revision, and manifest revision it began with.

## Conversation layout

### One scroll owner

The Guided Catalog route remains a full-height flex descendant of the dashboard
bleed layout. The transcript is the only vertical scroll container. The page,
route shell, composer, and action chips do not create competing scroll regions.

Short transcripts remain still. When the operator is already near the bottom,
new queued input, loader state, and assistant output keep the newest exchange in
view by scrolling the transcript element only. If the operator intentionally
scrolls upward, automatic following pauses and a compact latest-message
affordance returns them to the bottom.

### Full-bleed transcript

The transcript extends from the compact header to the bottom of the Guided
Catalog surface. Conversation content keeps a readable text measure, but the
scrolling canvas is not boxed into a card.

The floating controls are measured with `ResizeObserver`. That measured overlay
height becomes transcript bottom padding, with an additional spacing token, so
the final message is never covered at full scroll. No fixed guessed clearance is
used.

### Floating composer

The composer is a dense-glass floating surface above the transcript:

- one-line initial height using the OPS compact web control tier;
- shared `Textarea`, auto-growing only when the answer needs more lines;
- a firm maximum height, after which the input itself scrolls;
- upload as a quiet paperclip action inside the field;
- a 16px Lucide paper-airplane glyph with the localized `SEND` label;
- no mobile touch-target inflation;
- no second upload row and no large standalone CTA.

The user explicitly overrides the previous icon-only composer-action rule.
Guided conversational send actions use a compact icon-plus-label treatment.
The permanent interface-system contract must be updated in the same change.

### Floating route controls

`START OVER`, `USE ANOTHER METHOD`, and `BACK TO CATALOG` render as neutral,
compact chips outside the composer surface. They remain reachable at every
viewport and do not consume transcript height in normal flow.

## Motion

### Phase C intelligence indicator

The generic spinner is replaced by a tokenized line of small bars. A restrained
ripple moves across the bars with the OPS easing curve and established motion
durations. It communicates active reasoning without decoration, glow, bounce,
or layout movement.

This is a state-driven ambient beat implemented with existing CSS/Motion
infrastructure. It animates only transform and opacity, pauses when unmounted,
and adds no dependency.

### Assistant response reveal

Only a newly accepted Phase C response types into view. Persisted history and
responses loaded on refresh render immediately. The visual character reveal is
hidden from assistive technology; a complete, stable copy is exposed once via
the live region so screen readers do not announce every character.

Typewriter pacing uses `requestAnimationFrame`, is cancelled on unmount or
supersession, and does not use timer loops. It follows the transcript only while
the operator remains near the bottom.

With reduced motion, the bar ripple becomes a static intelligence mark and the
complete response appears through the standard opacity-only fallback.

## Accessibility

- The transcript remains a named polite log.
- The composer has a persistent accessible label.
- Upload and edit/remove controls have localized accessible names.
- Enter sends; Shift+Enter inserts a newline.
- Visible keyboard focus uses the OPS focus token.
- Queued, edited, removed, working, failed, and superseded states are conveyed
  by text, not color alone.
- The typewriter does not generate character-by-character announcements.
- Reduced motion changes both loading and response-reveal behavior.

## Responsive acceptance

At 915 × 685, 1280 × 720, 1440 × 900, and a narrow responsive viewport:

- the latest complete assistant question is visible above the composer;
- the first turn includes `PHASE C`, the complete question, and optional help;
- the transcript owns all remaining vertical room;
- the floating composer and action chips remain compact and reachable;
- the upload icon and send control are proportionate;
- no transcript text is hidden beneath the floating controls;
- the page and route shell remain stationary while the transcript follows new
  content.

## Scope and release boundary

This change may update Guided Catalog UI, Phase C generation/validation/session
plumbing, its database migration, tests, the OPS interface contract, and the
relevant Software Bible section. It does not change Phase C business prompts
beyond replacing unsupported behavior with the capability contract, does not
change company-knowledge retrieval, does not implement the missing Deck Designer
bridge, does not touch live CanPro data, and does not push or deploy.

`deck_geometry/v1` remains disabled until its iOS binding consumer ships and a
future capability-manifest revision explicitly activates it.

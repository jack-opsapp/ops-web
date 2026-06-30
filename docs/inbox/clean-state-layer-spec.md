# Inbox Clean-State Layer — Implementation Spec

> **Status:** Authored 2026-06-29. Execution artifact (not for Jackson review — proofs only).
> **Branch:** `feat/inbox-dark-launch`. **Initiative:** INBOX CLEAN STATE.
> **Memory:** `project-inbox-clean-state-layer`.

## Goal

Make the Gmail→lead pipeline reliable by inserting a **deterministic Conversation-State
resolver that runs before any AI**. Parsing and drafting consume one clean, structured
state object instead of raw, polluted thread text and unreliable derived fields. AI is then
used on top of clean state for nuance, drafting, and style learning only. Learning never owns
hard state rules.

## Diagnosis (verified against code, 2026-06-29)

Root causes traced to `file:line` evidence (full map in the session transcript / memory):

| Symptom | Root cause (code) |
|---|---|
| Status doesn't reflect conversation; clear wins missed | `StageEvaluator` is count/timing-only and hard-blocks terminal stages (`stage-evaluator.ts:22,42`). `AISyncReviewer` prompt forbids `won/lost` as a stage (`ai-sync-reviewer.ts:272`), only raises a `likely_won` notification (`sync-engine.ts:2013`). No AI step reads attachments. |
| Address/phone polluted by body snippets or operator signature | `extractFormField` collects every following line until the next known label (`email-parsing.ts:776-785`); phone takes the first 7–15 digit run (`email-parsing.ts:745-754`). **Zero operator-self exclusion for phone/address** — only the email field is guarded by `safeCustomerEmail` (`lead-enrichment.ts:300-302`). Parses RAW body. |
| Names fall back to email prefix | Designed fallbacks: `createClient` writes `senderEmail.split("@")[0]` (`sync-engine.ts:251`); `firstSafeEmailName`→`localPartToDisplayName` (`opportunity-title.ts:166,209`). |
| Owner/self misclassified as customer | `identifyCompanyDomains` drops public domains → empty domain set for gmail operators (`pattern-detection-service.ts:287`); wizard sets `userEmailAddresses = teamForwarders` (`import-pipeline-wizard.tsx:786`). LLM classifier never told who the operator is (`thread-classifier-service.ts:238-266`). |
| Duplicate opportunities | No DB uniqueness on `opportunities` for any dedupe key. Read-then-write create with no lock; webhook manual-sync + 15-min cron race (`sync-engine.ts:404-428`, `webhook/gmail/route.ts:157-170`). AI-classified leads skip dedupe entirely (`sync-engine.ts:1892-1957`). Dedupe keys off polluted fields. |
| Inconsistent titles | Four divergent title builders (em-dash / hyphen / none); title is write-once, never re-derived (`opportunity-title.ts:254`, `create-lead-modal.tsx:210`, `historical-import/route.ts:479,705`). |
| Bad draft: repeated price | `getContextForDraft` never queries `category='commitment'` (`memory-service.ts:1275-1297`); generic price list IS injected + prompt invites restating prices (`ai-draft-service.ts:792`). |
| Bad draft: wrong person | Greeting bound to linked `clients` record, never the actual last sender; auto path passes no recipient (`phase-c-autonomy-router.ts:193-202`); `from_email` is selected then ignored (`ai-draft-service.ts:481,505-508`). |
| Bad draft: ignored attachment | Drafting model receives plain `body_text` only — no attachment list, no vision (`ai-draft-service.ts:808-810`). `opportunities.images` (import) never read by drafter. |
| Thread text pollution (core hypothesis) | Provider computes quote-stripped `bodyTextClean` but ingestion persists the RAW body (`sync-engine.ts:523`). Drafting cleans nothing; no signature stripper exists anywhere. |

**Data model truth:** `opportunities` = canonical lead (no `leads` table; lead = a stage).
`email_threads` = thread rollup (link via `opportunity_id`). Messages on `activities` (no
`email_messages`). Commitments = `agent_memories` `category='commitment'` rolled up to
`email_threads` via migration-077 trigger. **Latent prod tables already exist** (absent from
generated types): `lead_field_provenance`, `opportunity_dispositions`,
`opportunity_lifecycle_action_audit`, `opportunity_merges`.

## Product decisions (Jackson, 2026-06-29)

1. **Acceptance → split by confidence.** Signed-estimate attached or unambiguous "yes" →
   auto-advance to Won. Softer/verbal-only → one-tap "Mark Won" with the evidence shown.
2. **Attachments → full vision now.** Per-attachment AI cost quoted below; enable after the
   cost is on record (cost-transparency rule).

## The central contract — `ConversationState`

A single deterministic resolver produces this per thread, consumed by parsing + drafting.
New file: `src/lib/api/services/conversation-state/conversation-state.ts`.

```ts
export interface OperatorIdentity {
  emails: Set<string>;        // connection.email ∪ company users' emails ∪ profile arrays
  domains: Set<string>;       // company email domains (public domains allowed here, unlike wizard)
  phones: Set<string>;        // normalized company + user phones (companies.phone, users.phone)
  addresses: Set<string>;     // normalized company address(es)
  companyName: string | null;
}

export interface CleanMessage {
  providerMessageId: string;
  direction: "inbound" | "outbound";
  partyRole: "customer" | "operator" | "internal" | "system" | "unknown";
  fromEmail: string;
  fromName: string | null;
  sentAt: string;             // ISO
  cleanBody: string;          // quote-stripped + signature-stripped + overlap-stripped
  rawBody: string;            // retained for audit
  isRealCustomerInbound: boolean; // direction=inbound ∧ partyRole=customer ∧ meaningful
  attachments: AttachmentRef[];
}

export interface AttachmentRef {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "pdf" | "document" | "other";
  requiresInspection: boolean;   // image/diagram/PDF on a customer inbound
  inspection?: AttachmentInspection | null; // populated by the vision step (Phase 2)
}

export interface SentLedgerEntry {
  kind: "price" | "quote" | "commitment" | "promise";
  text: string;               // "Quoted $3,200 for 40ft cedar fence"
  amount?: number | null;
  sentAt: string;
  sourceMessageId: string;
}

export interface ResolvedContact {
  name: string | null;        // real person/business name; null (never email-prefix) if unknown
  nameIsVerified: boolean;    // true only when from a real display name / contact-form field
  email: string | null;       // customer email (operator excluded)
  phone: string | null;       // customer phone (operator + shape-validated)
  address: string | null;     // customer address (operator + shape-validated)
  provenance: FieldProvenance[]; // written to lead_field_provenance
}

export type LeadStage =
  | "new_lead" | "qualifying" | "quoting" | "quoted"
  | "follow_up" | "negotiation" | "won" | "lost" | "discarded";

export interface AcceptSignal {
  detected: boolean;
  confidence: "high" | "low";
  basis: ("signed_estimate_attachment" | "explicit_accept_language" | "verbal_soft")[];
  evidenceMessageIds: string[];
}

export type RoutingDecision = "draft" | "update_lead_only" | "require_human_review";

export interface ConversationState {
  threadId: string;
  connectionId: string;
  operator: OperatorIdentity;
  recipient: { email: string | null; name: string | null }; // actual last inbound sender — for greeting
  messages: CleanMessage[];
  customerMessages: CleanMessage[]; // filtered: isRealCustomerInbound
  contact: ResolvedContact;
  stage: LeadStage;
  accept: AcceptSignal;
  sentLedger: SentLedgerEntry[];
  attachmentsRequiringInspection: AttachmentRef[];
  routing: RoutingDecision;
  routingReasons: string[];
  confidence: number;         // 0..1; low → require_human_review
}
```

**Routing rules (deterministic):** `require_human_review` when contact identity is ambiguous,
an attachment requires inspection and inspection failed/absent, accept signals conflict, or
confidence < threshold. `update_lead_only` when the thread is customer mail but no reply is
warranted. `draft` otherwise. Phase C drafting consumes `routing`, `recipient`, `customerMessages`,
`sentLedger`, and `attachmentsRequiringInspection`.

## File map

| File | Responsibility |
|---|---|
| `…/conversation-state/conversation-state.ts` | Orchestrator: builds `ConversationState` from a thread. Pure-ish (DB reads only). |
| `…/conversation-state/operator-identity.ts` | Build `OperatorIdentity` from `companies` + `users` + connection + profile. **Public domains allowed.** |
| `…/conversation-state/message-cleaner.ts` | `cleanBody`: quote + signature + overlap strip. New **signature stripper** lives here. |
| `…/conversation-state/party-classifier.ts` | Deterministic per-message `direction` + `partyRole` using `OperatorIdentity` (no substring heuristics). |
| `…/conversation-state/contact-resolver.ts` | `ResolvedContact` with operator-exclusion on **all** fields + phone/address shape validation. Writes `lead_field_provenance`. |
| `…/conversation-state/accept-detector.ts` | Deterministic verbal-accept keywords + signed-estimate-attachment detection → `AcceptSignal`. |
| `…/conversation-state/sent-ledger.ts` | Build `SentLedgerEntry[]` from `agent_memories category='commitment'` + outbound price detection. |
| `…/conversation-state/attachment-inspector.ts` | Phase 2: OpenAI vision pass over `requiresInspection` attachments. |
| `…/conversation-state/inbox-models.ts` | Centralized model constants (classify/draft/attachmentVision/acceptParse), default high. |
| `…/conversation-state/router.ts` | Compute `RoutingDecision` + confidence. |
| `src/lib/email/opportunity-title.ts` | Becomes the **single** canonical title builder; add `deriveTitle(state)` + re-derive hook. |
| `…/services/dedupe-guard.ts` | DB-backed idempotent opportunity create (Phase 0). |
| Migrations | Additive only (iOS-safe): `activities.body_text_clean`, dedupe unique index, populate latent tables. |

## Phases

### Phase 0 — Stop the bleeding (data integrity) — **prod-gated**

P0-A **Dedupe hardening.**
- Migration (additive, iOS-safe): add a partial **unique index** keying opportunity creation to
  `(company_id, source_thread_key)` where `source='email'` and not terminal — OR add
  `opportunities.source_thread_key text` + partial unique index. Create via upsert-on-conflict so
  the second concurrent create no-ops instead of inserting.
- Serialize per-connection sync: a `sync_in_progress`/advisory-lock guard in `runSync` so
  webhook manual-sync and the 15-min cron cannot overlap a connection.
- Route AI-classified leads (`sync-engine.ts:1892-1957`) through `findOpportunityRelationshipMatch`/
  `getOrCreateOpportunity` before create.
- **Existing-duplicate cleanup** (live-data write — needs explicit go-ahead): merge existing dup
  opportunities via `opportunity_merges` before the unique index is validated.
- Acceptance: two concurrent `runSync` calls on one thread create exactly one opportunity (test);
  AI-classified path reuses an existing active opportunity for the same client/thread.

P0-B **Clean text at ingestion.**
- Persist `activities.body_text_clean` (additive column) = provider `bodyTextClean` + signature strip
  at the single ingestion chokepoint (`sync-engine.ts:523`). Keep `body_text` raw.
- `message-cleaner.ts` exposes one `cleanBody()` used by every consumer.
- Acceptance: stored clean body has no quoted chain / signature for fixture threads.

P0-C **Operator identity + contact hygiene.**
- `operator-identity.ts` from `companies`+`users` (authoritative), not the wizard JSON.
- `contact-resolver.ts`: operator-exclusion on phone/address/name; bound `extractFormField`
  collection (blank-line + max-line + per-field length cap); phone shape validation (reject dates/
  order numbers); name never falls back to email prefix as a *verified* name.
- Acceptance: forwarded-lead fixture with operator signature yields customer (not operator)
  phone/address; bare-gmail sender yields `nameIsVerified=false`, not "Canprojack".

### Phase 1 — Drafting contract

- `ai-draft-service.generateDraft` consumes `ConversationState`: greeting bound to
  `state.recipient` (the real last sender), `customerMessages` clean text only, `sentLedger`
  injected with an explicit "do not restate already-sent prices" rule, attachment awareness.
- Phase C auto path passes the resolved recipient.
- Acceptance: draft greets the actual last sender; does not restate a price already in
  `sentLedger`; acknowledges a present attachment.

### Phase 2 — Lead-state

- `attachment-inspector.ts` (OpenAI vision) populates `AttachmentInspection`; signed-estimate
  detection feeds `accept-detector.ts`.
- `accept-detector.ts` → stage transitions per the **split-by-confidence** decision: high →
  auto-advance to Won; low → one-tap "Mark Won" surface + notification.
- Single canonical title builder; re-derive title when `contact.name` becomes verified.
- Acceptance: signed-estimate + "yes go ahead" moves lead to Won; verbal-only surfaces a confirm.

### Phase 3 — Routing + human review + learning scope

- `router.ts` decision surfaced in inbox; low-confidence threads held for review, never silently
  acted on.
- Learning (`memory-service`, `writing-profile-service`) reduced to tone/phrasing/reusable answers;
  all state rules removed from the AI prompt path.

## Model policy — OpenAI, quality-first (start high, regress to the sweet spot)

All AI-on-top steps stay on **OpenAI** (single provider; reuse `openai-clients.ts` keyed clients).
Per Jackson (2026-06-29): prioritize output quality over cost — **default every model constant to the
highest-end OpenAI model and step DOWN only after confirming where quality holds**, not the reverse.
Centralize the choice in `inbox-models.ts` (one exported constant per concern:
`classify / draft / attachmentVision / acceptParse`) so A/B regression is a constant change, not a
call-site hunt. Today the pipeline scatters cheap `gpt-4o-mini`/`gpt-5.4-mini` across call sites —
replace those reads with the centralized constants. The deterministic clean-state layer uses **no
model**; model quality only affects nuance/drafting/vision/accept-parse — never state rules.
See memory `feedback-inbox-engine-openai-quality-first`.

### Attachment vision — cost (cost-transparency)

Dedicated OpenAI vision inspector over `requiresInspection` attachments. Default to the top model
(GPT-5.4 today; GPT-5.5 is the newer ceiling — confirm its exact rate before flipping it on);
regress toward `gpt-5.4-mini` only if quality holds.

Per-attachment estimate (one image/PDF page ≈ ~1,500 vision tokens + ~500 prompt + ~300 output):

| Model | Input $/1M | Output $/1M | ~Cost / attachment |
|---|---|---|---|
| **GPT-5.4** (high end we start at) | $2.50 | $15 | **~$0.01** (signed-estimate parse ~$0.015–0.02) |
| GPT-5.4-mini (regress target) | $0.75 | $4.50 | ~$0.004 |
| GPT-5.4-nano | $0.20 | $1.25 | ~$0.001 |

Cached-input prefix is $0.25/1M (reused system prompt amortizes across attachments). At current
tenancy (Canpro + Maverick), ~1,000 inspected attachments/month ≈ **~$10/month** at the GPT-5.4 high
end; multi-page signed-estimate PDFs cost per page.

## Safety notes

- **iOS sync constraint:** every migration is additive (new nullable column, new index, populate
  latent table). No renames/drops/type changes.
- **Prod migrations** authorized direct (low-tenant) with recon-read-only + sentinel-rollback +
  blast-radius surfaced; the **existing-duplicate cleanup** is a live-data write requiring explicit
  go-ahead before execution.
- Vercel auto-deploys ops-web `main` to production — keep this work on the feature branch until
  verified; nothing reaches customers from the branch.

## Open gate

P0-A's existing-duplicate cleanup and the dedupe unique-index validation touch live customer data.
Need Jackson's explicit go-ahead before that step runs against prod. The code-layer P0 work
(clean-text persistence, identity resolver, contact hygiene, routing AI leads through dedupe) builds
+ tests without touching prod.

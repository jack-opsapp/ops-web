# Email Contact Name Authority Design

**Status:** Approved by the product decision that email-header names are provisional, stronger same-person evidence must replace them, and human edits must remain authoritative.

## Problem

OPS currently treats many Gmail `From` display values as canonical customer names. A mailbox handle such as `falkks` can therefore remain the opportunity contact name even after the customer signs as `Kevin Falk`. A local-part fallback such as `Jtblam` can remain even after the customer signs as `James Lam`. The opportunity title is generated once and does not follow a later contact-name correction.

This is a generalized intake defect. It affects normal sync, historical import, recovery, and any reuse/link branch that sends facts through canonical lead enrichment.

## Decision

Create one deterministic contact-name evidence boundary and use the existing `lead_field_provenance` table to enforce precedence and title ownership.

Evidence order:

1. Operator-confirmed identity.
2. Explicit contact-form identity.
3. A full customer name in an inbound sign-off, extracted only from the authored, quote-stripped message and tied to that message's external sender.
4. Exact linked-client directory identity when the client, opportunity, and current correspondence share the same normalized email.
5. A human-shaped `From` or outbound-recipient display name.
6. An email local-part, which is display fallback only and never verified identity.

Header names remain useful when they are the only evidence, but they are provisional. A later, stronger same-person source may replace them. Name similarity alone never establishes identity. A full signature from a different message participant, a quoted message, an operator signature, a public-domain name match, or a phone fragment cannot authorize replacement.

## Signature Boundary

Signature extraction is deterministic and conservative:

- Run after HTML/plain-text quote removal and before the signature is removed from the clean factual body.
- Consider inbound messages classified as real external customer messages only.
- Require an explicit closing such as `Thanks`, `Regards`, `Sincerely`, `Best`, or `Cheers`.
- Require a full human name of two to four name tokens immediately after the closing.
- Reject email addresses, URLs, digits, role/company suffixes, generic words, prose-shaped lines, operator identities, and names outside bounded length/token limits.
- Preserve Unicode letters, apostrophes, periods, and hyphens used in real names.
- Do not infer a last name, combine unrelated first/last names, or use fuzzy matching.

The signature name is authoritative for the sender email on that message. A first name alone is supporting display context, not sufficient to replace an existing canonical full name.

## Canonical Enrichment

`LeadEnrichmentFacts` carries optional field-specific contact-name evidence. Canonical enrichment compares that evidence with the persisted contact-name provenance:

- Higher-confidence evidence may replace the current value only when persisted provenance still snapshots that current value.
- Contact-form and operator-confirmed values remain protected.
- Signature evidence outranks exact linked-client, header, and local-part evidence.
- An exact linked-client name may promote an opportunity only across the same normalized email identity; phone fragments and name similarity are never sufficient.
- Equal or weaker evidence is idempotent and cannot churn names.
- A signature correction updates both the opportunity contact and an exactly matched client record when neither has operator protection.

All callers continue through `applyCanonicalLeadEnrichment`, including live sync, contact-form forwarding, existing-thread reuse, relationship reuse, exact-message recovery, import, and historical import.

## Generated Title Ownership

Generated email titles keep their existing suffix (`Email Inquiry` or `Estimate`) and follow a canonical contact-name correction only while OPS still owns the title.

OPS ownership is proven by either:

- a `lead_field_provenance` row for `field_name = 'title'` whose snapshot equals the current title; or
- for legacy rows only, an exact generated-title shape whose identity segment matches the current contact name or email-local-part fallback.

Every generated title creation/correction writes a title provenance snapshot. If a person edits the title, the database value no longer matches the OPS snapshot, so later enrichment fails closed and preserves the human title.

No schema migration is required: `field_name` is text and the existing provenance uniqueness, tenancy, RLS, confirmation, and snapshot rules already support title evidence.

## Intake Presentation

New ordinary-email leads may temporarily use a reasonable header display name. Mailbox handles and exact local-part values are never treated as verified. When no trustworthy identity exists, the title uses `New Lead` rather than presenting a mailbox handle as a person's name.

## Recovery and Existing Records

The generalized code handles future messages, retries, replay, and historical-import enrichment. Existing production records are not mutated by deployment. A separate guarded, approval-only repair selects records with:

- an unconfirmed low-confidence header/local-part contact name;
- stronger same-email signed-name or exact-directory evidence;
- unchanged canonical-field provenance snapshots; and
- a title still proven OPS-generated.

The repair is idempotent, records new provenance, and skips ambiguity or operator-modified fields.

## Verification

Required regression coverage:

- `falkks1980@gmail.com`: header `falkks`, later `Thanks, Kevin Falk`.
- `jtblam@gmail.com`: local-part/header fallback, later `Thanks, James Lam` plus phone.
- Correct full header names remain stable.
- Contact-form and operator-confirmed names cannot be overwritten.
- Quoted signatures, operator signatures, standalone prose, one-word sign-offs, role/company lines, public-domain same-name customers, and phone fragments cannot rename a lead.
- Same signed message replay and out-of-order older evidence are idempotent.
- Corrected contact names rewrite OPS-generated inquiry and estimate titles.
- Human-edited titles remain unchanged.
- Live sync, existing-thread reuse, import, historical import, and recovery all use the shared boundary.

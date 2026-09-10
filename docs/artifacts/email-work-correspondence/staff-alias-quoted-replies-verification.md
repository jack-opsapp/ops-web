# Quoted staff signature and correspondence retention repair

Date: 2026-09-10. Status: implemented and verified locally; production release and data repair are pending approval. No production writes were performed during this investigation.

## Failure and correction

Customer replies could quote a teammate's full name and phone beneath a prefixed or wrapped reply header. The staff-alias detector read that quoted signature as the customer's own identity evidence and recorded a pending staff alias. Subsequent inbox messages from that address entered the outbound review path, then the internal-recipient short circuit discarded them when their only recipient was the mailbox operator. The successful sync cursor advanced past those messages.

Identity evidence now excludes quoted and forwarded history, including Apple Mail, wrapped Gmail, nested and indented quote lines, localized quoted replies, Outlook headers, and nested contact forms. An explicitly empty body cannot regain identity evidence from its snippet. A genuine signature above the reply boundary still produces a review candidate.

Pending identity messages now receive a durable, unlinked `staff_alias_pending` activity before any internal-mail discard, even when optional sent-mail sync is disabled. Persistence failure holds the cursor. Replays reuse the existing activity. Pending review bypasses staff writing-style learning, customer matching, lead creation, and thread/opportunity projection; the later reconciliation pass cannot adopt the held activity. Existing immutable correspondence direction is preserved.

## Verification

- The new quote-isolation cases first reproduced 11 failures against the original implementation.
- A private, read-only replay of all nine source emails behind the affected aliases produced nine false aliases before the correction and zero afterward; all nine correctly resolved inbound. Customer content is kept outside the public repository.
- 252 focused tests passed across 14 files, covering staff identity, inquiry evidence, existing-job routing, chronology, and recovery.
- Six focused full-sync/recovery tests passed, including both sent-mail settings, two-message same-cycle quarantine, and replay without duplication or lead projection.
- Scoped TypeScript compilation passed using `staff-alias-tsconfig.json`.
- Independent review found no remaining actionable issues after checking reconciliation and contact-form quote handling.
- The older full sync test file has a known failing baseline: 37 failures / 78 passes before this patch, 36 failures / 81 passes after it, with no newly failing test names. Many older expectations assume automatic lead creation without the current inquiry-evidence contract. The full repository suite is not claimed green.
- Tests use provider/database doubles; production provider-source capture and live ingestion after deployment still require readback.

## Live audit and bounded recovery

The audited mailbox was active and advancing its sync cursor; other inbound messages were being saved. Nine external addresses had false pending staff-alias records. Across 37 exact provider messages from those addresses since the incident window began, 14 were already stored and 23 were missing. The original alias evidence predates the September inquiry-evidence correction.

All 23 missing source messages were fetched read-only and retained privately. Three are within the established exact recovery runner's seven-day window; its dry run returned `ready` for each. This verifies authorization, snapshot integrity, current absence, and input readiness, not the result of applying recovery. Their false alias must be rejected before canonical inbound recovery can proceed.

The other 20 messages require a separate bounded historical restoration, preserving provider timestamps, current ownership, and terminal/archive state. Supplier correspondence and completed-job messages must remain review/project history and cannot create or reopen a sales lead. Do not weaken the existing seven-day recovery cutoff, change source dates, or reset a mailbox cursor. The private repair package enumerates the exact aliases, source identities, existing targets, and checks needed before any production change.

Production completion requires a ready deployment containing this patch, audited rejection of only the nine proven false aliases, exact restoration with independent activity/source/event readback, and a subsequent successful sync. These steps have not yet been performed.

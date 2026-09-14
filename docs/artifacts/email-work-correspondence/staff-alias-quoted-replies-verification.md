# Quoted staff signature and correspondence retention repair

Date: 2026-09-10. Status: live. Jackson approved publishing the correction and the exact incident repair. Production commit `23ffe646a77effba851fe063c68c15e93114b9cb` includes fix `b295b697239d10330ea7239faace705b3d9b5d95` and the current main-branch changes. Vercel deployment `dpl_C1JXrygTkScb9pQhCi8ywu7V15Sa` reached READY and serves `app.opsapp.co`; the public login route returned HTTP 200.

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
- Tests use provider/database doubles. The separately approved production recovery used actual provider messages and independently verified saved activity and immutable-source content hashes.

## Live audit and bounded recovery

The audited mailbox was active and advancing its sync cursor; other inbound messages were being saved. Nine external addresses had false pending staff-alias records. Across 37 exact provider messages from those addresses since the incident window began, 14 were already stored and 23 were missing. The original alias evidence predates the September inquiry-evidence correction.

All nine proven false staff aliases were rejected with the approving administrator, source evidence, reason, and release commit recorded. An independent readback confirmed all nine changes and that the genuine verified secondary staff address was unchanged.

All 23 missing messages were restored from exact provider identities. The three recent messages passed the existing seven-day recovery runner through normal matching, correspondence projection, commercial guards, and summary refresh. A bounded historical restoration recovered the remaining 20: 12 existing-lead messages, three existing-project messages, and five review messages. The production recovery cutoff, provider dates, and mailbox cursor were not changed by either runner. Historical restoration preserved archive states and terminal stages. The recent customer replies legitimately resurfaced their original archived lead through the normal new-reply path.

Independent database readback verified 23 unique activities and 23 immutable provider-source records. Every saved activity matched the expected sender, thread, original date, inbound direction, body hash, and existing lead/project/review destination. Every immutable source matched the provider content hash. There are 15 corresponding lead events; project/review records retain their source and activity without inventing a lead event. Supported lead-memory turns were also persisted. The 14 pre-existing activities were unchanged. No new lead was created during the repair, and no restored message was duplicated.

The four other affected historical lead summaries were refreshed through the existing guarded summary service. Independent readback matched all four resulting summary hashes and timestamps. Their stages and archive states remained unchanged. Per-target receipts allow safe continuation without regenerating an already verified summary.

The mailbox remains active with sync enabled. Production advanced its sync watermark after deployment and alias correction, then again to `2026-09-10T22:10:12.606Z`; the final lock readback was clear. Production sync completion is verified through the database watermark. The runtime-log tool returned no detailed logs, so no stronger runtime trace is claimed. A manual cron probe using the local credential returned 401 and is not counted as a successful sync.

All customer content, exact repair manifests, authorization checks, original snapshots, source hashes, SQL readbacks, and per-message receipts remain in the private incident package outside this public repository. The published tests and this evidence note contain no customer identities or email bodies.

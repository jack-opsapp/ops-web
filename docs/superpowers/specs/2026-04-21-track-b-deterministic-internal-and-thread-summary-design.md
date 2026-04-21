# Deterministic Internal Detection + Per-Thread One-Sentence Summary — Design Spec

**Date:** 2026-04-21
**Status:** Proposed
**Track:** B of the inbox UI polish pass — addresses items 4 and 8 of the owner's feedback list

---

## Problem

Two separate inbox-quality complaints that share the same hot path (thread classification during sync) and are therefore best solved together:

**1. Internal emails are classified by the LLM when they shouldn't need to be.**
`thread-classifier-service.ts` hands every new email to gpt-5.4-mini, including threads where every participant is a known company user. The classifier's own prompt describes `INTERNAL` as "no external party is the primary recipient" — a deterministic fact the system already has access to via the `users` table. Relying on the LLM means:
- Token spend on threads where the answer is unambiguous.
- Occasional mis-classifications (an internal "crew schedule" thread getting tagged as CLIENT because the body mentions a client's name).
- No hard guarantee — the same thread can flip category across re-runs.

**2. The AI summary is invisible for 95% of threads.**
`thread-classifier-service.ts` only emits `aiSummary` when `messageCount >= 10`. For shorter threads, `aiSummary` is `null`. The UI in `thread-detail-view.tsx` gates the summary block on `aiSummary` being truthy, so the owner perceives the feature as "empty" on essentially every thread they open.

---

## Decisions

| Question | Decision |
|----------|----------|
| Definition of "internal" | All participants of the thread match a row in `users` for this company. Sender and every recipient are company users. |
| Deterministic rule vs. LLM | Deterministic rule overrides the LLM when it fires. Saves the classifier call entirely on genuinely internal threads. |
| Manual-correction safety | Rule does NOT run when `category_manually_set = true`. The user's category choice is sticky. |
| Forward safety | Rule does NOT run when the thread is a forward (subject prefix `Fwd:` / `Fw:` or body has a standard forward marker). Forwarded threads route to the LLM because the semantic source is the forwarded content, not the participants. |
| Existing known-forwarder guard | Rule does NOT run when the sync-engine's existing `isForwarderMatch` logic would have treated this thread as an inbound inquiry (a teamForwarder forwarding a form-subject message). |
| Backfill of existing threads | None. The rule applies from the next sync forward. Existing mis-classified threads stay until a user corrects them. |
| Summary generation cadence | Every classification produces a one-sentence summary. Threshold of `messageCount >= 10` is removed. |
| Summary scope | Describes the conversation's current state + what's owed. One sentence, ≤120 chars soft cap. |
| Relationship to `opportunity.ai_summary` | Unchanged — the opportunity summary is about the deal, refreshed on pipeline events, consumed by kanban cards and AI draft context. The thread summary is about the conversation, refreshed per message, consumed by the inbox thread detail. Different surfaces, different cadences, no duplication. |
| When the deterministic rule fires | Summary still gets written — deterministically, from a template, not via LLM. ("Internal thread between Jared and you about [subject].") |

---

## Architecture

### The classification pipeline today

```
sync-engine.ts
  ├── upsert email_threads row
  └── EmailThreadService.classifyAndUpdate(threadRow)
        └── ThreadClassifier.classifyThread(input)
              └── OpenAI call → { primaryCategory, confidence, labels, aiSummary, reasoning }
              └── UPDATE email_threads SET primary_category, confidence, labels, ai_summary, category_classifier_version='v1'
```

### The classification pipeline after this change

```
sync-engine.ts
  ├── upsert email_threads row
  └── EmailThreadService.classifyAndUpdate(threadRow)
        ├── [NEW] tryDeterministicInternal(threadRow, firstMsg, companyUserEmails, companyForwarders)
        │     └── if returns "INTERNAL" → write row with deterministic summary, category_confidence=1.0,
        │         category_classifier_version='deterministic-v1', SKIP the OpenAI call, return
        │     └── else fall through
        └── ThreadClassifier.classifyThread(input)
              └── OpenAI call → { primaryCategory, confidence, labels, aiSummary, reasoning }
              └── [CHANGED] aiSummary is now always a 1-sentence string (never null)
              └── UPDATE email_threads SET ...
```

### New helper: `tryDeterministicInternal`

Lives in `src/lib/api/services/deterministic-internal-rule.ts` (new file). Pure function, no Supabase access of its own — the caller fetches `companyUserEmails` once per sync run and passes it in.

```ts
export interface CompanyUser {
  email: string;                    // lowercase, trimmed
  displayName: string;              // firstName ?? firstName + " " + lastName ?? email local-part
}

export interface DeterministicInternalInput {
  subject: string;
  firstMessageBody: string;         // body of the oldest message in the thread
  participants: string[];           // from email_threads.participants (may include "Name <email>" format)
  senderEmail: string | null;       // latest sender, for forwarder match
  categoryManuallySet: boolean;
  companyUsers: Map<string, CompanyUser>;   // key: email (lowercase)
  teamForwarders: string[];         // from pipeline_profile.team_forwarders, if any
}

export interface DeterministicInternalResult {
  category: "INTERNAL";
  summary: string;                  // deterministic one-sentence template
  classifierVersion: "deterministic-v1";
  confidence: 1;                    // literal 1 (TS number literal; stored as numeric 1.0)
}

export function tryDeterministicInternal(
  input: DeterministicInternalInput
): DeterministicInternalResult | null;
```

The caller is responsible for extracting the bare email from each `participants` entry (they may arrive in `"Jared Reed <jared@ops.co>"` format). Use the existing `extractEmailAddress` helper in `src/lib/utils/email-parsing.ts` before looking up in `companyUsers`.

**Rule logic, in order (guards bail early):**

1. If `participants.length === 0` → return null. Empty participants means we don't know who's in the thread; don't classify deterministically. (`Array.every()` returns `true` on empty arrays, which would otherwise false-positive here — guarding explicitly.)
2. If `categoryManuallySet` → return null.
3. If `isForward(input.subject, input.firstMessageBody)` → return null.
4. If `isLikelyForwardedInquiry(input.senderEmail, input.subject, input.teamForwarders)` → return null.
5. Extract each participant's bare email via `extractEmailAddress`, lowercase. If any result is empty OR is NOT a key in `input.companyUsers` → return null.
6. Build the deterministic summary using the resolved `displayName` for each matched participant. Return `{ category: "INTERNAL", summary, classifierVersion: "deterministic-v1", confidence: 1 }`.

**`isForward`** reuses the patterns in `src/lib/utils/email-parsing.ts` (lines 308–311). We add a helper `isForwardMarker(subject, body)` there and re-export it. New code path: subject starts with `fwd:` / `fw:` (case-insensitive, whitespace-trimmed), OR body matches `/^-{5,}\s*Forwarded message\s*-{5,}/mi`, OR body matches `/^Begin forwarded message:/mi`.

**`isLikelyForwardedInquiry`** mirrors the existing check at `sync-engine.ts:646–649` — sender is in `profile.teamForwarders` AND `isFormSubmissionSubject(subject)` from `known-platforms.ts`. We extract this into a helper so both call sites share one implementation (sync-engine keeps its lead-creation logic unchanged; we just read the same predicate).

**Deterministic summary template:**

```ts
function buildDeterministicInternalSummary(
  participants: string[],
  companyUsers: Map<string, CompanyUser>,
  subject: string
): string {
  const names = participants
    .map((p) => {
      const email = extractEmailAddress(p).toLowerCase();
      const user = companyUsers.get(email);
      // Falls back to email local-part if somehow missing; rule 4 should
      // have already bailed when a participant isn't in companyUsers.
      return user?.displayName ?? email.split("@")[0];
    })
    .filter(Boolean);
  const shown = names.slice(0, 3);
  const extra = Math.max(0, names.length - shown.length);
  const who = shown.join(", ") + (extra > 0 ? ` +${extra}` : "");
  const topic = subject.trim() || "(no subject)";
  return `Internal thread between ${who} about ${topic}.`;
}
```

Example outputs:
- `Internal thread between Jared, Meghan, Alex about crew schedule for Friday.`
- `Internal thread between Jared and you about W9 for Acme.`
- `Internal thread between you, Meghan +3 about office move.`

### Classifier output schema change

`thread-classifier-service.ts` `ClassifyResult.aiSummary` changes from `string | null` to `string` (always populated). The system prompt is updated:

**Before (excerpt):**
> AI SUMMARY — only if messageCount >= 10
> For long threads (10+ messages), produce a 1–2 sentence summary […]. For shorter threads, return `aiSummary: null`.

**After:**
> AI SUMMARY — one sentence, always
> Produce a single sentence describing the CURRENT STATE of the conversation and what is owed by whom. Lead with the action if one is pending. ≤120 characters when possible. Examples:
>   - "Jane asked for cedar pricing; you owe her a quote by Fri Apr 25."
>   - "Brent confirmed PO #4421 for $3,220, delivers Tue Apr 29."
>   - "Your crew lead is asking whether to bring the spare trailer tomorrow."
> Return the sentence as `aiSummary` (required, non-empty).

The JSON output shape stays the same (`aiSummary: string`). Validation in `thread-classifier-service.ts` flips from `string | null` to required-non-empty-string; on validation failure, fall back to a deterministic template `"${senderName || senderEmail} · ${subject}"` rather than crashing.

### Company user cache

`tryDeterministicInternal` needs `companyUsers: Map<string, CompanyUser>` and `teamForwarders: string[]`. Both are loaded per-sync-run, not per-thread. The existing sync engine already loads the connection and profile per run; we add a one-shot query:

```ts
// Once per sync run, not per email
const { data: userRows } = await supabase
  .from("users")
  .select("email, first_name, last_name")
  .eq("company_id", companyId);

const companyUsers = new Map<string, CompanyUser>();
for (const row of userRows ?? []) {
  const email = (row.email as string | null)?.toLowerCase().trim();
  if (!email) continue;
  const first = (row.first_name as string | null)?.trim() ?? "";
  const last = (row.last_name as string | null)?.trim() ?? "";
  const displayName =
    [first, last].filter(Boolean).join(" ") || email.split("@")[0];
  companyUsers.set(email, { email, displayName });
}

// Belt-and-suspenders: include the mailbox owner even if their row is missing
// (brand-new connection, user row not yet upserted, etc.)
const connEmail = connection.email.toLowerCase().trim();
if (!companyUsers.has(connEmail)) {
  companyUsers.set(connEmail, {
    email: connEmail,
    displayName: connEmail.split("@")[0],
  });
}
```

Schema verified: `public.users` has `email`, `first_name`, `last_name` columns plus `company_id` (confirmed 2026-04-21).

### UI changes

`src/components/ops/inbox/thread-detail-view.tsx` lines 653–682 currently render:

```tsx
{(aiSummary || messageCount >= 10) && aiSummary && (
  <div ...>{aiSummary}</div>
)}
```

Becomes:

```tsx
{aiSummary && (
  <div className="shrink-0 px-3 py-2 border-b border-border-subtle bg-[rgba(111,148,176,0.04)]">
    <div className="flex items-start gap-2">
      <Sparkles className="w-[12px] h-[12px] text-ops-accent shrink-0 mt-[3px]" strokeWidth={1.75} />
      <p className="font-mohave text-[12.5px] text-text-2 leading-snug">
        {aiSummary}
      </p>
    </div>
  </div>
)}
```

- Removes the `messageCount >= 10` gate (obsolete — summaries now always exist on newly-classified threads).
- Removes the `// AI summary` pseudo-label, expand/collapse, and prose-length `line-clamp-2`. One sentence fits — no clamp needed.
- Keeps the `Sparkles` icon + accent-tinted background.
- Existing threads that have `aiSummary = null` (because they pre-date this change) render the block empty — which is fine because the conditional hides them. They will *never* get a summary retrofitted (no backfill — see Decisions above). Over time the inventory of summary-less threads shrinks as users open old threads and sync re-touches them.

---

## Files Touched

```
NEW:
  src/lib/api/services/deterministic-internal-rule.ts   — tryDeterministicInternal + helpers

MODIFIED:
  src/lib/utils/email-parsing.ts                         — add + export isForwardMarker(subject, body)
  src/lib/api/services/known-platforms.ts                — add + export isLikelyForwardedInquiry(senderEmail, subject, teamForwarders)
  src/lib/api/services/email-thread-service.ts           — classifyAndUpdate: try deterministic rule first, fallthrough to classifier
  src/lib/api/services/thread-classifier-service.ts      — system prompt updated for always-on summary; ClassifyResult.aiSummary: string (no null)
  src/lib/api/services/sync-engine.ts                    — load companyUserEmails once per run, pass into classifyAndUpdate
  src/components/ops/inbox/thread-detail-view.tsx        — drop messageCount gate, simplify render
  src/lib/types/email-thread.ts                          — (optional) update docblock for aiSummary field
```

Seven files. One new file. Zero schema migrations.

---

## Non-Goals

- **No backfill.** Existing `email_threads` rows with `ai_summary = null` stay that way. The owner explicitly chose this.
- **No changes to `opportunity.ai_summary`.** It's a different surface with different cadence. Pipeline kanban and AI draft context continue to read from it unchanged.
- **No schema changes.** `category_classifier_version` already exists as `text`; we just use the value `'deterministic-v1'` for deterministically-classified rows.
- **No changes to the UI for thread grouping** (item 6, handled by the parallel research agent).
- **No lead/client tag decoupling** (item 7 — Track C, separate spec).
- **No agent naming** (item 10 — Track F, separate spec).
- **No backfill of Phase C memories from email bodies** (item 9 — Track G, separate research by parallel agent).
- **No new category values.** INTERNAL already exists.

---

## Verification Plan

### Deterministic-internal rule

1. **Unit test** `tryDeterministicInternal` covering:
   - All participants in `companyUsers` → returns INTERNAL
   - One participant outside `companyUsers` → returns null
   - Empty participants array → returns null (explicit guard, not relying on `every()` truthiness)
   - Participant formatted as `"Jared Reed <jared@ops.co>"` is matched correctly by its bare email
   - Participant with malformed email (no `@`, or empty after extraction) → returns null
   - `categoryManuallySet = true` → returns null even when all else matches
   - Subject `"Fwd: Website inquiry"` → returns null
   - Subject `"FW: quote request"` (uppercase) → returns null
   - Subject `"Fw: update"` (mixed case) → returns null
   - Body contains `"---------- Forwarded message ----------"` → returns null
   - Body contains `"Begin forwarded message:"` → returns null
   - Sender in `teamForwarders` + subject `"new inquiry"` → returns null (matches existing sync-engine flow)
   - Normal internal thread → returns INTERNAL with summary matching `/^Internal thread between/` and confidence `1`
2. **Integration smoke**: in a dev environment with seeded users, sync a mailbox containing a known-internal thread. Confirm the resulting `email_threads` row has `primary_category='INTERNAL'`, `category_classifier_version='deterministic-v1'`, `category_confidence=1.0`, and no classifier call was made (check server logs for absence of the OpenAI request line).
3. **Forward regression**: sync a forwarded inquiry between two internal users. Confirm the row goes through the LLM path (`category_classifier_version='v1'`) and gets classified per content, not INTERNAL.

### Always-on summary

1. **Unit test** the classifier output validator — reject null/empty `aiSummary`, fall back to template on invalid output.
2. **Integration smoke**: sync a new 1-message thread. Confirm `ai_summary` is non-empty on the resulting row. Open the thread in `/inbox`, confirm the summary line renders.
3. **Visual regression**: open a pre-existing short thread whose summary is null. Confirm the summary block is hidden (graceful). Open a pre-existing long thread (msg count ≥ 10) whose summary is populated. Confirm it still renders correctly.

### Token cost sanity

Add a single log line to `thread-classifier-service.ts` when a classification runs: `[thread-classifier] classified thread ${id} (category=${primary}, tokens=${response.usage?.total_tokens})`. After one day of prod sync, query aggregated logs — expect mean tokens to rise by a small constant (the extra summary output, ~20–40 tokens).

---

## Design System Compliance

- Summary block: `bg-[rgba(111,148,176,0.04)]` (accent-tinted glass wash), `border-b border-border-subtle` — matches the existing block's styling.
- Text: `font-mohave text-[12.5px] text-text-2 leading-snug` (no change).
- Sparkles icon in `ops-accent` color — matches the existing block.
- No new colors, no new fonts, no shadows.

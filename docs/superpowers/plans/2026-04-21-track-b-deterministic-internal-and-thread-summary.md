# Deterministic Internal Detection + Always-On Thread Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-classify threads as `INTERNAL` deterministically when all participants are company users (with forward guards + manual-correction respect), and emit a one-sentence `ai_summary` for every thread.

**Architecture:** A pure `tryDeterministicInternal` helper runs before the LLM classifier inside `EmailThreadService.classifyAndUpdate`. When it fires, the thread is written with `category_classifier_version='deterministic-v1'`, `confidence=1`, and a template-generated summary — no OpenAI call. When it doesn't fire, the existing LLM classifier runs with an updated prompt that now produces a one-sentence summary on every thread (threshold of `messageCount >= 10` removed).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase, Vitest. OpenAI gpt-5.4-mini via `getSyncOpenAI()`. Tests go under `src/lib/api/services/__tests__/` following existing conventions.

**Spec:** `docs/superpowers/specs/2026-04-21-track-b-deterministic-internal-and-thread-summary-design.md`

---

## File Structure

Files in execution order:

```
NEW:
  src/lib/api/services/__tests__/deterministic-internal-rule.test.ts  — unit tests (TDD)
  src/lib/api/services/deterministic-internal-rule.ts                 — tryDeterministicInternal + loadCompanyUsers + loadTeamForwarders

MODIFIED:
  src/lib/utils/email-parsing.ts                         — add + export isForwardMarker
  src/lib/api/services/known-platforms.ts                — add + export isLikelyForwardedInquiry
  src/lib/api/services/thread-classifier-service.ts      — always-on aiSummary: system prompt + parseResult
  src/lib/api/services/email-thread-service.ts           — wire deterministic rule into classifyAndUpdate
  src/components/ops/inbox/thread-detail-view.tsx        — drop messageCount gate
```

Six files touched. Two new files. Zero schema migrations.

**Commit strategy:** TDD — tests go in before implementation, commit after each green. The shipping commits are:
1. Rule tests (red, committed separately so the implementation commit goes straight to green)
2. `isForwardMarker` extraction + `isLikelyForwardedInquiry` helper + `tryDeterministicInternal` (makes the tests pass; atomic commit)
3. Classifier always-on summary (independent of the rule)
4. Wire rule into `classifyAndUpdate` (integration — depends on 2)
5. UI simplification (depends on 3)

---

## Task 1: Write the deterministic-internal rule unit tests (red)

**Files:**
- Create: `src/lib/api/services/__tests__/deterministic-internal-rule.test.ts`

**Goal of this task:** Write comprehensive unit tests for `tryDeterministicInternal` against the exact behavior described in the spec. They MUST fail — the module doesn't exist yet. Commit the red test file so the implementation commit in Task 2 produces one clean green.

- [ ] **Step 1: Create the test file with full coverage of the spec's Rule Logic section**

Create `src/lib/api/services/__tests__/deterministic-internal-rule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  tryDeterministicInternal,
  type CompanyUser,
  type DeterministicInternalInput,
} from "../deterministic-internal-rule";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeCompanyUsers(
  entries: Array<[string, string]>
): Map<string, CompanyUser> {
  const m = new Map<string, CompanyUser>();
  for (const [email, displayName] of entries) {
    const key = email.toLowerCase();
    m.set(key, { email: key, displayName });
  }
  return m;
}

function baseInput(
  overrides: Partial<DeterministicInternalInput> = {}
): DeterministicInternalInput {
  return {
    subject: "crew schedule for Friday",
    firstMessageBody: "Hey team — confirming crew list for Friday.",
    participants: ["jared@ops.co", "meghan@ops.co"],
    senderEmail: "jared@ops.co",
    categoryManuallySet: false,
    companyUsers: makeCompanyUsers([
      ["jared@ops.co", "Jared Reed"],
      ["meghan@ops.co", "Meghan Lee"],
    ]),
    teamForwarders: [],
    connectionEmail: "meghan@ops.co",
    ...overrides,
  };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("tryDeterministicInternal — matches", () => {
  it("returns INTERNAL when all participants are company users", () => {
    const result = tryDeterministicInternal(baseInput());
    expect(result).not.toBeNull();
    expect(result!.category).toBe("INTERNAL");
    expect(result!.classifierVersion).toBe("deterministic-v1");
    expect(result!.confidence).toBe(1);
    expect(result!.summary).toMatch(/^Internal thread between /);
    expect(result!.summary).toContain("crew schedule for Friday");
  });

  it("resolves participant display names from companyUsers", () => {
    const result = tryDeterministicInternal(baseInput());
    expect(result!.summary).toContain("Jared Reed");
    expect(result!.summary).toContain("Meghan Lee");
  });

  it("handles participants formatted as 'Name <email>'", () => {
    const result = tryDeterministicInternal(
      baseInput({
        participants: ["Jared Reed <jared@ops.co>", "Meghan Lee <meghan@ops.co>"],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.category).toBe("INTERNAL");
  });

  it("is case-insensitive on participant emails", () => {
    const result = tryDeterministicInternal(
      baseInput({ participants: ["JARED@ops.co", "Meghan@OPS.CO"] })
    );
    expect(result).not.toBeNull();
  });

  it("truncates to 3 names and appends +N for the overflow", () => {
    const result = tryDeterministicInternal(
      baseInput({
        participants: [
          "a@ops.co",
          "b@ops.co",
          "c@ops.co",
          "d@ops.co",
          "e@ops.co",
        ],
        companyUsers: makeCompanyUsers([
          ["a@ops.co", "Alpha"],
          ["b@ops.co", "Bravo"],
          ["c@ops.co", "Charlie"],
          ["d@ops.co", "Delta"],
          ["e@ops.co", "Echo"],
        ]),
      })
    );
    expect(result).not.toBeNull();
    expect(result!.summary).toContain("Alpha, Bravo, Charlie +2");
    expect(result!.summary).not.toContain("Delta");
  });

  it("uses (no subject) placeholder when subject is blank", () => {
    const result = tryDeterministicInternal(
      baseInput({ subject: "   " })
    );
    expect(result!.summary).toContain("(no subject)");
  });

  it("accepts connectionEmail as a fallback when user row is missing", () => {
    const result = tryDeterministicInternal(
      baseInput({
        participants: ["new-user@ops.co", "meghan@ops.co"],
        companyUsers: makeCompanyUsers([["meghan@ops.co", "Meghan Lee"]]),
        connectionEmail: "new-user@ops.co",
      })
    );
    expect(result).not.toBeNull();
  });
});

// ─── Bail: manual override ───────────────────────────────────────────────────

describe("tryDeterministicInternal — bails on manual override", () => {
  it("returns null when categoryManuallySet is true", () => {
    expect(
      tryDeterministicInternal(baseInput({ categoryManuallySet: true }))
    ).toBeNull();
  });
});

// ─── Bail: forward subject ───────────────────────────────────────────────────

describe("tryDeterministicInternal — bails on forward subjects", () => {
  it("bails on 'Fwd: ...'", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "Fwd: Website inquiry" }))
    ).toBeNull();
  });

  it("bails on 'FW: ...' (uppercase)", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "FW: Quote request" }))
    ).toBeNull();
  });

  it("bails on 'Fw: ...' (mixed case)", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "Fw: update" }))
    ).toBeNull();
  });

  it("bails with leading whitespace on subject", () => {
    expect(
      tryDeterministicInternal(baseInput({ subject: "   FWD: pricing" }))
    ).toBeNull();
  });
});

// ─── Bail: forward body markers ──────────────────────────────────────────────

describe("tryDeterministicInternal — bails on forward body markers", () => {
  it("bails on '---------- Forwarded message ----------'", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          firstMessageBody:
            "Thought you'd want to see this.\n\n---------- Forwarded message ----------\nFrom: customer@example.com",
        })
      )
    ).toBeNull();
  });

  it("bails on 'Begin forwarded message:'", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          firstMessageBody:
            "FYI\n\nBegin forwarded message:\nFrom: customer@example.com",
        })
      )
    ).toBeNull();
  });
});

// ─── Bail: known-forwarder + form subject ────────────────────────────────────

describe("tryDeterministicInternal — bails on likely-forwarded-inquiry pattern", () => {
  it("bails when sender is in teamForwarders AND subject matches form pattern", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          senderEmail: "jared@ops.co",
          teamForwarders: ["jared@ops.co"],
          subject: "Got a new submission from your contact form",
        })
      )
    ).toBeNull();
  });

  it("does NOT bail when sender is in teamForwarders but subject is NOT a form", () => {
    const result = tryDeterministicInternal(
      baseInput({
        senderEmail: "jared@ops.co",
        teamForwarders: ["jared@ops.co"],
        subject: "lunch tomorrow",
      })
    );
    expect(result).not.toBeNull();
  });

  it("does NOT bail when subject matches form pattern but sender is not a forwarder", () => {
    const result = tryDeterministicInternal(
      baseInput({
        senderEmail: "meghan@ops.co",
        teamForwarders: ["someone-else@ops.co"],
        subject: "new inquiry about scheduling",
      })
    );
    expect(result).not.toBeNull();
  });
});

// ─── Bail: external participant ──────────────────────────────────────────────

describe("tryDeterministicInternal — bails when a participant is external", () => {
  it("returns null when one participant is NOT in companyUsers", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          participants: ["jared@ops.co", "customer@example.com"],
        })
      )
    ).toBeNull();
  });

  it("returns null when participant email extraction yields empty string", () => {
    expect(
      tryDeterministicInternal(
        baseInput({
          participants: ["jared@ops.co", "not-an-email"],
        })
      )
    ).toBeNull();
  });
});

// ─── Bail: empty participants ────────────────────────────────────────────────

describe("tryDeterministicInternal — bails on empty participants", () => {
  it("returns null when participants is empty", () => {
    expect(
      tryDeterministicInternal(baseInput({ participants: [] }))
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they all fail**

Run:
```bash
cd /c/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/deterministic-internal-rule.test.ts
```

Expected: all tests FAIL with an import error — `Cannot find module '../deterministic-internal-rule'`. The module doesn't exist yet; that's the whole point of this commit.

- [ ] **Step 3: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/api/services/__tests__/deterministic-internal-rule.test.ts && git commit -m "$(cat <<'EOF'
test(track-b): add failing tests for tryDeterministicInternal

Covers all rule paths from the spec: happy path, manual-override bail,
forward-subject bails (Fwd/FW/Fw case-insensitive), forward-body-marker
bails, known-forwarder + form-subject bail, external-participant bail,
empty-participants bail, name resolution + truncation, case-insensitive
matching, connectionEmail fallback.

Module under test does not exist yet — these fail with an import error.
Task 2 ships the implementation and takes them green in one commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement deterministic-internal-rule.ts + supporting helpers

**Files:**
- Modify: `src/lib/utils/email-parsing.ts` (add `isForwardMarker` export)
- Modify: `src/lib/api/services/known-platforms.ts` (add `isLikelyForwardedInquiry` export)
- Create: `src/lib/api/services/deterministic-internal-rule.ts`

**Goal of this task:** Ship the rule and its two pure-function dependencies. Tests from Task 1 should all go green in one commit.

- [ ] **Step 1: Add `isForwardMarker` export to `src/lib/utils/email-parsing.ts`**

The file already has forward-marker regexes inside `QUOTE_MARKERS` (lines 308–311). Export a named helper that checks subject and body with the same patterns. Add this block at the end of the file, just before the closing of the export surface (after `extractEmailAddress` on line 463):

```ts
// ─── Forward detection (shared by deterministic-internal-rule) ──────────────

const FORWARD_SUBJECT_RE = /^\s*fwd?:\s*/i;
const FORWARDED_MESSAGE_BODY_RE = /^-{5,}\s*Forwarded message\s*-{5,}/mi;
const BEGIN_FORWARDED_BODY_RE = /^Begin forwarded message:/mi;

/**
 * True when the thread's subject or first-message body indicates a
 * forward — subject starts with "Fwd:" / "FW:" / "Fw:" (case-insensitive,
 * whitespace-tolerant), OR body contains a standard forward marker.
 *
 * Used by tryDeterministicInternal to bail out of the "all participants are
 * internal → INTERNAL" shortcut when the thread's semantic content comes
 * from a forwarded message rather than the participants themselves.
 */
export function isForwardMarker(subject: string, bodyText: string): boolean {
  if (FORWARD_SUBJECT_RE.test(subject)) return true;
  if (FORWARDED_MESSAGE_BODY_RE.test(bodyText)) return true;
  if (BEGIN_FORWARDED_BODY_RE.test(bodyText)) return true;
  return false;
}
```

Note: the subject regex `^\s*fwd?:\s*` matches `Fwd:`, `FWD:`, `Fw:`, `FW:` with the `d?` making the `d` optional, `i` flag for case-insensitivity, `\s*` tolerating leading whitespace.

- [ ] **Step 2: Add `isLikelyForwardedInquiry` export to `src/lib/api/services/known-platforms.ts`**

The file already exports `isFormSubmissionSubject` (line 88). Add a second helper that wraps the combined check currently inlined in `sync-engine.ts:646-649`. Append to the end of the file:

```ts
/**
 * True when a sender's email is in the team's forwarders list AND the
 * subject matches a form-submission pattern. Used by both:
 *   - sync-engine.ts's lead-creation flow (existing)
 *   - deterministic-internal-rule.ts's bail check (new)
 *
 * Having one predicate prevents drift between the two call sites.
 */
export function isLikelyForwardedInquiry(
  senderEmail: string | null,
  subject: string,
  teamForwarders: string[]
): boolean {
  if (!senderEmail) return false;
  if (!isFormSubmissionSubject(subject)) return false;
  const sender = senderEmail.toLowerCase();
  return teamForwarders.some((f) => sender.includes(f.toLowerCase()));
}
```

- [ ] **Step 3: Create `src/lib/api/services/deterministic-internal-rule.ts`**

Full file contents:

```ts
/**
 * OPS Web — Deterministic Internal Thread Classification (Track B)
 *
 * When every participant of an email thread is a known company user, we can
 * classify the thread as INTERNAL without consulting the LLM. This file
 * exports the rule itself (`tryDeterministicInternal`) and the per-thread
 * reads that feed it (`loadCompanyUsers`, `loadTeamForwarders`).
 *
 * The rule bails (returns null) when:
 *   1. The participants list is empty
 *   2. The user has manually set the category
 *   3. The thread is a forward (subject "Fwd:"/body markers)
 *   4. The thread matches the known-forwarder + form-subject pattern
 *      (e.g. Jared forwards a website inquiry — already handled as a lead
 *      by sync-engine's existing logic; we must not hide it as INTERNAL)
 *   5. Any participant's email isn't in the companyUsers map
 *
 * When the rule fires, the thread is written with:
 *   - primary_category            = "INTERNAL"
 *   - category_confidence         = 1
 *   - category_classifier_version = "deterministic-v1"
 *   - ai_summary                  = "Internal thread between X, Y about Z."
 * and the classifier call is skipped entirely.
 *
 * Spec: docs/superpowers/specs/2026-04-21-track-b-deterministic-internal-and-thread-summary-design.md
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import {
  extractEmailAddress,
  isForwardMarker,
} from "@/lib/utils/email-parsing";
import { isLikelyForwardedInquiry } from "./known-platforms";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompanyUser {
  email: string;        // lowercase, trimmed
  displayName: string;  // e.g. "Jared Reed" or email local-part as fallback
}

export interface DeterministicInternalInput {
  subject: string;
  firstMessageBody: string;
  participants: string[];
  senderEmail: string | null;
  categoryManuallySet: boolean;
  companyUsers: Map<string, CompanyUser>;
  teamForwarders: string[];
  /** Falls back to this when the connection owner's users row is missing. */
  connectionEmail?: string;
}

export interface DeterministicInternalResult {
  category: "INTERNAL";
  summary: string;
  classifierVersion: "deterministic-v1";
  confidence: 1;
}

// ─── Rule ────────────────────────────────────────────────────────────────────

export function tryDeterministicInternal(
  input: DeterministicInternalInput
): DeterministicInternalResult | null {
  // Guard 1: empty participants (Array.every returns true on []; explicit guard)
  if (input.participants.length === 0) return null;

  // Guard 2: user has already chosen a category — respect their choice
  if (input.categoryManuallySet) return null;

  // Guard 3: forwarded thread — semantic content isn't from participants
  if (isForwardMarker(input.subject, input.firstMessageBody)) return null;

  // Guard 4: known-forwarder forwarding a form submission — this is a lead,
  // not an internal thread. sync-engine handles the lead creation; we just
  // need to NOT hide it under INTERNAL.
  if (
    isLikelyForwardedInquiry(
      input.senderEmail,
      input.subject,
      input.teamForwarders
    )
  ) {
    return null;
  }

  // Guard 5: every participant must resolve to a company user
  const resolvedNames: string[] = [];
  for (const participant of input.participants) {
    const email = extractEmailAddress(participant).toLowerCase().trim();
    if (!email) return null;

    const user =
      input.companyUsers.get(email) ??
      (input.connectionEmail?.toLowerCase().trim() === email
        ? {
            email,
            displayName: email.split("@")[0] ?? email,
          }
        : null);
    if (!user) return null;

    resolvedNames.push(user.displayName);
  }

  const summary = buildSummary(resolvedNames, input.subject);

  return {
    category: "INTERNAL",
    summary,
    classifierVersion: "deterministic-v1",
    confidence: 1,
  };
}

// ─── Summary template ────────────────────────────────────────────────────────

function buildSummary(resolvedNames: string[], subject: string): string {
  const shown = resolvedNames.slice(0, 3);
  const extra = Math.max(0, resolvedNames.length - shown.length);
  const who = shown.join(", ") + (extra > 0 ? ` +${extra}` : "");
  const topic = subject.trim() || "(no subject)";
  return `Internal thread between ${who} about ${topic}.`;
}

// ─── DB reads (called from classifyAndUpdate) ────────────────────────────────

/**
 * One-shot query for every user in the company plus their display name.
 * Called by EmailThreadService.classifyAndUpdate for each classification;
 * the fetch is small (~1KB per company) and parallelizes with the other
 * Promise.all reads already happening there.
 */
export async function loadCompanyUsers(
  companyId: string
): Promise<Map<string, CompanyUser>> {
  const supabase = requireSupabase();
  const { data: rows, error } = await supabase
    .from("users")
    .select("email, first_name, last_name")
    .eq("company_id", companyId);

  if (error) {
    console.error(
      "[deterministic-internal-rule] loadCompanyUsers failed:",
      error.message
    );
    return new Map();
  }

  const users = new Map<string, CompanyUser>();
  for (const row of rows ?? []) {
    const email = (row.email as string | null)?.toLowerCase().trim();
    if (!email) continue;
    const first = (row.first_name as string | null)?.trim() ?? "";
    const last = (row.last_name as string | null)?.trim() ?? "";
    const displayName =
      [first, last].filter(Boolean).join(" ") || email.split("@")[0] || email;
    users.set(email, { email, displayName });
  }
  return users;
}

/**
 * Team forwarders live inside email_connections.sync_filters (jsonb), which
 * is written by the pipeline import wizard. We look up the thread's owning
 * connection to read them.
 */
export async function loadTeamForwarders(
  connectionId: string
): Promise<string[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("email_connections")
    .select("sync_filters")
    .eq("id", connectionId)
    .maybeSingle();

  if (error || !data) return [];

  const filters = data.sync_filters as { teamForwarders?: string[] } | null;
  if (!filters || !Array.isArray(filters.teamForwarders)) return [];
  return filters.teamForwarders.filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
}
```

- [ ] **Step 4: Run the tests — expect green**

Run:
```bash
cd /c/OPS/ops-web && npx vitest run src/lib/api/services/__tests__/deterministic-internal-rule.test.ts
```

Expected: all tests PASS. If any fail, the rule logic doesn't match the spec — fix before committing.

- [ ] **Step 5: Type-check the whole project**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output after filtering the stale cache errors. Pre-existing `.next/types` errors are unrelated.

- [ ] **Step 6: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/utils/email-parsing.ts src/lib/api/services/known-platforms.ts src/lib/api/services/deterministic-internal-rule.ts && git commit -m "$(cat <<'EOF'
feat(track-b): add deterministic-internal-rule module

Ships the tryDeterministicInternal rule, its two supporting reads
(loadCompanyUsers, loadTeamForwarders), and the two shared predicates
(isForwardMarker, isLikelyForwardedInquiry) that previously lived
inline in sync-engine.ts. Takes the Task 1 unit tests green.

Not wired into classifyAndUpdate yet — that's Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Make the classifier emit a one-sentence summary on every thread

**Files:**
- Modify: `src/lib/api/services/thread-classifier-service.ts`

**Goal of this task:** Drop the `messageCount >= 10` gate from the classifier's summary generation. Every new classification produces a one-sentence summary. Downstream TypeScript is tightened: `ClassifyResult.aiSummary` becomes `string` (never null).

- [ ] **Step 1: Open `thread-classifier-service.ts` and locate the SYSTEM_PROMPT block**

Read `src/lib/api/services/thread-classifier-service.ts` lines 77–168. The section we're editing is the "AI SUMMARY — only if messageCount >= 10" block around lines 141–145 and the JSON shape comment at line 154–160.

- [ ] **Step 2: Replace the AI SUMMARY prompt section**

Change:

```ts
═══════════════════════════════════════════════════════════════
AI SUMMARY — only if messageCount >= 10
═══════════════════════════════════════════════════════════════

For long threads (10+ messages), produce a 1–2 sentence summary covering: who the thread is between, what it's about, and where it currently stands (awaiting quote, client signed off, vendor coordinating delivery, etc.). For shorter threads, return \`aiSummary: null\`.
```

to:

```ts
═══════════════════════════════════════════════════════════════
AI SUMMARY — one sentence, always
═══════════════════════════════════════════════════════════════

Produce a SINGLE sentence describing the current state of the conversation and what is owed by whom. Lead with the pending action if one exists. Target ≤120 characters. Never return null. Examples:

  - "Jane asked for cedar pricing; you owe her a quote by Fri Apr 25."
  - "Brent confirmed PO #4421 for $3,220, delivers Tue Apr 29."
  - "Your crew lead is asking whether to bring the spare trailer tomorrow."
  - "Marketing pitch from ACME Tools — no action needed."

For long threads (10+ messages) the sentence may capture the latest state only; we value scannability over completeness.
```

- [ ] **Step 3: Update the JSON shape comment in the prompt**

Change:
```ts
  "aiSummary": "..." | null,
```

to:
```ts
  "aiSummary": "...",  // one sentence, always non-empty
```

- [ ] **Step 4: Update `ClassifyResult.aiSummary` type**

Locate the `ClassifyResult` interface (around line 67). Change:

```ts
export interface ClassifyResult {
  threadId: string;
  primaryCategory: EmailThreadCategory;
  confidence: number;
  labels: EmailThreadLabel[];
  /** Populated only if messageCount >= 10. Null otherwise. */
  aiSummary: string | null;
  reasoning: string;
}
```

to:

```ts
export interface ClassifyResult {
  threadId: string;
  primaryCategory: EmailThreadCategory;
  confidence: number;
  labels: EmailThreadLabel[];
  /** One sentence describing conversation state + what's owed. Always populated. */
  aiSummary: string;
  reasoning: string;
}
```

- [ ] **Step 5: Update `parseResult` to enforce non-empty aiSummary with fallback**

Locate `parseResult` (around line 238). Change:

```ts
function parseResult(
  raw: Record<string, unknown>,
  threadId: string,
  messageCount: number
): ClassifyResult {
  const primaryCategory = validateCategory(raw.primaryCategory);
  const confidence = validateConfidence(raw.confidence);
  const labels = validateLabels(raw.labels);
  const aiSummary =
    messageCount >= 10 && typeof raw.aiSummary === "string" && raw.aiSummary.length > 0
      ? raw.aiSummary.slice(0, 500)
      : null;
  const reasoning =
    typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 200) : "";

  return {
    threadId,
    primaryCategory,
    confidence,
    labels,
    aiSummary,
    reasoning,
  };
}
```

to:

```ts
function parseResult(
  raw: Record<string, unknown>,
  threadId: string,
  messageCount: number
): ClassifyResult {
  void messageCount; // parameter retained for future heuristics
  const primaryCategory = validateCategory(raw.primaryCategory);
  const confidence = validateConfidence(raw.confidence);
  const labels = validateLabels(raw.labels);
  const rawSummary = typeof raw.aiSummary === "string" ? raw.aiSummary.trim() : "";
  const aiSummary =
    rawSummary.length > 0
      ? rawSummary.slice(0, 500)
      : `Thread classified as ${primaryCategory}.`; // defensive fallback if the model returns empty
  const reasoning =
    typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 200) : "";

  return {
    threadId,
    primaryCategory,
    confidence,
    labels,
    aiSummary,
    reasoning,
  };
}
```

- [ ] **Step 6: Update `fallbackResult` to return a non-null aiSummary**

Locate `fallbackResult` (around line 263). Change:

```ts
function fallbackResult(threadId: string): ClassifyResult {
  return {
    threadId,
    primaryCategory: "OTHER",
    confidence: 0.3,
    labels: [],
    aiSummary: null,
    reasoning: "classification_failed",
  };
}
```

to:

```ts
function fallbackResult(threadId: string): ClassifyResult {
  return {
    threadId,
    primaryCategory: "OTHER",
    confidence: 0.3,
    labels: [],
    aiSummary: "Classification unavailable — open the thread to read it directly.",
    reasoning: "classification_failed",
  };
}
```

- [ ] **Step 7: Type-check**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output. If `email-thread-service.ts` complains about passing `ClassifyResult.aiSummary` to `update.ai_summary`, the update will still work — the DB column is nullable — but we'll land that cleanup in Task 4.

- [ ] **Step 8: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/api/services/thread-classifier-service.ts && git commit -m "$(cat <<'EOF'
feat(track-b): always-on one-sentence thread summary from classifier

Drops the messageCount>=10 gate from aiSummary generation. Updates
the system prompt to request a single-sentence "current state + what's
owed" summary on every classification. parseResult now falls back to
a deterministic template if the model returns empty. ClassifyResult
type tightened: aiSummary is string, never null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the deterministic rule into `classifyAndUpdate`

**Files:**
- Modify: `src/lib/api/services/email-thread-service.ts`

**Goal of this task:** Inside `classifyAndUpdate`, load `companyUsers` + `teamForwarders` in parallel with the existing reads, try the deterministic rule first, and short-circuit the OpenAI call when it fires. Otherwise fall through to the existing classifier path.

- [ ] **Step 1: Open the file and locate the imports block**

Read `src/lib/api/services/email-thread-service.ts` lines 1–40 to find the existing imports. We'll add a new import near the other service imports.

- [ ] **Step 2: Add the import for the deterministic rule**

Add this line to the imports:

```ts
import {
  tryDeterministicInternal,
  loadCompanyUsers,
  loadTeamForwarders,
} from "./deterministic-internal-rule";
```

- [ ] **Step 3: Locate the `classifyAndUpdate` method**

Read lines 603–695. The structure is:
1. Fetch last 5 messages from `activities`
2. `Promise.all` for learnedRules + senderIsNew
3. Call `ThreadClassifier.classifyThread`
4. Merge labels with heuristics
5. Build `update` object and write

We'll insert the deterministic rule between step 2 and step 3.

- [ ] **Step 4: Expand the Promise.all to load companyUsers + teamForwarders**

Change lines 637–643:

```ts
    const senderEmail = threadRow.latestSenderEmail;
    const senderDomain = domainOf(senderEmail);

    const [learned, senderIsNew] = await Promise.all([
      loadLearnedRules(threadRow.companyId, senderEmail, senderDomain),
      senderEmail ? senderHasPriorConversations(threadRow.companyId, senderEmail).then((v) => !v) : Promise.resolve(false),
    ]);
```

to:

```ts
    const senderEmail = threadRow.latestSenderEmail;
    const senderDomain = domainOf(senderEmail);

    const [learned, senderIsNew, companyUsers, teamForwarders] =
      await Promise.all([
        loadLearnedRules(threadRow.companyId, senderEmail, senderDomain),
        senderEmail
          ? senderHasPriorConversations(threadRow.companyId, senderEmail).then(
              (v) => !v
            )
          : Promise.resolve(false),
        loadCompanyUsers(threadRow.companyId),
        loadTeamForwarders(threadRow.connectionId),
      ]);
```

- [ ] **Step 5: Read the connection's email for the fallback (belt-and-suspenders)**

Add this immediately after the Promise.all (just before the deterministic-rule try-block added in the next step):

```ts
    // Used as a fallback when the connection owner's users row is missing.
    const { data: connectionRow } = await supabase
      .from("email_connections")
      .select("email")
      .eq("id", threadRow.connectionId)
      .maybeSingle();
    const connectionEmail =
      (connectionRow?.email as string | null)?.toLowerCase().trim() ?? undefined;
```

- [ ] **Step 6: Attempt the deterministic rule before calling the classifier**

After the block added in Step 5 and before the `const outboundCount` line (originally at line 645), insert:

```ts
    // ── Deterministic INTERNAL classification ──────────────────────────
    // When every participant of the thread is a company user (and the
    // thread isn't a forward), we skip the LLM and write the result
    // directly. Manual corrections are respected by the rule itself.
    const firstMessageBody =
      messages[0]?.bodyText ?? messages[messages.length - 1]?.bodyText ?? "";
    const deterministic = tryDeterministicInternal({
      subject: threadRow.subject,
      firstMessageBody,
      participants: threadRow.participants,
      senderEmail,
      categoryManuallySet: threadRow.categoryManuallySet,
      companyUsers,
      teamForwarders,
      connectionEmail,
    });

    if (deterministic) {
      const update: Record<string, unknown> = {
        labels: threadRow.labels, // preserve any existing labels
        ai_summary: deterministic.summary,
        category_classified_at: new Date().toISOString(),
        category_classifier_version: deterministic.classifierVersion,
        primary_category: deterministic.category,
        category_confidence: deterministic.confidence,
      };

      const { data: updated, error: detErr } = await supabase
        .from("email_threads")
        .update(update)
        .eq("id", threadRow.id)
        .select("*")
        .single();

      if (detErr) {
        console.error(
          "[email-thread-service] deterministic-internal update failed:",
          detErr
        );
        return threadRow;
      }
      return mapEmailThreadFromDb(updated);
    }
```

- [ ] **Step 7: Verify downstream `update.ai_summary` assignment still compiles**

The existing line 669 is:

```ts
      ai_summary: result.aiSummary,
```

Since `result.aiSummary` is now `string` (never null) after Task 3, this assignment is still valid. No change needed, but confirm by reading the file.

- [ ] **Step 8: Type-check**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 9: Run ALL unit tests**

Run:
```bash
cd /c/OPS/ops-web && npx vitest run
```

Expected: all pass. The deterministic-internal-rule tests from Task 1 continue to pass (pure functions, untouched). No existing test should have regressed — `email-thread-service.ts` has no unit tests today, and the changes are additive (deterministic rule runs first, else falls through unchanged).

- [ ] **Step 10: Commit**

```bash
cd /c/OPS/ops-web && git add src/lib/api/services/email-thread-service.ts && git commit -m "$(cat <<'EOF'
feat(track-b): wire tryDeterministicInternal into classifyAndUpdate

Adds loadCompanyUsers + loadTeamForwarders to the existing Promise.all
in classifyAndUpdate. When the deterministic rule fires, write the
row with category_classifier_version='deterministic-v1' and skip the
OpenAI call entirely. Preserves existing labels on the row (the LLM
classifier merges labels but the deterministic path has no new ones
to add).

When the rule returns null, falls through to the unchanged LLM
classifier path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Simplify the thread detail view summary block

**Files:**
- Modify: `src/components/ops/inbox/thread-detail-view.tsx`

**Goal of this task:** Drop the `messageCount >= 10` gate in the summary render. The block now shows whenever `aiSummary` is truthy (which is "every newly-classified thread" going forward, and whatever's already populated on old rows). Also drop the now-unnecessary expand/collapse for a one-sentence summary.

- [ ] **Step 1: Open the file and locate the AI summary block**

Read `src/components/ops/inbox/thread-detail-view.tsx` lines 653–682. Current code:

```tsx
      {/* ─── AI summary ────────────────────────────────────────────────── */}
      {(aiSummary || messageCount >= 10) && aiSummary && (
        <div className="shrink-0 px-3 py-2 border-b border-border-subtle bg-[rgba(111,148,176,0.04)]">
          <div className="flex items-start gap-2">
            <Sparkles className="w-[12px] h-[12px] text-ops-accent shrink-0 mt-[3px]" strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
                // {t("thread.aiSummary") ?? "AI summary"}
              </p>
              <p
                className={cn(
                  "font-mohave text-[12.5px] text-text-2 mt-0.5 leading-snug",
                  !showFullSummary && "line-clamp-2"
                )}
              >
                {aiSummary}
              </p>
              {aiSummary.length > 200 && (
                <button
                  type="button"
                  onClick={() => setShowFullSummary((v) => !v)}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute hover:text-text-2 mt-1 transition-colors"
                >
                  {showFullSummary ? "Collapse" : "Expand"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 2: Replace with the simplified one-sentence render**

Change the block above to:

```tsx
      {/* ─── AI summary — one sentence, current state of the thread ──── */}
      {aiSummary && (
        <div className="shrink-0 px-3 py-2 border-b border-border-subtle bg-[rgba(111,148,176,0.04)]">
          <div className="flex items-start gap-2">
            <Sparkles
              className="w-[12px] h-[12px] text-ops-accent shrink-0 mt-[3px]"
              strokeWidth={1.75}
            />
            <p className="font-mohave text-[12.5px] text-text-2 leading-snug min-w-0 flex-1">
              {aiSummary}
            </p>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Remove the now-unused `showFullSummary` state**

Scroll up to find the state declaration (around line 342):

```tsx
  const [showFullSummary, setShowFullSummary] = useState(false);
```

Delete this line. `setShowFullSummary` was only used by the Expand/Collapse button, which we just removed.

- [ ] **Step 4: Check if `useState` is still needed for other state in this file**

Run:
```bash
cd /c/OPS/ops-web && grep -n "useState" src/components/ops/inbox/thread-detail-view.tsx
```

Expected: multiple lines still referencing `useState` (for `recatOpen`, `snoozeOpen`). No import change needed. If the grep returns only the imports line and no in-code usage, remove `useState` from the React import line — but this is highly unlikely.

- [ ] **Step 5: Type-check**

Run:
```bash
cd /c/OPS/ops-web && npm run type-check 2>&1 | grep -vE "\.next/types"
```

Expected: no output.

- [ ] **Step 6: Lint**

Run:
```bash
cd /c/OPS/ops-web && npm run lint 2>&1 | grep -E "thread-detail-view" | head -5
```

Expected: no new errors on this file. Pre-existing warnings (if any) are acceptable.

- [ ] **Step 7: Commit**

```bash
cd /c/OPS/ops-web && git add src/components/ops/inbox/thread-detail-view.tsx && git commit -m "$(cat <<'EOF'
refactor(inbox): simplify AI summary block for always-on one-sentence summary

Drops the messageCount>=10 gate (summaries now always present for new
threads), removes the expand/collapse affordance (one sentence doesn't
need it), removes the // AI summary pseudo-label (single sentence with
sparkle icon is self-explanatory). Removes unused showFullSummary state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

**Goal of this task:** Confirm the whole pipeline works against real email data.

- [ ] **Step 1: Start the dev server and sign in**

```bash
cd /c/OPS/ops-web && npm run dev
```

Open `http://localhost:3000/inbox` and sign in to a test account with an existing email connection.

- [ ] **Step 2: Trigger a manual sync**

In the dev UI, navigate to Settings → Email Integrations and click "Sync now" (or equivalent). Wait for the sync to complete.

- [ ] **Step 3: Open the browser devtools Network tab and watch for classification calls**

Filter requests by `api.openai.com`. For each new thread processed during the sync, you should see one OpenAI call UNLESS the thread is classified INTERNAL by the deterministic rule.

- [ ] **Step 4: Verify a known-internal thread**

Find (or send) a thread where every participant is on the company domain with no "Fwd:" in the subject. In Supabase SQL editor:

```sql
SELECT id, subject, primary_category, category_confidence, category_classifier_version, ai_summary
FROM email_threads
WHERE subject ILIKE '%<the known-internal subject>%'
ORDER BY last_message_at DESC
LIMIT 5;
```

Expected row values:
- `primary_category = 'INTERNAL'`
- `category_confidence = 1`
- `category_classifier_version = 'deterministic-v1'`
- `ai_summary` starts with `"Internal thread between "` and contains the subject

- [ ] **Step 5: Verify a normal external thread (LEAD/CLIENT/VENDOR)**

Pick a recently-synced thread from an external sender. In Supabase:

```sql
SELECT id, subject, primary_category, category_confidence, category_classifier_version, ai_summary
FROM email_threads
WHERE id = '<the thread id>'
LIMIT 1;
```

Expected row values:
- `primary_category` is NOT `INTERNAL` (unless the thread's content truly is internal-ish — but a vendor thread should NOT be)
- `category_classifier_version = 'v1'` (LLM path)
- `ai_summary` is a one-sentence string (non-empty, non-null)

- [ ] **Step 6: Verify a forwarded inquiry (Jared's case)**

Pick a thread where a team member forwarded an external inquiry (subject starts with "Fwd:" or body has the forward marker, all participants are company users).

```sql
SELECT id, subject, primary_category, category_classifier_version, ai_summary
FROM email_threads
WHERE id = '<the forwarded thread id>'
LIMIT 1;
```

Expected row values:
- `category_classifier_version = 'v1'` (went through the LLM — the forward guard bailed the deterministic rule)
- `primary_category` matches the LLM's reading of the FORWARDED content (likely `LEAD` if it's a website inquiry)
- `ai_summary` describes the forwarded content's state

- [ ] **Step 7: Visual check in the inbox UI**

Open several threads in `/inbox`. For every thread, verify:
- A single-sentence summary appears at the top of the thread detail view (below the Phase C strip)
- The summary is one readable sentence, not multiple paragraphs
- The Sparkles icon renders in the accent color
- No "AI summary" pseudo-label text appears
- No Expand/Collapse button appears

- [ ] **Step 8: Verify a pre-existing short thread has no summary**

Pick a thread synced BEFORE this change landed (messageCount < 10, original `ai_summary = NULL`). Confirm:
- The summary block does not render for this thread (graceful hide)
- The thread is still usable — all other panels work normally

- [ ] **Step 9: Stop the dev server**

`Ctrl+C` in the terminal.

- [ ] **Step 10: No commit**

No files changed in this task.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|--------------|------|
| `tryDeterministicInternal` interface + rule logic | Task 2 (Step 3) |
| All-participants-match rule | Task 2 (rule Guard 5) + Task 1 (happy-path tests) |
| Manual-correction guard | Task 2 (Guard 2) + Task 1 tests |
| Forward subject/body guard | Task 2 (Guard 3) via `isForwardMarker` (Step 1) + Task 1 tests |
| Known-forwarder + form-subject guard | Task 2 (Guard 4) via `isLikelyForwardedInquiry` (Step 2) + Task 1 tests |
| Empty-participants guard | Task 2 (Guard 1) + Task 1 test |
| Deterministic summary template | Task 2 (`buildSummary`) + Task 1 tests |
| `loadCompanyUsers` helper | Task 2 (Step 3) |
| `loadTeamForwarders` helper (reads `email_connections.sync_filters`) | Task 2 (Step 3) |
| Belt-and-suspenders `connectionEmail` fallback | Task 2 (rule Guard 5) + Task 1 test |
| Promise.all integration in `classifyAndUpdate` | Task 4 (Step 4) |
| Deterministic rule short-circuits the OpenAI call | Task 4 (Step 6) |
| `category_classifier_version='deterministic-v1'` on deterministic rows | Task 4 (Step 6) |
| `category_confidence=1` on deterministic rows | Task 4 (Step 6) |
| Always-on `aiSummary` in classifier output | Task 3 (Steps 2, 4–6) |
| System prompt update removing 10+ threshold | Task 3 (Step 2) |
| `ClassifyResult.aiSummary: string` (never null) | Task 3 (Step 4) |
| Defensive fallback when model returns empty | Task 3 (Step 5) |
| UI: drop messageCount gate | Task 5 (Step 2) |
| UI: simplify to one-sentence render | Task 5 (Step 2) |
| No backfill | Honored — no migration script in any task |
| End-to-end verification plan | Task 6 |

All spec sections have implementing tasks.

**Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" without code. Every code step shows the exact before/after. Every command shows the exact invocation and expected output.

**Type consistency:** `CompanyUser`, `DeterministicInternalInput`, `DeterministicInternalResult`, `tryDeterministicInternal`, `loadCompanyUsers`, `loadTeamForwarders` defined in Task 2 Step 3 and referenced by the same names in Task 4. `isForwardMarker` exported from Task 2 Step 1 and imported by Task 2 Step 3. `isLikelyForwardedInquiry` exported from Task 2 Step 2 and imported by Task 2 Step 3. `ClassifyResult.aiSummary` type flipped in Task 3 Step 4 is consumed in Task 4 Step 7 (no change required because the type narrowed).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-track-b-deterministic-internal-and-thread-summary.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

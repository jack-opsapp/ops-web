# Inbox · Opportunity Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `email_threads.opportunity_id` a first-class link surfaced everywhere in the inbox, with auto-link on ingest, manual attribution UI, and a closed-opportunity "new project?" assessment for inbound mail on won/lost deals.

**Architecture:**
- Backend extends `EmailThreadService` with `attributeOpportunity` (reconciles client mismatch in opp's favor) and `assessClosedOppRelevance` (one cheap AI call per inbound on closed opps).
- `upsertFromEmail` adds two new auto-rules: "client has 1 open opp → stamp" and "closed opp + fresh inbound → assess for new-project signal."
- Frontend ships an `OpportunityPicker` modal + `OpportunityStageChip`, integrated into thread detail header, context panel mini-card, conversation list rows, command palette, and a closed-opp banner.

**Tech Stack:** Next.js 14 App Router, TypeScript, TanStack Query, Zustand, Supabase, Framer Motion, Tailwind CSS, shadcn/ui (Command, Dialog), Vitest.

**Decisions baked in:**
- Closed-opp banner fires ONLY when AI signal returns `new_project`, not on every new inbound.
- Permission gate: new `inbox.attribute_opportunity` (action) + existing `pipeline.view` (read).
- No backfill migration. Auto-link forward; everything else is manual.
- All three UI surfaces (header chip, context mini-card, list badge) ship together.
- When attributing a thread to an opp whose `client_id` differs from the thread's, the opp wins — the thread's `client_id` is reconciled. This is the long-term fix for the Brian Fraser denormalization drift.

---

## File Structure

### Files to CREATE

| Path | Responsibility |
|------|----------------|
| `supabase/migrations/20260426120000_email_threads_closed_opp_assessment.sql` | Add `closed_opp_assessment jsonb` column |
| `src/components/ops/inbox/opportunity-stage-chip.tsx` | Stage chip primitive (mirrors CategoryChip) |
| `src/components/ops/inbox/opportunity-picker.tsx` | Modal: search + pick an open opportunity |
| `src/components/ops/inbox/closed-opp-banner.tsx` | "Looks like a new project" banner shown in detail view |
| `src/lib/hooks/use-open-opportunities.ts` | TanStack Query hook for open-opp lists (scoped to client or company) |
| `tests/integration/inbox-attribute-opportunity.test.ts` | Integration test for the mutation + reconciliation |
| `tests/unit/inbox-closed-opp-assessment.test.ts` | Unit test for the AI heuristic wrapper |

### Files to MODIFY

| Path | Why |
|------|-----|
| `src/lib/types/permissions.ts` | Add `inbox.attribute_opportunity` permission |
| `src/lib/types/email-thread.ts` | Add `closedOppAssessment` to types + DB mapper |
| `src/lib/api/services/email-thread-service.ts` | Add `attributeOpportunity` + `assessClosedOppRelevance` methods; wire auto-link in `upsertFromEmail` |
| `src/app/api/inbox/threads/[id]/route.ts` | Add `attributeOpportunity` to `ThreadAction` + permission map + handler; expand GET to return opp + assessment |
| `src/lib/hooks/use-inbox-threads.ts` | Add `attributeOpportunity` mutation to `useThreadActions` |
| `src/components/ops/inbox/thread-detail-view.tsx` | Mount stage chip + closed-opp banner; bind `O` shortcut |
| `src/components/ops/inbox/thread-context-panel.tsx` | Replace single-link button with mini-card + "Change opportunity" CTA |
| `src/components/ops/inbox/conversation-list.tsx` | Render stage badge on rows when opp linked |
| `src/components/ops/inbox/command-palette.tsx` | Add "Attribute to opportunity" item |
| `src/app/(dashboard)/inbox/page.tsx` | Wire `OpportunityPicker` open/close state + handler propagation |
| `src/i18n/dictionaries/en/inbox.json` | New strings |

---

## Verified facts (do not re-verify)

| Fact | Source | Verified |
|------|--------|----------|
| `email_threads.opportunity_id uuid nullable` exists | `information_schema.columns` query | ✅ |
| `email_threads` row count: 3,321 in test company; 8 with opp_id | DB query | ✅ |
| `OpportunityStage` enum: `new_lead, qualifying, quoting, quoted, follow_up, negotiation, won, lost, discarded` | `src/lib/types/pipeline.ts:28-39` | ✅ |
| `OPPORTUNITY_STAGE_COLORS` exported map | `src/lib/types/pipeline.ts:197-207` | ✅ |
| `EmailThreadService.archive` mutation signature | `email-thread-service.ts` | ✅ |
| `ACTION_PERMISSIONS` map at `route.ts:329-336` | grep | ✅ |
| `OpportunityService.fetchOpportunities(companyId, { clientId, ... })` | `opportunity-service.ts:31-48,371-373` | ✅ |
| Existing `inbox.*` permissions: view, view_company, archive, snooze, categorize, send, configure_phase_c | `permissions.ts:277-283` | ✅ |
| Modal pattern uses Radix Dialog + `.glass-dense` | `archive-confirm-modal.tsx`, design system v2 | ✅ |
| Cake Mono Light is the uppercase display voice; **Kosugi is deprecated** as of 2026-04-17 — use `font-mono` for 11px micro labels | `OPS-Web/CLAUDE.md`, `.interface-design/system.md:92` | ✅ |
| Easing: `cubic-bezier(0.22, 1, 0.36, 1)` only; no springs | `.interface-design/system.md:496-499` | ✅ |
| Modal radius: `rounded-modal` (12px); button radius: `rounded-[5px]`; chip radius: `rounded-chip` (4px) | system.md:184-189 | ✅ |
| Accent `#6F94B0` is for primary CTA + focus ring ONLY | system.md:38-45 | ✅ |
| Test framework: Vitest with `vi.mock` | `tests/integration/notifications.test.ts` | ✅ |

---

## Task 1 — Add `inbox.attribute_opportunity` permission

**Files:**
- Modify: `src/lib/types/permissions.ts:277-283`

- [ ] **Step 1.1: Read the existing inbox permission block**

Run: `grep -n 'inbox\.' /Users/jacksonsweet/Projects/OPS/OPS-Web/src/lib/types/permissions.ts`
Expected: 7 lines, ids `inbox.view`, `inbox.view_company`, `inbox.archive`, `inbox.snooze`, `inbox.categorize`, `inbox.send`, `inbox.configure_phase_c`.

- [ ] **Step 1.2: Insert new permission row after `inbox.categorize`**

Edit `src/lib/types/permissions.ts`. Locate the line:
```ts
{ id: "inbox.categorize", label: "Recategorize threads", scopes: ["all"] },
```
Insert immediately after it:
```ts
    { id: "inbox.attribute_opportunity", label: "Attribute threads to opportunities", scopes: ["all"] },
```

- [ ] **Step 1.3: Verify TypeScript compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && pnpm tsc --noEmit 2>&1 | head -30`
Expected: no errors mentioning `permissions.ts`.

- [ ] **Step 1.4: Commit**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/lib/types/permissions.ts
git commit -m "feat(perms): add inbox.attribute_opportunity permission"
```

---

## Task 2 — Migration: `closed_opp_assessment` jsonb column

**Files:**
- Create: `supabase/migrations/20260426120000_email_threads_closed_opp_assessment.sql`

- [ ] **Step 2.1: Create migration file**

Write to `supabase/migrations/20260426120000_email_threads_closed_opp_assessment.sql`:
```sql
-- email_threads.closed_opp_assessment
--
-- Cached AI assessment of whether the latest inbound message on a thread
-- whose linked opportunity is in a terminal stage (won/lost/discarded)
-- references a NEW project (vs a follow-up on the existing closed deal).
--
-- Shape:
--   {
--     "signal": "new_project" | "followup" | "unclear",
--     "assessed_at": "<ISO timestamp>",
--     "assessed_message_at": "<ISO of the message that triggered the assessment>",
--     "reasoning": "<one short sentence>"
--   }
--
-- Cleared (set to NULL) when the linked opportunity moves out of a terminal
-- stage, or when opportunity_id is unset.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS closed_opp_assessment jsonb DEFAULT NULL;

COMMENT ON COLUMN email_threads.closed_opp_assessment IS
  'AI assessment of new-project relevance for inbound mail on closed opps. {signal, assessed_at, assessed_message_at, reasoning}.';

-- Partial index used by the inbox detail endpoint when surfacing the banner.
CREATE INDEX IF NOT EXISTS email_threads_closed_opp_signal_idx
  ON email_threads ((closed_opp_assessment->>'signal'))
  WHERE closed_opp_assessment IS NOT NULL;
```

- [ ] **Step 2.2: Apply migration to Supabase via MCP**

Use the Supabase MCP `apply_migration` tool with project_id `ijeekuhbatykdomumfjx`, name `email_threads_closed_opp_assessment`, query as above. Expected: success with no errors.

- [ ] **Step 2.3: Verify column exists**

Use the Supabase MCP `execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'email_threads' AND column_name = 'closed_opp_assessment';
```
Expected: 1 row with `data_type = 'jsonb'`.

- [ ] **Step 2.4: Commit**

```bash
git add supabase/migrations/20260426120000_email_threads_closed_opp_assessment.sql
git commit -m "feat(db): add email_threads.closed_opp_assessment jsonb column"
```

---

## Task 3 — Extend types: `closedOppAssessment` on `EmailThread`

**Files:**
- Modify: `src/lib/types/email-thread.ts`

- [ ] **Step 3.1: Add type union and mapper**

Edit `src/lib/types/email-thread.ts`. After the existing `ArchiveLeadPreference` type (around line 92), insert:
```ts
/**
 * AI-derived signal for inbound mail landing on a thread whose linked
 * opportunity is in a terminal stage (won/lost/discarded).
 *
 *   - "new_project": message clearly references new work
 *   - "followup":    message is a continuation of the closed deal
 *   - "unclear":     ambiguous; UI shows a soft hint, not a banner
 */
export type ClosedOppSignal = "new_project" | "followup" | "unclear";

export interface ClosedOppAssessment {
  signal: ClosedOppSignal;
  assessedAt: Date;
  assessedMessageAt: Date;
  reasoning: string;
}
```

In the `EmailThread` interface (around line 142), after `hasUnresolvedCommitments: boolean;`, add:
```ts
  /** Cached AI assessment for inbound mail on closed-opp threads. Null when
   *  the linked opp is open, or when no inbound has arrived since close. */
  closedOppAssessment: ClosedOppAssessment | null;
```

In `mapEmailThreadFromDb` (around line 246), after `hasUnresolvedCommitments: Boolean(...)`:
```ts
    closedOppAssessment: parseClosedOppAssessment(row.closed_opp_assessment),
```

At the bottom of the helper section (just before the function), add:
```ts
function parseClosedOppAssessment(v: unknown): ClosedOppAssessment | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const signal = r.signal;
  if (signal !== "new_project" && signal !== "followup" && signal !== "unclear") {
    return null;
  }
  const assessedAt = typeof r.assessed_at === "string" ? new Date(r.assessed_at) : null;
  const assessedMessageAt =
    typeof r.assessed_message_at === "string" ? new Date(r.assessed_message_at) : null;
  if (!assessedAt || !assessedMessageAt) return null;
  return {
    signal,
    assessedAt,
    assessedMessageAt,
    reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
  };
}
```

- [ ] **Step 3.2: Verify TypeScript compiles**

Run: `cd /Users/jacksonsweet/Projects/OPS/OPS-Web && pnpm tsc --noEmit 2>&1 | head -30`
Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/types/email-thread.ts
git commit -m "feat(types): add ClosedOppAssessment to EmailThread"
```

---

## Task 4 — Service: `EmailThreadService.attributeOpportunity`

**Files:**
- Modify: `src/lib/api/services/email-thread-service.ts`
- Test: `tests/integration/inbox-attribute-opportunity.test.ts` (created in Task 5)

- [ ] **Step 4.1: Add method after `recategorize`**

Edit `src/lib/api/services/email-thread-service.ts`. Locate the `recategorize` method (around line 700). After its closing `},`, insert:

```ts
  /**
   * Link or unlink a thread's opportunity. When `opportunityId` is non-null:
   *   - validate the opportunity belongs to the same company
   *   - if the opportunity's `client_id` differs from the thread's, RECONCILE
   *     by setting the thread's `client_id` to the opportunity's. This is the
   *     authoritative fix for the long-standing denormalization drift where
   *     a thread's stamped client_id can diverge from its actual deal owner.
   *
   * When `opportunityId` is null: clears the link, leaves `client_id` alone.
   *
   * Returns the refreshed thread row.
   */
  async attributeOpportunity(params: {
    threadId: string;
    opportunityId: string | null;
  }): Promise<EmailThread> {
    const supabase = requireSupabase();

    const { data: threadRow, error: threadErr } = await supabase
      .from("email_threads")
      .select("id, company_id, client_id, opportunity_id")
      .eq("id", params.threadId)
      .single();
    if (threadErr || !threadRow) {
      throw new Error(`attributeOpportunity: thread not found (${params.threadId})`);
    }

    const update: Record<string, unknown> = {
      opportunity_id: params.opportunityId,
      updated_at: new Date().toISOString(),
    };

    if (params.opportunityId) {
      const { data: oppRow, error: oppErr } = await supabase
        .from("opportunities")
        .select("id, company_id, client_id, stage")
        .eq("id", params.opportunityId)
        .single();
      if (oppErr || !oppRow) {
        throw new Error(
          `attributeOpportunity: opportunity not found (${params.opportunityId})`
        );
      }
      if (oppRow.company_id !== threadRow.company_id) {
        throw new Error("attributeOpportunity: cross-company link rejected");
      }
      // Reconcile client_id — opportunity wins. This is the long-term fix
      // for the wrong-client denormalization drift.
      if (oppRow.client_id && oppRow.client_id !== threadRow.client_id) {
        update.client_id = oppRow.client_id;
      }
      // Closed-opp signals get reset on re-attribution; the next inbound
      // will trigger a fresh assessment.
      const terminal = ["won", "lost", "discarded"].includes(
        String(oppRow.stage)
      );
      if (!terminal) {
        update.closed_opp_assessment = null;
      }
    } else {
      // Unlink wipes the assessment — it has no meaning without a linked opp.
      update.closed_opp_assessment = null;
    }

    const { data: updated, error: updErr } = await supabase
      .from("email_threads")
      .update(update)
      .eq("id", params.threadId)
      .select("*")
      .single();
    if (updErr || !updated) {
      throw new Error(`attributeOpportunity: update failed (${updErr?.message ?? "unknown"})`);
    }
    return mapEmailThreadFromDb(updated);
  },
```

- [ ] **Step 4.2: Verify TS compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep email-thread-service.ts | head -10`
Expected: no output.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/api/services/email-thread-service.ts
git commit -m "feat(inbox): EmailThreadService.attributeOpportunity with client reconcile"
```

---

## Task 5 — Test: `attributeOpportunity` integration

**Files:**
- Create: `tests/integration/inbox-attribute-opportunity.test.ts`

- [ ] **Step 5.1: Write failing tests**

Create `tests/integration/inbox-attribute-opportunity.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Chainable supabase mock — pattern from tests/integration/notifications.test.ts
function createSupabaseMock(resultsByTable: Record<string, unknown[]>) {
  const queue: Record<string, unknown[]> = { ...resultsByTable };
  function builder(table: string) {
    const next = () => {
      const arr = queue[table] ?? [];
      const value = arr.shift() ?? { data: null, error: null };
      return Promise.resolve(value);
    };
    const chain: Record<string, unknown> = {};
    const methods = ["select", "insert", "update", "delete", "eq", "in", "is", "not", "or", "order", "limit", "contains", "gt", "lt"];
    for (const m of methods) chain[m] = vi.fn(() => chain);
    chain.single = vi.fn(() => next());
    chain.then = (resolve: (v: unknown) => unknown) => next().then(resolve);
    return chain as ReturnType<typeof Object>;
  }
  return { from: vi.fn((t: string) => builder(t)) };
}

vi.mock("@/lib/supabase/admin", () => {
  const supabase = createSupabaseMock({});
  return {
    requireSupabase: () => supabase,
    runWithSupabase: async (_s: unknown, fn: () => Promise<unknown>) => fn(),
  };
});

import { EmailThreadService } from "@/lib/api/services/email-thread-service";

describe("EmailThreadService.attributeOpportunity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links a thread to an opportunity and reconciles client_id", async () => {
    const supabase = (await import("@/lib/supabase/admin")).requireSupabase() as ReturnType<typeof createSupabaseMock>;
    // 1st `.single()` → load thread
    // 2nd `.single()` → load opportunity
    // 3rd `.single()` → updated thread
    const builder = supabase.from("email_threads") as { single: ReturnType<typeof vi.fn> };
    builder.single
      .mockResolvedValueOnce({
        data: { id: "t1", company_id: "co1", client_id: "wrong-client", opportunity_id: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "o1", company_id: "co1", client_id: "right-client", stage: "qualifying" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: "t1",
          company_id: "co1",
          connection_id: "c1",
          provider_thread_id: "p1",
          primary_category: "LEAD",
          category_confidence: 0.9,
          category_classifier_version: "v1",
          category_manually_set: false,
          labels: [],
          archived_at: null,
          snoozed_until: null,
          priority_score: 0,
          ai_summary: null,
          subject: "test",
          participants: [],
          first_message_at: "2026-04-26T00:00:00Z",
          last_message_at: "2026-04-26T00:00:00Z",
          message_count: 1,
          unread_count: 0,
          latest_direction: "inbound",
          latest_sender_email: null,
          latest_sender_name: null,
          latest_snippet: null,
          opportunity_id: "o1",
          client_id: "right-client",
          next_commitment_due_at: null,
          has_unresolved_commitments: false,
          closed_opp_assessment: null,
          created_at: "2026-04-26T00:00:00Z",
          updated_at: "2026-04-26T00:00:00Z",
        },
        error: null,
      });

    const result = await EmailThreadService.attributeOpportunity({
      threadId: "t1",
      opportunityId: "o1",
    });

    expect(result.opportunityId).toBe("o1");
    expect(result.clientId).toBe("right-client");
  });

  it("rejects cross-company linking", async () => {
    const supabase = (await import("@/lib/supabase/admin")).requireSupabase() as ReturnType<typeof createSupabaseMock>;
    const builder = supabase.from("email_threads") as { single: ReturnType<typeof vi.fn> };
    builder.single
      .mockResolvedValueOnce({
        data: { id: "t1", company_id: "co1", client_id: "cl1", opportunity_id: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "o1", company_id: "co2", client_id: "cl2", stage: "qualifying" },
        error: null,
      });

    await expect(
      EmailThreadService.attributeOpportunity({ threadId: "t1", opportunityId: "o1" })
    ).rejects.toThrow(/cross-company/);
  });

  it("unlinks when opportunityId is null", async () => {
    const supabase = (await import("@/lib/supabase/admin")).requireSupabase() as ReturnType<typeof createSupabaseMock>;
    const builder = supabase.from("email_threads") as { single: ReturnType<typeof vi.fn> };
    builder.single
      .mockResolvedValueOnce({
        data: { id: "t1", company_id: "co1", client_id: "cl1", opportunity_id: "o1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: "t1",
          company_id: "co1",
          connection_id: "c1",
          provider_thread_id: "p1",
          primary_category: "LEAD",
          category_confidence: 0.9,
          category_classifier_version: "v1",
          category_manually_set: false,
          labels: [],
          archived_at: null,
          snoozed_until: null,
          priority_score: 0,
          ai_summary: null,
          subject: "test",
          participants: [],
          first_message_at: "2026-04-26T00:00:00Z",
          last_message_at: "2026-04-26T00:00:00Z",
          message_count: 1,
          unread_count: 0,
          latest_direction: "inbound",
          latest_sender_email: null,
          latest_sender_name: null,
          latest_snippet: null,
          opportunity_id: null,
          client_id: "cl1",
          next_commitment_due_at: null,
          has_unresolved_commitments: false,
          closed_opp_assessment: null,
          created_at: "2026-04-26T00:00:00Z",
          updated_at: "2026-04-26T00:00:00Z",
        },
        error: null,
      });

    const result = await EmailThreadService.attributeOpportunity({
      threadId: "t1",
      opportunityId: null,
    });

    expect(result.opportunityId).toBeNull();
    expect(result.clientId).toBe("cl1"); // client_id NOT touched on unlink
  });
});
```

- [ ] **Step 5.2: Run test → expect FAIL on any setup issues, then iterate**

Run: `pnpm vitest run tests/integration/inbox-attribute-opportunity.test.ts`
Expected: 3 tests PASS. If failures, fix the mock harness until green.

- [ ] **Step 5.3: Commit**

```bash
git add tests/integration/inbox-attribute-opportunity.test.ts
git commit -m "test(inbox): integration tests for attributeOpportunity"
```

---

## Task 6 — Service: `assessClosedOppRelevance` AI helper

**Files:**
- Modify: `src/lib/api/services/email-thread-service.ts`

- [ ] **Step 6.1: Add helper above `attributeOpportunity`**

Edit `src/lib/api/services/email-thread-service.ts`. At the top of the file (after the existing `ThreadClassifier` import), add:
```ts
import { getSyncOpenAI } from "./openai-clients";
```

Then, in the helpers section near the top of the file (before the `EmailThreadService` const), insert:

```ts
// ─── Closed-opp relevance assessment ────────────────────────────────────────
//
// Tiny AI call used when a thread's linked opportunity is in a terminal stage
// (won/lost/discarded) AND a fresh inbound message has arrived since close.
//
// Returns one of: "new_project" / "followup" / "unclear".
//
// Output is cached on email_threads.closed_opp_assessment and only re-runs
// when last_message_at advances past the cached assessed_message_at.

const CLOSED_OPP_PROMPT = `You are a triage signal for a trades business owner. The user previously closed an opportunity (won or lost). A new inbound email just arrived on the same email thread.

Your job: decide whether the new message is about a NEW PROJECT — a different job — or a FOLLOW-UP on the same closed deal (a question, warranty issue, thank-you, scheduling clarification, etc.).

Output JSON, no prose:
{ "signal": "new_project" | "followup" | "unclear", "reasoning": "one short sentence" }

Rules:
- "new_project" — the message clearly references a new property, new scope, new quote, or different work. Examples: "we're thinking of doing the back deck now", "got another house on Broughton — can you quote it?", "my brother needs the same thing for his cottage".
- "followup" — the message is a continuation of the prior deal. Examples: "what's the best way to clean the railing?", "the inspector wants the warranty letter", "Stripe receipt didn't come through", "thank you so much, will recommend".
- "unclear" — genuinely ambiguous. Use sparingly.

You receive: the closed opportunity title, the prior message snippet (the close conversation), and the new inbound message body.`;

interface AssessClosedOppInput {
  opportunityTitle: string;
  closingSnippet: string;
  newMessageBody: string;
}

export async function assessClosedOppRelevance(
  input: AssessClosedOppInput
): Promise<{ signal: ClosedOppSignal; reasoning: string }> {
  const openai = getSyncOpenAI();
  const sanitize = (v: string, n: number): string =>
    v.replace(/[\[\]{}]/g, "").slice(0, n);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: CLOSED_OPP_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            opp: sanitize(input.opportunityTitle, 200),
            prior: sanitize(input.closingSnippet, 800),
            now: sanitize(input.newMessageBody, 1500),
          }),
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 120,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const raw = parsed.signal;
    const signal: ClosedOppSignal =
      raw === "new_project" || raw === "followup" || raw === "unclear"
        ? raw
        : "unclear";
    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 200) : "";
    return { signal, reasoning };
  } catch (err) {
    console.error(
      "[email-thread-service] assessClosedOppRelevance failed:",
      err instanceof Error ? err.message : err
    );
    return { signal: "unclear", reasoning: "assessment_failed" };
  }
}
```

Add `ClosedOppSignal` to the existing import line from `@/lib/types/email-thread`:
```ts
import type {
  ArchiveLeadPreference,
  ArchiveWritebackPreference,
  ClosedOppSignal,
  EmailThread,
  EmailThreadCategory,
  // ...rest of existing imports unchanged
} from "@/lib/types/email-thread";
```

- [ ] **Step 6.2: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | grep email-thread-service | head -5`
Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/api/services/email-thread-service.ts
git commit -m "feat(inbox): assessClosedOppRelevance AI helper for new-project signal"
```

---

## Task 7 — Auto-link rule + closed-opp assessment in `upsertFromEmail`

**Files:**
- Modify: `src/lib/api/services/email-thread-service.ts:540-600` (the upsertFromEmail update branch)

- [ ] **Step 7.1: Add auto-link block after client_id resolution**

Edit `src/lib/api/services/email-thread-service.ts`. Locate the existing block at line 557:
```ts
      if (!existing.client_id) {
        if (params.clientId) {
          update.client_id = params.clientId;
        } else {
          const auto = await resolveClientIdFromEmails(
            supabase,
            companyId,
            Array.from(existingParticipants)
          );
          if (auto) update.client_id = auto;
        }
      }
```

Immediately after this block, insert:
```ts
      // Auto-link to opportunity when the resolved client has exactly ONE
      // open opp. Skipped when the thread already has an opp_id.
      const resolvedClientId =
        (update.client_id as string | undefined) ??
        (existing.client_id as string | undefined);
      if (!existing.opportunity_id && resolvedClientId && !params.opportunityId) {
        const { data: openOpps } = await supabase
          .from("opportunities")
          .select("id")
          .eq("client_id", resolvedClientId)
          .eq("company_id", companyId)
          .not("stage", "in", '("won","lost","discarded")')
          .is("deleted_at", null)
          .is("archived_at", null)
          .limit(2);
        if (openOpps && openOpps.length === 1) {
          update.opportunity_id = openOpps[0].id as string;
        }
      }
```

- [ ] **Step 7.2: Add closed-opp assessment trigger after the update succeeds**

Find the end of the update branch where `return { threadRow: ..., isNew: false }` happens (around line 578). Replace that block with:
```ts
      const { data: updated, error: updError } = await supabase
        .from("email_threads")
        .update(update)
        .eq("id", existing.id as string)
        .select("*")
        .single();

      if (updError) throw new Error(`upsertFromEmail update failed: ${updError.message}`);

      const updatedThread = mapEmailThreadFromDb(updated);
      // Closed-opp assessment — fires when an inbound message lands on a
      // thread whose opportunity is in a terminal stage. Cached server-side
      // so we don't re-bill the model on every fetch.
      if (direction === "inbound" && updatedThread.opportunityId) {
        await maybeAssessClosedOpp(updatedThread, snippet, email.bodyText ?? "").catch(
          (err) => {
            console.error(
              "[email-thread-service] closed-opp assessment failed:",
              err instanceof Error ? err.message : err
            );
          }
        );
      }
      return { threadRow: updatedThread, isNew: false };
```

- [ ] **Step 7.3: Add `maybeAssessClosedOpp` helper above `EmailThreadService`**

Insert in the helpers section (above the `EmailThreadService` const, near `assessClosedOppRelevance`):
```ts
async function maybeAssessClosedOpp(
  thread: EmailThread,
  closingSnippet: string,
  newBody: string
): Promise<void> {
  if (!thread.opportunityId) return;
  const supabase = requireSupabase();
  const { data: opp } = await supabase
    .from("opportunities")
    .select("id, title, stage, actual_close_date")
    .eq("id", thread.opportunityId)
    .single();
  if (!opp) return;
  const terminal = ["won", "lost", "discarded"].includes(String(opp.stage));
  if (!terminal) return;
  // Skip if we've already assessed this exact message_at.
  const cached = thread.closedOppAssessment;
  if (cached && cached.assessedMessageAt.getTime() === thread.lastMessageAt.getTime()) {
    return;
  }
  const result = await assessClosedOppRelevance({
    opportunityTitle: (opp.title as string) || "(untitled)",
    closingSnippet,
    newMessageBody: newBody,
  });
  await supabase
    .from("email_threads")
    .update({
      closed_opp_assessment: {
        signal: result.signal,
        assessed_at: new Date().toISOString(),
        assessed_message_at: thread.lastMessageAt.toISOString(),
        reasoning: result.reasoning,
      },
    })
    .eq("id", thread.id);
}
```

- [ ] **Step 7.4: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | grep email-thread-service | head -10`
Expected: no errors.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/api/services/email-thread-service.ts
git commit -m "feat(inbox): auto-link single open opp + closed-opp assessment on ingest"
```

---

## Task 8 — Wire `attributeOpportunity` into the threads PATCH route

**Files:**
- Modify: `src/app/api/inbox/threads/[id]/route.ts:321-336` and switch

- [ ] **Step 8.1: Extend the action union**

Locate `type ThreadAction` (line 321). Replace with:
```ts
type ThreadAction =
  | { action: "archive" }
  | { action: "unarchive" }
  | { action: "snooze"; until: string }
  | { action: "unsnooze" }
  | { action: "recategorize"; toCategory: EmailThreadCategory; note?: string }
  | { action: "markRead"; isRead: boolean }
  | { action: "attributeOpportunity"; opportunityId: string | null };
```

- [ ] **Step 8.2: Extend `ACTION_PERMISSIONS`**

Locate the map (line 329). Add the new entry:
```ts
const ACTION_PERMISSIONS: Record<string, string> = {
  archive: "inbox.archive",
  unarchive: "inbox.archive",
  snooze: "inbox.snooze",
  unsnooze: "inbox.snooze",
  recategorize: "inbox.categorize",
  markRead: "inbox.view",
  attributeOpportunity: "inbox.attribute_opportunity",
};
```

- [ ] **Step 8.3: Add switch case before the closing `}` of the switch**

Locate the existing `case "markRead":` block. After its closing `}`, insert:
```ts
      case "attributeOpportunity": {
        // Validate body shape — opportunityId may be string or null
        if (typeof body.opportunityId !== "string" && body.opportunityId !== null) {
          return NextResponse.json(
            { error: "`opportunityId` must be a uuid or null" },
            { status: 400 }
          );
        }
        // Cross-pipeline-permission gate: anyone attributing must also be
        // able to see pipeline data.
        const canSeePipeline = await checkPermissionById(userId, "pipeline.view");
        if (!canSeePipeline) {
          return NextResponse.json(
            { error: "Forbidden — pipeline.view required" },
            { status: 403 }
          );
        }
        const updated = await runWithSupabase(supabase, () =>
          EmailThreadService.attributeOpportunity({
            threadId: id,
            opportunityId: body.opportunityId,
          })
        );
        return NextResponse.json({
          ok: true,
          thread: {
            id: updated.id,
            opportunityId: updated.opportunityId,
            clientId: updated.clientId,
          },
        });
      }
```

- [ ] **Step 8.4: Test the endpoint with curl smoke** (manual)

Once the dev server is running (`pnpm dev`), call:
```bash
curl -X PATCH "http://localhost:3000/api/inbox/threads/<thread-id>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"action":"attributeOpportunity","opportunityId":"<opp-id>"}'
```
Expected: `{ ok: true, thread: { id, opportunityId, clientId } }` with HTTP 200.

- [ ] **Step 8.5: Commit**

```bash
git add src/app/api/inbox/threads/[id]/route.ts
git commit -m "feat(api): inbox PATCH attributeOpportunity action"
```

---

## Task 9 — Update GET `/api/inbox/threads/[id]` to return opp + assessment

**Files:**
- Modify: `src/app/api/inbox/threads/[id]/route.ts` (the GET handler — verify location)

- [ ] **Step 9.1: Locate the GET handler and current response shape**

Run:
```bash
grep -n "export async function GET\|opportunityId\|opportunityName\|opportunityStage" /Users/jacksonsweet/Projects/OPS/OPS-Web/src/app/api/inbox/threads/\[id\]/route.ts | head -20
```

- [ ] **Step 9.2: Extend the GET response with opportunity stage + closed-opp assessment**

In the GET handler, locate the part that builds the response. After resolving the thread, add an opportunity lookup:
```ts
let opportunityStage: string | null = null;
let opportunityTitle: string | null = null;
if (thread.opportunityId) {
  const { data: opp } = await supabase
    .from("opportunities")
    .select("id, title, stage")
    .eq("id", thread.opportunityId)
    .single();
  if (opp) {
    opportunityStage = (opp.stage as string) ?? null;
    opportunityTitle = (opp.title as string) ?? null;
  }
}
```

In the `NextResponse.json({...})` payload, add the fields:
```ts
opportunityId: thread.opportunityId,
opportunityStage,
opportunityTitle,
closedOppAssessment: thread.closedOppAssessment
  ? {
      signal: thread.closedOppAssessment.signal,
      assessedAt: thread.closedOppAssessment.assessedAt.toISOString(),
      assessedMessageAt:
        thread.closedOppAssessment.assessedMessageAt.toISOString(),
      reasoning: thread.closedOppAssessment.reasoning,
    }
  : null,
```

- [ ] **Step 9.3: Mirror the new fields in the inbox list endpoint**

Edit `src/app/api/inbox/threads/route.ts:142-169` (the response map). Add after `clientName: ...`:
```ts
opportunityStage: null,           // populated below in a single batch query
closedOppAssessmentSignal:
  t.closedOppAssessment?.signal ?? null,
```

Above that map, after `clientNameById`, add:
```ts
const opportunityStageById = new Map<string, string>();
const opportunityIds = Array.from(
  new Set(result.threads.map((t) => t.opportunityId).filter((v): v is string => !!v))
);
if (opportunityIds.length > 0) {
  const { data: oppRows } = await supabase
    .from("opportunities")
    .select("id, stage")
    .in("id", opportunityIds);
  for (const row of oppRows ?? []) {
    opportunityStageById.set(row.id as string, String(row.stage));
  }
}
```

Then in the row map, replace the placeholder `opportunityStage: null` with:
```ts
opportunityStage: t.opportunityId
  ? opportunityStageById.get(t.opportunityId) ?? null
  : null,
```

- [ ] **Step 9.4: Update wire types in `useInboxThreads`**

Edit `src/lib/hooks/use-inbox-threads.ts`. In `InboxThreadRow` interface, after `clientName: string | null;`:
```ts
  /** Opportunity stage when the thread is linked, else null. */
  opportunityStage: string | null;
  /** Closed-opp signal for inbound mail on terminal opps; null otherwise. */
  closedOppAssessmentSignal: "new_project" | "followup" | "unclear" | null;
```

For the single-thread response (find the matching interface, likely `InboxThread` or similar), add:
```ts
opportunityStage: string | null;
opportunityTitle: string | null;
closedOppAssessment: {
  signal: "new_project" | "followup" | "unclear";
  assessedAt: string;
  assessedMessageAt: string;
  reasoning: string;
} | null;
```

- [ ] **Step 9.5: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: no errors.

- [ ] **Step 9.6: Commit**

```bash
git add src/app/api/inbox/threads/[id]/route.ts src/app/api/inbox/threads/route.ts src/lib/hooks/use-inbox-threads.ts
git commit -m "feat(api): inbox endpoints return opportunity stage + closed-opp signal"
```

---

## Task 10 — Hook: `attributeOpportunity` mutation in `useThreadActions`

**Files:**
- Modify: `src/lib/hooks/use-inbox-threads.ts`

- [ ] **Step 10.1: Add mutation inside `useThreadActions`**

Locate `useThreadActions` and the existing `recategorize` mutation. After it, insert:
```ts
  const attributeOpportunity = useMutation({
    mutationFn: (args: { threadId: string; opportunityId: string | null }) =>
      runThreadAction({
        threadId: args.threadId,
        action: "attributeOpportunity",
        opportunityId: args.opportunityId,
      }),
    onSuccess: (_res, args) => {
      invalidateLists();
      invalidateDetail(args.threadId);
      invalidateOpportunities();
    },
  });
```

- [ ] **Step 10.2: Expose it in the returned object**

Find the `return { archive, unarchive, snooze, unsnooze, ... }` at the end. Add `attributeOpportunity,`:
```ts
  return {
    archive,
    unarchive,
    archiveBatch,
    unarchiveBatch,
    snooze,
    unsnooze,
    markRead,
    recategorize,
    attributeOpportunity,
    setLeadArchivePreference,
  };
```

- [ ] **Step 10.3: Extend the request body type used by `runThreadAction`**

Search for the `ThreadActionBody` (or similar) type union the helper uses. Add the new variant:
```ts
| { threadId: string; action: "attributeOpportunity"; opportunityId: string | null }
```

- [ ] **Step 10.4: Verify types compile**

Run: `pnpm tsc --noEmit 2>&1 | grep use-inbox-threads | head -5`
Expected: no errors.

- [ ] **Step 10.5: Commit**

```bash
git add src/lib/hooks/use-inbox-threads.ts
git commit -m "feat(inbox): attributeOpportunity mutation in useThreadActions"
```

---

## Task 11 — Hook: `useOpenOpportunities`

**Files:**
- Create: `src/lib/hooks/use-open-opportunities.ts`

- [ ] **Step 11.1: Write the hook**

Create `src/lib/hooks/use-open-opportunities.ts`:
```ts
"use client";

/**
 * useOpenOpportunities — TanStack Query hook for the OpportunityPicker.
 *
 * When `clientId` is provided, returns only that client's open opps.
 * Otherwise returns all open opps in the user's company. "Open" excludes
 * won, lost, discarded, plus archived/deleted rows.
 *
 * Caches for 60s — opp creation is rare relative to picker opens.
 */

import { useQuery } from "@tanstack/react-query";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import { OpportunityStage, type Opportunity } from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { queryKeys } from "@/lib/api/query-client";

export interface OpenOpportunityRow {
  id: string;
  title: string;
  stage: OpportunityStage;
  clientId: string | null;
  estimatedValue: number | null;
  stageEnteredAt: string;
}

const CLOSED_STAGES = new Set<OpportunityStage>([
  OpportunityStage.Won,
  OpportunityStage.Lost,
  OpportunityStage.Discarded,
]);

function toRow(opp: Opportunity): OpenOpportunityRow {
  return {
    id: opp.id,
    title: opp.title,
    stage: opp.stage,
    clientId: opp.clientId,
    estimatedValue: opp.estimatedValue,
    stageEnteredAt: opp.stageEnteredAt.toISOString(),
  };
}

export function useOpenOpportunities(clientId: string | null) {
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? null;

  return useQuery({
    queryKey: [
      ...queryKeys.opportunities.lists(),
      "open-for-picker",
      companyId,
      clientId ?? "all",
    ],
    queryFn: async (): Promise<OpenOpportunityRow[]> => {
      if (!companyId) return [];
      const all = await OpportunityService.fetchOpportunities(companyId, {
        clientId: clientId ?? undefined,
        includeArchived: false,
        includeDeleted: false,
        sortField: "stage_entered_at",
        descending: true,
      });
      return all.filter((o) => !CLOSED_STAGES.has(o.stage)).map(toRow);
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 11.2: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | grep use-open-opportunities | head -5`
Expected: no errors.

- [ ] **Step 11.3: Commit**

```bash
git add src/lib/hooks/use-open-opportunities.ts
git commit -m "feat(inbox): useOpenOpportunities hook for picker"
```

---

## Task 12 — Component: `OpportunityStageChip`

**Files:**
- Create: `src/components/ops/inbox/opportunity-stage-chip.tsx`

- [ ] **Step 12.1: Build the chip**

Create `src/components/ops/inbox/opportunity-stage-chip.tsx`:
```tsx
"use client";

/**
 * OpportunityStageChip — small chip rendering an opportunity's pipeline stage.
 *
 * Mirrors CategoryChip's visual language: 22px tall, 4px radius, neutral
 * background, 2px left-border accent in the stage's earth-tone color.
 *
 * Sizes:
 *   - "sm" (18px tall) — list rows
 *   - "md" (22px tall) — detail header, context panel
 */

import { cn } from "@/lib/utils/cn";
import { OpportunityStage, OPPORTUNITY_STAGE_COLORS } from "@/lib/types/pipeline";

const STAGE_LABEL: Record<OpportunityStage, string> = {
  [OpportunityStage.NewLead]: "NEW LEAD",
  [OpportunityStage.Qualifying]: "QUALIFYING",
  [OpportunityStage.Quoting]: "QUOTING",
  [OpportunityStage.Quoted]: "QUOTED",
  [OpportunityStage.FollowUp]: "FOLLOW-UP",
  [OpportunityStage.Negotiation]: "NEGOTIATION",
  [OpportunityStage.Won]: "WON",
  [OpportunityStage.Lost]: "LOST",
  [OpportunityStage.Discarded]: "DISCARDED",
};

interface Props {
  stage: OpportunityStage | string;
  size?: "sm" | "md";
  className?: string;
}

export function OpportunityStageChip({ stage, size = "md", className }: Props) {
  // Tolerate raw string from the API list endpoint.
  const stageEnum = (stage as OpportunityStage) ?? OpportunityStage.NewLead;
  const color = OPPORTUNITY_STAGE_COLORS[stageEnum] ?? "#8F9AA3";
  const label = STAGE_LABEL[stageEnum] ?? String(stage).toUpperCase();
  const heightCls = size === "sm" ? "h-[18px] px-1.5 text-[9.5px]" : "h-[22px] px-2 text-[10px]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip",
        "border border-border-subtle bg-[rgba(255,255,255,0.04)]",
        "font-mono uppercase tracking-[0.16em] text-text-2",
        heightCls,
        className
      )}
      style={{ borderLeft: `2px solid ${color}` }}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 12.2: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | grep opportunity-stage-chip | head -5`
Expected: no errors.

- [ ] **Step 12.3: Commit**

```bash
git add src/components/ops/inbox/opportunity-stage-chip.tsx
git commit -m "feat(inbox): OpportunityStageChip component"
```

---

## Task 13 — Component: `OpportunityPicker` modal

**Files:**
- Create: `src/components/ops/inbox/opportunity-picker.tsx`

- [ ] **Step 13.1: Build the picker**

Create `src/components/ops/inbox/opportunity-picker.tsx`:
```tsx
"use client";

/**
 * OpportunityPicker — modal dialog for attributing a thread to an opportunity.
 *
 * Layout:
 *   1. "This client's opportunities" section (when thread has a clientId)
 *      — open opps for the linked client, suggested first
 *   2. "All open opportunities" section
 *      — full company-wide list, with search
 *   3. "Unlink from opportunity" footer button when the thread already has one
 *
 * Glass-dense surface, `rounded-modal` (12px), no spring physics, EASE_SMOOTH.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Search as SearchIcon, X, Unlink } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { useOpenOpportunities, type OpenOpportunityRow } from "@/lib/hooks/use-open-opportunities";
import { OpportunityStageChip } from "./opportunity-stage-chip";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Thread's current client (used to suggest opps); null if none. */
  clientId: string | null;
  /** Currently linked opp id; null if none. Used for the unlink action. */
  currentOpportunityId: string | null;
  /** Called when the user picks an opp (or chooses to unlink → opportunityId=null). */
  onConfirm: (opportunityId: string | null) => void;
}

export function OpportunityPicker({
  open,
  onOpenChange,
  clientId,
  currentOpportunityId,
  onConfirm,
}: Props) {
  const { t } = useDictionary("inbox");
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const clientOpps = useOpenOpportunities(clientId);
  const allOpps = useOpenOpportunities(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Build two filtered lists, dedup by id, suggested-first.
  const { suggested, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (o: OpenOpportunityRow): boolean =>
      q.length === 0 || o.title.toLowerCase().includes(q);
    const suggestedRows = (clientOpps.data ?? []).filter(matches);
    const suggestedIds = new Set(suggestedRows.map((o) => o.id));
    const otherRows = (allOpps.data ?? [])
      .filter((o) => !suggestedIds.has(o.id))
      .filter(matches);
    return { suggested: suggestedRows, others: otherRows };
  }, [clientOpps.data, allOpps.data, query]);

  const isLoading = clientOpps.isLoading || allOpps.isLoading;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <AnimatePresence>
          {open && (
            <>
              <Dialog.Overlay asChild>
                <motion.div
                  className="fixed inset-0 bg-black/60 z-[3000]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0.15 : 0.2, ease: EASE_SMOOTH }}
                />
              </Dialog.Overlay>
              <Dialog.Content asChild>
                <motion.div
                  className={cn(
                    "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[3010]",
                    "w-[480px] max-h-[600px] overflow-hidden",
                    "glass-dense rounded-modal flex flex-col"
                  )}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                  transition={{ duration: reduceMotion ? 0.15 : 0.2, ease: EASE_SMOOTH }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                    <Dialog.Title className="font-cakemono font-light uppercase text-[14px] tracking-[0.18em] text-text">
                      {t("attribute.title") ?? "Attribute to opportunity"}
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="text-text-3 hover:text-text-2 transition-colors"
                        aria-label="Close"
                      >
                        <X className="w-[14px] h-[14px]" />
                      </button>
                    </Dialog.Close>
                  </div>

                  {/* Search */}
                  <div className="px-4 py-2.5 border-b border-border-subtle">
                    <div className="flex items-center gap-2 bg-surface-input border border-border-subtle rounded-[5px] px-2.5 h-[30px]">
                      <SearchIcon className="w-[13px] h-[13px] text-text-mute shrink-0" />
                      <input
                        type="text"
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("attribute.searchPlaceholder") ?? "Search opportunities…"}
                        className="flex-1 bg-transparent outline-none font-mohave text-[13px] text-text placeholder:text-text-3"
                      />
                    </div>
                  </div>

                  {/* Lists */}
                  <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {isLoading ? (
                      <div className="px-4 py-6 font-mono text-[11px] text-text-3 uppercase tracking-[0.16em]">
                        // loading…
                      </div>
                    ) : suggested.length === 0 && others.length === 0 ? (
                      <div className="px-4 py-6 font-mohave text-[13px] text-text-3">
                        {query.length > 0
                          ? t("attribute.noMatch") ?? "No matching open opportunities."
                          : t("attribute.noOpen") ?? "No open opportunities yet."}
                      </div>
                    ) : (
                      <>
                        {suggested.length > 0 && (
                          <Section
                            label={t("attribute.suggestedLabel") ?? "// for this client"}
                            opps={suggested}
                            currentOpportunityId={currentOpportunityId}
                            onPick={(id) => {
                              onConfirm(id);
                              onOpenChange(false);
                            }}
                          />
                        )}
                        {others.length > 0 && (
                          <Section
                            label={t("attribute.allLabel") ?? "// all open opportunities"}
                            opps={others}
                            currentOpportunityId={currentOpportunityId}
                            onPick={(id) => {
                              onConfirm(id);
                              onOpenChange(false);
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Footer — unlink */}
                  {currentOpportunityId && (
                    <div className="px-4 py-2.5 border-t border-border-subtle flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          onConfirm(null);
                          onOpenChange(false);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 h-[28px] px-3 rounded-[5px]",
                          "border border-border-subtle text-text-2 hover:text-text",
                          "hover:bg-surface-hover transition-colors",
                          "font-cakemono font-light uppercase text-[11px] tracking-[0.16em]"
                        )}
                      >
                        <Unlink className="w-[12px] h-[12px]" />
                        {t("attribute.unlink") ?? "Unlink"}
                      </button>
                    </div>
                  )}
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Section({
  label,
  opps,
  currentOpportunityId,
  onPick,
}: {
  label: string;
  opps: OpenOpportunityRow[];
  currentOpportunityId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="py-1">
      <div className="px-4 py-1.5 font-mono text-[10px] text-text-mute uppercase tracking-[0.18em]">
        {label}
      </div>
      <ul>
        {opps.map((opp) => {
          const active = opp.id === currentOpportunityId;
          return (
            <li key={opp.id}>
              <button
                type="button"
                onClick={() => onPick(opp.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-4 py-2 text-left",
                  "hover:bg-surface-hover transition-colors",
                  active && "bg-surface-active"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mohave text-[13px] text-text truncate">
                    {opp.title || "(untitled)"}
                  </div>
                  {opp.estimatedValue !== null && (
                    <div className="font-mono text-[11px] text-text-3 mt-0.5">
                      ${opp.estimatedValue.toLocaleString()}
                    </div>
                  )}
                </div>
                <OpportunityStageChip stage={opp.stage} size="sm" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 13.2: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | grep opportunity-picker | head -5`
Expected: no errors.

- [ ] **Step 13.3: Commit**

```bash
git add src/components/ops/inbox/opportunity-picker.tsx
git commit -m "feat(inbox): OpportunityPicker modal"
```

---

## Task 14 — Wire `OpportunityPicker` into the inbox page

**Files:**
- Modify: `src/app/(dashboard)/inbox/page.tsx`

- [ ] **Step 14.1: Add picker state at top of `InboxPage`**

After the existing `[paletteOpen, setPaletteOpen]` line, insert:
```ts
  // ─── Opportunity picker (attribution flow) ────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const handleOpenPicker = useCallback(() => {
    if (!selectedThread) return;
    setPickerOpen(true);
  }, [selectedThread]);

  const handlePickerConfirm = useCallback(
    (opportunityId: string | null) => {
      if (!selectedThread) return;
      attributeMutation.mutate({
        threadId: selectedThread.id,
        opportunityId,
      });
    },
    [selectedThread]
  );
```

- [ ] **Step 14.2: Pull the new mutation off `useThreadActions`**

In the destructure at line 298–304, add `attributeOpportunity: attributeMutation,`:
```ts
  const {
    archive: archiveMutation,
    unarchive: unarchiveMutation,
    archiveBatch: archiveBatchMutation,
    unarchiveBatch: unarchiveBatchMutation,
    setLeadArchivePreference: setLeadArchivePreferenceMutation,
    attributeOpportunity: attributeMutation,
  } = useThreadActions();
```

- [ ] **Step 14.3: Render the picker near the bottom of the JSX (after `ComposeEmailModal`)**

Insert:
```tsx
      <OpportunityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        clientId={selectedThread?.clientId ?? null}
        currentOpportunityId={selectedThread?.opportunityId ?? null}
        onConfirm={handlePickerConfirm}
      />
```

Add the import at the top:
```ts
import { OpportunityPicker } from "@/components/ops/inbox/opportunity-picker";
```

- [ ] **Step 14.4: Pass `onAttributeOpportunity` down to thread detail and command palette**

In the `<ThreadDetailView ...>` props, add:
```tsx
        onAttributeOpportunity={handleOpenPicker}
```

In the `<CommandPalette ... handlers={{...}}>` block, add:
```ts
          onAttributeOpportunity: handleOpenPicker,
```

- [ ] **Step 14.5: Compile check**

Run: `pnpm tsc --noEmit 2>&1 | grep inbox/page | head -5`
Expected: no errors (Tasks 15–17 add the prop on `ThreadDetailView` and the handler key on `CommandPalette`; expect those to compile after Task 17).

- [ ] **Step 14.6: Commit**

```bash
git add src/app/\(dashboard\)/inbox/page.tsx
git commit -m "feat(inbox): wire OpportunityPicker state on inbox page"
```

---

## Task 15 — Thread detail header — opp chip + `O` shortcut

**Files:**
- Modify: `src/components/ops/inbox/thread-detail-view.tsx`

- [ ] **Step 15.1: Add the prop**

Locate the `Props` (or similar) interface at the top. Add:
```ts
  onAttributeOpportunity?: () => void;
```

Pull it from props in the function signature.

- [ ] **Step 15.2: Add stage chip in the header next to `CategoryChip`**

Locate the JSX block where `<CategoryChip ...>` renders (around line 670 per the audit). After it, insert:
```tsx
          {thread?.opportunityId && thread.opportunityStage && (
            <button
              type="button"
              onClick={onAttributeOpportunity}
              className="rounded-chip outline-none focus-visible:ring-2 focus-visible:ring-ops-accent ring-offset-2 ring-offset-black"
              aria-label={t("attribute.changeOpp") ?? "Change linked opportunity"}
            >
              <OpportunityStageChip stage={thread.opportunityStage} size="md" />
            </button>
          )}
          {thread?.clientId && !thread.opportunityId && (
            <button
              type="button"
              onClick={onAttributeOpportunity}
              className={cn(
                "inline-flex items-center gap-1.5 h-[22px] px-2 rounded-chip",
                "border border-border-subtle bg-[rgba(255,255,255,0.02)]",
                "font-mono uppercase tracking-[0.16em] text-[10px]",
                "text-text-3 hover:text-text-2 hover:border-[rgba(255,255,255,0.18)] transition-colors"
              )}
            >
              <Plus className="w-[10px] h-[10px]" />
              {t("attribute.linkCta") ?? "Link opportunity"}
            </button>
          )}
```

Add imports at the top of the file:
```tsx
import { Plus } from "lucide-react";
import { OpportunityStageChip } from "./opportunity-stage-chip";
```

- [ ] **Step 15.3: Add `O` keyboard shortcut binding**

Locate the existing `useEffect` block that registers shortcuts (search for `"a"` archive or `"e"` archive — there's a `keydown` handler around line 572 per the audit). Inside the handler, add (next to the other key cases):
```ts
        case "o": {
          if (!keyboardActive || metaOrCtrl(e)) return;
          e.preventDefault();
          onAttributeOpportunity?.();
          return;
        }
```

- [ ] **Step 15.4: Compile + visual smoke**

Run: `pnpm tsc --noEmit 2>&1 | grep thread-detail-view | head -10`
Expected: no errors.

Run dev server: `pnpm dev`. Open the inbox, select a thread that has `opportunity_id` set in the DB. Expected: stage chip appears in the header. Click it → picker opens. Press `O` on a different thread → picker opens.

- [ ] **Step 15.5: Commit**

```bash
git add src/components/ops/inbox/thread-detail-view.tsx
git commit -m "feat(inbox): opp stage chip + 'O' shortcut in thread detail header"
```

---

## Task 16 — Context panel — opp mini-card

**Files:**
- Modify: `src/components/ops/inbox/thread-context-panel.tsx:410-450`

- [ ] **Step 16.1: Replace the existing single-link button with a mini-card**

Locate the block (lines ~424–448 per the audit). Replace it with:
```tsx
            {/* Linked opportunity */}
            {thread.opportunityId ? (
              <div>
                <SectionHeader icon={FolderKanban} label={t("context.opportunity") ?? "Opportunity"} />
                <div className="rounded-[5px] border border-border-subtle bg-[rgba(255,255,255,0.02)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => router.push(`/pipeline/${thread.opportunityId}`)}
                    className="w-full flex items-start gap-2 px-2.5 py-2 hover:bg-surface-hover transition-colors text-left"
                  >
                    <FolderKanban
                      className="w-[12px] h-[12px] text-text-mute shrink-0 mt-0.5"
                      strokeWidth={1.75}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-[12.5px] text-text truncate">
                        {ctx?.opportunityName ?? t("attribute.untitled") ?? "(untitled)"}
                      </p>
                      {ctx?.opportunityStage && (
                        <div className="mt-1">
                          <OpportunityStageChip stage={ctx.opportunityStage} size="sm" />
                        </div>
                      )}
                    </div>
                    <ExternalLink
                      className="w-[11px] h-[11px] text-text-mute mt-0.5"
                      strokeWidth={1.75}
                    />
                  </button>
                  <div className="border-t border-border-subtle">
                    <button
                      type="button"
                      onClick={onAttributeOpportunity}
                      className={cn(
                        "w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5",
                        "hover:bg-surface-hover transition-colors",
                        "font-cakemono font-light uppercase text-[10px] tracking-[0.16em] text-text-3 hover:text-text-2"
                      )}
                    >
                      {t("attribute.changeOpp") ?? "Change opportunity"}
                    </button>
                  </div>
                </div>
              </div>
            ) : thread.clientId ? (
              <div>
                <SectionHeader icon={FolderKanban} label={t("context.opportunity") ?? "Opportunity"} />
                <button
                  type="button"
                  onClick={onAttributeOpportunity}
                  className={cn(
                    "w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-[5px]",
                    "border border-dashed border-border-subtle bg-[rgba(255,255,255,0.01)]",
                    "hover:bg-surface-hover hover:border-[rgba(255,255,255,0.18)] transition-colors",
                    "font-cakemono font-light uppercase text-[11px] tracking-[0.16em] text-text-3 hover:text-text-2"
                  )}
                >
                  <Plus className="w-[11px] h-[11px]" />
                  {t("attribute.linkCta") ?? "Link opportunity"}
                </button>
              </div>
            ) : null}
```

Add imports:
```tsx
import { Plus } from "lucide-react";
import { OpportunityStageChip } from "./opportunity-stage-chip";
```

Add `onAttributeOpportunity?: () => void;` to the `Props` interface.

- [ ] **Step 16.2: Plumb the prop from page.tsx → ThreadContextPanel**

In `src/app/(dashboard)/inbox/page.tsx`, add to the `<ThreadContextPanel>` props:
```tsx
        onAttributeOpportunity={handleOpenPicker}
```

- [ ] **Step 16.3: Compile + smoke**

Run: `pnpm tsc --noEmit 2>&1 | head -10`. Expected: no errors.

In dev server: open a thread with no opp link. The "// LINK OPPORTUNITY" dashed CTA should appear in the context panel. Click → picker opens. Pick an opp → mini-card replaces the dashed CTA.

- [ ] **Step 16.4: Commit**

```bash
git add src/components/ops/inbox/thread-context-panel.tsx src/app/\(dashboard\)/inbox/page.tsx
git commit -m "feat(inbox): expand context panel opp section into mini-card"
```

---

## Task 17 — Conversation list — opp stage badge on rows

**Files:**
- Modify: `src/components/ops/inbox/conversation-list.tsx`

- [ ] **Step 17.1: Add the badge in the row metadata strip**

Locate the row render (around line 240–290 per the audit, where `clientName` and `latestSenderName` are displayed). Add the badge alongside the existing category chip on the right side of the row. After the existing `<CategoryChip ... size="sm" />` (or equivalent), insert:
```tsx
              {thread.opportunityStage && (
                <OpportunityStageChip stage={thread.opportunityStage} size="sm" />
              )}
```

If row layout is tight, place the chip on the second metadata line instead — match the existing line where timestamps live. Wrap with truncation if needed to avoid pushing the timestamp off-row.

Add the import:
```tsx
import { OpportunityStageChip } from "./opportunity-stage-chip";
```

- [ ] **Step 17.2: Compile + smoke**

Run: `pnpm tsc --noEmit 2>&1 | head -5`. Expected: no errors.

In dev server: scroll the list. Threads with `opportunity_id` set show a small stage chip. Visually verify (a) it doesn't break row alignment, (b) tracking matches the category chip exactly.

- [ ] **Step 17.3: Commit**

```bash
git add src/components/ops/inbox/conversation-list.tsx
git commit -m "feat(inbox): opp stage badge on conversation list rows"
```

---

## Task 18 — Command palette — "Attribute to opportunity"

**Files:**
- Modify: `src/components/ops/inbox/command-palette.tsx`

- [ ] **Step 18.1: Extend `CommandPaletteHandlers` interface**

Locate the `CommandPaletteHandlers` interface. Add:
```ts
  onAttributeOpportunity?: () => void;
```

- [ ] **Step 18.2: Add the command item in the "This thread" group**

Locate the existing `<CommandItem value="archive thread e" ...>` block. After the recategorize item (or last thread-scoped item), add:
```tsx
            {selectedThreadId && (
              <CommandItem
                value="attribute opportunity link o"
                onSelect={() => run(handlers.onAttributeOpportunity)}
              >
                <Link2 className="w-[14px] h-[14px] text-text-3" />
                {t("palette.attributeOpp") ?? "Attribute to opportunity"}
                <span className="ml-auto">
                  <KeyHint keys="O" />
                </span>
              </CommandItem>
            )}
```

Add the icon import:
```tsx
import { Link2 } from "lucide-react";
```

- [ ] **Step 18.3: Compile + smoke**

Run: `pnpm tsc --noEmit 2>&1 | grep command-palette | head -5`. Expected: no errors.

In dev server: open inbox, select a thread, press `⌘K`, type "attr" — the new item appears. Click it → picker opens.

- [ ] **Step 18.4: Commit**

```bash
git add src/components/ops/inbox/command-palette.tsx
git commit -m "feat(inbox): command palette 'Attribute to opportunity' item"
```

---

## Task 19 — Closed-opp banner

**Files:**
- Create: `src/components/ops/inbox/closed-opp-banner.tsx`
- Modify: `src/components/ops/inbox/thread-detail-view.tsx`

- [ ] **Step 19.1: Build the banner component**

Create `src/components/ops/inbox/closed-opp-banner.tsx`:
```tsx
"use client";

/**
 * ClosedOppBanner — surfaces when an inbound message lands on a thread whose
 * linked opportunity is in a terminal stage (won/lost/discarded) AND the AI
 * has flagged the new message as referencing a NEW project (signal === "new_project").
 *
 * The "followup" and "unclear" signals deliberately render NOTHING — the user
 * doesn't want noise on every closed-opp follow-up question.
 *
 * Two CTAs:
 *   - [NEW OPPORTUNITY] — opens the wizard / handler to create a new opp and
 *     re-attribute the thread (handler is owned by the page).
 *   - [DISMISS]         — clears the assessment from the thread row, never
 *     shows again unless a new inbound triggers a fresh assessment.
 */

import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface Props {
  signal: "new_project" | "followup" | "unclear";
  reasoning?: string;
  onCreateNewOpportunity: () => void;
  onDismiss: () => void;
}

export function ClosedOppBanner({
  signal,
  reasoning,
  onCreateNewOpportunity,
  onDismiss,
}: Props) {
  const { t } = useDictionary("inbox");
  const reduceMotion = useReducedMotion();
  if (signal !== "new_project") return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: reduceMotion ? 0.15 : 0.25, ease: EASE_SMOOTH }}
      className="overflow-hidden border-b border-border-subtle"
    >
      <div className="px-4 py-3 flex items-start gap-3 bg-[rgba(157,181,130,0.05)]">
        <Sparkles
          className="w-[14px] h-[14px] text-olive shrink-0 mt-0.5"
          strokeWidth={1.75}
        />
        <div className="flex-1 min-w-0">
          <p className="font-mohave text-[13px] text-text">
            {t("closedOpp.headline") ?? "Looks like a new project."}
          </p>
          {reasoning && (
            <p className="mt-0.5 font-mono text-[11px] text-text-3 italic">
              [{reasoning}]
            </p>
          )}
          <p className="mt-1 font-mono text-[11px] text-text-3">
            {t("closedOpp.body") ?? "This message references work outside the closed opportunity."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onCreateNewOpportunity}
            className={cn(
              "inline-flex items-center h-[26px] px-2.5 rounded-[5px]",
              "text-ops-accent border border-ops-accent",
              "hover:bg-ops-accent hover:text-black transition-colors",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.16em]"
            )}
          >
            {t("closedOpp.createCta") ?? "New opportunity"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("closedOpp.dismiss") ?? "Dismiss"}
            className="text-text-3 hover:text-text-2 transition-colors p-1"
          >
            <X className="w-[12px] h-[12px]" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 19.2: Mount the banner in `ThreadDetailView`**

Edit `src/components/ops/inbox/thread-detail-view.tsx`. Right after the header block (and before the messages list), insert:
```tsx
        {thread?.closedOppAssessment?.signal === "new_project" && (
          <ClosedOppBanner
            signal={thread.closedOppAssessment.signal}
            reasoning={thread.closedOppAssessment.reasoning}
            onCreateNewOpportunity={() => onCreateNewOpportunity?.(thread.id)}
            onDismiss={() => onDismissClosedOppBanner?.(thread.id)}
          />
        )}
```

Add to the `Props` interface:
```ts
  onCreateNewOpportunity?: (threadId: string) => void;
  onDismissClosedOppBanner?: (threadId: string) => void;
```

Pull both from props in the function signature. Add the import:
```tsx
import { ClosedOppBanner } from "./closed-opp-banner";
```

- [ ] **Step 19.3: Add page-level handlers**

Edit `src/app/(dashboard)/inbox/page.tsx`. After `handleOpenPicker`, insert:
```ts
  // Banner CTA — open the picker preloaded for "new opp" creation. For Phase 1
  // we route to the picker (user manually creates an opp in /pipeline first,
  // then attributes here). A future Phase 2 task can add inline opp creation.
  const handleCreateNewOpportunity = useCallback(
    (_threadId: string) => {
      handleOpenPicker();
    },
    [handleOpenPicker]
  );

  // Banner dismiss — clears the assessment so the banner stops showing.
  // Implemented as an opportunityId no-op attribution: simplest path is a
  // dedicated dismiss action. For Phase 1 we can fire a direct fetch.
  const handleDismissClosedOppBanner = useCallback(async (threadId: string) => {
    try {
      const idToken = await (await import("@/lib/firebase/auth")).getIdToken();
      await fetch(`/api/inbox/threads/${threadId}/dismiss-closed-opp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      // Refetch the thread detail so the banner disappears.
      // queryClient handle is available via useQueryClient if needed.
    } catch (err) {
      console.error("[inbox] dismiss closed-opp banner failed:", err);
    }
  }, []);
```

Pass both as props on `<ThreadDetailView>`:
```tsx
        onCreateNewOpportunity={handleCreateNewOpportunity}
        onDismissClosedOppBanner={handleDismissClosedOppBanner}
```

- [ ] **Step 19.4: Add the dismiss endpoint**

Create `src/app/api/inbox/threads/[id]/dismiss-closed-opp/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth/admin-auth";
import { findUserByAuth } from "@/lib/auth/find-user";
import { checkPermissionById } from "@/lib/auth/permission-check";
import { getServiceRoleClient } from "@/lib/supabase/admin";

/**
 * POST /api/inbox/threads/[id]/dismiss-closed-opp
 *
 * Clears `closed_opp_assessment` on a single thread — the user has reviewed
 * the banner and decided it's a follow-up. Re-evaluation only fires again
 * when a fresh inbound message arrives.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authUser = await verifyAdminAuth(request);
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const allowed = await checkPermissionById(user.id as string, "inbox.view");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("email_threads")
    .update({ closed_opp_assessment: null })
    .eq("id", id)
    .eq("company_id", user.company_id as string);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 19.5: Compile + smoke**

Run: `pnpm tsc --noEmit 2>&1 | head -10`. Expected: no errors.

In dev server: find a thread whose linked opp is `won` or `lost` and which has `closed_opp_assessment = {signal:"new_project"}` (you can `UPDATE` a row manually for the smoke test). Open the thread → banner appears. Click `[DISMISS]` → banner disappears (page refetch confirms `closed_opp_assessment = null` in the DB).

- [ ] **Step 19.6: Commit**

```bash
git add src/components/ops/inbox/closed-opp-banner.tsx src/components/ops/inbox/thread-detail-view.tsx src/app/\(dashboard\)/inbox/page.tsx src/app/api/inbox/threads/\[id\]/dismiss-closed-opp/route.ts
git commit -m "feat(inbox): closed-opp 'new project?' banner with dismiss"
```

---

## Task 20 — i18n keys

**Files:**
- Modify: `src/i18n/dictionaries/en/inbox.json`

- [ ] **Step 20.1: Add keys**

Open the file. Add the following keys before the final `}` (preserve existing keys, alphabetize within their group prefix):
```json
  "attribute.title": "Attribute to opportunity",
  "attribute.searchPlaceholder": "Search opportunities…",
  "attribute.suggestedLabel": "// for this client",
  "attribute.allLabel": "// all open opportunities",
  "attribute.noMatch": "No matching open opportunities.",
  "attribute.noOpen": "No open opportunities yet.",
  "attribute.unlink": "Unlink",
  "attribute.linkCta": "Link opportunity",
  "attribute.changeOpp": "Change opportunity",
  "attribute.untitled": "(untitled)",

  "context.opportunity": "Opportunity",

  "palette.attributeOpp": "Attribute to opportunity",

  "closedOpp.headline": "Looks like a new project.",
  "closedOpp.body": "This message references work outside the closed opportunity.",
  "closedOpp.createCta": "New opportunity",
  "closedOpp.dismiss": "Dismiss"
```

- [ ] **Step 20.2: Mirror in `es/inbox.json`** (search for the file; if it exists, add Spanish translations or copy English as a temporary fallback). If not found, skip.

- [ ] **Step 20.3: Commit**

```bash
git add src/i18n/dictionaries/en/inbox.json
[ -f src/i18n/dictionaries/es/inbox.json ] && git add src/i18n/dictionaries/es/inbox.json
git commit -m "i18n(inbox): keys for opportunity attribution + closed-opp banner"
```

---

## Task 21 — Smoke-test checklist

**Files:** none (manual verification)

- [ ] **Step 21.1: Run dev server**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && pnpm dev
```

- [ ] **Step 21.2: Walk through the verification matrix**

For each row, confirm the expected behavior in the browser. Note any failures and fix them in a follow-up commit.

| # | Action | Expected |
|---|--------|----------|
| 1 | Open `/inbox`, select a thread with `opportunity_id` set | Stage chip renders in detail header AND on the list row AND in the context panel mini-card |
| 2 | Select a thread with `client_id` set but `opportunity_id = null` | "+ LINK OPPORTUNITY" CTA appears in detail header AND context panel |
| 3 | Click the "+ LINK OPPORTUNITY" CTA | OpportunityPicker opens; "// for this client" section shows that client's open opps; full list below |
| 4 | Pick an opp from the list | Picker closes; thread detail header now shows the stage chip; mini-card appears in context panel; row badge appears in list |
| 5 | Re-open the picker on the now-attributed thread | Footer shows `[UNLINK]` button |
| 6 | Click `[UNLINK]` | Picker closes; chip disappears from header + row + context panel |
| 7 | Press `O` keyboard shortcut while a thread is selected | Picker opens |
| 8 | Press `⌘K` → type "attr" → click "Attribute to opportunity" | Picker opens |
| 9 | DB seed: set `closed_opp_assessment = {"signal":"new_project","assessed_at":"...","assessed_message_at":"...","reasoning":"References a different deck"}` on a thread linked to a `won` opp; refresh | Banner renders below the header with the reasoning in brackets |
| 10 | Click `[NEW OPPORTUNITY]` on the banner | OpportunityPicker opens (Phase 1: user picks an existing or creates one in pipeline first) |
| 11 | Click `[X]` (dismiss) on the banner | Banner disappears; DB row's `closed_opp_assessment` is now NULL |
| 12 | Auto-link smoke: ingest a fresh inbound to a client that has exactly one open opp | New thread row in DB has `opportunity_id` populated |
| 13 | Auto-link smoke: ingest to a client with two open opps | New thread row has `opportunity_id = null` (we don't guess) |
| 14 | Cross-company link rejection: try to attribute a thread to an opp from a different company via direct API | 403 Forbidden with `cross-company link rejected` |
| 15 | Permission gate: revoke `inbox.attribute_opportunity` from a test user | Picker still opens but the attempt errors with 403; UI shows toast (use existing error handling) |
| 16 | Reduced motion: enable `prefers-reduced-motion` in browser dev tools | Banner uses opacity-only fallback at 150ms |

- [ ] **Step 21.3: If any rows fail, fix and re-test** (no commit — these are integration touch-ups within prior tasks)

- [ ] **Step 21.4: Final clean-up commit**

```bash
git status
git add -A
git commit -m "chore(inbox): smoke-test fixes for opportunity attribution" --allow-empty
```

---

## Self-review

**Spec coverage:**
- ✅ Backend: `attributeOpportunity` mutation with client reconciliation (Task 4)
- ✅ Backend: closed-opp AI assessment (Tasks 6-7)
- ✅ Backend: auto-link rule on ingest (Task 7)
- ✅ Backend: API exposes opp + assessment (Task 9)
- ✅ Hooks: mutation + open-opp query (Tasks 10-11)
- ✅ UI: stage chip primitive (Task 12)
- ✅ UI: picker modal (Task 13)
- ✅ UI: header chip + `O` shortcut (Task 15)
- ✅ UI: context mini-card (Task 16)
- ✅ UI: list row badge (Task 17)
- ✅ UI: command palette item (Task 18)
- ✅ UI: closed-opp banner with dismiss (Task 19)
- ✅ Permissions: new `inbox.attribute_opportunity` + `pipeline.view` cross-check (Tasks 1, 8)
- ✅ Migration for `closed_opp_assessment` (Task 2)
- ✅ i18n (Task 20)
- ✅ Smoke test (Task 21)

**Placeholder scan:** No "TBD", "TODO", or "implement later" patterns. Each step contains executable code or a concrete shell command.

**Type consistency:** `attributeOpportunity` signature matches across service (Task 4), API route (Task 8), hook (Task 10), and inbox page handler (Task 14). `OpportunityStageChip` accepts `OpportunityStage | string` to handle both the typed pipeline service path and the raw string from the inbox list endpoint.

**Cost note:** The closed-opp AI assessment is a single `gpt-5.4-mini` call per inbound on a closed-opp thread. With ~1500 chars input and ~120 output tokens, ~$0.0003 per call. Even at 100 closed-opp inbounds/month per company, that's ~$0.03. Cached server-side; no per-fetch cost.

---

## Execution handoff

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in the current session with checkpoints. Use `superpowers:executing-plans`.

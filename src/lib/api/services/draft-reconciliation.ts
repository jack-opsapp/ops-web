/**
 * OPS Web — Draft Reconciliation
 *
 * Closes the Phase C learning loop for AI drafts placed in the user's real
 * mailbox. When the user edits + sends from their native mail client, the old
 * in-app Send path never fires. This module reconciles, during sync, the
 * eventual sent reply against the draft we placed — feeding the outcome back
 * into AIDraftService.recordDraftOutcome so edit-distance learning continues.
 *
 * Entry points:
 *   - classifyDraftOutcome — pure classifier (Part A, TDD-driven)
 *   - reconcilePendingMailboxDrafts — runner wired into the per-thread sync path (Part B)
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "./email-service";
import { AIDraftService } from "./ai-draft-service";
import { stripPriorMessageOverlap, stripQuotedContent } from "@/lib/utils/email-parsing";
import type { EmailConnection } from "@/lib/types/email-connection";

// ─── Part A: Pure Classifier ────────────────────────────────────────────────

/**
 * The four terminal and in-flight states for a pending mailbox draft.
 *
 *   used          — draft gone + outbound exists → user sent the AI draft (possibly edited)
 *   from_scratch  — draft still present + outbound exists → user composed a fresh reply
 *   discarded     — draft gone + no outbound + past TTL → user deleted the draft without sending
 *   pending       — all other cases: too early to call, do nothing this cycle
 */
export type DraftOutcome = "used" | "from_scratch" | "discarded" | "pending";

/**
 * Classify what happened to a mailbox draft.
 *
 * Pure function — no I/O. Decision tree:
 *   1. If there is an outbound reply:
 *      - Draft gone → user sent (or based on) the AI draft   → "used"
 *      - Draft still there → user wrote fresh                 → "from_scratch"
 *   2. No outbound reply:
 *      - Draft gone + daysSinceDraft >= ttl                   → "discarded"
 *      - Anything else (still present OR within TTL window)   → "pending"
 *
 * @param s.draftStillInMailbox  True if the provider draft id still appears in listDrafts.
 * @param s.hasOutboundAfter     True if an outbound activity exists with created_at > draft row created_at.
 * @param s.daysSinceDraft       Integer days since the ai_draft_history row was created.
 * @param s.ttlDays              Max days before a gone-with-no-reply draft is called discarded. Default 14.
 */
export function classifyDraftOutcome(s: {
  draftStillInMailbox: boolean;
  hasOutboundAfter: boolean;
  daysSinceDraft: number;
  ttlDays?: number;
}): DraftOutcome {
  const ttl = s.ttlDays ?? 14;

  if (s.hasOutboundAfter) {
    // User replied via their mail client.
    // Draft still sitting in drafts folder = they wrote a fresh reply (ignored ours).
    // Draft gone = they used our draft as the base (possibly edited).
    return s.draftStillInMailbox ? "from_scratch" : "used";
  }

  // No outbound reply yet.
  if (!s.draftStillInMailbox && s.daysSinceDraft >= ttl) {
    // Draft deleted and no reply sent in TTL window → user discarded it.
    return "discarded";
  }

  // Too early to decide (within TTL, or draft still present and awaiting send).
  return "pending";
}

// ─── Part B: Reconciliation Runner ──────────────────────────────────────────

export interface ReconcileParams {
  connection: EmailConnection;
  /** Provider thread id (e.g. Gmail threadId / M365 conversationId). */
  providerThreadId: string;
  supabase: ReturnType<typeof requireSupabase>;
}

/**
 * Reconcile pending mailbox drafts for a thread after its activities are persisted.
 *
 * Design intent:
 *   - CHEAP FIRST: if there are no pending rows for this thread, we return
 *     immediately without touching the provider. The common case (thread with
 *     no AI draft, or draft already resolved) is free.
 *   - SINGLE PROVIDER CALL: if pending rows exist, we call listDrafts() once
 *     and build a Set for O(1) membership checks against all pending rows.
 *
 * Pagination / completeness caveat:
 *   listDrafts() returns ALL drafts in a single call (no cursor) for both
 *   Gmail (maxResults uncapped, pages internally) and M365. However, if a
 *   user's Drafts folder is unusually large (thousands of drafts), the
 *   provider may truncate. This is documented for T13 investigation — in
 *   practice, trades business owners do not accumulate thousands of drafts,
 *   and a missing draft is treated as "still present" only by absence; the
 *   next sync cycle will re-check. The worst outcome is a one-cycle delay
 *   before a "used" or "discarded" outcome is registered.
 *
 * Error isolation: one row's failure does not abort the rest.
 * Fire-and-forget from the sync loop: the caller wraps in .catch(log).
 */
export async function reconcilePendingMailboxDrafts({
  connection,
  providerThreadId,
  supabase,
}: ReconcileParams): Promise<void> {
  // Step 1: Query for pending rows — exit immediately if none.
  const { data: pendingRows, error: queryErr } = await supabase
    .from("ai_draft_history")
    .select(
      "id, company_id, user_id, profile_type, mailbox_draft_id, created_at, original_draft"
    )
    .eq("connection_id", connection.id)
    .eq("thread_id", providerThreadId)
    .eq("status", "auto_drafted")
    .not("mailbox_draft_id", "is", null);

  if (queryErr) {
    console.error("[draft-reconciliation] pending-row query failed:", queryErr);
    return;
  }

  if (!pendingRows || pendingRows.length === 0) {
    // Fast path — no AI drafts to reconcile on this thread.
    return;
  }

  // Step 2: One provider listDrafts() call; build a Set of current draft ids.
  let currentDraftIds: Set<string>;
  try {
    const provider = EmailService.getProvider(connection);
    const drafts = await provider.listDrafts();
    currentDraftIds = new Set(drafts.map((d) => d.id));
  } catch (err) {
    console.error(
      "[draft-reconciliation] listDrafts failed (non-fatal, will retry next sync):",
      err
    );
    return;
  }

  // Step 3: Query outbound activities for this thread (all of them, ordered oldest-first).
  const { data: outboundActivities } = await supabase
    .from("activities")
    .select("id, body_text, created_at")
    .eq("company_id", connection.companyId)
    .eq("email_thread_id", providerThreadId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: true });

  const outbound = outboundActivities ?? [];

  // We also need all message bodies in the thread (for quote-stripping).
  const { data: allActivities } = await supabase
    .from("activities")
    .select("id, body_text, created_at, direction")
    .eq("company_id", connection.companyId)
    .eq("email_thread_id", providerThreadId)
    .order("created_at", { ascending: true });

  const allRows = allActivities ?? [];

  const now = new Date();

  // Step 4: Classify and act on each pending row independently.
  for (const row of pendingRows) {
    try {
      const rowCreatedAt = new Date(row.created_at as string);
      const mailboxDraftId = row.mailbox_draft_id as string;

      const draftStillInMailbox = currentDraftIds.has(mailboxDraftId);

      // Outbound activities that arrived AFTER this draft row was created.
      const outboundAfter = outbound.filter(
        (a) => new Date(a.created_at as string) > rowCreatedAt
      );
      const hasOutboundAfter = outboundAfter.length > 0;

      const daysSinceDraft = Math.floor(
        (now.getTime() - rowCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      const outcome = classifyDraftOutcome({
        draftStillInMailbox,
        hasOutboundAfter,
        daysSinceDraft,
      });

      switch (outcome) {
        case "used": {
          // User sent the AI draft (possibly edited). Feed back into learning.
          const latestOutbound = outboundAfter[outboundAfter.length - 1];
          const rawBody = (latestOutbound?.body_text as string) ?? "";

          // Normalize: strip quoted prior messages and quote-marker lines so the
          // edit-distance comparison is against only the NEW content the user typed.
          // Exclude the exact reply under assessment by activity id (not by
          // body value — two identical bodies in a thread must not both drop).
          const priorBodies = allRows
            .filter((a) => a.id !== latestOutbound?.id)
            .map((a) => (a.body_text as string) ?? "")
            .filter(Boolean);
          let cleanBody = stripPriorMessageOverlap(rawBody, priorBodies);
          cleanBody = stripQuotedContent(cleanBody);

          await AIDraftService.recordDraftOutcome(
            row.id as string,
            row.company_id as string,
            row.user_id as string,
            "sent",
            cleanBody,
            (row.profile_type as string) ?? "general"
          );

          // recordDraftOutcome sets status='sent'. Override with 'sent_from_mailbox'
          // to distinguish mailbox-provenance outcomes from in-app Send outcomes.
          await supabase
            .from("ai_draft_history")
            .update({ status: "sent_from_mailbox" })
            .eq("id", row.id);
          break;
        }

        case "from_scratch": {
          // User sent a fresh reply, ignoring our draft. Update status only —
          // do NOT call recordDraftOutcome. The existing learnFromOutboundEmail
          // call in sync-engine (~L1451) already captured this reply as a voice
          // sample; calling recordDraftOutcome here would register a bogus 100%
          // rewrite and poison the edit-distance learning signal.
          await supabase
            .from("ai_draft_history")
            .update({ status: "superseded" })
            .eq("id", row.id);
          break;
        }

        case "discarded": {
          await supabase
            .from("ai_draft_history")
            .update({ status: "discarded_in_mailbox" })
            .eq("id", row.id);
          break;
        }

        case "pending":
          // Too early — do nothing. Re-evaluated on next sync.
          break;
      }
    } catch (err) {
      // One row's failure must not abort others.
      console.error(
        `[draft-reconciliation] row ${row.id} failed (non-fatal):`,
        err
      );
    }
  }
}

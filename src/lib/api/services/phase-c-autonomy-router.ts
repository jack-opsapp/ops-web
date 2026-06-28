/**
 * OPS Web - Phase C Autonomy Router
 *
 * Called after a thread is classified (EmailThreadService.classifyAndUpdate)
 * and on every new inbound message that lands on a classified thread
 * (sync-engine step 7.6). Reads the per-category autonomy level stored on
 * the owning email_connection and dispatches the corresponding Phase C action:
 *
 *   off               → no-op
 *   draft_on_request  → no-op (user clicks AI Draft manually)
 *   auto_draft        → generate a draft in the connected mailbox Drafts folder
 *   auto_send         → draft + schedule an AutoSend (pending_auto_sends row)
 *   auto_archive      → archive the thread via EmailThreadService.archive
 *   auto_follow_up    → LEAD only — if the last outbound is stale, draft + schedule a nudge
 *
 * Global gate: if the GLOBAL Phase C autonomy level is below AUTO_SEND (level 4)
 * we cap auto_send and auto_follow_up to auto_draft behavior so nothing is
 * actually sent autonomously until the user has crossed the global threshold.
 *
 * The router is defensive: any failure logs and returns gracefully —
 * classification must never fail because of a routing error.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { AutonomyMilestoneService } from "./autonomy-milestone-service";
import { AutoSendService } from "./auto-send-service";
import { AIDraftService } from "./ai-draft-service";
import { EmailService } from "./email-service";
import { EmailThreadService } from "./email-thread-service";
import {
  pickExistingMailboxDraft,
  type MailboxDraftRow,
} from "./mailbox-draft-helpers";
import { PhaseCCategoryAutonomy } from "./phase-c-category-autonomy-service";
import type {
  EmailThread,
  EmailThreadAutonomyLevel,
  EmailThreadCategory,
} from "@/lib/types/email-thread";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Days of outbound silence before LEAD auto_follow_up triggers a nudge. */
const STALE_LEAD_DAYS = 7;

/** Global Phase C gate — category-level auto_send is capped below this level. */
const GLOBAL_AUTO_SEND_LEVEL = 4;

// ─── Types ───────────────────────────────────────────────────────────────────

export type RouterOutcome =
  | "noop_off"
  | "noop_draft_on_request"
  | "noop_not_stale"
  | "noop_not_inbound"
  | "noop_archived"
  | "noop_global_gate"
  | "auto_drafted"
  | "auto_sent_scheduled"
  | "auto_archived"
  | "auto_follow_up_scheduled"
  /**
   * AIDraftService returned no draft because it needed operator input;
   * the empty-response fallback formulated a question and wrote it to
   * `email_threads.agent_blocking_question`. Surfaces in the inbox as
   * the lavender NEEDS_INPUT band.
   */
  | "escalated_to_operator"
  | "error";

export interface RouterResult {
  outcome: RouterOutcome;
  category: EmailThreadCategory;
  effectiveLevel: EmailThreadAutonomyLevel;
  detail?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveConnectionOwner(
  connectionId: string
): Promise<{ userId: string | null }> {
  const supabase = requireSupabase();
  const { data } = await supabase
    .from("email_connections")
    .select("user_id")
    .eq("id", connectionId)
    .maybeSingle();
  return { userId: (data?.user_id as string | null) ?? null };
}

function isThreadActionable(thread: EmailThread): boolean {
  return thread.archivedAt === null && thread.snoozedUntil === null;
}

/**
 * P4-A cost guard: has Phase C already auto-drafted a reply for the LATEST
 * inbound message on this thread?
 *
 * `auto_draft` means "one draft per genuinely-new inbound message", NOT "one
 * draft per re-sync". sync-engine flags `needsClassify=true` for EVERY inbound
 * on a non-manually-set thread, and the inbound-reuse path also fires the
 * router — so without this guard a thread that re-syncs / gets reclassified
 * while its latest message is still inbound would re-invoke the draft LLM each
 * time. We pin idempotency to the provider message id the draft replies to:
 * the latest inbound activity's `email_message_id`, recorded on
 * `ai_draft_history.source_message_id`.
 *
 * Returns the latest inbound provider message id when a fresh draft IS needed,
 * or `null` when an open phase_c draft already covers that message (caller
 * short-circuits before the LLM call). A null latest-inbound id (provider gave
 * us no message id) also returns "needs draft" — we can't dedup what we can't
 * key, and mailbox draft idempotency still guards provider placement.
 */
async function latestInboundNeedsDraft(
  thread: EmailThread
): Promise<{ needsDraft: boolean; sourceMessageId: string | null }> {
  const supabase = requireSupabase();

  // The provider message id of the most recent inbound message on the thread.
  const { data: latest } = await supabase
    .from("activities")
    .select("email_message_id")
    .eq("company_id", thread.companyId)
    .eq("email_thread_id", thread.providerThreadId)
    .eq("type", "email")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sourceMessageId =
    (latest?.email_message_id as string | null) ?? null;

  // Can't dedup without a stable message key — let the draft proceed. The
  // mailbox placement path still reuses an existing unresolved provider draft
  // for this thread.
  if (!sourceMessageId) {
    return { needsDraft: true, sourceMessageId };
  }

  // Has any Phase C draft already been generated for this exact inbound
  // provider message? Any terminal status still suppresses re-drafting: a user
  // who sent, ignored, or deleted the draft should not get the same draft again
  // until a genuinely new inbound message arrives.
  const { data: matching } = await supabase
    .from("ai_draft_history")
    .select("id")
    .eq("company_id", thread.companyId)
    .eq("connection_id", thread.connectionId)
    .eq("thread_id", thread.providerThreadId)
    .eq("origin", "phase_c")
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();

  // A matching draft already covers this inbound message → no new LLM.
  return { needsDraft: !matching, sourceMessageId };
}

async function placePhaseCMailboxDraft(
  thread: EmailThread,
  draft: {
    draft: string;
    draftHistoryId: string;
    subject?: string;
  }
): Promise<{ mailboxDraftId: string }> {
  const supabase = requireSupabase();
  const to = thread.latestSenderEmail?.trim();
  if (!to) {
    throw new Error("no inbound sender on thread");
  }

  const connection = await EmailService.getConnection(thread.connectionId);
  if (!connection) {
    throw new Error("connection not found");
  }
  if (connection.companyId !== thread.companyId) {
    throw new Error("connection company mismatch");
  }

  const provider = EmailService.getProvider(connection);
  const subject = draft.subject?.trim()
    ? draft.subject
    : thread.subject?.toLowerCase().startsWith("re:")
      ? thread.subject
      : `Re: ${thread.subject ?? ""}`.trim();

  const { data: priorRows } = await supabase
    .from("ai_draft_history")
    .select("id, mailbox_draft_id, status")
    .eq("connection_id", thread.connectionId)
    .eq("thread_id", thread.providerThreadId)
    .eq("origin", "phase_c");

  const existing = pickExistingMailboxDraft(
    (priorRows ?? []) as MailboxDraftRow[]
  );

  let mailboxDraftId: string;
  if (existing?.mailbox_draft_id) {
    await provider.updateDraft(
      existing.mailbox_draft_id,
      to,
      subject,
      draft.draft,
      thread.providerThreadId
    );
    mailboxDraftId = existing.mailbox_draft_id;
  } else {
    mailboxDraftId = await provider.createDraft(
      to,
      subject,
      draft.draft,
      thread.providerThreadId
    );
  }

  await supabase
    .from("ai_draft_history")
    .update({
      status: "auto_drafted",
      mailbox_draft_id: mailboxDraftId,
      thread_id: thread.providerThreadId,
      subject,
      subject_source: "generated",
    })
    .eq("id", draft.draftHistoryId);

  return { mailboxDraftId };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const PhaseCAutonomyRouter = {
  /**
   * Core entry point. Non-throwing — all errors are caught and logged.
   */
  async route(thread: EmailThread): Promise<RouterResult> {
    const category = thread.primaryCategory;

    try {
      // Skip threads already out of the active inbox.
      if (!isThreadActionable(thread)) {
        return { outcome: "noop_archived", category, effectiveLevel: "off" };
      }

      const autonomyMap = await PhaseCCategoryAutonomy.get(thread.connectionId);
      const declared = autonomyMap[category] ?? "off";

      const { userId } = await resolveConnectionOwner(thread.connectionId);
      if (!userId) {
        return {
          outcome: "error",
          category,
          effectiveLevel: declared,
          detail: "connection has no owner user_id",
        };
      }

      // Global AUTO_SEND gate — cap any send-capable level to auto_draft
      // until the user has crossed the global milestone.
      let effective = declared;
      if (
        declared === "auto_send" ||
        declared === "auto_follow_up"
      ) {
        const globalState = await AutonomyMilestoneService.getAutonomyLevel(
          thread.companyId,
          userId,
          thread.connectionId
        );
        if (globalState.level < GLOBAL_AUTO_SEND_LEVEL) {
          effective = "auto_draft";
        }
      }

      switch (effective) {
        case "off":
          return { outcome: "noop_off", category, effectiveLevel: effective };

        case "draft_on_request":
          return {
            outcome: "noop_draft_on_request",
            category,
            effectiveLevel: effective,
          };

        case "auto_draft":
          return await this.doAutoDraft(thread, userId, effective);

        case "auto_send":
          return await this.doAutoSend(thread, userId, effective);

        case "auto_archive":
          return await this.doAutoArchive(thread, effective);

        case "auto_follow_up":
          return await this.doAutoFollowUp(thread, userId, effective);
      }
    } catch (err) {
      console.error(
        "[phase-c-router] route failed for thread",
        thread.id,
        err instanceof Error ? err.message : err
      );
      return {
        outcome: "error",
        category,
        effectiveLevel: "off",
        detail: err instanceof Error ? err.message : "unknown",
      };
    }
  },

  /**
   * auto_draft — generate a draft via AIDraftService and place it in the
   * connected mailbox Drafts folder. The user reviews/sends from Gmail/Outlook.
   * Only drafts on INBOUND triggers so Phase C isn't drafting replies to
   * its own sent messages.
   */
  async doAutoDraft(
    thread: EmailThread,
    userId: string,
    effective: EmailThreadAutonomyLevel
  ): Promise<RouterResult> {
    if (thread.latestDirection !== "inbound") {
      return {
        outcome: "noop_not_inbound",
        category: thread.primaryCategory,
        effectiveLevel: effective,
      };
    }

    if (!thread.latestSenderEmail) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "no inbound sender on thread",
      };
    }

    // P4-A cost guard: short-circuit BEFORE the draft LLM if we already
    // auto-drafted for this exact inbound message. Prevents one-draft-per-resync
    // from re-invoking the model on a thread whose latest message is unchanged.
    const { needsDraft } = await latestInboundNeedsDraft(thread);
    if (!needsDraft) {
      return {
        outcome: "auto_drafted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "existing phase_c draft covers latest inbound (no re-draft)",
      };
    }

    const draft = await AIDraftService.generateDraft({
      companyId: thread.companyId,
      userId,
      connectionId: thread.connectionId,
      opportunityId: thread.opportunityId ?? undefined,
      threadId: thread.providerThreadId,
      profileTypeOverride: PhaseCCategoryAutonomy.profileTypesFor(
        thread.primaryCategory
      )[0],
      // P4-B: stamp ai_draft_history.origin so the Phase C auto-drafts are
      // distinguishable from operator/compose drafts.
      origin: "phase_c",
    });

    if (!draft.available) {
      // Empty-response escalation path — the AIDraftService asked Claude
      // to formulate a question instead of a draft and wrote it to
      // `email_threads.agent_blocking_question`. Surface that distinctly
      // from generic errors so callers can log the success.
      if (draft.escalated) {
        return {
          outcome: "escalated_to_operator",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: draft.reason,
        };
      }
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: draft.reason ?? "draft unavailable",
      };
    }

    if (!draft.draftHistoryId) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "draft history id missing",
      };
    }

    try {
      const placed = await placePhaseCMailboxDraft(thread, draft);
      return {
        outcome: "auto_drafted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: placed.mailboxDraftId,
      };
    } catch (err) {
      console.error(
        "[phase-c-router] mailbox draft placement failed (non-fatal):",
        thread.id,
        err instanceof Error ? err.message : err
      );
      await requireSupabase()
        .from("ai_draft_history")
        .update({ status: "auto_drafted" })
        .eq("id", draft.draftHistoryId);
    }

    return {
      outcome: "auto_drafted",
      category: thread.primaryCategory,
      effectiveLevel: effective,
      detail: draft.draftHistoryId,
    };
  },

  /**
   * auto_send — fully autonomous: generate draft, schedule send with
   * randomized business-hour-aware delay via AutoSendService.
   */
  async doAutoSend(
    thread: EmailThread,
    userId: string,
    effective: EmailThreadAutonomyLevel
  ): Promise<RouterResult> {
    if (thread.latestDirection !== "inbound") {
      return {
        outcome: "noop_not_inbound",
        category: thread.primaryCategory,
        effectiveLevel: effective,
      };
    }

    const { enabled, settings } = await AutoSendService.isEnabled(
      thread.companyId,
      thread.connectionId
    );
    if (!enabled || !settings) {
      // Feature or setting is off — fall back to auto_draft behavior.
      return await this.doAutoDraft(thread, userId, "auto_draft");
    }

    // Resolve reply recipients from the latest inbound message.
    const toEmails = thread.latestSenderEmail
      ? [thread.latestSenderEmail]
      : [];
    if (toEmails.length === 0) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "no inbound sender on thread",
      };
    }

    const subject = thread.subject?.toLowerCase().startsWith("re:")
      ? thread.subject
      : `Re: ${thread.subject ?? ""}`;

    const scheduled = await AutoSendService.scheduleAutoSend({
      companyId: thread.companyId,
      userId,
      connectionId: thread.connectionId,
      opportunityId: thread.opportunityId ?? undefined,
      threadId: thread.providerThreadId,
      toEmails,
      subject,
      settings,
    });

    if (!scheduled) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "auto-send schedule failed",
      };
    }

    return {
      outcome: "auto_sent_scheduled",
      category: thread.primaryCategory,
      effectiveLevel: effective,
      detail: scheduled.id,
    };
  },

  /**
   * auto_archive — immediately archive the thread. Skips provider write-back
   * when the connection's archive_writeback_preference is 'ask' (user hasn't
   * chosen) since auto_archive implies the user has deliberately opted in.
   * In that 'ask' case we archive OPS-only.
   */
  async doAutoArchive(
    thread: EmailThread,
    effective: EmailThreadAutonomyLevel
  ): Promise<RouterResult> {
    // P4-E hard refuse: CUSTOMER threads must NEVER auto-archive. auto_archive
    // is not in allowedLevelsFor('CUSTOMER'), so this should be unreachable —
    // but a stale stored config or a future routing change must not silently
    // archive a customer conversation. Fail safe to a no-op.
    if (thread.primaryCategory === "CUSTOMER") {
      console.error(
        "[phase-c-router] refused auto_archive for CUSTOMER thread",
        thread.id
      );
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "auto_archive refused for CUSTOMER category",
      };
    }

    const result = await EmailThreadService.archive({ threadId: thread.id });
    if ("needsPreference" in result) {
      // Preference unresolved — fall through to OPS-only archive.
      const supabase = requireSupabase();
      await supabase
        .from("email_threads")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", thread.id);
    }
    return {
      outcome: "auto_archived",
      category: thread.primaryCategory,
      effectiveLevel: effective,
    };
  },

  /**
   * auto_follow_up — LEAD/CLIENT only. Triggers a nudge when the thread has
   * been quiet for STALE_LEAD_DAYS with an outbound as the most recent
   * direction (i.e., we replied, they didn't). Uses the same pending_auto_sends
   * pipeline as auto_send so it is also business-hour gated.
   */
  async doAutoFollowUp(
    thread: EmailThread,
    userId: string,
    effective: EmailThreadAutonomyLevel
  ): Promise<RouterResult> {
    const lastOutbound = thread.latestDirection === "outbound";
    const cutoff = Date.now() - STALE_LEAD_DAYS * 86_400_000;
    const isStale = thread.lastMessageAt.getTime() < cutoff;

    if (!lastOutbound || !isStale) {
      return {
        outcome: "noop_not_stale",
        category: thread.primaryCategory,
        effectiveLevel: effective,
      };
    }

    const { enabled, settings } = await AutoSendService.isEnabled(
      thread.companyId,
      thread.connectionId
    );
    if (!enabled || !settings) {
      return await this.doAutoDraft(thread, userId, "auto_draft");
    }

    const toEmails = thread.participants.filter(
      (p) => p && !p.endsWith(">") // tolerates "Name <email>" formats
    );
    if (toEmails.length === 0 && thread.latestSenderEmail) {
      toEmails.push(thread.latestSenderEmail);
    }

    const subject = thread.subject?.toLowerCase().startsWith("re:")
      ? thread.subject
      : `Re: ${thread.subject ?? ""}`;

    const scheduled = await AutoSendService.scheduleAutoSend({
      companyId: thread.companyId,
      userId,
      connectionId: thread.connectionId,
      opportunityId: thread.opportunityId ?? undefined,
      threadId: thread.providerThreadId,
      toEmails,
      subject,
      settings,
    });

    if (!scheduled) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "follow-up schedule failed",
      };
    }

    return {
      outcome: "auto_follow_up_scheduled",
      category: thread.primaryCategory,
      effectiveLevel: effective,
      detail: scheduled.id,
    };
  },
};

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
 *   auto_draft        → generate a draft and stash it (no send)
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
import { EmailThreadService } from "./email-thread-service";
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
   * auto_draft — generate a draft via AIDraftService and store it in
   * ai_draft_history (status='drafted'). The user reviews via the inbox.
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

    const draft = await AIDraftService.generateDraft({
      companyId: thread.companyId,
      userId,
      connectionId: thread.connectionId,
      opportunityId: thread.opportunityId ?? undefined,
      threadId: thread.providerThreadId,
      profileTypeOverride: PhaseCCategoryAutonomy.profileTypesFor(
        thread.primaryCategory
      )[0],
    });

    if (!draft.available) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: draft.reason ?? "draft unavailable",
      };
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

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
import { AIDraftService, type AIDraftResult } from "./ai-draft-service";
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
 * the latest inbound activity's `email_message_id`, recorded on the bridged
 * `ai_draft_history.source_message_id`.
 *
 * Returns the latest inbound provider message id when a fresh draft IS needed,
 * or `null` when an open phase_c draft already covers that message (caller
 * short-circuits before the LLM call). A null latest-inbound id (provider gave
 * us no message id) also returns "needs draft" — we can't dedup what we can't
 * key, and the paired-draft idempotency check still guards the DB insert.
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

  // Can't dedup without a stable message key — let the draft proceed (the
  // paired-draft insert is still idempotent on the bridge id).
  if (!sourceMessageId || !thread.opportunityId) {
    return { needsDraft: true, sourceMessageId };
  }

  // Is there already an OPEN phase_c draft bridged to an ai_draft_history row
  // whose source_message_id is this exact inbound message? Two cheap reads:
  // open phase_c bridges for this opportunity+thread, then match the message.
  let openQuery = supabase
    .from("opportunity_follow_up_drafts")
    .select("ai_draft_history_id")
    .eq("company_id", thread.companyId)
    .eq("opportunity_id", thread.opportunityId)
    .eq("origin", "phase_c")
    .eq("status", "drafted")
    .not("ai_draft_history_id", "is", null);
  openQuery = thread.providerThreadId
    ? openQuery.eq("provider_thread_id", thread.providerThreadId)
    : openQuery.is("provider_thread_id", null);
  const { data: openDrafts } = await openQuery;

  const bridgeIds = (openDrafts ?? [])
    .map((d) => d.ai_draft_history_id as string | null)
    .filter((id): id is string => !!id);

  if (bridgeIds.length === 0) {
    return { needsDraft: true, sourceMessageId };
  }

  const { data: matching } = await supabase
    .from("ai_draft_history")
    .select("id")
    .eq("company_id", thread.companyId)
    .in("id", bridgeIds)
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();

  // A matching open draft already covers this inbound message → no new LLM.
  return { needsDraft: !matching, sourceMessageId };
}

/**
 * P4-C: create the first-class `origin='phase_c'` local draft paired with the
 * just-generated ai_draft_history row.
 *
 * Coexistence rules (bible §10, line 1797): phase_c drafts NEVER supersede an
 * operator or template_follow_up draft — those are independent origins that
 * coexist. The one-open-template unique index only covers
 * `origin='template_follow_up'`, so phase_c rows never collide with it.
 *
 * To avoid an unbounded pile of open phase_c drafts on a chatty thread, we
 * supersede the prior OPEN phase_c draft on the SAME opportunity+thread before
 * inserting the new one (mirroring template behavior, using status
 * 'superseded'). Operator/template drafts are untouched.
 */
async function createPhaseCPairedDraft(
  thread: EmailThread,
  userId: string,
  draft: AIDraftResult
): Promise<void> {
  const supabase = requireSupabase();
  const now = new Date().toISOString();

  // Supersede a prior open phase_c draft on the same opportunity+thread.
  // Scoped strictly to origin='phase_c' so operator/template drafts can never
  // be retired by this path.
  let supersedeQuery = supabase
    .from("opportunity_follow_up_drafts")
    .update({ status: "superseded", superseded_at: now, updated_at: now })
    .eq("company_id", thread.companyId)
    .eq("opportunity_id", thread.opportunityId as string)
    .eq("origin", "phase_c")
    .eq("status", "drafted");
  supersedeQuery = thread.providerThreadId
    ? supersedeQuery.eq("provider_thread_id", thread.providerThreadId)
    : supersedeQuery.is("provider_thread_id", null);
  const { error: supErr } = await supersedeQuery;
  if (supErr) {
    console.error(
      "[phase-c-router] phase_c supersede failed (continuing):",
      supErr.message
    );
  }

  // If the bridged ai_draft_history row already produced a paired phase_c
  // draft (idempotency on reclassify re-fire), don't double-insert.
  const { data: existing } = await supabase
    .from("opportunity_follow_up_drafts")
    .select("id")
    .eq("company_id", thread.companyId)
    .eq("ai_draft_history_id", draft.draftHistoryId)
    .maybeSingle();
  if (existing) return;

  const { error: insErr } = await supabase
    .from("opportunity_follow_up_drafts")
    .insert({
      company_id: thread.companyId,
      opportunity_id: thread.opportunityId as string,
      connection_id: thread.connectionId,
      provider_thread_id: thread.providerThreadId,
      origin: "phase_c",
      status: "drafted",
      subject: draft.subject ?? "",
      original_body: draft.draft,
      ai_draft_history_id: draft.draftHistoryId,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });
  if (insErr) {
    // Surface as a thrown error so the caller logs it (non-fatal at the
    // doAutoDraft boundary — the ai_draft_history row already exists).
    throw new Error(`phase_c paired draft insert failed: ${insErr.message}`);
  }
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

    // P4-C: create the paired first-class local draft row so the phase_c
    // auto-draft is visible in the unified draft model (/api/inbox/drafts)
    // alongside template/operator drafts, with durable provenance bridged to
    // ai_draft_history via ai_draft_history_id. Best-effort: a failure here
    // must not turn a successful generate into an error — the ai_draft_history
    // row already exists and the draft is usable.
    if (draft.draftHistoryId && thread.opportunityId) {
      try {
        await createPhaseCPairedDraft(thread, userId, draft);
      } catch (err) {
        console.error(
          "[phase-c-router] paired phase_c draft creation failed (non-fatal):",
          thread.id,
          err instanceof Error ? err.message : err
        );
      }
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

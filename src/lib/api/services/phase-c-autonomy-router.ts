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
 * Autonomous sending is gated by the exact OPS actor, mailbox, and primary
 * category graduation record. There is intentionally no mailbox-wide accuracy
 * threshold: unrelated categories must neither unlock nor block this thread.
 *
 * The router is defensive: any failure logs and returns gracefully —
 * classification must never fail because of a routing error.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { AutoSendService } from "./auto-send-service";
import { AIDraftService } from "./ai-draft-service";
import { EmailService } from "./email-service";
import { EmailThreadService } from "./email-thread-service";
import {
  pickExistingMailboxDraft,
  type MailboxDraftRow,
} from "./mailbox-draft-helpers";
import { PhaseCCategoryAutonomy } from "./phase-c-category-autonomy-service";
import { normalizeReplySubject } from "@/lib/email/email-subject-policy";
import {
  renderMailboxDraftWithSignature,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";
import {
  resolvePhaseCEmailActor,
  type PhaseCEmailActorContext,
} from "@/lib/email/phase-c-email-actor";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
import type {
  EmailThread,
  EmailThreadAutonomyLevel,
  EmailThreadCategory,
} from "@/lib/types/email-thread";
import { runEmailProviderMailboxOperation } from "./email-provider-mailbox-operation";
import {
  buildEmailProviderMutationFingerprint,
  createEmailProviderMutationAttemptService,
} from "./email-provider-mutation-attempt-service";

// ─── Config ──────────────────────────────────────────────────────────────────

/** Days of outbound silence before LEAD auto_follow_up triggers a nudge. */
const STALE_LEAD_DAYS = 7;

// ─── Types ───────────────────────────────────────────────────────────────────

export type RouterOutcome =
  | "noop_off"
  | "noop_draft_on_request"
  | "noop_not_stale"
  | "noop_not_inbound"
  | "noop_archived"
  | "noop_actor_unavailable"
  | "draft_placement_pending"
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
  /**
   * The deterministic router held the thread for review
   * (routing='require_human_review'), so the autonomous draft/send was
   * suppressed. Distinct from `noop_off` (user choice) and `error` — this is the
   * Phase 3 safety gate doing its job. Surfaces the routing reasons in `detail`.
   */
  | "noop_held_for_review"
  | "error";

export interface RouterResult {
  outcome: RouterOutcome;
  category: EmailThreadCategory;
  effectiveLevel: EmailThreadAutonomyLevel;
  detail?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  thread: EmailThread,
  userId: string
): Promise<{
  needsDraft: boolean;
  sourceMessageId: string | null;
  retryDraft: {
    draft: string;
    draftHistoryId: string;
    subject?: string;
  } | null;
}> {
  const supabase = requireSupabase();

  // The provider message id of the most recent inbound message on the thread.
  const { data: latest } = await supabase
    .from("activities")
    .select("email_message_id")
    .eq("company_id", thread.companyId)
    .eq("email_connection_id", thread.connectionId)
    .eq("email_thread_id", thread.providerThreadId)
    .eq("type", "email")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sourceMessageId = (latest?.email_message_id as string | null) ?? null;

  // Can't dedup without a stable message key — let the draft proceed. The
  // mailbox placement path still reuses an existing unresolved provider draft
  // for this thread.
  if (!sourceMessageId) {
    return { needsDraft: true, sourceMessageId, retryDraft: null };
  }

  // Has any Phase C draft already been generated for this exact inbound
  // provider message? Any terminal status still suppresses re-drafting: a user
  // who sent, ignored, or deleted the draft should not get the same draft again
  // until a genuinely new inbound message arrives.
  const { data: matching } = await supabase
    .from("ai_draft_history")
    .select("id, status, mailbox_draft_id, original_draft, subject")
    .eq("company_id", thread.companyId)
    .eq("connection_id", thread.connectionId)
    .eq("thread_id", thread.providerThreadId)
    .eq("user_id", userId)
    .eq("origin", "phase_c")
    .eq("source_message_id", sourceMessageId)
    .limit(1)
    .maybeSingle();

  const retryDraft =
    matching?.status === "drafted" &&
    !matching.mailbox_draft_id &&
    typeof matching.original_draft === "string" &&
    matching.original_draft.trim() &&
    typeof matching.id === "string"
      ? {
          draft: matching.original_draft,
          draftHistoryId: matching.id,
          ...(typeof matching.subject === "string" && matching.subject.trim()
            ? { subject: matching.subject }
            : {}),
        }
      : null;

  // A matching draft already covers this inbound message → no new LLM.
  return {
    needsDraft: !matching,
    sourceMessageId,
    retryDraft,
  };
}

class PhaseCThreadAuthorizationError extends Error {
  constructor(readonly reason: string) {
    super(`Phase C thread authorization revoked: ${reason}`);
    this.name = "PhaseCThreadAuthorizationError";
  }
}

async function authorizeCurrentPhaseCThread(
  thread: EmailThread,
  userId: string,
  operation: "send" | "mutate"
) {
  return resolveEmailOpportunityAccess({
    actor: { userId, companyId: thread.companyId },
    operation,
    threadId: thread.id,
    connectionId: thread.connectionId,
    providerThreadId: thread.providerThreadId,
    opportunityId: thread.opportunityId ?? undefined,
    supabase: requireSupabase(),
  });
}

async function placePhaseCMailboxDraft(
  thread: EmailThread,
  userId: string,
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

  return runEmailProviderMailboxOperation({
    supabase,
    connectionId: connection.id,
    context: "phase-c-mailbox-draft-placement",
    busyError: "PHASE_C_DRAFT_MAILBOX_BUSY",
    run: async (checkpoint) => {
      const provider = EmailService.getProvider(connection);
      const signature = await resolveEmailSignatureForMessage({
        supabase,
        connection,
        userId,
        refreshProviderIfMissing: true,
        providerLockCheckpoint: checkpoint,
      });
      const renderedDraft = renderMailboxDraftWithSignature(
        draft.draft,
        signature
      );
      const subject = draft.subject?.trim()
        ? draft.subject
        : normalizeReplySubject(thread.subject ?? "");

      const { data: priorRows } = await supabase
        .from("ai_draft_history")
        .select("id, mailbox_draft_id, status")
        .eq("company_id", thread.companyId)
        .eq("user_id", userId)
        .eq("connection_id", thread.connectionId)
        .eq("thread_id", thread.providerThreadId)
        .eq("origin", "phase_c");

      const existing = pickExistingMailboxDraft(
        (priorRows ?? []) as MailboxDraftRow[]
      );

      // Signature work can take long enough for a lead handoff. Re-check the
      // exact thread/lead/mailbox intersection while holding the physical
      // mailbox lease, immediately before the provider mutation.
      const currentAccess = await authorizeCurrentPhaseCThread(
        thread,
        userId,
        "send"
      );
      if (!currentAccess.allowed) {
        throw new PhaseCThreadAuthorizationError(currentAccess.reason);
      }

      let mailboxDraftId: string;
      if (existing?.mailbox_draft_id) {
        await checkpoint();
        await provider.updateDraft(
          existing.mailbox_draft_id,
          to,
          subject,
          renderedDraft.body,
          thread.providerThreadId,
          renderedDraft.contentType
        );
        mailboxDraftId = existing.mailbox_draft_id;

        // This is an idempotent update of an already-bound provider draft.
        await checkpoint();
        const { data: reassigned, error: reassignError } = await supabase.rpc(
          "reassign_phase_c_mailbox_draft",
          {
            p_company_id: thread.companyId,
            p_connection_id: thread.connectionId,
            p_new_draft_history_id: draft.draftHistoryId,
            p_mailbox_draft_id: mailboxDraftId,
            p_thread_id: thread.providerThreadId,
            p_expected_old_draft_history_id: existing.id,
          }
        );
        if (reassignError || !reassigned) {
          throw new Error(
            `mailbox draft history reassignment failed: ${reassignError?.message ?? "no row returned"}`
          );
        }
      } else {
        const mutationService =
          createEmailProviderMutationAttemptService(supabase);
        let createdThisInvocation = false;
        const completed = await mutationService.execute({
          actorUserId: userId,
          connectionId: thread.connectionId,
          operationKind: "draft_create",
          operationKey: `phase-c-reply-draft:${draft.draftHistoryId}`,
          assertMailboxLease: () => checkpoint(true),
          requestFingerprint: buildEmailProviderMutationFingerprint({
            version: 1,
            connectionId: thread.connectionId,
            opportunityId: thread.opportunityId,
            providerThreadId: thread.providerThreadId,
            draftHistoryId: draft.draftHistoryId,
            to: to.toLowerCase(),
          }),
          executeProvider: async () => {
            const latestAccess = await authorizeCurrentPhaseCThread(
              thread,
              userId,
              "send"
            );
            if (!latestAccess.allowed) {
              throw new PhaseCThreadAuthorizationError(latestAccess.reason);
            }
            await checkpoint();
            const draftId = await provider.createDraft(
              to,
              subject,
              renderedDraft.body,
              thread.providerThreadId,
              renderedDraft.contentType
            );
            createdThisInvocation = true;
            return {
              resourceId: draftId,
              result: { draftId },
            };
          },
          reconcile: async ({ resourceId }) => {
            if (!createdThisInvocation) {
              const latestAccess = await authorizeCurrentPhaseCThread(
                thread,
                userId,
                "send"
              );
              if (!latestAccess.allowed) {
                throw new PhaseCThreadAuthorizationError(latestAccess.reason);
              }
              await checkpoint();
              await provider.updateDraft(
                resourceId,
                to,
                subject,
                renderedDraft.body,
                thread.providerThreadId,
                renderedDraft.contentType
              );
            }

            // Provider identity is durable in the mutation ledger. Reconcile
            // the exact resource idempotently; never create again here.
            await checkpoint();
            const { data: reassigned, error: reassignError } =
              await supabase.rpc("reassign_phase_c_mailbox_draft", {
                p_company_id: thread.companyId,
                p_connection_id: thread.connectionId,
                p_new_draft_history_id: draft.draftHistoryId,
                p_mailbox_draft_id: resourceId,
                p_thread_id: thread.providerThreadId,
                p_expected_old_draft_history_id: null,
              });
            if (reassignError || !reassigned) {
              throw new Error(
                `mailbox draft history reassignment failed: ${reassignError?.message ?? "no row returned"}`
              );
            }
          },
        });
        if (!completed.providerResourceId) {
          throw new Error("durable provider draft identity missing");
        }
        mailboxDraftId = completed.providerResourceId;
      }

      return { mailboxDraftId };
    },
  });
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

      const mailboxPolicy = await PhaseCCategoryAutonomy.get(
        thread.connectionId
      );
      let declared = mailboxPolicy[category] ?? "off";

      let userId: string | null = null;
      let actorContext: PhaseCEmailActorContext | null = null;
      const needsActor =
        declared === "auto_draft" ||
        declared === "auto_send" ||
        declared === "auto_archive" ||
        declared === "auto_follow_up";
      if (needsActor) {
        const actorResolution = await resolvePhaseCEmailActor({
          companyId: thread.companyId,
          connectionId: thread.connectionId,
          opportunityId: thread.opportunityId,
          internalThreadId: thread.id,
          providerThreadId: thread.providerThreadId,
        });
        if (actorResolution.kind === "no_work") {
          return {
            outcome: "noop_actor_unavailable",
            category,
            effectiveLevel: declared,
            detail: actorResolution.reason,
          };
        }
        actorContext = actorResolution.context;
        userId = actorContext.actorUserId;

        const actorPolicy = await PhaseCCategoryAutonomy.get(
          thread.connectionId,
          userId
        );
        declared = actorPolicy[category] ?? "off";
      }

      // Exact-category gate — cap send-capable levels until this actor has
      // graduated on this mailbox and this primary category.
      let effective = declared;
      if (declared === "auto_send" || declared === "auto_follow_up") {
        if (!userId) {
          return {
            outcome: "noop_actor_unavailable",
            category,
            effectiveLevel: declared,
            detail: "actor_identity_invalid",
          };
        }
        const categoryGraduation = await PhaseCCategoryAutonomy.isGraduated(
          thread.companyId,
          thread.connectionId,
          userId,
          category
        );
        if (!categoryGraduation.ready) {
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
          if (!userId) {
            return {
              outcome: "noop_actor_unavailable",
              category,
              effectiveLevel: effective,
              detail: "actor_identity_invalid",
            };
          }
          return await this.doAutoDraft(thread, userId, effective);

        case "auto_send":
          if (!actorContext) {
            return {
              outcome: "noop_actor_unavailable",
              category,
              effectiveLevel: effective,
              detail: "actor_identity_invalid",
            };
          }
          return await this.doAutoSend(thread, actorContext, effective);

        case "auto_archive":
          if (!actorContext) {
            return {
              outcome: "noop_actor_unavailable",
              category,
              effectiveLevel: effective,
              detail: "actor_identity_invalid",
            };
          }
          return await this.doAutoArchive(
            thread,
            actorContext.actorUserId,
            effective
          );

        case "auto_follow_up":
          if (!actorContext) {
            return {
              outcome: "noop_actor_unavailable",
              category,
              effectiveLevel: effective,
              detail: "actor_identity_invalid",
            };
          }
          return await this.doAutoFollowUp(thread, actorContext, effective);
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

    const accessBeforeDraft = await authorizeCurrentPhaseCThread(
      thread,
      userId,
      "send"
    );
    if (!accessBeforeDraft.allowed) {
      return {
        outcome: "noop_actor_unavailable",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: accessBeforeDraft.reason,
      };
    }

    // P4-A cost guard: short-circuit BEFORE the draft LLM if we already
    // auto-drafted for this exact inbound message. Prevents one-draft-per-resync
    // from re-invoking the model on a thread whose latest message is unchanged.
    const { needsDraft, retryDraft } = await latestInboundNeedsDraft(
      thread,
      userId
    );
    let draft: {
      draft: string;
      draftHistoryId: string;
      subject?: string;
    } | null = retryDraft;
    if (!draft && !needsDraft) {
      return {
        outcome: "auto_drafted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "existing phase_c draft covers latest inbound (no re-draft)",
      };
    }

    if (!draft) {
      const generated = await AIDraftService.generateDraft({
        companyId: thread.companyId,
        userId,
        connectionId: thread.connectionId,
        opportunityId: thread.opportunityId ?? undefined,
        threadId: thread.providerThreadId,
        profileTypeOverride: PhaseCCategoryAutonomy.profileTypesFor(
          thread.primaryCategory
        )[0],
        // Phase 3 routing gate — a thread held for review is never auto-drafted.
        autonomous: true,
        // P4-B: stamp ai_draft_history.origin so the Phase C auto-drafts are
        // distinguishable from operator/compose drafts.
        origin: "phase_c",
      });

      if (!generated.available) {
        // Phase 3: the deterministic router held the thread for review. This is a
        // deliberate, explainable hold — surface it distinctly from errors so the
        // operator (and logs) see WHY autonomy stood down.
        if (generated.heldForReview) {
          return {
            outcome: "noop_held_for_review",
            category: thread.primaryCategory,
            effectiveLevel: effective,
            detail: generated.reason,
          };
        }
        // Empty-response escalation path — the AIDraftService asked Claude
        // to formulate a question instead of a draft and wrote it to
        // `email_threads.agent_blocking_question`. Surface that distinctly
        // from generic errors so callers can log the success.
        if (generated.escalated) {
          return {
            outcome: "escalated_to_operator",
            category: thread.primaryCategory,
            effectiveLevel: effective,
            detail: generated.reason,
          };
        }
        return {
          outcome: "error",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: generated.reason ?? "draft unavailable",
        };
      }

      if (!generated.draftHistoryId) {
        return {
          outcome: "error",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: "draft history id missing",
        };
      }

      draft = {
        draft: generated.draft,
        draftHistoryId: generated.draftHistoryId,
        ...(generated.subject ? { subject: generated.subject } : {}),
      };
    }

    try {
      const placed = await placePhaseCMailboxDraft(thread, userId, draft);
      return {
        outcome: "auto_drafted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: placed.mailboxDraftId,
      };
    } catch (err) {
      if (err instanceof PhaseCThreadAuthorizationError) {
        return {
          outcome: "noop_actor_unavailable",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: err.reason,
        };
      }
      console.error(
        "[phase-c-router] mailbox draft placement failed (non-fatal):",
        thread.id,
        err instanceof Error ? err.message : err
      );
      return {
        outcome: "draft_placement_pending",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: err instanceof Error ? err.message : "mailbox draft pending",
      };
    }
  },

  /**
   * auto_send — fully autonomous: generate draft, schedule send with
   * randomized business-hour-aware delay via AutoSendService.
   */
  async doAutoSend(
    thread: EmailThread,
    actorContext: PhaseCEmailActorContext,
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
      return await this.doAutoDraft(
        thread,
        actorContext.actorUserId,
        "auto_draft"
      );
    }

    // Resolve reply recipients from the latest inbound message.
    const toEmails = thread.latestSenderEmail ? [thread.latestSenderEmail] : [];
    if (toEmails.length === 0) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "no inbound sender on thread",
      };
    }

    const subject = normalizeReplySubject(thread.subject ?? "");

    const scheduled = await AutoSendService.scheduleAutoSend({
      category: thread.primaryCategory,
      companyId: thread.companyId,
      actorContext,
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
    userId: string,
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

    const access = await authorizeCurrentPhaseCThread(thread, userId, "mutate");
    if (!access.allowed) {
      return {
        outcome: "noop_actor_unavailable",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: access.reason,
      };
    }

    const result = await EmailThreadService.archive({
      threadId: thread.id,
      authorizeProviderMutation: async () =>
        (await authorizeCurrentPhaseCThread(thread, userId, "mutate")).allowed,
    });
    if ("needsPreference" in result) {
      // Preference unresolved — fall through to OPS-only archive.
      const accessBeforeOpsArchive = await authorizeCurrentPhaseCThread(
        thread,
        userId,
        "mutate"
      );
      if (!accessBeforeOpsArchive.allowed) {
        return {
          outcome: "noop_actor_unavailable",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: accessBeforeOpsArchive.reason,
        };
      }
      const supabase = requireSupabase();
      await supabase
        .from("email_threads")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", thread.id)
        .eq("company_id", thread.companyId)
        .eq("opportunity_id", thread.opportunityId);
    }
    return {
      outcome: "auto_archived",
      category: thread.primaryCategory,
      effectiveLevel: effective,
    };
  },

  /**
   * auto_follow_up — CUSTOMER only. Triggers a nudge when the thread has
   * been quiet for STALE_LEAD_DAYS with an outbound as the most recent
   * direction (i.e., we replied, they didn't). Uses the same pending_auto_sends
   * pipeline as auto_send so it is also business-hour gated.
   */
  async doAutoFollowUp(
    thread: EmailThread,
    actorContext: PhaseCEmailActorContext,
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
      return await this.doAutoDraft(
        thread,
        actorContext.actorUserId,
        "auto_draft"
      );
    }

    const toEmails = thread.participants.filter(
      (p) => p && !p.endsWith(">") // tolerates "Name <email>" formats
    );
    if (toEmails.length === 0 && thread.latestSenderEmail) {
      toEmails.push(thread.latestSenderEmail);
    }

    const subject = normalizeReplySubject(thread.subject ?? "");

    const scheduled = await AutoSendService.scheduleAutoSend({
      category: thread.primaryCategory,
      companyId: thread.companyId,
      actorContext,
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

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
import { emailSyncContinuationPendingForConnection } from "@/lib/email/email-sync-continuation-state";
import { normalizeEmailAddress } from "@/lib/utils/email-parsing";
import { buildConversationState } from "./conversation-state/conversation-state";

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
  | "noop_sync_incomplete"
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
  | "noop_no_reply_warranted"
  /**
   * Placement-only recovery found nothing stranded for the thread's latest
   * inbound message. Distinct from `noop_off`: autonomy is live, there is
   * simply no unplaced draft to re-drive, and recovery never mints one.
   */
  | "noop_no_stranded_draft"
  /**
   * Placement-only recovery reached a thread whose effective level is not
   * `auto_draft`. Mailbox placement is that level's contract and no other's,
   * so anything else is left to the pipeline that owns it.
   */
  | "noop_placement_not_applicable"
  | "error";

/**
 * Placement-only mode: re-drive a draft that already exists but never reached
 * the mailbox. It shares the full routing pre-flight and differs in two ways —
 * it never calls the draft model, and it never marks the thread dirty on a
 * deferral, because a recurring sweep doing either would spend money and
 * manufacture classification work on every cycle.
 */
interface RouteOptions {
  placementOnly?: boolean;
  /** Canonical route proof; never accepted from public/API input. */
  phaseCActorContext?: PhaseCEmailActorContext;
}

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
interface ExactEmailSourceTurn {
  resolution:
    "resolved" | "missing" | "ambiguous" | "read_error" | "history_read_error";
  sourceMessageId: string | null;
  sourceActivityId: string | null;
  sourceCreatedAt: Date | null;
  direction: "inbound" | "outbound" | null;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
}

function normalizeSourceRecipients(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeEmailAddress(value))
    .filter((value) => Boolean(value && /^[^\s@]+@[^\s@]+$/.test(value)));
}

async function latestEmailSource(
  thread: EmailThread
): Promise<ExactEmailSourceTurn> {
  const { data: sourceRows, error } = await requireSupabase()
    .from("activities")
    .select(
      "id, email_message_id, created_at, direction, from_email, to_emails, cc_emails"
    )
    .eq("company_id", thread.companyId)
    .eq("email_connection_id", thread.connectionId)
    .eq("email_thread_id", thread.providerThreadId)
    .eq("type", "email")
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(2);

  const unavailable = (
    resolution: ExactEmailSourceTurn["resolution"]
  ): ExactEmailSourceTurn => ({
    resolution,
    sourceMessageId: null,
    sourceActivityId: null,
    sourceCreatedAt: null,
    direction: null,
    fromEmail: null,
    toEmails: [],
    ccEmails: [],
  });
  if (error) {
    console.error(
      "[phase-c-router] latest email source load failed:",
      error.message
    );
    return unavailable("read_error");
  }

  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  const latest = rows[0] ?? null;
  if (!latest) return unavailable("missing");

  const latestId =
    typeof latest.id === "string" && latest.id.trim() ? latest.id.trim() : null;
  const latestCreatedAt =
    typeof latest.created_at === "string" ? new Date(latest.created_at) : null;
  if (
    !latestId ||
    !latestCreatedAt ||
    !Number.isFinite(latestCreatedAt.getTime())
  ) {
    return unavailable("missing");
  }

  const runnerUp = rows[1] ?? null;
  const runnerUpId =
    typeof runnerUp?.id === "string" && runnerUp.id.trim()
      ? runnerUp.id.trim()
      : null;
  const runnerUpCreatedAt =
    typeof runnerUp?.created_at === "string"
      ? new Date(runnerUp.created_at)
      : null;
  if (
    runnerUpId &&
    runnerUpId !== latestId &&
    runnerUpCreatedAt &&
    Number.isFinite(runnerUpCreatedAt.getTime()) &&
    runnerUpCreatedAt.getTime() === latestCreatedAt.getTime()
  ) {
    return unavailable("ambiguous");
  }

  return {
    resolution: "resolved",
    sourceMessageId: (latest?.email_message_id as string | null) ?? null,
    sourceActivityId: latestId,
    sourceCreatedAt: latestCreatedAt,
    direction:
      latest?.direction === "inbound" || latest?.direction === "outbound"
        ? latest.direction
        : null,
    fromEmail:
      typeof latest?.from_email === "string"
        ? normalizeEmailAddress(latest.from_email) || null
        : null,
    toEmails: normalizeSourceRecipients(latest?.to_emails),
    ccEmails: normalizeSourceRecipients(latest?.cc_emails),
  };
}

function inboundSourceRecipient(source: ExactEmailSourceTurn): string | null {
  const email = source.fromEmail;
  return email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

function exactSourceMatches(
  expected: ExactEmailSourceTurn,
  current: ExactEmailSourceTurn
): boolean {
  return (
    expected.resolution === "resolved" &&
    current.resolution === "resolved" &&
    Boolean(expected.sourceActivityId) &&
    expected.sourceActivityId === current.sourceActivityId &&
    expected.sourceMessageId === current.sourceMessageId &&
    expected.direction === current.direction
  );
}

function sourceResolutionFailureDetail(source: ExactEmailSourceTurn): string {
  switch (source.resolution) {
    case "ambiguous":
      return "PHASE_C_DRAFT_SOURCE_AMBIGUOUS";
    case "read_error":
      return "PHASE_C_DRAFT_SOURCE_READ_FAILED";
    case "history_read_error":
      return "PHASE_C_DRAFT_HISTORY_READ_FAILED";
    case "missing":
      return "PHASE_C_DRAFT_SOURCE_MISSING";
    case "resolved":
      return "PHASE_C_DRAFT_SOURCE_STALE";
  }
}

async function latestInboundNeedsDraft(
  thread: EmailThread,
  userId: string
): Promise<{
  needsDraft: boolean;
  sourceMessageId: string | null;
  sourceActivityId: string | null;
  source: ExactEmailSourceTurn;
  retryDraft: {
    draft: string;
    draftHistoryId: string;
    subject?: string;
  } | null;
}> {
  const supabase = requireSupabase();
  const source = await latestEmailSource(thread);
  const { sourceMessageId, sourceActivityId } = source;

  if (source.resolution !== "resolved") {
    return {
      needsDraft: false,
      sourceMessageId: null,
      sourceActivityId: null,
      source,
      retryDraft: null,
    };
  }

  // Can't dedup without a stable message key — let the draft proceed. The
  // mailbox placement path still reuses an existing unresolved provider draft
  // for this thread.
  if (!sourceMessageId) {
    return {
      needsDraft: true,
      sourceMessageId,
      sourceActivityId,
      source,
      retryDraft: null,
    };
  }

  // Has any Phase C draft already been generated for this exact inbound
  // provider message? Any terminal status still suppresses re-drafting: a user
  // who sent, ignored, or deleted the draft should not get the same draft again
  // until a genuinely new inbound message arrives.
  const { data: matching, error: matchingError } = await supabase
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

  if (matchingError) {
    console.error(
      "[phase-c-router] draft history lookup failed:",
      matchingError.message
    );
    return {
      needsDraft: false,
      sourceMessageId,
      sourceActivityId,
      source: { ...source, resolution: "history_read_error" },
      retryDraft: null,
    };
  }

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
    sourceActivityId,
    source,
    retryDraft,
  };
}

class PhaseCThreadAuthorizationError extends Error {
  constructor(readonly reason: string) {
    super(`Phase C thread authorization revoked: ${reason}`);
    this.name = "PhaseCThreadAuthorizationError";
  }
}

class PhaseCSyncContinuationError extends Error {
  constructor() {
    super("mailbox_sync_continuation_pending");
    this.name = "PhaseCSyncContinuationError";
  }
}

class PhaseCDraftSourceStaleError extends Error {
  constructor() {
    super("PHASE_C_DRAFT_SOURCE_STALE");
    this.name = "PhaseCDraftSourceStaleError";
  }
}

async function deferPhaseCThread(thread: EmailThread): Promise<void> {
  const { error } = await requireSupabase()
    .from("email_threads")
    .update({ category_classified_at: null })
    .eq("id", thread.id)
    .eq("company_id", thread.companyId)
    .eq("connection_id", thread.connectionId);
  if (error) {
    throw new Error(
      `Phase C continuation deferral failed: ${error.message ?? "unknown error"}`,
      { cause: error }
    );
  }
}

/**
 * `ownsMailboxLease` must be set by every caller running INSIDE
 * `runEmailProviderMailboxOperation`. Taking that lease writes
 * `sync_in_progress_at`, so without it the check reads the caller's own lock
 * and refuses the mutation it is already holding the lease to perform.
 */
async function assertPhaseCSyncTerminal(
  thread: EmailThread,
  options: { ownsMailboxLease?: boolean } = {}
): Promise<void> {
  const pending = await emailSyncContinuationPendingForConnection({
    supabase: requireSupabase() as never,
    connectionId: thread.connectionId,
    context: "phase-c",
    ownsMailboxLease: options.ownsMailboxLease,
    // Provider scope only. A summary-only continuation is DERIVED from the
    // mailbox snapshot, so it can never make that snapshot less current —
    // treating it as "sync incomplete" froze Phase C drafting on the primary
    // mailbox for a week while the provider itself was fully caught up.
    scope: "provider",
  });
  if (pending) throw new PhaseCSyncContinuationError();
}

/** Levels at which OPS had committed to acting on the thread itself. */
function autonomyLevelExpectsAction(
  level: EmailThreadAutonomyLevel
): boolean {
  return (
    level === "auto_draft" ||
    level === "auto_send" ||
    level === "auto_archive" ||
    level === "auto_follow_up"
  );
}

/**
 * Reason detail, said the way an operator would say it. The raw code stays in
 * the router result and the log line for diagnosis.
 */
function actorUnavailableReasonCopy(detail: string): string {
  switch (detail) {
    case "opportunity_unassigned":
    case "opportunity_required":
    case "assignment_contract_unavailable":
    case "assignment_stale":
    case "personal_owner_not_assignee":
    case "personal_connection_owner_missing":
      return "no one is assigned to the lead";
    default:
      return "the assigned operator cannot send from this mailbox";
  }
}

/**
 * The company operator who can act on an unowned lead. Same resolution the
 * lead-lifecycle review notifications already use: the recorded company admin,
 * falling back to an active admin user.
 */
async function resolvePhaseCAlertRecipient(
  companyId: string
): Promise<string | null> {
  const supabase = requireSupabase();

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("admin_ids")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    console.error(
      "[phase-c-router] company operator read failed",
      companyError.message
    );
  }
  const recordedAdminId = (company?.admin_ids as string[] | null)?.[0] ?? null;
  if (recordedAdminId) return recordedAdminId;

  const { data: adminRows, error: adminError } = await supabase
    .from("users")
    .select("id, deleted_at, is_active")
    .eq("company_id", companyId)
    .eq("is_company_admin", true)
    .limit(5);
  if (adminError) {
    console.error(
      "[phase-c-router] fallback operator read failed",
      adminError.message
    );
    return null;
  }

  const candidates = (adminRows ?? []) as Array<{
    id: string;
    deleted_at: string | null;
    is_active: boolean | null;
  }>;
  const active = candidates.find(
    (row) => row.deleted_at === null && row.is_active !== false
  );
  return active?.id ?? null;
}

/**
 * Leave a trace when Phase C owed this thread an action and had no actor to
 * perform it. One OPEN alert per thread: a recurring condition re-uses the
 * standing alert rather than stacking a new one every sweep.
 *
 * Never throws — a routing decision must not fail because its alert could not
 * be written.
 */
async function reportPhaseCActorUnavailable(
  thread: EmailThread,
  detail: string
): Promise<void> {
  const dedupeKey = `phase-c-actor-unavailable:${thread.id}`;
  try {
    const recipientUserId = await resolvePhaseCAlertRecipient(thread.companyId);
    if (!recipientUserId) return;

    const supabase = requireSupabase();
    const { data: existing, error: existingError } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", recipientUserId)
      .eq("company_id", thread.companyId)
      .eq("type", "system")
      .eq("dedupe_key", dedupeKey)
      .is("resolved_at", null)
      .limit(1);
    if (existingError) {
      console.error(
        "[phase-c-router] actor-unavailable alert dedupe read failed",
        existingError.message
      );
      return;
    }
    if (Array.isArray(existing) && existing.length > 0) return;

    const { error: insertError } = await supabase.from("notifications").insert({
      user_id: recipientUserId,
      company_id: thread.companyId,
      type: "system",
      title: "Reply waiting, no owner",
      body: `OPS did not draft this customer reply because ${actorUnavailableReasonCopy(detail)}.`,
      is_read: false,
      persistent: true,
      deep_link_type: "inbox",
      action_url: `/inbox/${thread.id}`,
      action_label: "Assign this lead",
      dedupe_key: dedupeKey,
      resolved_at: null,
    });
    if (insertError) {
      console.error(
        "[phase-c-router] actor-unavailable alert insert failed",
        insertError.message
      );
    }
  } catch (error) {
    console.error(
      "[phase-c-router] actor-unavailable alert failed for thread",
      thread.id,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * `noop_actor_unavailable` used to be silent: the outcome was returned and the
 * thread was dropped until new mail happened to arrive. On an actionable
 * customer thread at a level that promised action, that is a reply the operator
 * never learns about. Raise one standing alert and re-arm the thread so the
 * router runs again as soon as an assignee exists.
 */
async function actorUnavailableResult(
  thread: EmailThread,
  effectiveLevel: EmailThreadAutonomyLevel,
  detail: string,
  options: RouteOptions
): Promise<RouterResult> {
  const result: RouterResult = {
    outcome: "noop_actor_unavailable",
    category: thread.primaryCategory,
    effectiveLevel,
    detail,
  };

  const owesAction =
    !options.placementOnly &&
    thread.primaryCategory === "CUSTOMER" &&
    isThreadActionable(thread) &&
    autonomyLevelExpectsAction(effectiveLevel);
  if (!owesAction) return result;

  console.warn(
    "[phase-c-router] actor unavailable on actionable customer thread",
    thread.id,
    detail
  );
  await reportPhaseCActorUnavailable(thread, detail);
  try {
    await deferPhaseCThread(thread);
  } catch (error) {
    console.error(
      "[phase-c-router] actor-unavailable deferral failed for thread",
      thread.id,
      error instanceof Error ? error.message : error
    );
  }
  return result;
}

function syncIncompleteResult(
  thread: EmailThread,
  effectiveLevel: EmailThreadAutonomyLevel
): RouterResult {
  return {
    outcome: "noop_sync_incomplete",
    category: thread.primaryCategory,
    effectiveLevel,
    detail: "mailbox_sync_continuation_pending",
  };
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
  source: ExactEmailSourceTurn,
  draft: {
    draft: string;
    draftHistoryId: string;
    subject?: string;
  }
): Promise<{ mailboxDraftId: string }> {
  const supabase = requireSupabase();
  const to = inboundSourceRecipient(source);
  if (!to) {
    throw new Error("exact inbound source recipient missing");
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

      const { data: priorRows, error: priorRowsError } = await supabase
        .from("ai_draft_history")
        .select("id, mailbox_draft_id, status")
        .eq("company_id", thread.companyId)
        .eq("user_id", userId)
        .eq("connection_id", thread.connectionId)
        .eq("thread_id", thread.providerThreadId)
        .eq("origin", "phase_c");

      if (priorRowsError) {
        throw new Error("PHASE_C_DRAFT_HISTORY_READ_FAILED", {
          cause: priorRowsError,
        });
      }

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
      const currentSource = await latestEmailSource(thread);
      if (!exactSourceMatches(source, currentSource)) {
        throw new PhaseCDraftSourceStaleError();
      }

      let mailboxDraftId: string;
      if (existing?.mailbox_draft_id) {
        await assertPhaseCSyncTerminal(thread, { ownsMailboxLease: true });
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
            const latestSource = await latestEmailSource(thread);
            if (!exactSourceMatches(source, latestSource)) {
              throw new PhaseCDraftSourceStaleError();
            }
            await assertPhaseCSyncTerminal(thread, { ownsMailboxLease: true });
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
              const latestSource = await latestEmailSource(thread);
              if (!exactSourceMatches(source, latestSource)) {
                throw new PhaseCDraftSourceStaleError();
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
  async route(
    thread: EmailThread,
    options: RouteOptions = {}
  ): Promise<RouterResult> {
    const category = thread.primaryCategory;

    try {
      // Skip threads already out of the active inbox.
      if (!isThreadActionable(thread)) {
        return { outcome: "noop_archived", category, effectiveLevel: "off" };
      }

      try {
        await assertPhaseCSyncTerminal(thread);
      } catch (error) {
        if (error instanceof PhaseCSyncContinuationError) {
          if (!options.placementOnly) await deferPhaseCThread(thread);
          return syncIncompleteResult(thread, "off");
        }
        throw error;
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
          return await actorUnavailableResult(
            thread,
            declared,
            actorResolution.reason,
            options
          );
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
          return await actorUnavailableResult(
            thread,
            declared,
            "actor_identity_invalid",
            options
          );
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

      // Mailbox placement is the `auto_draft` contract. A stranded row under any
      // other level predates the level it now sits under, and pushing it into
      // the mailbox would cut across the pipeline that owns the thread today.
      if (
        options.placementOnly &&
        effective !== "auto_draft" &&
        effective !== "off" &&
        effective !== "draft_on_request"
      ) {
        return {
          outcome: "noop_placement_not_applicable",
          category,
          effectiveLevel: effective,
        };
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
            return await actorUnavailableResult(
              thread,
              effective,
              "actor_identity_invalid",
              options
            );
          }
          return await this.doAutoDraft(thread, userId, effective, {
            ...options,
            phaseCActorContext: actorContext ?? undefined,
          });

        case "auto_send":
          if (!actorContext) {
            return await actorUnavailableResult(
              thread,
              effective,
              "actor_identity_invalid",
              options
            );
          }
          return await this.doAutoSend(thread, actorContext, effective);

        case "auto_archive":
          if (!actorContext) {
            return await actorUnavailableResult(
              thread,
              effective,
              "actor_identity_invalid",
              options
            );
          }
          return await this.doAutoArchive(
            thread,
            actorContext.actorUserId,
            effective
          );

        case "auto_follow_up":
          if (!actorContext) {
            return await actorUnavailableResult(
              thread,
              effective,
              "actor_identity_invalid",
              options
            );
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
    effective: EmailThreadAutonomyLevel,
    options: RouteOptions = {}
  ): Promise<RouterResult> {
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
    const { needsDraft, sourceActivityId, source, retryDraft } =
      await latestInboundNeedsDraft(thread, userId);
    if (source.resolution !== "resolved") {
      return {
        outcome: options.placementOnly ? "draft_placement_pending" : "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: sourceResolutionFailureDetail(source),
      };
    }
    if (source.direction !== "inbound") {
      return {
        outcome: "noop_not_inbound",
        category: thread.primaryCategory,
        effectiveLevel: effective,
      };
    }
    if (!sourceActivityId || !inboundSourceRecipient(source)) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "exact inbound source recipient missing",
      };
    }
    let draft: {
      draft: string;
      draftHistoryId: string;
      subject?: string;
    } | null = retryDraft;
    // Placement-only is checked FIRST, and deliberately does not care WHY there
    // is nothing to place. The live path reports an already-covered thread as
    // `auto_drafted` — true for it, since a draft does cover that inbound — but
    // the recovery sweep counts that outcome as a placement it performed. Left
    // below the next branch, every already-healthy thread inflates
    // `placement.placed` on every cycle, forever, and a real collapse to zero
    // placements hides inside the noise. These counters are the tripwire for a
    // repeat of the outage; they have to mean what they say.
    if (!draft && options.placementOnly) {
      // Recovery places what already exists. Nothing stranded covers the latest
      // inbound message, so drafting one is the classification path's call —
      // and its cost — not this sweep's.
      return {
        outcome: "noop_no_stranded_draft",
        category: thread.primaryCategory,
        effectiveLevel: effective,
      };
    }

    if (!draft && !needsDraft) {
      return {
        outcome: "auto_drafted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "existing phase_c draft covers latest inbound (no re-draft)",
      };
    }

    if (draft && options.placementOnly) {
      const conversationState = await buildConversationState(thread.id);
      if (!conversationState) {
        return {
          outcome: "noop_held_for_review",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: "current conversation disposition unavailable",
        };
      }

      const currentSource = await latestEmailSource(thread);
      if (!exactSourceMatches(source, currentSource)) {
        return {
          outcome: "draft_placement_pending",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail: "PHASE_C_DRAFT_SOURCE_STALE",
        };
      }

      if (conversationState.responseDisposition === "no_reply_required") {
        const { data: superseded, error: supersedeError } =
          await requireSupabase()
            .from("ai_draft_history")
            .update({
              status: "superseded",
              discarded_at: new Date().toISOString(),
            })
            .eq("id", draft.draftHistoryId)
            .eq("company_id", thread.companyId)
            .eq("connection_id", thread.connectionId)
            .eq("thread_id", thread.providerThreadId)
            .eq("user_id", userId)
            .eq("origin", "phase_c")
            .eq("status", "drafted")
            .is("mailbox_draft_id", null)
            .select("id")
            .maybeSingle();
        if (supersedeError) {
          return {
            outcome: "draft_placement_pending",
            category: thread.primaryCategory,
            effectiveLevel: effective,
            detail: `stranded draft supersede failed: ${supersedeError.message}`,
          };
        }
        if (superseded?.id !== draft.draftHistoryId) {
          return {
            outcome: "draft_placement_pending",
            category: thread.primaryCategory,
            effectiveLevel: effective,
            detail: "stranded draft supersede updated no row",
          };
        }
        return {
          outcome: "noop_no_reply_warranted",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail:
            conversationState.routingReasons.join(" ") ||
            "latest source does not warrant a reply",
        };
      }

      if (conversationState.responseDisposition === "operator_input_required") {
        return {
          outcome: "noop_held_for_review",
          category: thread.primaryCategory,
          effectiveLevel: effective,
          detail:
            conversationState.routingReasons.join(" ") ||
            "latest source requires operator input",
        };
      }
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
        phaseCActorContext: options.phaseCActorContext,
        emailAccess: accessBeforeDraft,
        sourceActivityId:
          thread.opportunityId && sourceActivityId
            ? sourceActivityId
            : undefined,
        draftPurpose: { kind: "conversation_reply" },
        signatureWillBeAppended: true,
      });

      if (!generated.available) {
        if (generated.noReplyWarranted) {
          return {
            outcome: "noop_no_reply_warranted",
            category: thread.primaryCategory,
            effectiveLevel: effective,
            detail: generated.reason,
          };
        }
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
      const placed = await placePhaseCMailboxDraft(
        thread,
        userId,
        source,
        draft
      );
      return {
        outcome: "auto_drafted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: placed.mailboxDraftId,
      };
    } catch (err) {
      if (err instanceof PhaseCSyncContinuationError) {
        if (!options.placementOnly) await deferPhaseCThread(thread);
        return syncIncompleteResult(thread, effective);
      }
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
   * Re-drive placement for a draft that exists in OPS but never reached the
   * mailbox — the `draft_placement_pending` outcome, seen again.
   *
   * Nothing else retries those rows: the router runs on classification, and a
   * thread is only reclassified when new inbound mail lands on it, so a
   * customer who never writes again strands the draft permanently. The bounded
   * per-connection sweep calls this on a schedule instead of on their behalf.
   *
   * Every fence the live path enforces still applies here — terminal sync
   * outside the mailbox lease, the lease itself around the provider mutation,
   * current autonomy level, and live actor authorization re-checked while
   * holding the lease.
   */
  async retryStrandedMailboxDraft(thread: EmailThread): Promise<RouterResult> {
    return this.route(thread, { placementOnly: true });
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
    const source = await latestEmailSource(thread);
    if (source.resolution !== "resolved") {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: sourceResolutionFailureDetail(source),
      };
    }
    if (source.direction !== "inbound") {
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
        "auto_draft",
        { phaseCActorContext: actorContext }
      );
    }

    // Replies bind to the exact current inbound author, never the thread's
    // cached sender or cumulative participant history.
    const sourceRecipient = inboundSourceRecipient(source);
    if (!sourceRecipient) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "exact inbound source recipient missing",
      };
    }

    const subject = normalizeReplySubject(thread.subject ?? "");

    const accessBeforeSend = await authorizeCurrentPhaseCThread(
      thread,
      actorContext.actorUserId,
      "send"
    );
    if (!accessBeforeSend.allowed) {
      return {
        outcome: "noop_actor_unavailable",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: accessBeforeSend.reason,
      };
    }
    try {
      await assertPhaseCSyncTerminal(thread);
    } catch (error) {
      if (error instanceof PhaseCSyncContinuationError) {
        await deferPhaseCThread(thread);
        return syncIncompleteResult(thread, effective);
      }
      throw error;
    }

    const { sourceActivityId, sourceMessageId } = source;
    if (!sourceActivityId || !sourceMessageId) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "latest inbound source identity missing",
      };
    }

    const scheduled = await AutoSendService.scheduleAutoSend({
      category: thread.primaryCategory,
      companyId: thread.companyId,
      actorContext,
      connectionId: thread.connectionId,
      opportunityId: thread.opportunityId ?? undefined,
      threadId: thread.providerThreadId,
      inReplyTo: sourceMessageId,
      toEmails: [sourceRecipient],
      ccEmails: [],
      subject,
      settings,
      generation: {
        kind: "conversation_reply",
        emailAccess: accessBeforeSend,
        sourceActivityId,
        sourceMessageId,
      },
    });

    if (scheduled.outcome === "no_reply_warranted") {
      return {
        outcome: "noop_no_reply_warranted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: scheduled.reason,
      };
    }
    if (scheduled.outcome === "held_for_review") {
      return {
        outcome: "noop_held_for_review",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: scheduled.reason,
      };
    }
    if (scheduled.outcome === "unavailable") {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: scheduled.reason ?? "auto-send schedule failed",
      };
    }

    return {
      outcome: "auto_sent_scheduled",
      category: thread.primaryCategory,
      effectiveLevel: effective,
      detail: scheduled.pending.id,
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

    try {
      await assertPhaseCSyncTerminal(thread);
    } catch (error) {
      if (error instanceof PhaseCSyncContinuationError) {
        await deferPhaseCThread(thread);
        return syncIncompleteResult(thread, effective);
      }
      throw error;
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
    const cutoff = Date.now() - STALE_LEAD_DAYS * 86_400_000;
    const source = await latestEmailSource(thread);
    if (source.resolution !== "resolved") {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: sourceResolutionFailureDetail(source),
      };
    }
    const sourceCreatedAt = source.sourceCreatedAt;
    const isStale =
      sourceCreatedAt !== null &&
      Number.isFinite(sourceCreatedAt.getTime()) &&
      sourceCreatedAt.getTime() < cutoff;

    if (source.direction !== "outbound" || !isStale) {
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
        "auto_draft",
        { phaseCActorContext: actorContext }
      );
    }

    const subject = normalizeReplySubject(thread.subject ?? "");

    const accessBeforeFollowUp = await authorizeCurrentPhaseCThread(
      thread,
      actorContext.actorUserId,
      "send"
    );
    if (!accessBeforeFollowUp.allowed) {
      return {
        outcome: "noop_actor_unavailable",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: accessBeforeFollowUp.reason,
      };
    }

    if (source.toEmails.length === 0) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "latest outbound source recipient missing",
      };
    }
    try {
      await assertPhaseCSyncTerminal(thread);
    } catch (error) {
      if (error instanceof PhaseCSyncContinuationError) {
        await deferPhaseCThread(thread);
        return syncIncompleteResult(thread, effective);
      }
      throw error;
    }

    const { sourceActivityId, sourceMessageId } = source;
    if (
      !sourceActivityId ||
      !sourceMessageId ||
      !sourceCreatedAt ||
      !Number.isFinite(sourceCreatedAt.getTime())
    ) {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: "latest outbound source identity missing",
      };
    }
    if (sourceCreatedAt.getTime() >= cutoff) {
      return {
        outcome: "noop_not_stale",
        category: thread.primaryCategory,
        effectiveLevel: effective,
      };
    }

    const scheduled = await AutoSendService.scheduleAutoSend({
      category: thread.primaryCategory,
      companyId: thread.companyId,
      actorContext,
      connectionId: thread.connectionId,
      opportunityId: thread.opportunityId ?? undefined,
      threadId: thread.providerThreadId,
      inReplyTo: sourceMessageId,
      toEmails: source.toEmails,
      ccEmails: source.ccEmails,
      subject,
      settings,
      generation: {
        kind: "auto_follow_up",
        autonomousRoutingAuthority: "phase_c_stale_lead_follow_up",
        emailAccess: accessBeforeFollowUp,
        sourceActivityId,
        sourceMessageId,
        followUpSequence: 1,
        instruction:
          "Write a brief, natural follow-up after seven days without a response. Advance only the existing lead conversation, do not repeat the original pitch, and ask at most one easy next-step question.",
      },
    });

    if (scheduled.outcome === "no_reply_warranted") {
      return {
        outcome: "noop_no_reply_warranted",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: scheduled.reason,
      };
    }
    if (scheduled.outcome === "held_for_review") {
      return {
        outcome: "noop_held_for_review",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: scheduled.reason,
      };
    }
    if (scheduled.outcome === "unavailable") {
      return {
        outcome: "error",
        category: thread.primaryCategory,
        effectiveLevel: effective,
        detail: scheduled.reason ?? "follow-up schedule failed",
      };
    }

    return {
      outcome: "auto_follow_up_scheduled",
      category: thread.primaryCategory,
      effectiveLevel: effective,
      detail: scheduled.pending.id,
    };
  },
};

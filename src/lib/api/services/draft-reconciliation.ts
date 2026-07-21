/**
 * OPS Web — Draft Reconciliation
 *
 * Closes the Phase C learning loop for AI drafts placed in the user's real
 * mailbox. When the user edits + sends from their native mail client, the old
 * in-app Send path never fires. This module reconciles, during sync, the
 * eventual sent reply against the draft we placed. Sent outcomes are handed to
 * the durable provider-id queue so writing, memory, and draft state apply once.
 *
 * Entry points:
 *   - classifyDraftOutcome — pure classifier (Part A, TDD-driven)
 *   - reconcilePendingMailboxDrafts — exact per-thread reconciler (Part B)
 *   - reconcilePendingMailboxDraftsForConnection — bounded per-sync sweep
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "./email-service";
import { EmailOutboundLearningService } from "./email-outbound-learning-service";
import {
  authoredMessageBody,
  cleanMessageBody,
} from "./conversation-state/message-cleaner";
import {
  EmailSignatureService,
  stripKnownRenderedEmailSignatures,
} from "./email-signature-service";
import type { EmailConnection } from "@/lib/types/email-connection";
import { mapGmailReads } from "./providers/gmail-read";
import type { ProviderReadPolicy } from "./email-provider";
import {
  runEmailProviderMailboxOperation,
  type EmailProviderMailboxCheckpoint,
} from "./email-provider-mailbox-operation";

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
  /** Shared absolute budget supplied by the connection-level sync sweep. */
  readPolicy?: ProviderReadPolicy;
  /** Reuse the sync worker's physical-mailbox lease when one is already held. */
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}

interface ResolvedMailboxLearningActor {
  actorUserId: string;
  opportunityId: string | null;
  assignmentVersion: number | null;
  assignmentEventId: string | null;
  proofType: "native_mailbox_draft" | "personal_mailbox_owner";
}

const DRAFT_RECONCILIATION_READ_DEADLINE_MS = 2 * 60 * 1000;
const DRAFT_RECONCILIATION_SWEEP_DEADLINE_MS = 4 * 60 * 1000;
const DRAFT_RECONCILIATION_SWEEP_CANDIDATE_LIMIT = 500;
const DRAFT_RECONCILIATION_SWEEP_THREAD_LIMIT = 100;

function reconciliationFailureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

function throwReconciliationFailures(
  label: string,
  failures: Array<{ identity: string; error: unknown }>
): never {
  const detail = failures
    .slice(0, 3)
    .map(
      ({ identity, error }) =>
        `${identity}: ${reconciliationFailureMessage(error)}`
    )
    .join("; ");
  throw new Error(
    `[draft-reconciliation] ${label} (${failures.length}): ${detail}`,
    { cause: failures[0]?.error }
  );
}

async function resolveMailboxLearningActor(input: {
  supabase: ReconcileParams["supabase"];
  companyId: string;
  connectionId: string;
  draftHistoryId: string;
  providerMessageId: string;
  providerThreadId: string;
  outcome: "used" | "from_scratch";
}): Promise<ResolvedMailboxLearningActor | null> {
  const { data, error } = await input.supabase.rpc(
    "resolve_email_outbound_learning_mailbox_actor_as_system",
    {
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
      p_draft_history_id: input.draftHistoryId,
      p_provider_message_id: input.providerMessageId,
      p_provider_thread_id: input.providerThreadId,
      p_outcome: input.outcome,
    }
  );
  if (error) {
    throw new Error(
      `[draft-reconciliation] mailbox actor proof failed: ${reconciliationFailureMessage(error)}`,
      { cause: error }
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const row = data as Record<string, unknown>;
  if (
    typeof row.actorUserId !== "string" ||
    !row.actorUserId ||
    !["native_mailbox_draft", "personal_mailbox_owner"].includes(
      String(row.proofType ?? "")
    )
  ) {
    return null;
  }

  return {
    actorUserId: row.actorUserId,
    opportunityId:
      typeof row.opportunityId === "string" ? row.opportunityId : null,
    assignmentVersion:
      typeof row.assignmentVersion === "number" ? row.assignmentVersion : null,
    assignmentEventId:
      typeof row.assignmentEventId === "string" ? row.assignmentEventId : null,
    proofType: row.proofType as ResolvedMailboxLearningActor["proofType"],
  };
}

async function authoredBodyWithoutKnownSignature(input: {
  companyId: string;
  connection: EmailConnection;
  userId: string;
  rawBody: string;
  subject: string;
}): Promise<{ authoredBody: string; signatureRemoved: boolean }> {
  // Provider replies place the current signature before the quoted thread.
  // Remove quote/forwarded content first so the exact signature becomes the
  // anchored suffix that the known-revision matcher can prove and remove.
  const original = authoredMessageBody(input.rawBody, {
    subject: input.subject,
  }).trim();
  try {
    const knownSignatures = await EmailSignatureService.listKnown({
      companyId: input.companyId,
      connectionId: input.connection.id,
    });
    const signatures = knownSignatures
      .filter(
        (signature) =>
          signature.scopeUserId === null ||
          signature.scopeUserId === input.userId
      )
      .map((signature) => ({
        html: signature.contentHtml,
        text: signature.contentText,
        hash: signature.contentHash,
      }));
    if (signatures.length === 0) {
      return { authoredBody: original, signatureRemoved: false };
    }

    const authoredBody = stripKnownRenderedEmailSignatures({
      body: original,
      contentType: "text",
      signatures,
    }).trim();
    return {
      authoredBody: authoredBody || original,
      signatureRemoved: Boolean(authoredBody && authoredBody !== original),
    };
  } catch (signatureError) {
    console.warn(
      "[draft-reconciliation] exact signature strip unavailable; learning disabled",
      signatureError
    );
    return { authoredBody: original, signatureRemoved: false };
  }
}

/**
 * Reconcile pending mailbox drafts for a thread after its activities are persisted.
 *
 * Design intent:
 *   - CHEAP FIRST: if there are no pending rows for this thread, we return
 *     immediately without touching the provider. The common case (thread with
 *     no AI draft, or draft already resolved) is free.
 *   - EXACT PROVIDER IDENTITY: listDrafts() is intentionally a bounded UI
 *     snapshot, so its omissions cannot prove deletion. Reconciliation calls
 *     getDraft() for each immutable mailbox_draft_id instead.
 *
 * Error isolation: one row's failure does not abort the rest. The sync loop
 * awaits reconciliation so exact provider reads finish before its connection
 * lease is released.
 */
export async function reconcilePendingMailboxDrafts({
  connection,
  providerThreadId,
  supabase,
  readPolicy,
  providerLockCheckpoint,
}: ReconcileParams): Promise<void> {
  // Step 1: Query for pending rows — exit immediately if none.
  const { data: pendingRows, error: queryErr } = await supabase
    .from("ai_draft_history")
    .select(
      "id, company_id, user_id, mailbox_draft_id, created_at, profile_type, opportunity_id"
    )
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .eq("thread_id", providerThreadId)
    .eq("status", "auto_drafted")
    .not("mailbox_draft_id", "is", null);

  if (queryErr) {
    throw new Error(
      `[draft-reconciliation] pending-row query failed: ${reconciliationFailureMessage(queryErr)}`,
      { cause: queryErr }
    );
  }

  if (!pendingRows || pendingRows.length === 0) {
    // Fast path — no AI drafts to reconcile on this thread.
    return;
  }

  // Step 2: Collapse any legacy competing histories by immutable provider
  // draft id. New placements use the same transactional RPC, so this is a
  // defensive repair for rows written before that invariant existed.
  const rowsByMailboxDraft = new Map<string, Array<Record<string, unknown>>>();
  for (const row of pendingRows as Array<Record<string, unknown>>) {
    const mailboxDraftId = String(row.mailbox_draft_id ?? "");
    if (!mailboxDraftId) continue;
    const group = rowsByMailboxDraft.get(mailboxDraftId) ?? [];
    group.push(row);
    rowsByMailboxDraft.set(mailboxDraftId, group);
  }

  const canonicalRows: Array<Record<string, unknown>> = [];
  for (const [mailboxDraftId, group] of rowsByMailboxDraft) {
    const ordered = [...group].sort((left, right) => {
      const byCreated =
        Date.parse(String(right.created_at ?? "")) -
        Date.parse(String(left.created_at ?? ""));
      if (Number.isFinite(byCreated) && byCreated !== 0) return byCreated;
      return String(right.id ?? "").localeCompare(String(left.id ?? ""));
    });
    const newest = ordered[0];
    if (ordered.length > 1) {
      const { error } = await supabase.rpc("reassign_phase_c_mailbox_draft", {
        p_company_id: connection.companyId,
        p_connection_id: connection.id,
        p_new_draft_history_id: String(newest.id),
        p_mailbox_draft_id: mailboxDraftId,
        p_thread_id: providerThreadId,
        p_expected_old_draft_history_id: String(ordered[1].id),
      });
      if (error) {
        throw new Error(
          `[draft-reconciliation] competing history repair failed for ${mailboxDraftId}: ${reconciliationFailureMessage(error)}`,
          { cause: error }
        );
      }
    }
    canonicalRows.push(newest);
  }

  const draftPresence = new Map<string, boolean>();
  const providerReadFailures: Array<{ identity: string; error: unknown }> = [];
  const effectiveReadPolicy: ProviderReadPolicy = {
    deadlineAt:
      readPolicy?.deadlineAt ??
      Date.now() + DRAFT_RECONCILIATION_READ_DEADLINE_MS,
    context: readPolicy?.context ?? "mailbox draft reconciliation",
  };
  await runEmailProviderMailboxOperation({
    supabase,
    connectionId: connection.id,
    context: "mailbox-draft-reconciliation",
    busyError: "DRAFT_RECONCILIATION_MAILBOX_BUSY",
    providerLockCheckpoint,
    run: async (checkpoint) => {
      const provider = EmailService.getProvider(connection);
      await mapGmailReads(
        canonicalRows,
        async (row, _index, readPolicy) => {
          const mailboxDraftId = String(row.mailbox_draft_id);
          await checkpoint();
          try {
            const draft = await provider.getDraft(mailboxDraftId, readPolicy);
            draftPresence.set(mailboxDraftId, draft !== null);
          } catch (error) {
            providerReadFailures.push({ identity: mailboxDraftId, error });
          }
          await checkpoint();
        },
        effectiveReadPolicy
      );
      if (providerReadFailures.length > 0) {
        throwReconciliationFailures(
          "exact provider draft read failed; sync checkpoint withheld",
          providerReadFailures
        );
      }
    },
  });

  // Step 3: Query outbound activities for this thread (all of them, ordered oldest-first).
  const { data: outboundActivities, error: outboundError } = await supabase
    .from("activities")
    .select(
      "id, body_text, created_at, subject, from_email, to_emails, email_message_id, opportunity_id"
    )
    .eq("company_id", connection.companyId)
    .eq("email_connection_id", connection.id)
    .eq("email_thread_id", providerThreadId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: true });
  if (outboundError) {
    throw new Error(
      `[draft-reconciliation] outbound activity query failed: ${reconciliationFailureMessage(outboundError)}`,
      { cause: outboundError }
    );
  }

  const outbound = outboundActivities ?? [];

  const now = new Date();

  // Step 4: Classify newest histories first and claim each immutable sent
  // provider message at most once per reconciliation pass.
  canonicalRows.sort(
    (left, right) =>
      Date.parse(String(right.created_at ?? "")) -
      Date.parse(String(left.created_at ?? ""))
  );
  const claimedOutboundMessageIds = new Set<string>();
  const rowFailures: Array<{ identity: string; error: unknown }> = [];
  for (const row of canonicalRows) {
    try {
      const rowCreatedAt = new Date(row.created_at as string);
      const mailboxDraftId = row.mailbox_draft_id as string;

      if (!draftPresence.has(mailboxDraftId)) continue;
      const draftStillInMailbox = draftPresence.get(mailboxDraftId) === true;

      // Outbound activities that arrived AFTER this draft row was created.
      const outboundAfter = outbound.filter(
        (activity) =>
          new Date(activity.created_at as string) > rowCreatedAt &&
          typeof activity.email_message_id === "string" &&
          Boolean(activity.email_message_id) &&
          !claimedOutboundMessageIds.has(activity.email_message_id as string)
      );
      const hasOutboundAfter = outboundAfter.length > 0;
      const latestOutbound = outboundAfter.at(-1);
      if (latestOutbound?.email_message_id) {
        claimedOutboundMessageIds.add(
          latestOutbound.email_message_id as string
        );
      }

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
          // User sent the AI draft (possibly edited). The durable queue is the
          // sole owner of learning and sent-state transitions for this outcome.
          const providerMessageId = latestOutbound?.email_message_id as
            | string
            | null;
          const rawBody = (latestOutbound?.body_text as string) ?? "";
          if (!providerMessageId || !rawBody.trim()) break;
          const subject = (latestOutbound?.subject as string | null) ?? "";

          const resolvedActor = await resolveMailboxLearningActor({
            supabase,
            companyId: row.company_id as string,
            connectionId: connection.id,
            draftHistoryId: row.id as string,
            providerMessageId,
            providerThreadId,
            outcome: "used",
          });
          const bookkeepingUserId = row.user_id as string;
          const attributedUserId =
            resolvedActor?.actorUserId ?? bookkeepingUserId;

          // Native mailbox sends round-trip the provider-rendered signature in
          // body_text. Remove only the exact effective signature before edit
          // comparison/profile learning. If the provider reformatted it beyond
          // safe recognition, fail closed: finish draft bookkeeping but do not
          // train on a signature-contaminated sample.
          const preparedBody = await authoredBodyWithoutKnownSignature({
            companyId: row.company_id as string,
            connection,
            userId: attributedUserId,
            rawBody,
            subject,
          });
          const authoredBody = preparedBody.authoredBody;
          const cleanBody = cleanMessageBody(authoredBody, { subject });

          const { data: linkedFollowUps, error: followUpError } = await supabase
            .from("opportunity_follow_up_drafts")
            .select("id")
            .eq("company_id", row.company_id as string)
            .eq("ai_draft_history_id", row.id as string)
            .eq("status", "drafted")
            .limit(2);
          if (followUpError) throw followUpError;
          if ((linkedFollowUps ?? []).length > 1) {
            throw new Error(
              "mailbox draft maps to multiple drafted lifecycle rows"
            );
          }

          await new EmailOutboundLearningService(supabase).enqueueIfEnabled({
            companyId: row.company_id as string,
            connectionId: connection.id,
            providerMessageId,
            providerThreadId,
            // A stale draft owner is retained only so the queue can close the
            // immutable draft receipt. The database downgrades that path to
            // autonomous bookkeeping; it cannot train or graduate the user.
            userId: attributedUserId,
            fromEmail:
              (latestOutbound?.from_email as string | null) ?? connection.email,
            toEmails: Array.isArray(latestOutbound?.to_emails)
              ? (latestOutbound.to_emails as string[])
              : [],
            subject,
            bodyText: rawBody,
            authoredBody,
            cleanBody,
            occurredAt: latestOutbound?.created_at as string,
            labelIds: ["SENT"],
            draftHistoryId: row.id as string,
            draftDeliveryChannel: "mailbox",
            followUpDraftId:
              (linkedFollowUps?.[0]?.id as string | undefined) ?? null,
            opportunityId: resolvedActor
              ? resolvedActor.opportunityId
              : ((row.opportunity_id as string | null) ?? null),
            profileType: (row.profile_type as string | null) ?? "general",
            learningAuthority:
              resolvedActor && preparedBody.signatureRemoved
                ? "operator_approved"
                : "autonomous",
          });
          break;
        }

        case "from_scratch": {
          // User sent a fresh reply, ignoring our draft. Upgrade the generic
          // sync receipt to human-authored only after the exact configured
          // signature is removed. Do not attach the ignored AI draft: that
          // would register a bogus 100% rewrite and poison edit learning.
          const providerMessageId = latestOutbound?.email_message_id as
            | string
            | null;
          const rawBody = (latestOutbound?.body_text as string) ?? "";
          if (providerMessageId && rawBody.trim()) {
            const subject = (latestOutbound?.subject as string | null) ?? "";
            const resolvedActor = await resolveMailboxLearningActor({
              supabase,
              companyId: row.company_id as string,
              connectionId: connection.id,
              draftHistoryId: row.id as string,
              providerMessageId,
              providerThreadId,
              outcome: "from_scratch",
            });
            if (resolvedActor) {
              const preparedBody = await authoredBodyWithoutKnownSignature({
                companyId: row.company_id as string,
                connection,
                userId: resolvedActor.actorUserId,
                rawBody,
                subject,
              });
              const authoredBody = preparedBody.authoredBody;
              const cleanBody = cleanMessageBody(authoredBody, { subject });
              await new EmailOutboundLearningService(supabase).enqueueIfEnabled(
                {
                  companyId: row.company_id as string,
                  connectionId: connection.id,
                  providerMessageId,
                  providerThreadId,
                  userId: resolvedActor.actorUserId,
                  fromEmail:
                    (latestOutbound?.from_email as string | null) ??
                    connection.email,
                  toEmails: Array.isArray(latestOutbound?.to_emails)
                    ? (latestOutbound.to_emails as string[])
                    : [],
                  subject,
                  bodyText: rawBody,
                  authoredBody,
                  cleanBody,
                  occurredAt: latestOutbound?.created_at as string,
                  labelIds: ["SENT"],
                  opportunityId: resolvedActor.opportunityId,
                  profileType: (row.profile_type as string | null) ?? "general",
                  learningAuthority: preparedBody.signatureRemoved
                    ? "operator_authored"
                    : "autonomous",
                }
              );
            }
          }
          const { error: supersedeError } = await supabase
            .from("ai_draft_history")
            .update({
              status: "superseded",
              discarded_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (supersedeError) throw supersedeError;
          break;
        }

        case "discarded": {
          const { error: discardError } = await supabase
            .from("ai_draft_history")
            .update({
              status: "discarded_in_mailbox",
              discarded_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          if (discardError) throw discardError;
          break;
        }

        case "pending":
          // Too early — do nothing. Re-evaluated on next sync.
          break;
      }
    } catch (err) {
      // Finish the bounded batch so independent rows can converge, then hold
      // the provider cursor and replay the cycle if any durable transition
      // failed. Provider ids and queue claims make successful rows idempotent.
      rowFailures.push({ identity: String(row.id), error: err });
    }
  }
  if (rowFailures.length > 0) {
    throwReconciliationFailures(
      "draft outcome persistence failed; sync checkpoint withheld",
      rowFailures
    );
  }
}

/**
 * Revisit a bounded set of pending mailbox-draft threads once per connection
 * sync. This runs even when Gmail reports no new message, which is the only
 * way to observe a draft deleted without being sent. The caller owns the
 * connection lease and must not publish its provider cursor if this rejects.
 */
export async function reconcilePendingMailboxDraftsForConnection({
  connection,
  supabase,
  providerLockCheckpoint,
}: {
  connection: EmailConnection;
  supabase: ReturnType<typeof requireSupabase>;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}): Promise<void> {
  const { data, error } = await supabase
    .from("ai_draft_history")
    .select("thread_id")
    .eq("company_id", connection.companyId)
    .eq("connection_id", connection.id)
    .eq("status", "auto_drafted")
    .not("mailbox_draft_id", "is", null)
    .not("thread_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(DRAFT_RECONCILIATION_SWEEP_CANDIDATE_LIMIT);
  if (error) {
    throw new Error(
      `[draft-reconciliation] pending-thread sweep query failed: ${reconciliationFailureMessage(error)}`,
      { cause: error }
    );
  }

  const providerThreadIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) =>
          typeof row.thread_id === "string" ? row.thread_id.trim() : ""
        )
        .filter(Boolean)
    )
  ).slice(0, DRAFT_RECONCILIATION_SWEEP_THREAD_LIMIT);
  if (providerThreadIds.length === 0) return;

  const readPolicy: ProviderReadPolicy = {
    deadlineAt: Date.now() + DRAFT_RECONCILIATION_SWEEP_DEADLINE_MS,
    context: "mailbox draft reconciliation sweep",
  };
  const threadFailures: Array<{ identity: string; error: unknown }> = [];
  for (const providerThreadId of providerThreadIds) {
    try {
      await reconcilePendingMailboxDrafts({
        connection,
        providerThreadId,
        supabase,
        readPolicy,
        providerLockCheckpoint,
      });
    } catch (error) {
      threadFailures.push({ identity: providerThreadId, error });
    }
  }
  if (threadFailures.length > 0) {
    throwReconciliationFailures(
      "connection draft sweep failed; sync checkpoint withheld",
      threadFailures
    );
  }
}

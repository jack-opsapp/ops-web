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
  /**
   * True when the sent body provably reuses this draft's wording. Supplied by
   * `outboundBodyDerivedFromDraft`; absent means "no evidence either way".
   */
  outboundDerivedFromDraft?: boolean;
}): DraftOutcome {
  const ttl = s.ttlDays ?? 14;

  if (s.hasOutboundAfter) {
    // User replied via their mail client.
    // Draft gone = the draft resource was consumed by the send. Strongest proof.
    if (!s.draftStillInMailbox) return "used";
    // Draft still sitting in the drafts folder is ABSENCE of proof, not proof
    // of independent authorship: the operator can lift our wording into a new
    // compose and leave the API draft behind (bug be648d50 — five real sends
    // filed as rewrites). Only the sent body can settle it.
    return s.outboundDerivedFromDraft === true ? "used" : "from_scratch";
  }

  // No outbound reply yet.
  if (!s.draftStillInMailbox && s.daysSinceDraft >= ttl) {
    // Draft deleted and no reply sent in TTL window → user discarded it.
    return "discarded";
  }

  // Too early to decide (within TTL, or draft still present and awaiting send).
  return "pending";
}

/**
 * Minimum verbatim run (normalized characters) that proves the operator's send
 * reuses this draft's wording rather than merely sharing the author's habits.
 *
 * Calibrated on production, not guessed. Company
 * a612edc0-5c18-4c4d-af97-55b9410dd077, 2026-08-06:
 *   - 5 true pairs (draft -> the send the operator made in that thread) scored
 *     54, 64, 86, 151, 174.
 *   - 245 negative pairs — each draft against 45 unrelated real sends by the
 *     same operator plus the other four customers' sends, i.e. same voice,
 *     same stock opener, same signature — topped out at 45.
 * 50 is the midpoint of that gap: 5/5 true pairs caught, 0/245 false positives.
 */
export const DRAFT_DERIVATION_MIN_VERBATIM_RUN = 50;

/** Upper bound on compared text so a pathological body cannot dominate a sync. */
const DRAFT_DERIVATION_MAX_COMPARE_CHARS = 20_000;

/** A trailing sign-off — the boundary past which nothing is authored content. */
const DRAFT_DERIVATION_SIGN_OFF =
  /\b(thanks|thank you|all the best|best regards|regards|cheers|talk soon|sincerely)\b\s*[,!.]?\s*$/i;

const DRAFT_DERIVATION_SALUTATION =
  /^(hi|hey|hello|dear|good (morning|afternoon|evening))\b/i;

function normalizeForDerivation(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DRAFT_DERIVATION_MAX_COMPARE_CHARS);
}

/**
 * Drop the salutation line and everything from the sign-off onward.
 *
 * Both are stock scaffolding this operator repeats on every message, so
 * leaving them in measures their habits instead of reuse of THIS draft — the
 * difference between a 21-character separation and none at all.
 */
function stripDerivationScaffolding(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start += 1;
  if (start < lines.length && DRAFT_DERIVATION_SALUTATION.test(lines[start].trim())) {
    start += 1;
  }
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (DRAFT_DERIVATION_SIGN_OFF.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  return normalizeForDerivation(lines.slice(start, end).join("\n"));
}

/** Longest common contiguous run, in characters. O(n·m) time, O(m) space. */
function longestCommonRun(left: string, right: string): number {
  if (!left || !right) return 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  let current = new Array<number>(right.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      } else {
        current[j] = 0;
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return best;
}

/**
 * Does the operator's sent message reuse this draft's wording?
 *
 * Pure function — no I/O. This is the second admissible proof that the
 * operator sent our draft; the first is the draft resource being consumed.
 * Quoted/forwarded content is removed first, so our own text quoted back
 * inside a reply is never mistaken for authorship.
 */
export function outboundBodyDerivedFromDraft(input: {
  draftBody: string | null | undefined;
  sentBody: string | null | undefined;
  subject: string | null | undefined;
}): boolean {
  const draftBody = input.draftBody ?? "";
  const sentBody = input.sentBody ?? "";
  if (!draftBody.trim() || !sentBody.trim()) return false;

  const authoredSent = authoredMessageBody(sentBody, {
    subject: input.subject ?? "",
  });
  const draft = stripDerivationScaffolding(draftBody);
  const sent = stripDerivationScaffolding(authoredSent);
  if (!draft || !sent) return false;

  return longestCommonRun(draft, sent) >= DRAFT_DERIVATION_MIN_VERBATIM_RUN;
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
  proofType:
    | "native_mailbox_draft"
    | "personal_mailbox_owner"
    // A shared mailbox send cannot name its author, so a rewrite on a
    // company-type connection is anchored on the current exact assignee who
    // owns the OPS draft on that very thread — the same inference the
    // `native_mailbox_draft` arm already trusts for reused drafts.
    | "company_mailbox_assignee";
}

const DRAFT_RECONCILIATION_READ_DEADLINE_MS = 2 * 60 * 1000;
const DRAFT_RECONCILIATION_SWEEP_DEADLINE_MS = 4 * 60 * 1000;
const DRAFT_RECONCILIATION_SWEEP_CANDIDATE_LIMIT = 500;
const DRAFT_RECONCILIATION_SWEEP_THREAD_LIMIT = 100;

/**
 * Terminal states a history row can hold while its provider draft object is
 * still sitting in the mailbox. `discarded_in_mailbox` is excluded because
 * reaching it required proving the object was already gone, and `discarded`
 * is the in-app discard, which deletes the object on its way out.
 */
const ORPHAN_CLEANUP_TERMINAL_STATUSES = [
  "sent_from_mailbox",
  "superseded",
] as const;

const ORPHAN_CLEANUP_ROW_LIMIT = 200;
const ORPHAN_CLEANUP_DRAFT_LIMIT = 25;
const ORPHAN_CLEANUP_OWNER_ROW_LIMIT = 1_000;
const ORPHAN_CLEANUP_DEADLINE_MS = 60 * 1000;

function isOrphanCleanupTerminalStatus(status: unknown): boolean {
  return (ORPHAN_CLEANUP_TERMINAL_STATUSES as readonly string[]).includes(
    String(status ?? "")
  );
}

/** Newest first, matching how competing histories are collapsed above. */
function newestHistoryRowFirst(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): number {
  const byCreated =
    Date.parse(String(right.created_at ?? "")) -
    Date.parse(String(left.created_at ?? ""));
  if (Number.isFinite(byCreated) && byCreated !== 0) return byCreated;
  return String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

/**
 * Delete provider draft objects the operator's own send made redundant.
 *
 * Cleanup is hygiene, not truth: the send is already recorded and the learning
 * receipt is already claimed, so a revoked scope or a provider blip must never
 * withhold the sync cursor. Every failure is swallowed here and retried by the
 * terminal-row sweep on a later cycle.
 */
async function deleteOrphanedMailboxDrafts(input: {
  connection: EmailConnection;
  supabase: ReconcileParams["supabase"];
  mailboxDraftIds: string[];
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}): Promise<void> {
  if (input.mailboxDraftIds.length === 0) return;
  try {
    await runEmailProviderMailboxOperation({
      supabase: input.supabase,
      connectionId: input.connection.id,
      context: "mailbox-draft-orphan-cleanup",
      busyError: "DRAFT_ORPHAN_CLEANUP_MAILBOX_BUSY",
      providerLockCheckpoint: input.providerLockCheckpoint,
      run: async (checkpoint) => {
        const provider = EmailService.getProvider(input.connection);
        for (const mailboxDraftId of input.mailboxDraftIds) {
          await checkpoint();
          // Both providers define deleteDraft as idempotent (404 is success),
          // so a replayed cycle re-deleting a gone draft is a no-op.
          await provider.deleteDraft(mailboxDraftId);
          await checkpoint();
        }
      },
    });
  } catch (error) {
    console.warn(
      `[draft-reconciliation] orphaned mailbox draft cleanup failed for connection ${input.connection.id}; the send is recorded and the sweep will retry`,
      error
    );
  }
}

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
    ![
      "native_mailbox_draft",
      "personal_mailbox_owner",
      "company_mailbox_assignee",
    ].includes(String(row.proofType ?? ""))
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
      "id, company_id, user_id, mailbox_draft_id, source_message_id, created_at, profile_type, opportunity_id, original_draft"
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

  // Load the complete persisted thread context before looking at the provider
  // draft. The first activity after the exact source message decides whether
  // the draft context advanced or the operator resolved it: anything before
  // placement, or an inbound after placement, makes the draft stale; an
  // outbound after placement is the candidate send reconciled below.
  const { data: activities, error: activityError } = await supabase
    .from("activities")
    .select(
      "id, direction, body_text, created_at, subject, from_email, to_emails, email_message_id, opportunity_id"
    )
    .eq("company_id", connection.companyId)
    .eq("email_connection_id", connection.id)
    .eq("email_thread_id", providerThreadId)
    .order("created_at", { ascending: true });
  if (activityError) {
    throw new Error(
      `[draft-reconciliation] activity query failed: ${reconciliationFailureMessage(activityError)}`,
      { cause: activityError }
    );
  }

  const threadActivities = (activities ?? []) as Array<Record<string, unknown>>;
  const staleDraftHistoryIds = new Set<string>();
  for (const row of canonicalRows) {
    const sourceMessageId =
      typeof row.source_message_id === "string"
        ? row.source_message_id.trim()
        : "";
    if (!sourceMessageId) continue;
    const source = threadActivities.find(
      (activity) => activity.email_message_id === sourceMessageId
    );
    if (!source) continue;
    const sourceAt = Date.parse(String(source.created_at ?? ""));
    if (!Number.isFinite(sourceAt)) continue;
    const draftCreatedAt = Date.parse(String(row.created_at ?? ""));
    if (!Number.isFinite(draftCreatedAt)) continue;
    const firstFollowingActivity = threadActivities.find((activity) => {
      if (activity.email_message_id === sourceMessageId) return false;
      const activityAt = Date.parse(String(activity.created_at ?? ""));
      return Number.isFinite(activityAt) && activityAt >= sourceAt;
    });
    if (!firstFollowingActivity) continue;
    const firstFollowingAt = Date.parse(
      String(firstFollowingActivity.created_at ?? "")
    );
    if (
      firstFollowingAt <= draftCreatedAt ||
      firstFollowingActivity.direction !== "outbound"
    ) {
      staleDraftHistoryIds.add(String(row.id));
    }
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
            if (draft !== null && staleDraftHistoryIds.has(String(row.id))) {
              // Both providers define deleteDraft as idempotent (404 is
              // success). If the database write below fails after deletion,
              // replay still classifies by source-message freshness and can
              // never reinterpret the missing stale draft as user-approved.
              await checkpoint();
              await provider.deleteDraft(mailboxDraftId);
              draftPresence.set(mailboxDraftId, false);
              await checkpoint();
            }
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

  const outbound = threadActivities.filter(
    (activity) => activity.direction === "outbound"
  );

  const now = new Date();

  // Step 4: Classify newest histories first and claim each immutable sent
  // provider message at most once per reconciliation pass.
  canonicalRows.sort(
    (left, right) =>
      Date.parse(String(right.created_at ?? "")) -
      Date.parse(String(left.created_at ?? ""))
  );
  const claimedOutboundMessageIds = new Set<string>();
  const orphanedMailboxDraftIds: string[] = [];
  const rowFailures: Array<{ identity: string; error: unknown }> = [];
  for (const row of canonicalRows) {
    try {
      if (staleDraftHistoryIds.has(String(row.id))) {
        const { error: supersedeError } = await supabase
          .from("ai_draft_history")
          .update({
            status: "superseded",
            discarded_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (supersedeError) throw supersedeError;
        continue;
      }

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

      // A present draft resource cannot prove the operator ignored us, so ask
      // the sent body directly whether it reuses this draft's wording.
      const outboundDerivedFromDraft = hasOutboundAfter
        ? outboundBodyDerivedFromDraft({
            draftBody: row.original_draft as string | null,
            sentBody: latestOutbound?.body_text as string | null,
            subject: latestOutbound?.subject as string | null,
          })
        : false;

      const outcome = classifyDraftOutcome({
        draftStillInMailbox,
        hasOutboundAfter,
        daysSinceDraft,
        outboundDerivedFromDraft,
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

          // The message is already delivered. A draft object that survived the
          // send is the operator lifting our wording into a fresh compose, and
          // it now reads as an unsent reply — send it again and the customer
          // receives the same message twice. Only the sent body can license
          // this deletion, so require the derivation proof explicitly rather
          // than inheriting it from the classifier's decision tree.
          if (draftStillInMailbox && outboundDerivedFromDraft === true) {
            orphanedMailboxDraftIds.push(mailboxDraftId);
          }

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
          // signature is removed. Do not attach the ignored AI draft as the
          // sent draft: that would register a bogus 100% rewrite and poison
          // edit learning. It travels instead on `replacedDraftHistoryId`, the
          // memory-only lane, so the correction the operator actually made is
          // still learned.
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
                  replacedDraftHistoryId: row.id as string,
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

  // Run cleanup before any failure is raised: the drafts staged here belong to
  // sends already proven, and deletion is idempotent under replay.
  await deleteOrphanedMailboxDrafts({
    connection,
    supabase,
    mailboxDraftIds: orphanedMailboxDraftIds,
    providerLockCheckpoint,
  });

  if (rowFailures.length > 0) {
    throwReconciliationFailures(
      "draft outcome persistence failed; sync checkpoint withheld",
      rowFailures
    );
  }
}

/**
 * Is deleting this draft object licensed by proof its wording was delivered?
 *
 * Two admissible proofs, in descending strength:
 *   1. The durable learning queue bound an immutable sent provider message to
 *      this exact draft receipt when it closed the row.
 *   2. The sent body still carries this draft's wording verbatim.
 *
 * Everything else — including a bare `superseded` row, which means the operator
 * wrote their own reply — leaves the operator's draft where they left it.
 *
 * `sent_from_mailbox` alone is deliberately NOT a proof. Six production rows
 * reached that state when absence from a bounded `listDrafts()` page was still
 * treated as evidence of a send; that evidence has since been withdrawn, and
 * their drafts may be genuinely unsent work.
 */
async function orphanDeletionAdmissible(input: {
  connection: EmailConnection;
  supabase: ReconcileParams["supabase"];
  owner: Record<string, unknown>;
}): Promise<boolean> {
  const { owner } = input;
  if (
    String(owner.status ?? "") === "sent_from_mailbox" &&
    String(owner.sent_provider_message_id ?? "").trim()
  ) {
    return true;
  }

  const threadId = String(owner.thread_id ?? "").trim();
  const ownerCreatedAt = String(owner.created_at ?? "").trim();
  // No thread or no placement timestamp means no send can be tied to this
  // draft, and an unproven draft is never deleted.
  if (!threadId || !ownerCreatedAt) return false;

  const { data, error } = await input.supabase
    .from("activities")
    .select("body_text, subject, email_message_id, created_at")
    .eq("company_id", input.connection.companyId)
    .eq("email_connection_id", input.connection.id)
    .eq("email_thread_id", threadId)
    .eq("direction", "outbound")
    .gt("created_at", ownerCreatedAt)
    .not("email_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(
      `[draft-reconciliation] orphan derivation lookup failed: ${reconciliationFailureMessage(error)}`,
      { cause: error }
    );
  }

  const latestOutbound = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (!latestOutbound) return false;

  return outboundBodyDerivedFromDraft({
    draftBody: owner.original_draft as string | null,
    sentBody: latestOutbound.body_text as string | null,
    subject: latestOutbound.subject as string | null,
  });
}

/**
 * Sweep terminal rows whose provider draft object is still live.
 *
 * The per-thread reconciler stops looking at a row the moment it goes terminal,
 * so a draft that survived a recognized send is never revisited — it just sits
 * in the Drafts folder looking like an unsent reply. This is the backstop for
 * that gap: it retries deletions the sync-time cleanup could not complete, and
 * drains the backlog written before the classifier learned to read sent bodies.
 *
 * Settled draft objects are stamped so each one is read from the provider at
 * most once. A row that is settled can never change its verdict, so "leave this
 * one alone" is as final as "deleted". Only transient failures stay unstamped.
 *
 * Never throws: cleanup must not withhold a sync cursor.
 */
async function sweepOrphanedMailboxDrafts(input: {
  connection: EmailConnection;
  supabase: ReconcileParams["supabase"];
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}): Promise<void> {
  const { connection, supabase } = input;
  try {
    const historyColumns =
      "id, thread_id, mailbox_draft_id, status, created_at, original_draft, sent_provider_message_id";

    const { data: candidateData, error: candidateError } = await supabase
      .from("ai_draft_history")
      .select(historyColumns)
      .eq("company_id", connection.companyId)
      .eq("connection_id", connection.id)
      .in("status", [...ORPHAN_CLEANUP_TERMINAL_STATUSES])
      .not("mailbox_draft_id", "is", null)
      .is("mailbox_draft_cleanup_at", null)
      .order("created_at", { ascending: false })
      .limit(ORPHAN_CLEANUP_ROW_LIMIT);
    if (candidateError) throw candidateError;

    const mailboxDraftIds: string[] = [];
    for (const row of (candidateData ?? []) as Array<Record<string, unknown>>) {
      const mailboxDraftId =
        typeof row.mailbox_draft_id === "string"
          ? row.mailbox_draft_id.trim()
          : "";
      if (!mailboxDraftId || mailboxDraftIds.includes(mailboxDraftId)) continue;
      mailboxDraftIds.push(mailboxDraftId);
      if (mailboxDraftIds.length >= ORPHAN_CLEANUP_DRAFT_LIMIT) break;
    }
    if (mailboxDraftIds.length === 0) return;

    // A draft id outlives the row that placed it: the composer patches the same
    // object and `reassign_phase_c_mailbox_draft` re-points it at a newer
    // history. Only the newest row describes what the object holds NOW, so
    // every decision below is made about that row and no other.
    // Newest first under an explicit bound: if a pathological draft id ever
    // accumulated more histories than one page holds, truncation drops the
    // oldest rows — never the row that decides ownership.
    const { data: ownerData, error: ownerError } = await supabase
      .from("ai_draft_history")
      .select(historyColumns)
      .eq("company_id", connection.companyId)
      .eq("connection_id", connection.id)
      .in("mailbox_draft_id", mailboxDraftIds)
      .order("created_at", { ascending: false })
      .limit(ORPHAN_CLEANUP_OWNER_ROW_LIMIT);
    if (ownerError) throw ownerError;

    const rowsByMailboxDraftId = new Map<
      string,
      Array<Record<string, unknown>>
    >();
    for (const row of (ownerData ?? []) as Array<Record<string, unknown>>) {
      const mailboxDraftId = String(row.mailbox_draft_id ?? "");
      if (!mailboxDraftId) continue;
      const group = rowsByMailboxDraftId.get(mailboxDraftId) ?? [];
      group.push(row);
      rowsByMailboxDraftId.set(mailboxDraftId, group);
    }

    const decisions: Array<{ mailboxDraftId: string; admissible: boolean }> = [];
    for (const mailboxDraftId of mailboxDraftIds) {
      const group = rowsByMailboxDraftId.get(mailboxDraftId) ?? [];
      const owner = [...group].sort(newestHistoryRowFirst)[0];
      // A live placement owns the object: it holds wording awaiting a send, and
      // the pending-thread reconciler is the only thing allowed to resolve it.
      if (!owner || !isOrphanCleanupTerminalStatus(owner.status)) continue;
      decisions.push({
        mailboxDraftId,
        admissible: await orphanDeletionAdmissible({
          connection,
          supabase,
          owner,
        }),
      });
    }
    if (decisions.length === 0) return;

    const settledMailboxDraftIds = new Set<string>();
    const readPolicy: ProviderReadPolicy = {
      deadlineAt: Date.now() + ORPHAN_CLEANUP_DEADLINE_MS,
      context: "orphaned mailbox draft cleanup",
    };
    await runEmailProviderMailboxOperation({
      supabase,
      connectionId: connection.id,
      context: "mailbox-draft-orphan-sweep",
      busyError: "DRAFT_ORPHAN_SWEEP_MAILBOX_BUSY",
      providerLockCheckpoint: input.providerLockCheckpoint,
      run: async (checkpoint) => {
        const provider = EmailService.getProvider(connection);
        for (const { mailboxDraftId, admissible } of decisions) {
          try {
            await checkpoint();
            const draft = await provider.getDraft(mailboxDraftId, readPolicy);
            if (draft === null || !admissible) {
              // Gone already, or present with no admissible proof — either way
              // this object is settled and never needs reading again.
              settledMailboxDraftIds.add(mailboxDraftId);
              continue;
            }
            await provider.deleteDraft(mailboxDraftId);
            settledMailboxDraftIds.add(mailboxDraftId);
            await checkpoint();
          } catch (error) {
            // Left unstamped on purpose so the next sweep retries it.
            console.warn(
              `[draft-reconciliation] orphan sweep could not settle draft ${mailboxDraftId}`,
              error
            );
          }
        }
      },
    });

    const settledRowIds: string[] = [];
    for (const mailboxDraftId of settledMailboxDraftIds) {
      for (const row of rowsByMailboxDraftId.get(mailboxDraftId) ?? []) {
        if (!isOrphanCleanupTerminalStatus(row.status)) continue;
        settledRowIds.push(String(row.id));
      }
    }
    if (settledRowIds.length === 0) return;

    const { error: stampError } = await supabase
      .from("ai_draft_history")
      .update({ mailbox_draft_cleanup_at: new Date().toISOString() })
      .in("id", settledRowIds);
    if (stampError) throw stampError;
  } catch (error) {
    console.warn(
      `[draft-reconciliation] orphaned mailbox draft sweep failed for connection ${connection.id}`,
      error
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

  // Terminal rows are outside the pending reconciler's reach, so their orphans
  // are swept here. Non-throwing, and runs even when nothing was pending.
  await sweepOrphanedMailboxDrafts({
    connection,
    supabase,
    providerLockCheckpoint,
  });

  if (threadFailures.length > 0) {
    throwReconciliationFailures(
      "connection draft sweep failed; sync checkpoint withheld",
      threadFailures
    );
  }
}

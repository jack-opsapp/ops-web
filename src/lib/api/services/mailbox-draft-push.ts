/**
 * OPS Web — Contact-form new-thread draft placement
 *
 * Shared by the canonical Phase C autonomy router and the manual Pipeline
 * "Draft" route. When a lead's only inbound correspondence
 * is a forwarded contact-form submission, the form lives on the FORWARDER's
 * thread — a reply addressed to that thread is wrong. Instead we start a clean
 * NEW thread to the actual client, capture the provider-minted thread id, and:
 *   - persist it onto ai_draft_history.thread_id, so reconcilePendingMailboxDrafts
 *     can detect the client's eventual reply (it keys on thread_id);
 *   - link the new thread to the opportunity (opportunity_email_threads), so the
 *     user's send creates an outbound activity reconciliation can read.
 *
 * One predicate, one place — prevents the sync and manual paths from drifting.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import {
  pickExistingMailboxDraft,
  type MailboxDraftRow,
} from "./mailbox-draft-helpers";
import type { CreateNewThreadDraftResult } from "./email-provider";
import type { ContactFormSubmissionIdentity } from "@/lib/utils/email-parsing";

/** OPS-voice subject for an auto-drafted FIRST reply to a contact-form lead.
 *  Sentence case, no exclamation, no "Re:" (ops-copywriter, 2026-06-03). */
export const CONTACT_FORM_OUTREACH_SUBJECT = "Thanks for reaching out";

/** Grounds the new-email draft in the submitter's actual inquiry so the body
 *  reads as a real first reply, not boilerplate. Fed to generateDraft as
 *  `userInstruction` (its new-email prompt renders it as "Purpose: …"). */
export function buildContactFormDraftInstruction(
  submitter: Pick<ContactFormSubmissionIdentity, "name" | "message">
): string {
  const who = submitter.name?.trim() || "a prospective customer";
  const msg = submitter.message?.trim();
  const quoted = msg ? ` They wrote: "${msg.slice(0, 500)}"` : "";
  return `Write a brief, warm first reply to a new website enquiry from ${who}.${quoted} Acknowledge their request and suggest a next step (a quick call or a site visit). Keep it short and do not invent specifics.`;
}

type PushProvider = {
  createNewThreadDraft: (
    to: string,
    subject: string,
    body: string,
    contentType?: "text" | "html"
  ) => Promise<CreateNewThreadDraftResult>;
  updateDraft: (
    draftId: string,
    to: string,
    subject: string,
    body: string,
    threadId?: string,
    contentType?: "text" | "html"
  ) => Promise<void>;
};

interface PlaceNewThreadDraftArgs {
  provider: PushProvider;
  connectionId: string;
  opportunityId: string;
  /** ai_draft_history row id created by AIDraftService.generateDraft. */
  draftHistoryId: string;
  to: string;
  subject: string;
  body: string;
  contentType?: "text" | "html";
  /**
   * Autonomous Phase C placements use the canonical atomic history
   * reassignment RPC. Manual/operator drafts omit this and retain the existing
   * direct history update behavior because their history origin is not Phase C.
   */
  phaseCCompanyId?: string;
  /**
   * A queue-backed placement has already persisted a one-shot provider
   * placement attempt. Creation is allowed only when the database proved no
   * prior OPS draft exists.
   */
  forceCreate?: boolean;
  /**
   * Exact provider identity selected server-side from one active OPS draft.
   * This bypasses all database/provider inventory and updates only that draft.
   */
  exactReusableDraft?: {
    mailboxDraftId: string;
    threadId: string;
  };
  /**
   * Queue-backed workers persist history attribution, thread linkage, and queue
   * completion in one database transaction. When supplied, the shared helper
   * performs no local database writes.
   */
  persistPlacement?: (input: {
    mailboxDraftId: string;
    threadId: string;
  }) => Promise<boolean>;
}

/** A reusable prior draft also carries its minted thread so updateDraft can
 *  re-pin to the same conversation. */
type ReusableDraftRow = MailboxDraftRow & { thread_id?: string | null };

/**
 * Place a fresh-outreach draft on a NEW provider thread for a contact-form lead.
 *
 * Idempotent per (connection_id, opportunity_id): a re-sync reuses the prior
 * auto_drafted mailbox draft (updateDraft on its thread) instead of minting a
 * second thread. May throw — callers run this inside their own non-fatal
 * try/catch (the sync loop and the manual route both treat push as best-effort).
 */
export async function placeNewThreadDraft({
  provider,
  connectionId,
  opportunityId,
  draftHistoryId,
  to,
  subject,
  body,
  contentType = "text",
  phaseCCompanyId,
  forceCreate = false,
  exactReusableDraft,
  persistPlacement,
}: PlaceNewThreadDraftArgs): Promise<{
  mailboxDraftId: string;
  threadId: string | null;
}> {
  const supabase = requireSupabase();

  const exactMailboxDraftId = exactReusableDraft?.mailboxDraftId.trim() || null;
  const exactThreadId = exactReusableDraft?.threadId.trim() || null;
  if (
    exactReusableDraft &&
    (!exactMailboxDraftId || !exactThreadId || forceCreate)
  ) {
    throw new Error("Exact reusable mailbox draft identity is invalid");
  }

  // Idempotency: keyed on the opportunity, not a thread — at first run no new
  // thread exists yet, and there is no shared forwarder thread to dedup on.
  let existing: ReusableDraftRow | null = null;
  if (!forceCreate && !exactReusableDraft) {
    let priorQuery = supabase
      .from("ai_draft_history")
      .select("id, mailbox_draft_id, status, thread_id")
      .eq("connection_id", connectionId)
      .eq("opportunity_id", opportunityId);
    if (phaseCCompanyId) {
      priorQuery = priorQuery
        .eq("company_id", phaseCCompanyId)
        .eq("origin", "phase_c");
    }
    const { data: priorRows, error: priorError } = await priorQuery;
    if (priorError) {
      throw new Error(
        `Failed to inspect existing mailbox draft identity: ${priorError.message ?? "unknown error"}`
      );
    }
    existing = pickExistingMailboxDraft(
      (priorRows ?? []) as MailboxDraftRow[]
    ) as ReusableDraftRow | null;
  }

  let mailboxDraftId: string;
  let threadId: string | null;

  if (exactMailboxDraftId && exactThreadId) {
    await provider.updateDraft(
      exactMailboxDraftId,
      to,
      subject,
      body,
      exactThreadId,
      contentType
    );
    mailboxDraftId = exactMailboxDraftId;
    threadId = exactThreadId;
  } else if (!forceCreate && existing?.mailbox_draft_id) {
    const reuseThread = existing.thread_id ?? undefined;
    await provider.updateDraft(
      existing.mailbox_draft_id,
      to,
      subject,
      body,
      reuseThread,
      contentType
    );
    mailboxDraftId = existing.mailbox_draft_id;
    threadId = existing.thread_id ?? null;
  } else {
    const created = await provider.createNewThreadDraft(
      to,
      subject,
      body,
      contentType
    );
    mailboxDraftId = created.draftId;
    threadId = created.threadId;
  }

  if (persistPlacement) {
    if (!threadId?.trim()) {
      throw new Error(
        "Atomic Phase C placement persistence requires a provider thread identity"
      );
    }
    const persisted = await persistPlacement({
      mailboxDraftId,
      threadId,
    });
    if (!persisted) {
      throw new Error("Atomic placement persistence was rejected");
    }
    return { mailboxDraftId, threadId };
  }

  if (phaseCCompanyId) {
    if (!threadId?.trim()) {
      throw new Error(
        "Failed to persist Phase C mailbox draft identity: provider thread missing"
      );
    }
    const { data: reassigned, error: reassignError } = await supabase.rpc(
      "reassign_phase_c_mailbox_draft",
      {
        p_company_id: phaseCCompanyId,
        p_connection_id: connectionId,
        p_thread_id: threadId,
        p_new_draft_history_id: draftHistoryId,
        p_mailbox_draft_id: mailboxDraftId,
        p_expected_old_draft_history_id:
          existing?.id && existing.id !== draftHistoryId ? existing.id : null,
        p_subject: subject,
      }
    );
    if (reassignError || !reassigned) {
      throw new Error(
        `Failed to atomically persist Phase C mailbox draft identity: ${reassignError?.message ?? "no row returned"}`
      );
    }
  } else {
    const { error: historyError } = await supabase
      .from("ai_draft_history")
      .update({
        status: "auto_drafted",
        mailbox_draft_id: mailboxDraftId,
        thread_id: threadId,
        subject,
      })
      .eq("id", draftHistoryId);
    if (historyError) {
      throw new Error(
        `Failed to persist mailbox draft identity: ${historyError.message ?? "unknown error"}`
      );
    }
  }

  // Link the new thread to the opportunity so processSentEmail attaches the
  // user's eventual send as an outbound activity (reconciliation reads it) and
  // future client replies inherit the lead.
  if (threadId) {
    const { error: linkError } = await supabase
      .from("opportunity_email_threads")
      .upsert(
        {
          opportunity_id: opportunityId,
          thread_id: threadId,
          connection_id: connectionId,
        },
        {
          onConflict: "thread_id,connection_id",
          ignoreDuplicates: true,
        }
      );
    if (linkError) {
      throw new Error(
        `Failed to claim mailbox draft thread: ${linkError.message ?? "unknown error"}`
      );
    }
    const { data: canonicalLink, error: canonicalError } = await supabase
      .from("opportunity_email_threads")
      .select("opportunity_id")
      .eq("thread_id", threadId)
      .eq("connection_id", connectionId)
      .limit(1)
      .maybeSingle();
    if (canonicalError || canonicalLink?.opportunity_id !== opportunityId) {
      throw new Error(
        `Mailbox draft thread belongs to a different opportunity: ${canonicalError?.message ?? canonicalLink?.opportunity_id ?? "missing owner"}`
      );
    }
  }

  return { mailboxDraftId, threadId };
}

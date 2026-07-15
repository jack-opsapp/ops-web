/**
 * POST /api/integrations/email/draft
 * Generate a draft reply for a pipeline lead using AI memory + writing profile,
 * then push it into the user's real mailbox Drafts folder (Gmail or Outlook).
 *
 * Works WITHOUT phase_c — phase_c context is used when available but is not required.
 * Requires an active email connection for the company/user to offer "Save to mailbox".
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { AIDraftService } from "@/lib/api/services/ai-draft-service";
import { WritingProfileService } from "@/lib/api/services/writing-profile-service";
import { EmailService } from "@/lib/api/services/email-service";
import {
  pickExistingMailboxDraft,
  type MailboxDraftRow,
} from "@/lib/api/services/mailbox-draft-helpers";
import {
  placeNewThreadDraft,
  CONTACT_FORM_OUTREACH_SUBJECT,
} from "@/lib/api/services/mailbox-draft-push";
import { extractContactFormSubmission } from "@/lib/utils/email-parsing";
import { normalizeReplySubject } from "@/lib/email/email-subject-policy";
import {
  renderMailboxDraftWithSignature,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const { companyId, userId, opportunityId, checkOnly } = body;

    if (!companyId || !userId || !opportunityId) {
      return NextResponse.json(
        { error: "companyId, userId, and opportunityId required" },
        { status: 400 }
      );
    }
    const authError = await requireEmailCompanyAccess(
      request,
      companyId,
      "inbox.send",
      userId
    );
    if (authError) return authError;

    const { data: ownedOpportunity, error: opportunityError } = await supabase
      .from("opportunities")
      .select("id")
      .eq("id", opportunityId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (opportunityError) {
      throw new Error(
        `Failed to validate opportunity ownership: ${opportunityError.message}`
      );
    }
    if (!ownedOpportunity) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Resolve email connection for this company/user ───────────────────
    // We need this for both the availability check and draft generation.
    const connections = await EmailService.getConnections(companyId);
    // Prefer a user-specific active connection; fall back to company-level one.
    const connection =
      connections.find((c) => c.userId === userId && c.status === "active") ??
      connections.find((c) => c.status === "active") ??
      null;

    // ── Quick availability check — no AI calls ───────────────────────────
    if (checkOnly) {
      if (!connection) {
        return NextResponse.json({
          available: false,
          confidence: 0,
          draft: "",
          sources: [],
          reason: "No mailbox connected",
        });
      }

      const profile = await WritingProfileService.getProfile(companyId, userId);
      const emailsAnalyzed = (profile?.emails_analyzed as number) || 0;
      const confidence = WritingProfileService.getConfidence(emailsAnalyzed);
      const meetsThreshold = emailsAnalyzed >= 5;

      return NextResponse.json({
        available: meetsThreshold,
        confidence,
        draft: "",
        sources: [],
        reason: !meetsThreshold
          ? `Need more email data (${emailsAnalyzed}/5 emails analyzed, confidence: ${(confidence * 100).toFixed(0)}%)`
          : undefined,
        provider: connection.provider,
      });
    }

    // ── Generate draft via AIDraftService ────────────────────────────────
    // AIDraftService creates an ai_draft_history row and returns a draftHistoryId.
    // It uses phase_c context when available but does NOT require phase_c to be
    // enabled — any user with ≥5 emails analyzed can get a draft.
    const connectionId = connection?.id ?? "";

    const draftResult = await AIDraftService.generateDraft({
      companyId,
      userId,
      connectionId,
      opportunityId,
    });

    if (!draftResult.available || !draftResult.draft) {
      return NextResponse.json({
        draft: "",
        confidence: draftResult.confidence,
        sources: draftResult.sources,
        available: false,
        reason: draftResult.reason,
        mailboxSaved: false,
      });
    }

    // ── Push to mailbox Drafts folder ────────────────────────────────────
    // If no active connection, return the draft without mailbox placement.
    if (!connection) {
      return NextResponse.json({
        draft: draftResult.draft,
        confidence: draftResult.confidence,
        sources: draftResult.sources,
        available: true,
        draftHistoryId: draftResult.draftHistoryId,
        mailboxSaved: false,
        reason: "No mailbox connected",
      });
    }

    let mailboxDraftId: string | null = null;
    let mailboxSaved = false;

    try {
      const provider = EmailService.getProvider(connection);
      const signature = await resolveEmailSignatureForMessage({
        supabase,
        connection,
        userId,
        refreshProviderIfMissing: true,
      });
      if (!signature) {
        throw new Error("EMAIL_SIGNATURE_REQUIRED");
      }
      const renderedDraft = renderMailboxDraftWithSignature(
        draftResult.draft,
        signature
      );

      // Fetch the opportunity's thread context for subject + recipient
      const { data: opp } = await supabase
        .from("opportunities")
        .select("title, clients!inner(email, name)")
        .eq("id", opportunityId)
        .single();

      // Get the last inbound activity to build a reply subject (body_text lets
      // us detect a forwarded contact-form submission).
      const { data: lastActivity } = await supabase
        .from("activities")
        .select("subject, email_thread_id, body_text")
        .eq("opportunity_id", opportunityId)
        .eq("type", "email")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1);

      const clientRecord = opp?.clients as unknown as
        | { email: string; name: string }
        | { email: string; name: string }[]
        | null
        | undefined;
      const clientObj = Array.isArray(clientRecord)
        ? clientRecord[0]
        : clientRecord;
      const clientEmail = clientObj?.email;

      // Forwarded contact-form lead → fresh first reply on a NEW thread to the
      // actual client, not a "Re:" glued to the forwarder's thread. Detect from
      // the latest inbound activity body; if matched, ignore the forwarder
      // thread entirely and place a clean new-thread outreach (shared helper
      // also links the thread + tracks thread_id for reconciliation).
      const contactFormSubmitter = extractContactFormSubmission(
        (lastActivity?.[0]?.subject as string) ?? "",
        (lastActivity?.[0]?.body_text as string) ?? ""
      );
      if (contactFormSubmitter && draftResult.draftHistoryId) {
        const to = contactFormSubmitter.email || clientEmail;
        if (!to) {
          return NextResponse.json({
            draft: draftResult.draft,
            confidence: draftResult.confidence,
            sources: draftResult.sources,
            available: true,
            draftHistoryId: draftResult.draftHistoryId,
            mailboxSaved: false,
            reason: "No client email to address draft to",
          });
        }
        const placed = await placeNewThreadDraft({
          provider,
          connectionId: connection.id,
          opportunityId,
          draftHistoryId: draftResult.draftHistoryId,
          to,
          subject: draftResult.subject || CONTACT_FORM_OUTREACH_SUBJECT,
          body: renderedDraft.body,
          contentType: renderedDraft.contentType,
        });
        return NextResponse.json({
          draft: draftResult.draft,
          confidence: draftResult.confidence,
          sources: draftResult.sources,
          available: true,
          draftHistoryId: draftResult.draftHistoryId,
          mailboxSaved: true,
          mailboxDraftId: placed.mailboxDraftId,
          provider: connection.provider,
        });
      }

      const rawSubject =
        (lastActivity?.[0]?.subject as string) ||
        (opp?.title as string) ||
        "Your inquiry";
      const replySubject = normalizeReplySubject(rawSubject);
      const providerThreadId: string | undefined =
        (lastActivity?.[0]?.email_thread_id as string) ?? undefined;

      // Resolve the provider thread id from email_threads if we have it
      let mailboxThreadId: string | undefined;
      if (providerThreadId) {
        const { data: threadRow } = await supabase
          .from("email_threads")
          .select("provider_thread_id")
          .eq("id", providerThreadId)
          .single();
        mailboxThreadId =
          (threadRow?.provider_thread_id as string) ?? undefined;
      }

      if (!clientEmail) {
        // No recipient — can't push. Return draft without mailbox placement.
        return NextResponse.json({
          draft: draftResult.draft,
          confidence: draftResult.confidence,
          sources: draftResult.sources,
          available: true,
          draftHistoryId: draftResult.draftHistoryId,
          mailboxSaved: false,
          reason: "No client email to address draft to",
        });
      }

      // Idempotency: check for an existing unresolved mailbox draft on this
      // thread so we update in-place rather than creating a duplicate.
      let existingMailboxDraftId: string | null = null;
      if (mailboxThreadId && draftResult.draftHistoryId) {
        const { data: priorRows } = await supabase
          .from("ai_draft_history")
          .select("id, mailbox_draft_id, status")
          .eq("connection_id", connection.id)
          .eq("thread_id", mailboxThreadId);
        const existing = pickExistingMailboxDraft(
          (priorRows ?? []) as MailboxDraftRow[]
        );
        existingMailboxDraftId = existing?.mailbox_draft_id ?? null;
      }

      if (existingMailboxDraftId) {
        await provider.updateDraft(
          existingMailboxDraftId,
          clientEmail,
          replySubject,
          renderedDraft.body,
          mailboxThreadId,
          renderedDraft.contentType
        );
        mailboxDraftId = existingMailboxDraftId;
      } else {
        mailboxDraftId = await provider.createDraft(
          clientEmail,
          replySubject,
          renderedDraft.body,
          mailboxThreadId,
          renderedDraft.contentType
        );
      }

      // Persist mailbox_draft_id + set status to auto_drafted
      if (draftResult.draftHistoryId && mailboxDraftId) {
        await supabase
          .from("ai_draft_history")
          .update({
            status: "auto_drafted",
            mailbox_draft_id: mailboxDraftId,
            subject: replySubject,
            subject_source: "thread",
          })
          .eq("id", draftResult.draftHistoryId);
      }

      mailboxSaved = true;
    } catch (pushErr) {
      // Mailbox push is non-fatal — still return the draft so Copy works.
      console.error("[draft-route] mailbox push failed (non-fatal):", pushErr);

      // Update status to auto_drafted even without a mailbox_draft_id so the
      // reconciliation and UI can still see this draft.
      if (draftResult.draftHistoryId) {
        await supabase
          .from("ai_draft_history")
          .update({ status: "auto_drafted" })
          .eq("id", draftResult.draftHistoryId);
      }
    }

    return NextResponse.json({
      draft: draftResult.draft,
      confidence: draftResult.confidence,
      sources: draftResult.sources,
      available: true,
      draftHistoryId: draftResult.draftHistoryId,
      mailboxSaved,
      mailboxDraftId,
      subject: draftResult.subject,
      provider: connection.provider,
    });
  } catch (err) {
    console.error("[draft-generator]", err);
    return NextResponse.json(
      { error: "Failed to generate draft" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

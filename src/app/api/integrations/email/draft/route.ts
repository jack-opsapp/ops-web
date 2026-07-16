/**
 * POST /api/integrations/email/draft
 * Generate a draft reply for a pipeline lead using AI memory + writing profile,
 * then push it into the user's real mailbox Drafts folder (Gmail or Outlook).
 *
 * Works WITHOUT phase_c — phase_c context is used when available but is not required.
 * Requires an active email connection for the company/user to offer "Save to mailbox".
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { resolveEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";
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

interface ReplyThreadRow {
  id: string;
  connection_id: string;
  provider_thread_id: string;
}

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
    const actorResolution = await resolveEmailRouteActor(request, {
      claimedCompanyId: companyId,
      claimedUserId: userId,
    });
    if (!actorResolution.ok) return actorResolution.response;
    const { actor } = actorResolution;

    // ── Resolve email connection for this company/user ───────────────────
    // We need this for both the availability check and draft generation.
    const connections = await EmailService.getConnections(actor.companyId);
    // Prefer the actor's own active personal connection, then an active shared
    // company connection. Never fall through to another user's mailbox.
    let connection =
      connections.find(
        (c) =>
          c.type === "individual" &&
          c.userId === actor.userId &&
          c.status === "active"
      ) ??
      connections.find((c) => c.type === "company" && c.status === "active") ??
      null;

    if (!connection) {
      return NextResponse.json({
        available: false,
        confidence: 0,
        draft: "",
        sources: [],
        reason: "No mailbox connected",
        mailboxSaved: false,
      });
    }

    const access = await resolveEmailOpportunityAccess({
      actor,
      operation: "send",
      connectionId: connection.id,
      opportunityId,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!access.opportunityId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    let draftAccess = access;
    const canonicalOpportunityId = access.opportunityId;

    // Load the canonical reply context only after the lead + tentative sender
    // have passed authorization. Activities store provider thread ids (plus a
    // connection id on modern rows), so never treat email_thread_id as the
    // internal email_threads UUID without resolving it first.
    const [{ data: opp }, { data: lastActivity }] = await Promise.all([
      supabase
        .from("opportunities")
        .select("title, clients!inner(email, name)")
        .eq("id", canonicalOpportunityId)
        .eq("company_id", actor.companyId)
        .single(),
      supabase
        .from("activities")
        .select("subject, email_thread_id, email_connection_id, body_text")
        .eq("opportunity_id", canonicalOpportunityId)
        .eq("type", "email")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const latestInbound = lastActivity?.[0] ?? null;
    const contactFormSubmitter = extractContactFormSubmission(
      (latestInbound?.subject as string) ?? "",
      (latestInbound?.body_text as string) ?? ""
    );

    let replyThread: ReplyThreadRow | null = null;
    const activityThreadId = latestInbound?.email_thread_id as
      | string
      | null
      | undefined;
    const activityConnectionId = latestInbound?.email_connection_id as
      | string
      | null
      | undefined;

    if (activityThreadId && !contactFormSubmitter) {
      if (activityConnectionId) {
        const { data: exactThread, error: exactThreadError } = await supabase
          .from("email_threads")
          .select("id, connection_id, provider_thread_id")
          .eq("company_id", actor.companyId)
          .eq("connection_id", activityConnectionId)
          .eq("provider_thread_id", activityThreadId)
          .maybeSingle();
        if (exactThreadError) {
          throw new Error(
            `Failed to resolve reply thread: ${exactThreadError.message}`
          );
        }
        replyThread = exactThread as ReplyThreadRow | null;
      }

      // Legacy activities may predate email_connection_id. Resolve their
      // immutable provider-thread owner through the opportunity junction.
      if (!replyThread && !activityConnectionId) {
        const { data: linkRows, error: linkError } = await supabase
          .from("opportunity_email_threads")
          .select("connection_id")
          .eq("opportunity_id", canonicalOpportunityId)
          .eq("thread_id", activityThreadId)
          .limit(2);
        if (linkError) {
          throw new Error(
            `Failed to resolve reply thread owner: ${linkError.message}`
          );
        }
        const links = Array.isArray(linkRows) ? linkRows : [];
        if (links.length === 1 && links[0]?.connection_id) {
          const { data: linkedThread, error: linkedThreadError } =
            await supabase
              .from("email_threads")
              .select("id, connection_id, provider_thread_id")
              .eq("company_id", actor.companyId)
              .eq("connection_id", links[0].connection_id as string)
              .eq("provider_thread_id", activityThreadId)
              .maybeSingle();
          if (linkedThreadError) {
            throw new Error(
              `Failed to resolve linked reply thread: ${linkedThreadError.message}`
            );
          }
          replyThread = linkedThread as ReplyThreadRow | null;
        }
      }

      // Compatibility for the brief period when activities stored the
      // internal thread UUID instead of the provider thread id.
      if (!replyThread) {
        const { data: legacyThread, error: legacyThreadError } = await supabase
          .from("email_threads")
          .select("id, connection_id, provider_thread_id")
          .eq("id", activityThreadId)
          .eq("company_id", actor.companyId)
          .maybeSingle();
        if (legacyThreadError) {
          throw new Error(
            `Failed to resolve legacy reply thread: ${legacyThreadError.message}`
          );
        }
        replyThread = legacyThread as ReplyThreadRow | null;
      }
    }

    if (replyThread) {
      const pinnedConnection = connections.find(
        (candidate) =>
          candidate.id === replyThread?.connection_id &&
          candidate.status === "active"
      );
      if (!pinnedConnection) {
        return NextResponse.json(
          {
            available: false,
            confidence: 0,
            draft: "",
            sources: [],
            reason:
              "Reconnect the mailbox for this conversation before drafting a reply.",
            code: "EMAIL_CONNECTION_UNAVAILABLE",
            mailboxSaved: false,
          },
          { status: 409 }
        );
      }
      const threadAccess = await resolveEmailOpportunityAccess({
        actor,
        operation: "send",
        threadId: replyThread.id,
        connectionId: replyThread.connection_id,
        providerThreadId: replyThread.provider_thread_id,
        opportunityId: canonicalOpportunityId,
        supabase,
      });
      if (!threadAccess.allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      draftAccess = threadAccess;
      connection = pinnedConnection;
    }

    // ── Quick availability check — no AI calls ───────────────────────────
    if (checkOnly) {
      const profile = await WritingProfileService.getProfile(
        actor.companyId,
        actor.userId
      );
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
    const draftResult = await AIDraftService.generateDraft({
      companyId: draftAccess.actor.companyId,
      userId: draftAccess.actor.userId,
      connectionId: draftAccess.connectionId,
      opportunityId: draftAccess.opportunityId ?? undefined,
      threadId: draftAccess.providerThreadId ?? undefined,
      emailAccess: draftAccess,
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
    let mailboxDraftId: string | null = null;
    let mailboxSaved = false;

    try {
      const provider = EmailService.getProvider(connection);
      const signature = await resolveEmailSignatureForMessage({
        supabase,
        connection,
        userId: actor.userId,
        refreshProviderIfMissing: true,
      });
      if (!signature) {
        throw new Error("EMAIL_SIGNATURE_REQUIRED");
      }
      const renderedDraft = renderMailboxDraftWithSignature(
        draftResult.draft,
        signature
      );

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
          opportunityId: canonicalOpportunityId,
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
        (latestInbound?.subject as string) ||
        (opp?.title as string) ||
        "Your inquiry";
      const replySubject = normalizeReplySubject(rawSubject);
      const mailboxThreadId = replyThread?.provider_thread_id;

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

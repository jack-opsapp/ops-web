// src/lib/api/services/sync-engine.ts
// Core sync cycle — runs on every sync trigger (cron, manual, webhook).
// Implements the 12-step flow from spec Section 4C.

import { requireSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "./email-service";
import { EmailMatchingServiceV2 } from "./email-matching-service-v2";
import { StageEvaluator } from "./stage-evaluator";
import { AISyncReviewer } from "./ai-sync-reviewer";
import { MemoryService } from "./memory-service";
import { WritingProfileService } from "./writing-profile-service";
import { matchPlatform, isFormSubmissionSubject } from "./known-platforms";
import type {
  EmailConnection,
  SyncProfile,
} from "@/lib/types/email-connection";
import type { NormalizedEmail } from "./email-provider";

export interface SyncCycleResult {
  activitiesCreated: number;
  matched: number;
  needsReview: number;
  newLeads: number;
  stageChanges: number;
  labelsApplied: number;
  errors: string[];
}

// ─── Module-level helpers ───────────────────────────────────────────────────

function matchesPattern(email: NormalizedEmail, profile: SyncProfile): boolean {
  const normalized = email.subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
    .trim()
    .toLowerCase();
  return (profile.estimateSubjectPatterns || []).some((p) =>
    normalized.includes(p.toLowerCase())
  );
}

function extractSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).toLowerCase().trim();
}

function emptyResult(): SyncCycleResult {
  return {
    activitiesCreated: 0,
    matched: 0,
    needsReview: 0,
    newLeads: 0,
    stageChanges: 0,
    labelsApplied: 0,
    errors: [],
  };
}

async function createClient(
  email: NormalizedEmail,
  companyId: string
): Promise<string> {
  const supabase = requireSupabase();
  const senderEmail = extractSenderEmail(email.from);

  // Check for existing client first to avoid duplicates
  const { data: existingClients } = await supabase
    .from("clients")
    .select("id")
    .eq("company_id", companyId)
    .ilike("email", senderEmail)
    .is("deleted_at", null)
    .limit(1);

  if (existingClients && existingClients.length > 0) {
    return existingClients[0].id;
  }

  const { data } = await supabase
    .from("clients")
    .insert({
      company_id: companyId,
      name: email.fromName || senderEmail.split("@")[0],
      email: senderEmail,
    })
    .select("id")
    .single();
  return data!.id;
}

async function createSubClient(
  email: NormalizedEmail,
  clientId: string,
  companyId: string
): Promise<void> {
  const supabase = requireSupabase();
  const senderEmail = extractSenderEmail(email.from);

  // Check for existing sub-client to avoid duplicates
  const { data: existingSub } = await supabase
    .from("sub_clients")
    .select("id")
    .eq("client_id", clientId)
    .ilike("email", senderEmail)
    .is("deleted_at", null)
    .limit(1);

  if (existingSub && existingSub.length > 0) return;

  await supabase.from("sub_clients").insert({
    company_id: companyId,
    client_id: clientId,
    name: email.fromName || senderEmail.split("@")[0],
    email: senderEmail,
  });
}

async function createOpportunity(
  email: NormalizedEmail,
  clientId: string,
  companyId: string,
  stage: string
): Promise<string> {
  const supabase = requireSupabase();
  const isOutbound = stage === "qualifying"; // sent folder leads start at qualifying
  const { data } = await supabase
    .from("opportunities")
    .insert({
      company_id: companyId,
      client_id: clientId,
      title: `${email.fromName || "New Lead"} — Email Inquiry`,
      stage,
      source: "email",
      correspondence_count: 1,
      outbound_count: isOutbound ? 1 : 0,
      inbound_count: isOutbound ? 0 : 1,
      last_inbound_at: isOutbound ? null : email.date.toISOString(),
      last_outbound_at: isOutbound ? email.date.toISOString() : null,
      last_message_direction: isOutbound ? "out" : "in",
      tags: ["email-import"],
    })
    .select("id")
    .single();
  return data!.id;
}

async function getOrCreateOpportunity(
  clientId: string,
  companyId: string,
  email: NormalizedEmail
): Promise<string> {
  const supabase = requireSupabase();

  const { data: existing } = await supabase
    .from("opportunities")
    .select("id")
    .eq("client_id", clientId)
    .eq("company_id", companyId)
    .not("stage", "in", '("won","lost")')
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  return createOpportunity(email, clientId, companyId, "new_lead");
}

async function linkThread(
  opportunityId: string,
  threadId: string,
  connectionId: string
): Promise<void> {
  const supabase = requireSupabase();
  await supabase.from("opportunity_email_threads").upsert(
    {
      opportunity_id: opportunityId,
      thread_id: threadId,
      connection_id: connectionId,
    },
    { onConflict: "thread_id,connection_id" }
  );
}

async function createActivity(
  email: NormalizedEmail,
  connection: EmailConnection,
  opportunityId: string | null,
  direction: "inbound" | "outbound",
  extra?: {
    matchNeedsReview?: boolean;
    suggestedClientId?: string | null;
    matchConfidence?: string;
  }
): Promise<void> {
  const supabase = requireSupabase();
  await supabase.from("activities").insert({
    company_id: connection.companyId,
    type: "email",
    subject: email.subject,
    content: email.snippet,
    email_message_id: email.id,
    email_thread_id: email.threadId,
    opportunity_id: opportunityId,
    direction,
    from_email: extractSenderEmail(email.from),
    match_needs_review: extra?.matchNeedsReview || false,
    suggested_client_id: extra?.suggestedClientId || null,
    match_confidence: extra?.matchConfidence || "pattern",
    is_read: !extra?.matchNeedsReview,
  });
}

async function updateCorrespondenceCounts(
  opportunityId: string,
  direction: "inbound" | "outbound",
  date: Date,
  result: SyncCycleResult
): Promise<void> {
  const supabase = requireSupabase();

  const { data: opp } = await supabase
    .from("opportunities")
    .select(
      "correspondence_count, outbound_count, inbound_count, stage, last_inbound_at, last_outbound_at"
    )
    .eq("id", opportunityId)
    .single();

  if (!opp) return;

  const updates: Record<string, unknown> = {
    correspondence_count: (opp.correspondence_count || 0) + 1,
    last_message_direction: direction === "inbound" ? "in" : "out",
    last_activity_at: new Date().toISOString(),
  };

  if (direction === "inbound") {
    updates.inbound_count = (opp.inbound_count || 0) + 1;
    updates.last_inbound_at = date.toISOString();
  } else {
    updates.outbound_count = (opp.outbound_count || 0) + 1;
    updates.last_outbound_at = date.toISOString();
  }

  // Evaluate stage
  const evaluation = StageEvaluator.evaluate({
    outboundCount: (updates.outbound_count ||
      opp.outbound_count ||
      0) as number,
    inboundCount: (updates.inbound_count || opp.inbound_count || 0) as number,
    totalMessages: updates.correspondence_count as number,
    lastMessageDirection: direction === "inbound" ? "in" : "out",
    lastInboundAt:
      direction === "inbound"
        ? date
        : opp.last_inbound_at
          ? new Date(opp.last_inbound_at)
          : null,
    lastOutboundAt:
      direction === "outbound"
        ? date
        : opp.last_outbound_at
          ? new Date(opp.last_outbound_at)
          : null,
    currentStage: opp.stage,
    autoFollowUpDays: 5, // TODO: fetch from company pipeline stage config
  });

  if (evaluation.changed) {
    updates.stage = evaluation.stage;
    result.stageChanges++;
  }

  await supabase.from("opportunities").update(updates).eq("id", opportunityId);
}

async function applyLabel(
  threadId: string,
  connection: EmailConnection,
  result: SyncCycleResult
): Promise<void> {
  if (!connection.opsLabelId) return;
  try {
    const provider = EmailService.getProvider(connection);
    await provider.applyLabel(threadId, connection.opsLabelId);
    result.labelsApplied++;
  } catch (err) {
    console.error(
      `[sync-engine] Failed to apply label to thread ${threadId}:`,
      err
    );
  }
}

async function createTerminalFlagNotification(
  stageResult: { threadId: string; terminalFlag: string | null },
  connection: EmailConnection
): Promise<void> {
  if (!stageResult.terminalFlag || !connection.userId) return;

  const supabase = requireSupabase();

  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", stageResult.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (!threadLink || threadLink.length === 0) return;

  const oppId = threadLink[0].opportunity_id;
  const { data: opp } = await supabase
    .from("opportunities")
    .select("title, client_id")
    .eq("id", oppId)
    .single();

  let clientName = "A client";
  if (opp?.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("name")
      .eq("id", opp.client_id as string)
      .single();
    if (client?.name) clientName = client.name as string;
  }

  const action =
    stageResult.terminalFlag === "likely_won"
      ? "accepted your estimate"
      : "declined";

  await supabase.from("notifications").insert({
    user_id: connection.userId,
    company_id: connection.companyId,
    type: "role_needed",
    title:
      stageResult.terminalFlag === "likely_won"
        ? "Possible deal won"
        : "Possible deal lost",
    body: `${clientName} may have ${action}. Review and confirm.`,
    is_read: false,
    persistent: true,
    action_url: "/pipeline",
    action_label:
      stageResult.terminalFlag === "likely_won" ? "Mark as Won" : "Review",
  });
}

async function createSyncNotification(
  connection: EmailConnection,
  result: SyncCycleResult
): Promise<void> {
  const userId = connection.userId;
  if (!userId) return;

  const parts: string[] = [];
  if (result.newLeads > 0)
    parts.push(
      `${result.newLeads} new lead${result.newLeads > 1 ? "s" : ""}`
    );
  if (result.matched > 0)
    parts.push(
      `${result.matched} email${result.matched > 1 ? "s" : ""} matched`
    );
  if (result.needsReview > 0)
    parts.push(
      `${result.needsReview} need${result.needsReview > 1 ? "" : "s"} review`
    );

  if (parts.length === 0) return;

  const supabase = requireSupabase();
  await supabase.from("notifications").insert({
    user_id: userId,
    company_id: connection.companyId,
    type: "mention",
    title: "Email sync complete",
    body: parts.join(" · "),
    is_read: false,
    persistent: false,
    action_url: "/pipeline",
    action_label: "View Pipeline",
  });
}

// ─── Inbound / Outbound Processors ─────────────────────────────────────────

/** Returns true if the email was unmatched (no pattern, no thread link). */
async function processInboundEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile: SyncProfile,
  result: SyncCycleResult
): Promise<boolean> {
  const supabase = requireSupabase();

  // Dedup: check if we already have this email
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", email.id)
    .limit(1);

  if (existing && existing.length > 0) return false;

  // Thread inheritance — is this thread already linked to an OPS lead?
  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", email.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (threadLink && threadLink.length > 0) {
    await createActivity(
      email,
      connection,
      threadLink[0].opportunity_id,
      "inbound"
    );
    await updateCorrespondenceCounts(
      threadLink[0].opportunity_id,
      "inbound",
      email.date,
      result
    );
    await applyLabel(email.threadId, connection, result);
    result.activitiesCreated++;
    result.matched++;
    return false;
  }

  // Pattern matching
  const isPatternMatch = matchesPattern(email, profile);
  const isPlatformMatch = matchPlatform(email.from) !== null;
  const isForwarderMatch =
    profile.teamForwarders?.some((f) =>
      email.from.toLowerCase().includes(f.toLowerCase())
    ) && isFormSubmissionSubject(email.subject);

  if (isPatternMatch || isPlatformMatch || isForwarderMatch) {
    const matchResult = await EmailMatchingServiceV2.match(
      connection.companyId,
      extractSenderEmail(email.from),
      {
        threadId: email.threadId,
        name: email.fromName,
        connectionId: connection.id,
      }
    );

    if (matchResult.action === "create_new") {
      const clientId = await createClient(email, connection.companyId);
      const oppId = await createOpportunity(
        email,
        clientId,
        connection.companyId,
        "new_lead"
      );
      await linkThread(oppId, email.threadId, connection.id);
      await createActivity(email, connection, oppId, "inbound");
      await applyLabel(email.threadId, connection, result);
      result.newLeads++;
      result.activitiesCreated++;
    } else if (
      matchResult.action === "link" ||
      matchResult.action === "create_subclient"
    ) {
      const oppId = await getOrCreateOpportunity(
        matchResult.clientId!,
        connection.companyId,
        email
      );
      await linkThread(oppId, email.threadId, connection.id);
      await createActivity(email, connection, oppId, "inbound");
      await updateCorrespondenceCounts(oppId, "inbound", email.date, result);
      await applyLabel(email.threadId, connection, result);
      result.matched++;
      result.activitiesCreated++;

      if (matchResult.action === "create_subclient") {
        await createSubClient(
          email,
          matchResult.clientId!,
          connection.companyId
        );
      }
    } else if (matchResult.action === "review") {
      await createActivity(email, connection, null, "inbound", {
        matchNeedsReview: true,
        suggestedClientId: matchResult.suggestedClientId,
        matchConfidence: matchResult.confidence,
      });
      result.needsReview++;
      result.activitiesCreated++;
    }
    return false; // Matched by pattern
  }

  // Unmatched — will be sent to AI classification if feature-gated
  return true;
}

async function processSentEmail(
  email: NormalizedEmail,
  connection: EmailConnection,
  profile: SyncProfile,
  result: SyncCycleResult
): Promise<void> {
  const supabase = requireSupabase();

  // Dedup
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", email.id)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Thread inheritance for sent mail
  const { data: threadLink } = await supabase
    .from("opportunity_email_threads")
    .select("opportunity_id")
    .eq("thread_id", email.threadId)
    .eq("connection_id", connection.id)
    .limit(1);

  if (threadLink && threadLink.length > 0) {
    await createActivity(
      email,
      connection,
      threadLink[0].opportunity_id,
      "outbound"
    );
    await updateCorrespondenceCounts(
      threadLink[0].opportunity_id,
      "outbound",
      email.date,
      result
    );
    // Memory update for outbound emails (feature-gated, fire and forget)
    if (connection.userId) {
      Promise.all([
        MemoryService.processOutboundEmail(
          connection.companyId,
          connection.userId,
          { from: email.from, to: email.to, subject: email.subject, bodyText: email.bodyText, date: email.date.toISOString() }
        ),
        WritingProfileService.updateFromEmail(
          connection.companyId,
          connection.userId,
          { bodyText: email.bodyText }
        ),
      ]).catch((err) => console.error("[sync-engine] Memory update error:", err));
    }
    result.activitiesCreated++;
    result.matched++;
    return;
  }

  // Sent folder safety net: user sent to a NEW external address
  for (const recipient of email.to) {
    const recipientEmail = extractSenderEmail(recipient);
    const recipientDomain = recipientEmail.split("@")[1]?.toLowerCase();

    // Skip internal/company emails
    if (profile.companyDomains?.some((d) => recipientDomain === d)) continue;
    if (recipientEmail === connection.email) continue;

    // Check if subject matches estimate pattern
    const normalizedSubject = email.subject
      .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
      .trim();
    const isEstimate = profile.estimateSubjectPatterns?.some((p) =>
      normalizedSubject.toLowerCase().includes(p.toLowerCase())
    );

    if (isEstimate) {
      const matchResult = await EmailMatchingServiceV2.match(
        connection.companyId,
        recipientEmail,
        {
          threadId: email.threadId,
          name: "",
          connectionId: connection.id,
        }
      );

      if (matchResult.action === "create_new") {
        const clientId = await createClient(
          {
            ...email,
            from: recipientEmail,
            fromName: recipientEmail.split("@")[0],
          },
          connection.companyId
        );
        const oppId = await createOpportunity(
          email,
          clientId,
          connection.companyId,
          "qualifying"
        );
        await linkThread(oppId, email.threadId, connection.id);
        await createActivity(email, connection, oppId, "outbound");
        await applyLabel(email.threadId, connection, result);
        result.newLeads++;
        result.activitiesCreated++;
      } else if (matchResult.clientId) {
        const oppId = await getOrCreateOpportunity(
          matchResult.clientId,
          connection.companyId,
          email
        );
        await linkThread(oppId, email.threadId, connection.id);
        await createActivity(email, connection, oppId, "outbound");
        await updateCorrespondenceCounts(oppId, "outbound", email.date, result);
        result.matched++;
        result.activitiesCreated++;
      }
    }
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const SyncEngine = {
  /**
   * Run a full sync cycle for a connection.
   * This is the main entry point — called by cron, manual sync, and webhook.
   */
  async runSync(connectionId: string): Promise<SyncCycleResult> {
    const connection = await EmailService.getConnection(connectionId);

    if (!connection || connection.status !== "active") {
      return { ...emptyResult(), errors: ["Connection not active"] };
    }

    const provider = EmailService.getProvider(connection);
    const profile = connection.syncFilters as SyncProfile;
    const result = emptyResult();

    try {
      const syncToken = connection.historyId || "";

      // Step 1: Fetch new emails since last sync (inbox + sent)
      const [inboxResult, sentResult] = await Promise.all([
        provider.fetchNewEmailsSince(syncToken),
        provider.fetchSentEmailsSince(syncToken),
      ]);

      const inboxEmails = inboxResult.emails;
      const sentEmails = sentResult.emails;
      const newSyncToken = inboxResult.nextSyncToken;

      if (inboxEmails.length === 0 && sentEmails.length === 0) {
        await EmailService.updateConnection(connectionId, {
          lastSyncedAt: new Date(),
          historyId: newSyncToken,
        });
        return result;
      }

      // Step 2-4: Process inbound emails, collect unmatched for AI review
      const unmatchedEmails: NormalizedEmail[] = [];
      for (const email of inboxEmails) {
        const unmatched = await processInboundEmail(email, connection, profile, result);
        if (unmatched) unmatchedEmails.push(email);
      }

      // Step 3: Process sent emails (sent folder safety net)
      for (const email of sentEmails) {
        await processSentEmail(email, connection, profile, result);
      }

      // Step 5: AI classification for unmatched emails (feature-gated)
      // Step 6: AI stage evaluation for leads with new emails (feature-gated)
      try {
        const supabase = requireSupabase();

        // Get company context for AI
        const { data: company } = await supabase
          .from("companies")
          .select("name, industry")
          .eq("id", connection.companyId)
          .single();

        const companyName = (company?.name as string) || "";
        const companyIndustry = (company?.industry as string) || "trades";

        // Step 5: AI classification for unmatched emails
        if (unmatchedEmails.length > 0) {
          const aiResult = await AISyncReviewer.reviewUnmatchedEmails(
            unmatchedEmails,
            connection,
            {
              name: companyName,
              industry: companyIndustry,
              domains: profile.companyDomains || [],
            }
          );

          // Persist AI-classified leads as opportunities
          for (const classified of aiResult.classifiedLeads) {
            try {
              const matchResult = await EmailMatchingServiceV2.match(
                connection.companyId,
                classified.clientEmail,
                {
                  threadId: classified.email.threadId,
                  name: classified.clientName,
                  connectionId: connection.id,
                }
              );

              let clientId: string;
              if (matchResult.action === "link" || matchResult.action === "create_subclient") {
                clientId = matchResult.clientId!;
              } else {
                clientId = await createClient(classified.email, connection.companyId);
              }

              const oppId = await createOpportunity(
                classified.email,
                clientId,
                connection.companyId,
                classified.stage
              );
              await linkThread(oppId, classified.email.threadId, connection.id);
              await createActivity(classified.email, connection, oppId, "inbound", {
                matchConfidence: "ai",
              });
              await applyLabel(classified.email.threadId, connection, result);
              result.activitiesCreated++;
            } catch (err) {
              console.error(`[sync-engine] Failed to persist AI lead ${classified.clientEmail}:`, err);
            }
          }
          result.newLeads += aiResult.newLeadsClassified;
        }

        // Step 6: AI stage evaluation for threads that received new emails
        const activeThreadIds: string[] = [];
        for (const email of [...inboxEmails, ...sentEmails]) {
          const { data: tl } = await supabase
            .from("opportunity_email_threads")
            .select("thread_id")
            .eq("thread_id", email.threadId)
            .eq("connection_id", connection.id)
            .limit(1);
          if (tl && tl.length > 0 && !activeThreadIds.includes(email.threadId)) {
            activeThreadIds.push(email.threadId);
          }
        }

        if (activeThreadIds.length > 0) {
          const stageResults = await AISyncReviewer.evaluateStages(
            activeThreadIds,
            connection,
            { name: companyName }
          );

          for (const sr of stageResults) {
            if (sr.terminalFlag) {
              await createTerminalFlagNotification(sr, connection);
            }
            if (sr.newStage) {
              // Write the AI-evaluated stage to the opportunity
              const { data: threadOpp } = await supabase
                .from("opportunity_email_threads")
                .select("opportunity_id")
                .eq("thread_id", sr.threadId)
                .eq("connection_id", connection.id)
                .limit(1);

              if (threadOpp && threadOpp.length > 0) {
                await supabase
                  .from("opportunities")
                  .update({
                    stage: sr.newStage,
                    stage_entered_at: new Date().toISOString(),
                    ai_stage_confidence: 1.0,
                    ai_stage_signals: sr.terminalFlag || "ai_evaluated",
                  })
                  .eq("id", threadOpp[0].opportunity_id);
              }
              result.stageChanges++;
            }
          }
        }
      } catch (aiErr) {
        console.error("[sync-engine] AI review error (non-fatal):", aiErr);
      }

      // Step 11: Notifications
      if (result.newLeads > 0 || result.activitiesCreated > 0) {
        await createSyncNotification(connection, result);
      }

      // Step 12: Update sync token
      await EmailService.updateConnection(connectionId, {
        lastSyncedAt: new Date(),
        historyId: newSyncToken,
      });
    } catch (err) {
      console.error(`[sync-engine] Error syncing ${connectionId}:`, err);
      result.errors.push(
        err instanceof Error ? err.message : "Unknown error"
      );
    }

    return result;
  },

  /**
   * Sweep all active opportunities for stale follow-up detection.
   * Called by the cron independently of new email arrival — catches leads
   * that go quiet (no new emails trigger the per-email evaluator).
   */
  async sweepStaleLeads(): Promise<number> {
    const supabase = requireSupabase();
    let stageChanges = 0;

    // Find all active opportunities with outbound as last direction
    // that haven't had activity in >5 days and aren't already in follow_up/terminal
    const { data: staleOpps } = await supabase
      .from("opportunities")
      .select(
        "id, stage, correspondence_count, outbound_count, inbound_count, last_inbound_at, last_outbound_at, last_message_direction"
      )
      .eq("last_message_direction", "out")
      .not("stage", "in", '("won","lost","follow_up")')
      .is("deleted_at", null)
      .not("last_outbound_at", "is", null);

    for (const opp of staleOpps ?? []) {
      const evaluation = StageEvaluator.evaluate({
        outboundCount: opp.outbound_count || 0,
        inboundCount: opp.inbound_count || 0,
        totalMessages: opp.correspondence_count || 0,
        lastMessageDirection: (opp.last_message_direction as "in" | "out") || "out",
        lastInboundAt: opp.last_inbound_at
          ? new Date(opp.last_inbound_at)
          : null,
        lastOutboundAt: opp.last_outbound_at
          ? new Date(opp.last_outbound_at)
          : null,
        currentStage: opp.stage,
        autoFollowUpDays: 5,
      });

      if (evaluation.changed) {
        await supabase
          .from("opportunities")
          .update({ stage: evaluation.stage })
          .eq("id", opp.id);
        stageChanges++;
      }
    }

    return stageChanges;
  },
};

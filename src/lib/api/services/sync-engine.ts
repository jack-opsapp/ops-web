// src/lib/api/services/sync-engine.ts
// Core sync cycle — runs on every sync trigger (cron, manual, webhook).
// Implements the 12-step flow from spec Section 4C.

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { EmailService } from "./email-service";
import { EmailMatchingServiceV2 } from "./email-matching-service-v2";
import { StageEvaluator } from "./stage-evaluator";
import { matchPlatform, isFormSubmissionSubject } from "./known-platforms";
import type { EmailConnection, SyncProfile } from "@/lib/types/email-connection";
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

export class SyncEngine {
  /**
   * Run a full sync cycle for a connection.
   * This is the main entry point — called by cron, manual sync, and webhook.
   */
  static async runSync(connectionId: string): Promise<SyncCycleResult> {
    const supabase = getServiceRoleClient();
    const connection = await EmailService.getConnection(connectionId);

    if (!connection || connection.status !== "active") {
      return {
        activitiesCreated: 0,
        matched: 0,
        needsReview: 0,
        newLeads: 0,
        stageChanges: 0,
        labelsApplied: 0,
        errors: ["Connection not active"],
      };
    }

    const provider = EmailService.getProvider(connection);
    const profile = connection.syncFilters as SyncProfile;
    const result: SyncCycleResult = {
      activitiesCreated: 0,
      matched: 0,
      needsReview: 0,
      newLeads: 0,
      stageChanges: 0,
      labelsApplied: 0,
      errors: [],
    };

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
        // Nothing new — just update timestamp
        await EmailService.updateConnection(connectionId, {
          lastSyncedAt: new Date(),
          historyId: newSyncToken,
        });
        return result;
      }

      // Step 2-4: Process inbound emails
      for (const email of inboxEmails) {
        await this.processInboundEmail(
          email,
          connection,
          profile,
          result,
          supabase
        );
      }

      // Step 3: Process sent emails (sent folder safety net)
      for (const email of sentEmails) {
        await this.processSentEmail(
          email,
          connection,
          profile,
          result,
          supabase
        );
      }

      // Step 5: AI classification runs here if feature-gated (Plan 4)
      // Step 6: Stage evaluation runs here (handled per-email in processInbound/Sent)
      // Step 7: Client matching runs per-email above
      // Step 8: Labels applied per-email above

      // Step 11: Notifications
      if (result.newLeads > 0 || result.activitiesCreated > 0) {
        await this.createSyncNotification(connection, result, supabase);
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
  }

  /**
   * Process an inbound email: pattern match → thread inherit → match client → stage → label
   */
  private static async processInboundEmail(
    email: NormalizedEmail,
    connection: EmailConnection,
    profile: SyncProfile,
    result: SyncCycleResult,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<void> {
    // Dedup: check if we already have this email
    const { data: existing } = await supabase
      .from("activities")
      .select("id")
      .eq("email_message_id", email.id)
      .limit(1);

    if (existing && existing.length > 0) return;

    // Step 4: Thread inheritance — is this thread already linked to an OPS lead?
    const { data: threadLink } = await supabase
      .from("opportunity_email_threads")
      .select("opportunity_id")
      .eq("thread_id", email.threadId)
      .eq("connection_id", connection.id)
      .limit(1);

    if (threadLink && threadLink.length > 0) {
      // Auto-link to existing lead
      await this.createActivity(
        email,
        connection,
        threadLink[0].opportunity_id,
        "inbound",
        supabase
      );
      await this.updateCorrespondenceCounts(
        threadLink[0].opportunity_id,
        "inbound",
        email.date,
        result,
        supabase
      );
      await this.applyLabel(email.threadId, connection, result);
      result.activitiesCreated++;
      result.matched++;
      return;
    }

    // Step 2: Pattern matching
    const isPatternMatch = this.matchesPattern(email, profile);
    const isPlatformMatch = matchPlatform(email.from) !== null;
    const isForwarderMatch =
      profile.teamForwarders?.some((f) =>
        email.from.toLowerCase().includes(f.toLowerCase())
      ) && isFormSubmissionSubject(email.subject);

    if (isPatternMatch || isPlatformMatch || isForwarderMatch) {
      // This is a candidate — run client matching
      const matchResult = await EmailMatchingServiceV2.match(
        connection.companyId,
        this.extractSenderEmail(email.from),
        {
          threadId: email.threadId,
          name: email.fromName,
          connectionId: connection.id,
        }
      );

      if (matchResult.action === "create_new") {
        // Create new client + opportunity
        const clientId = await this.createClient(
          email,
          connection.companyId,
          supabase
        );
        const oppId = await this.createOpportunity(
          email,
          clientId,
          connection.companyId,
          "new_lead",
          supabase
        );
        await this.linkThread(oppId, email.threadId, connection.id, supabase);
        await this.createActivity(
          email,
          connection,
          oppId,
          "inbound",
          supabase
        );
        await this.applyLabel(email.threadId, connection, result);
        result.newLeads++;
        result.activitiesCreated++;
      } else if (
        matchResult.action === "link" ||
        matchResult.action === "create_subclient"
      ) {
        // Link to existing client
        const oppId = await this.getOrCreateOpportunity(
          matchResult.clientId!,
          connection.companyId,
          email,
          supabase
        );
        await this.linkThread(oppId, email.threadId, connection.id, supabase);
        await this.createActivity(
          email,
          connection,
          oppId,
          "inbound",
          supabase
        );
        await this.updateCorrespondenceCounts(
          oppId,
          "inbound",
          email.date,
          result,
          supabase
        );
        await this.applyLabel(email.threadId, connection, result);
        result.matched++;
        result.activitiesCreated++;

        if (matchResult.action === "create_subclient") {
          await this.createSubClient(
            email,
            matchResult.clientId!,
            connection.companyId,
            supabase
          );
        }
      } else if (matchResult.action === "review") {
        // Queue for review
        await this.createActivity(
          email,
          connection,
          null,
          "inbound",
          supabase,
          {
            matchNeedsReview: true,
            suggestedClientId: matchResult.suggestedClientId,
            matchConfidence: matchResult.confidence,
          }
        );
        result.needsReview++;
        result.activitiesCreated++;
      }
    }
    // If no pattern match and AI review not enabled, email is ignored (noise)
    // Plan 4 adds AI classification here when feature-gated
  }

  /**
   * Process a sent email: safety net — if user replied to someone not in OPS, create a lead
   */
  private static async processSentEmail(
    email: NormalizedEmail,
    connection: EmailConnection,
    profile: SyncProfile,
    result: SyncCycleResult,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<void> {
    // Dedup
    const { data: existing } = await supabase
      .from("activities")
      .select("id")
      .eq("email_message_id", email.id)
      .limit(1);

    if (existing && existing.length > 0) return;

    // Step 4: Thread inheritance for sent mail
    const { data: threadLink } = await supabase
      .from("opportunity_email_threads")
      .select("opportunity_id")
      .eq("thread_id", email.threadId)
      .eq("connection_id", connection.id)
      .limit(1);

    if (threadLink && threadLink.length > 0) {
      // User replied in an existing lead thread — log outbound activity + update counts
      await this.createActivity(
        email,
        connection,
        threadLink[0].opportunity_id,
        "outbound",
        supabase
      );
      await this.updateCorrespondenceCounts(
        threadLink[0].opportunity_id,
        "outbound",
        email.date,
        result,
        supabase
      );
      result.activitiesCreated++;
      result.matched++;
      return;
    }

    // Sent folder safety net: user sent to a NEW external address
    for (const recipient of email.to) {
      const recipientEmail = this.extractSenderEmail(recipient);
      const recipientDomain = recipientEmail.split("@")[1]?.toLowerCase();

      // Skip internal/company emails
      if (profile.companyDomains?.some((d) => recipientDomain === d)) continue;
      if (recipientEmail === connection.email) continue;

      // Check if subject matches estimate pattern
      const normalizedSubject = email.subject
        .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
        .trim();
      const matchesEstimate = profile.estimateSubjectPatterns?.some((p) =>
        normalizedSubject.toLowerCase().includes(p.toLowerCase())
      );

      if (matchesEstimate) {
        // User sent an estimate to someone — check if they're already in OPS
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
          // New lead from sent folder — user is already engaging
          const clientId = await this.createClient(
            {
              ...email,
              from: recipientEmail,
              fromName: recipientEmail.split("@")[0],
            },
            connection.companyId,
            supabase
          );
          const oppId = await this.createOpportunity(
            email,
            clientId,
            connection.companyId,
            "qualifying",
            supabase
          );
          await this.linkThread(
            oppId,
            email.threadId,
            connection.id,
            supabase
          );
          await this.createActivity(
            email,
            connection,
            oppId,
            "outbound",
            supabase
          );
          await this.applyLabel(email.threadId, connection, result);
          result.newLeads++;
          result.activitiesCreated++;
        } else if (matchResult.clientId) {
          // Already in OPS — log outbound activity
          const oppId = await this.getOrCreateOpportunity(
            matchResult.clientId,
            connection.companyId,
            email,
            supabase
          );
          await this.linkThread(
            oppId,
            email.threadId,
            connection.id,
            supabase
          );
          await this.createActivity(
            email,
            connection,
            oppId,
            "outbound",
            supabase
          );
          await this.updateCorrespondenceCounts(
            oppId,
            "outbound",
            email.date,
            result,
            supabase
          );
          result.matched++;
          result.activitiesCreated++;
        }
      }
    }
  }

  // ─── Helper Methods ─────────────────────────────────────────────────────────

  private static matchesPattern(
    email: NormalizedEmail,
    profile: SyncProfile
  ): boolean {
    const normalized = email.subject
      .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
      .trim()
      .toLowerCase();
    return (profile.estimateSubjectPatterns || []).some((p) =>
      normalized.includes(p.toLowerCase())
    );
  }

  private static extractSenderEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return (match ? match[1] : from).toLowerCase().trim();
  }

  private static async createClient(
    email: NormalizedEmail,
    companyId: string,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<string> {
    const senderEmail = this.extractSenderEmail(email.from);

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

  private static async createSubClient(
    email: NormalizedEmail,
    clientId: string,
    companyId: string,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<void> {
    const senderEmail = this.extractSenderEmail(email.from);

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

  private static async createOpportunity(
    email: NormalizedEmail,
    clientId: string,
    companyId: string,
    stage: string,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<string> {
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

  private static async getOrCreateOpportunity(
    clientId: string,
    companyId: string,
    email: NormalizedEmail,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<string> {
    // Find existing open opportunity for this client
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

    return this.createOpportunity(
      email,
      clientId,
      companyId,
      "new_lead",
      supabase
    );
  }

  private static async linkThread(
    opportunityId: string,
    threadId: string,
    connectionId: string,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<void> {
    await supabase.from("opportunity_email_threads").upsert(
      {
        opportunity_id: opportunityId,
        thread_id: threadId,
        connection_id: connectionId,
      },
      { onConflict: "thread_id,connection_id" }
    );
  }

  private static async createActivity(
    email: NormalizedEmail,
    connection: EmailConnection,
    opportunityId: string | null,
    direction: "inbound" | "outbound",
    supabase: ReturnType<typeof getServiceRoleClient>,
    extra?: {
      matchNeedsReview?: boolean;
      suggestedClientId?: string | null;
      matchConfidence?: string;
    }
  ): Promise<void> {
    await supabase.from("activities").insert({
      company_id: connection.companyId,
      type: "email",
      subject: email.subject,
      content: email.snippet,
      email_message_id: email.id,
      email_thread_id: email.threadId,
      opportunity_id: opportunityId,
      direction,
      from_email: this.extractSenderEmail(email.from),
      match_needs_review: extra?.matchNeedsReview || false,
      suggested_client_id: extra?.suggestedClientId || null,
      match_confidence: extra?.matchConfidence || "pattern",
      is_read: !extra?.matchNeedsReview,
    });
  }

  private static async updateCorrespondenceCounts(
    opportunityId: string,
    direction: "inbound" | "outbound",
    date: Date,
    result: SyncCycleResult,
    supabase: ReturnType<typeof getServiceRoleClient>
  ): Promise<void> {
    // Fetch current counts
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
      inboundCount: (updates.inbound_count ||
        opp.inbound_count ||
        0) as number,
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

    await supabase
      .from("opportunities")
      .update(updates)
      .eq("id", opportunityId);
  }

  private static async applyLabel(
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

  private static async createSyncNotification(
    connection: EmailConnection,
    result: SyncCycleResult,
    supabase: ReturnType<typeof getServiceRoleClient>
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
}

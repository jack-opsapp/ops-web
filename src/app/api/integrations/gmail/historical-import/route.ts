/**
 * OPS Web - Gmail Historical Import
 *
 * POST /api/integrations/gmail/historical-import
 * Imports historical emails from Gmail for a given connection and date range.
 * Processes messages in batches with dedup, noise filtering, and 3-tier matching.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride, requireSupabase } from "@/lib/supabase/helpers";
import { EmailFilterService } from "@/lib/api/services/email-filter-service";
import { EmailMatchingService } from "@/lib/api/services/email-matching-service";
import { ClientService } from "@/lib/api/services/client-service";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import {
  ActivityType,
  OpportunityStage,
  OpportunitySource,
  DEFAULT_SYNC_FILTERS,
} from "@/lib/types/pipeline";
import type { GmailSyncFilters } from "@/lib/types/pipeline";

// ─── Approved contact from wizard ──────────────────────────────────────────

interface ApprovedContact {
  fromEmail: string;
  name: string;
  createLead: boolean;
}

// ─── Gmail API types ─────────────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  threadId: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{ mimeType: string; body: { data?: string } }>;
    body?: { data?: string };
  };
  snippet?: string;
  labelIds?: string[];
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

// ─── Token refresh helper (duplicated from gmail-service to avoid circular imports) ──

interface ConnectionRow {
  id: string;
  company_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  history_id: string | null;
  sync_enabled: boolean;
  sync_filters: GmailSyncFilters | null;
}

async function refreshAccessToken(
  connectionId: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_GMAIL_CLIENT_ID!,
      client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const json = await response.json();
  if (!json.access_token) throw new Error("Failed to refresh Gmail access token");

  const supabase = requireSupabase();
  await supabase
    .from("gmail_connections")
    .update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("id", connectionId);

  return json.access_token as string;
}

async function getValidToken(conn: ConnectionRow): Promise<string> {
  const expiresAt = new Date(conn.expires_at);
  if (expiresAt > new Date(Date.now() + 60_000)) {
    return conn.access_token;
  }
  return refreshAccessToken(conn.id, conn.refresh_token);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_MESSAGES = 5000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 200;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    const body = await request.json();
    const companyId = body.companyId as string | undefined;
    const connectionId = body.connectionId as string | undefined;
    const importAfter = body.importAfter as string | undefined;
    const approvedContacts = (body.approvedContacts ?? []) as ApprovedContact[];

    if (!companyId || !connectionId || !importAfter) {
      return NextResponse.json(
        { error: "companyId, connectionId, and importAfter are required" },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(importAfter)) {
      return NextResponse.json(
        { error: "importAfter must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    // Load connection
    const { data: connRow, error: connError } = await supabase
      .from("gmail_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("company_id", companyId)
      .single();

    if (connError || !connRow) {
      return NextResponse.json(
        { error: "Gmail connection not found" },
        { status: 404 }
      );
    }

    const conn = connRow as ConnectionRow;

    // Get a valid access token (refresh if needed)
    const token = await getValidToken(conn);

    // Parse sync_filters from the connection row (JSONB column)
    const syncFilters: GmailSyncFilters =
      conn.sync_filters && typeof conn.sync_filters === "object"
        ? conn.sync_filters
        : DEFAULT_SYNC_FILTERS;

    // Create import job record
    const { data: job, error: jobError } = await supabase
      .from("gmail_import_jobs")
      .insert({
        company_id: companyId,
        connection_id: connectionId,
        status: "running",
        import_after: importAfter,
      })
      .select()
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: `Failed to create import job: ${jobError?.message}` },
        { status: 500 }
      );
    }

    const jobId = job.id as string;

    // Build blocklist via EmailFilterService
    const blocklist = await EmailFilterService.buildBlocklist(syncFilters);

    // ── List messages from Gmail API ──────────────────────────────────────
    // Convert YYYY-MM-DD to YYYY/MM/DD for Gmail query
    const queryDate = importAfter.replace(/-/g, "/");
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    try {
      do {
        const listUrl = new URL(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        );
        listUrl.searchParams.set("q", `after:${queryDate}`);
        listUrl.searchParams.set("maxResults", "500");
        if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

        const listResp = await fetch(listUrl.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!listResp.ok) {
          throw new Error(`Gmail messages.list failed: ${listResp.status} ${listResp.statusText}`);
        }

        const listData: GmailMessageListResponse = await listResp.json();

        for (const msg of listData.messages ?? []) {
          allMessageIds.push(msg.id);
        }

        pageToken = listData.nextPageToken;
      } while (pageToken && allMessageIds.length < MAX_MESSAGES);
    } catch (err) {
      // Mark job as failed
      await supabase
        .from("gmail_import_jobs")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : "Failed to list messages",
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to list messages" },
        { status: 500 }
      );
    }

    // Trim to MAX_MESSAGES
    if (allMessageIds.length > MAX_MESSAGES) {
      allMessageIds.length = MAX_MESSAGES;
    }

    const totalEmails = allMessageIds.length;

    // Update job with total count
    await supabase
      .from("gmail_import_jobs")
      .update({ total_emails: totalEmails })
      .eq("id", jobId);

    // ── Process messages in batches ───────────────────────────────────────
    let processed = 0;
    let matched = 0;
    let unmatched = 0;
    let needsReview = 0;

    for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
      const batch = allMessageIds.slice(i, i + BATCH_SIZE);

      for (const msgId of batch) {
        try {
          const result = await processMessage(
            msgId,
            token,
            companyId,
            syncFilters,
            blocklist,
            supabase
          );

          processed++;

          if (result === null) {
            // Skipped (dedup or filtered)
            continue;
          }

          if (result.matched) {
            matched++;
          } else {
            unmatched++;
          }
          if (result.needsReview) {
            needsReview++;
          }
        } catch {
          processed++;
          // Skip individual message failures
        }
      }

      // Update job progress after each batch
      await supabase
        .from("gmail_import_jobs")
        .update({ processed, matched, unmatched, needs_review: needsReview })
        .eq("id", jobId);

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < allMessageIds.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // ── Create clients & leads from approved contacts ─────────────────────
    let clientsCreated = 0;
    let leadsCreated = 0;

    if (approvedContacts.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[gmail-import] Creating clients/leads for ${approvedContacts.length} approved contacts`
      );

      for (const contact of approvedContacts) {
        try {
          // Check if a client already exists for this email
          const { data: existingClients } = await supabase
            .from("clients")
            .select("id")
            .eq("company_id", companyId)
            .eq("email", contact.fromEmail.toLowerCase())
            .is("deleted_at", null)
            .limit(1);

          let clientId: string;

          if (existingClients && existingClients.length > 0) {
            clientId = existingClients[0].id;
          } else {
            // Create new client
            const newClient = await ClientService.createClient({
              name: contact.name,
              companyId,
              email: contact.fromEmail.toLowerCase(),
            });
            clientId = newClient.id;
            clientsCreated++;
          }

          // Link unmatched activities for this email to the new client
          await supabase
            .from("activities")
            .update({ client_id: clientId })
            .eq("company_id", companyId)
            .eq("from_email", contact.fromEmail.toLowerCase())
            .is("client_id", null);

          // Create lead (opportunity) if flagged
          if (contact.createLead) {
            // Check if there's already an open opportunity for this client
            const existingOpps = await OpportunityService.fetchOpportunities(
              companyId,
              {
                clientId,
                stages: [
                  OpportunityStage.NewLead,
                  OpportunityStage.Qualifying,
                  OpportunityStage.Quoting,
                  OpportunityStage.Quoted,
                  OpportunityStage.FollowUp,
                  OpportunityStage.Negotiation,
                ],
              }
            );

            if (existingOpps.length === 0) {
              await OpportunityService.createOpportunity({
                companyId,
                clientId,
                title: `Email inquiry from ${contact.name}`,
                stage: OpportunityStage.NewLead,
                source: OpportunitySource.Email,
                contactName: contact.name,
                contactEmail: contact.fromEmail,
                contactPhone: null,
                description: null,
                assignedTo: null,
                priority: null,
                estimatedValue: null,
                actualValue: null,
                winProbability: 20,
                expectedCloseDate: null,
                actualCloseDate: null,
                projectId: null,
                lostReason: null,
                lostNotes: null,
                address: null,
                tags: ["email-import"],
              });
              leadsCreated++;
            }
          }
        } catch (err) {
          console.error(
            `[gmail-import] Failed to create client/lead for ${contact.fromEmail}:`,
            err
          );
          // Continue with next contact — don't fail the whole import
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[gmail-import] Created ${clientsCreated} clients, ${leadsCreated} leads`
      );
    }

    // ── Mark job as completed ─────────────────────────────────────────────
    await supabase
      .from("gmail_import_jobs")
      .update({
        status: "completed",
        processed,
        matched,
        unmatched,
        needs_review: needsReview,
        clients_created: clientsCreated,
        leads_created: leadsCreated,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Update connection historyId to current
    const profileResp = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const profile = (await profileResp.json()) as { historyId?: string };
    if (profile.historyId) {
      await supabase
        .from("gmail_connections")
        .update({ history_id: profile.historyId })
        .eq("id", connectionId);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      totalEmails,
      matched,
      unmatched,
      needsReview,
      clientsCreated,
      leadsCreated,
    });
  } catch (err) {
    console.error("[gmail-historical-import]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}

// ─── Process a single message ────────────────────────────────────────────────

async function processMessage(
  msgId: string,
  token: string,
  companyId: string,
  syncFilters: GmailSyncFilters,
  blocklist: { domains: Set<string>; keywords: string[] },
  supabase: ReturnType<typeof requireSupabase>
): Promise<{ matched: boolean; needsReview: boolean } | null> {
  // Dedup: check if we already have this message
  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("email_message_id", msgId)
    .limit(1);

  if ((existing ?? []).length > 0) return null;

  // Fetch message metadata
  const msgResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!msgResp.ok) {
    throw new Error(`Failed to fetch message ${msgId}: ${msgResp.status}`);
  }

  const msg: GmailMessage = await msgResp.json();

  const headers = msg.payload?.headers ?? [];
  const from = headers.find((h) => h.name === "From")?.value ?? "";
  const to = headers.find((h) => h.name === "To")?.value ?? "";
  const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
  const threadId = msg.threadId;

  // Extract email address from "Name <email>" format
  const fromEmail = (from.match(/<(.+?)>/) ?? [, from])[1]?.toLowerCase() ?? "";

  // Noise filter: skip automated/marketing emails
  if (EmailFilterService.shouldFilter(fromEmail, subject, blocklist, syncFilters, msg.labelIds, msg.snippet)) {
    return null;
  }

  // 3-tier matching via EmailMatchingService
  const matchResult = await EmailMatchingService.matchEmail(
    companyId,
    from,
    to,
    msg.snippet ?? "",
    threadId ?? null
  );

  const clientId = matchResult.clientId;

  // Determine direction
  const direction: "inbound" | "outbound" = clientId
    ? matchResult.confidence !== "unmatched"
      ? "inbound"
      : "outbound"
    : "inbound";

  // Find open opportunity for matched client
  let opportunityId: string | null = null;
  if (clientId) {
    const opps = await OpportunityService.fetchOpportunities(companyId, {
      clientId,
      stages: [
        OpportunityStage.NewLead,
        OpportunityStage.Qualifying,
        OpportunityStage.Quoting,
        OpportunityStage.Quoted,
        OpportunityStage.FollowUp,
        OpportunityStage.Negotiation,
      ],
    });
    opportunityId = opps[0]?.id ?? null;
  }

  // Create activity
  const activity = await OpportunityService.createActivity({
    companyId,
    opportunityId,
    clientId,
    estimateId: null,
    invoiceId: null,
    projectId: null,
    siteVisitId: null,
    type: ActivityType.Email,
    subject,
    content: msg.snippet ?? null,
    outcome: null,
    direction,
    durationMinutes: null,
    attachments: [],
    emailThreadId: threadId,
    emailMessageId: msgId,
    isRead: !!clientId,
    fromEmail: fromEmail || null,
    createdBy: null,
  });

  // Update matching metadata columns
  await supabase
    .from("activities")
    .update({
      match_confidence: matchResult.confidence,
      match_needs_review: matchResult.needsReview,
      suggested_client_id: matchResult.suggestedClientId,
    })
    .eq("id", activity.id);

  const isMatched = matchResult.confidence !== "unmatched";

  return {
    matched: isMatched,
    needsReview: matchResult.needsReview,
  };
}

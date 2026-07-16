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
import {
  EmailMatchingServiceV2,
  type MatchResultV2,
} from "@/lib/api/services/email-matching-service-v2";
import { ClientService } from "@/lib/api/services/client-service";
import { OpportunityService } from "@/lib/api/services/opportunity-service";
import { OpportunityLifecycleService } from "@/lib/api/services/opportunity-lifecycle-service";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import {
  applyCanonicalLeadEnrichment,
  type LeadEnrichmentFacts,
} from "@/lib/email/lead-enrichment";
import {
  buildEmailOpportunityTitle,
  parseMailboxDisplayName,
} from "@/lib/email/opportunity-title";
import { findOpportunityRelationshipMatch } from "@/lib/email/opportunity-relationship-matching";
import {
  logInvalidProviderEmailIds,
  normalizeProviderEmailId,
  validateProviderEmailIds,
  type ProviderEmailIdValidationResult,
} from "@/lib/email/provider-email-ids";
import {
  buildLeadRoutingIdentity,
  canonicalizeProviderThreadId,
  resolvePersistedEmailDirection,
} from "@/lib/email/email-ingestion-routing";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import {
  extractContactFormSubmission,
  htmlToPlainText,
  isCommonEmailDomain,
  normalizeEmailAddress,
} from "@/lib/utils/email-parsing";
import {
  ActivityType,
  OpportunityStage,
  OpportunitySource,
  DEFAULT_SYNC_FILTERS,
} from "@/lib/types/pipeline";
import type { GmailSyncFilters } from "@/lib/types/pipeline";
import { requireEmailCompanyAccess } from "@/lib/email/email-route-auth";
import { escapeIlikeLiteral } from "@/lib/supabase/ilike-literal";

// ─── Approved contact from wizard ──────────────────────────────────────────

interface ApprovedContact {
  fromEmail: string;
  name: string;
  createLead: boolean;
  isCompanyGroup?: boolean;
  subContacts?: Array<{ fromEmail: string; name: string }>;
}

// ─── Gmail API types ─────────────────────────────────────────────────────────

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailMessagePart & {
    headers?: Array<{ name: string; value: string }>;
  };
  snippet?: string;
  labelIds?: string[];
}

const NON_DELIVERY_GMAIL_LABELS = new Set(["DRAFT", "SPAM", "TRASH"]);

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
  if (!json.access_token)
    throw new Error("Failed to refresh Gmail access token");

  const supabase = requireSupabase();
  const { error: tokenPersistError } = await supabase
    .from("email_connections")
    .update({
      access_token: json.access_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("id", connectionId);
  if (tokenPersistError) {
    throw new Error(
      `Failed to persist refreshed Gmail access token: ${tokenPersistError.message}`
    );
  }

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

function normalizeHistoricalImportMessageId(
  msgId: string,
  companyId: string
): string | null {
  const providerMessageId = normalizeProviderEmailId(msgId);
  if (providerMessageId) return providerMessageId;

  const validation: Extract<ProviderEmailIdValidationResult, { ok: false }> = {
    ok: false,
    boundary: "gmail_historical_import_message_fetch",
    providerThreadId: null,
    providerMessageId: null,
    reasons: ["blank_provider_message_id"],
  };

  logInvalidProviderEmailIds(validation, {
    companyId,
    rawProviderMessageId: msgId,
  });
  return null;
}

function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return Buffer.from(
      value.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
  } catch {
    return "";
  }
}

function extractGmailBody(payload: GmailMessagePart | undefined): string {
  if (!payload) return "";

  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: GmailMessagePart): void => {
    const decoded = decodeBase64Url(part.body?.data);
    if (decoded) {
      const mimeType = (part.mimeType ?? "").toLowerCase();
      if (mimeType === "text/html") html.push(decoded);
      else if (
        mimeType === "text/plain" ||
        (!mimeType && !part.parts?.length)
      ) {
        plain.push(decoded);
      }
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);

  const plainBody = plain.join("\n").trim();
  if (plainBody) return plainBody;
  return htmlToPlainText(html.join("\n"));
}

function headerValue(msg: GmailMessage, name: string): string {
  return (
    msg.payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

function mailboxList(value: string): string[] {
  return (value.match(/(?:"[^"]*"|[^,])+/g) ?? [])
    .map((mailbox) => mailbox.trim())
    .filter(Boolean);
}

function verifiedMailboxDisplayName(
  mailbox: string,
  normalizedMailboxEmail = normalizeEmailAddress(mailbox)
): string | null {
  const displayName = parseMailboxDisplayName(mailbox);
  const localPart = normalizedMailboxEmail.split("@")[0]?.trim().toLowerCase();
  if (!displayName || !localPart) return displayName;
  return displayName.trim().toLowerCase() === localPart ? null : displayName;
}

function messageDate(msg: GmailMessage): Date {
  const internalDate = Number(msg.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) {
    return new Date(internalDate);
  }
  const headerDate = new Date(headerValue(msg, "Date"));
  return Number.isNaN(headerDate.getTime()) ? new Date() : headerDate;
}

function externalRecipient(
  mailboxes: string[],
  operatorEmailAddresses: string[],
  operatorDomains: string[]
): { email: string; name: string | null } | null {
  const operatorEmails = new Set(
    operatorEmailAddresses.map(normalizeEmailAddress).filter(Boolean)
  );
  const internalDomains = new Set(
    operatorDomains.map((domain) => domain.toLowerCase())
  );

  for (const mailbox of mailboxes) {
    const email = normalizeEmailAddress(mailbox);
    if (!email || operatorEmails.has(email)) continue;
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (domain && internalDomains.has(domain)) continue;
    return { email, name: verifiedMailboxDisplayName(mailbox, email) };
  }
  return null;
}

async function gmailHistoryBoundary(token: string): Promise<string> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(
      `Gmail users.getProfile failed: ${response.status} ${response.statusText}`
    );
  }
  const profile = (await response.json()) as { historyId?: string };
  if (!profile.historyId?.trim()) {
    throw new Error("Gmail users.getProfile returned no history boundary");
  }
  return profile.historyId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markImportJobFailed(
  supabase: ReturnType<typeof requireSupabase>,
  jobId: string,
  failure: string
): Promise<string> {
  const { error } = await supabase
    .from("gmail_import_jobs")
    .update({
      status: "failed",
      error_message: failure,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  return error
    ? `${failure}; additionally failed to mark import job failed: ${error.message}`
    : failure;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);
  let jobId: string | null = null;

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

    const authError = await requireEmailCompanyAccess(request, companyId);
    if (authError) return authError;

    // Load connection
    const { data: connRow, error: connError } = await supabase
      .from("email_connections")
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
    const { data: companyUsers, error: companyUsersError } = await supabase
      .from("users")
      .select("email")
      .eq("company_id", companyId);
    if (companyUsersError) {
      throw new Error(
        `Failed to load operator email identities: ${companyUsersError.message}`
      );
    }
    const operatorEmailAddresses = Array.from(
      new Set(
        [
          conn.email,
          ...(companyUsers ?? [])
            .map((user) => (typeof user.email === "string" ? user.email : ""))
            .filter(Boolean),
        ]
          .map(normalizeEmailAddress)
          .filter(Boolean)
      )
    );
    const operatorDomains = Array.from(
      new Set(
        [...operatorEmailAddresses.map((email) => email.split("@")[1] ?? "")]
          .map((domain) => domain.trim().toLowerCase())
          .filter(
            (domain): domain is string =>
              Boolean(domain) && !isCommonEmailDomain(domain)
          )
      )
    );

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

    jobId = job.id as string;

    // Snapshot the incremental boundary BEFORE listing. Messages arriving
    // during this import remain discoverable by the next history traversal.
    const historyBoundary = await gmailHistoryBoundary(token);

    // Build blocklist via EmailFilterService
    const blocklist = await EmailFilterService.buildBlocklist(syncFilters);

    // ── List messages from Gmail API ──────────────────────────────────────
    // Convert YYYY-MM-DD to YYYY/MM/DD for Gmail query
    const queryDate = importAfter.replace(/-/g, "/");
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

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
        throw new Error(
          `Gmail messages.list failed: ${listResp.status} ${listResp.statusText}`
        );
      }

      const listData: GmailMessageListResponse = await listResp.json();

      for (const msg of listData.messages ?? []) {
        allMessageIds.push(msg.id);
      }

      pageToken = listData.nextPageToken;
    } while (pageToken && allMessageIds.length < MAX_MESSAGES);

    if (pageToken || allMessageIds.length > MAX_MESSAGES) {
      throw new Error(
        `Historical Gmail import exceeds the safe ${MAX_MESSAGES}-message limit; narrow the import start date and retry`
      );
    }

    const totalEmails = allMessageIds.length;

    // Update job with total count
    const { error: totalError } = await supabase
      .from("gmail_import_jobs")
      .update({ total_emails: totalEmails })
      .eq("id", jobId);
    if (totalError) {
      throw new Error(`Failed to persist import total: ${totalError.message}`);
    }

    // ── Process messages in batches ───────────────────────────────────────
    let processed = 0;
    let matched = 0;
    let unmatched = 0;
    let needsReview = 0;
    let clientsCreated = 0;
    let leadsCreated = 0;

    for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
      const batch = allMessageIds.slice(i, i + BATCH_SIZE);

      for (const msgId of batch) {
        try {
          const result = await processMessage(
            msgId,
            token,
            companyId,
            connectionId,
            conn.email,
            operatorEmailAddresses,
            operatorDomains,
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
          if (result.leadCreated) {
            leadsCreated++;
          }
        } catch (error) {
          throw new Error(
            `Failed to process Gmail message ${msgId}: ${errorMessage(error)}`
          );
        }
      }

      // Update job progress after each batch
      const { error: progressError } = await supabase
        .from("gmail_import_jobs")
        .update({ processed, matched, unmatched, needs_review: needsReview })
        .eq("id", jobId);
      if (progressError) {
        throw new Error(
          `Failed to persist import progress: ${progressError.message}`
        );
      }

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < allMessageIds.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // ── Create clients & leads from approved contacts ─────────────────────
    if (approvedContacts.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[gmail-import] Creating clients/leads for ${approvedContacts.length} approved contacts`
      );

      for (const contact of approvedContacts) {
        try {
          let clientId: string;

          if (contact.isCompanyGroup && contact.subContacts?.length) {
            // ── Company group: create company client + sub-clients ──────
            // Check if company client already exists. ilike so a mixed-case
            // stored email ("John@Example.com") still matches the incoming
            // lowercased address.
            const { data: existingClients, error: existingClientsError } =
              await supabase
                .from("clients")
                .select("id")
                .eq("company_id", companyId)
                .ilike(
                  "email",
                  escapeIlikeLiteral(contact.fromEmail.toLowerCase())
                )
                .is("deleted_at", null)
                .limit(1);
            if (existingClientsError) {
              throw new Error(
                `Failed to check approved company contact: ${existingClientsError.message}`
              );
            }

            if (existingClients && existingClients.length > 0) {
              clientId = existingClients[0].id;
            } else {
              const newClient = await ClientService.createClient({
                name: contact.name,
                companyId,
                email: contact.fromEmail.toLowerCase(),
              });
              clientId = newClient.id;
              clientsCreated++;
            }

            // Create sub-clients for each person in the domain group
            for (const sub of contact.subContacts) {
              try {
                // Check if sub-client already exists
                const { data: existingSub, error: existingSubError } =
                  await supabase
                    .from("sub_clients")
                    .select("id")
                    .eq("client_id", clientId)
                    .ilike(
                      "email",
                      escapeIlikeLiteral(sub.fromEmail.toLowerCase())
                    )
                    .is("deleted_at", null)
                    .limit(1);
                if (existingSubError) {
                  throw new Error(
                    `Failed to check approved sub-contact: ${existingSubError.message}`
                  );
                }

                if (!existingSub || existingSub.length === 0) {
                  await ClientService.createSubClient(
                    {
                      name: sub.name,
                      clientId,
                      email: sub.fromEmail.toLowerCase(),
                    },
                    companyId
                  );
                }

                // Link activities from this sub-contact to the company client
                const { error: subActivityLinkError } = await supabase
                  .from("activities")
                  .update({ client_id: clientId })
                  .eq("company_id", companyId)
                  .eq("from_email", sub.fromEmail.toLowerCase())
                  .is("client_id", null);
                if (subActivityLinkError) {
                  throw new Error(
                    `Failed to link approved sub-contact activities: ${subActivityLinkError.message}`
                  );
                }
              } catch (subErr) {
                throw new Error(
                  `Failed to create sub-client ${sub.fromEmail}: ${errorMessage(subErr)}`
                );
              }
            }
          } else {
            // ── Individual contact ──────────────────────────────────────
            // ilike so mixed-case stored emails still match.
            const { data: existingClients, error: existingClientsError } =
              await supabase
                .from("clients")
                .select("id")
                .eq("company_id", companyId)
                .ilike(
                  "email",
                  escapeIlikeLiteral(contact.fromEmail.toLowerCase())
                )
                .is("deleted_at", null)
                .limit(1);
            if (existingClientsError) {
              throw new Error(
                `Failed to check approved contact: ${existingClientsError.message}`
              );
            }

            if (existingClients && existingClients.length > 0) {
              clientId = existingClients[0].id;
            } else {
              const newClient = await ClientService.createClient({
                name: contact.name,
                companyId,
                email: contact.fromEmail.toLowerCase(),
              });
              clientId = newClient.id;
              clientsCreated++;
            }

            // Link unmatched activities for this email to the client
            const { error: activityLinkError } = await supabase
              .from("activities")
              .update({ client_id: clientId })
              .eq("company_id", companyId)
              .eq("from_email", contact.fromEmail.toLowerCase())
              .is("client_id", null);
            if (activityLinkError) {
              throw new Error(
                `Failed to link approved contact activities: ${activityLinkError.message}`
              );
            }
          }

          // Create lead (opportunity) if flagged
          if (contact.createLead) {
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
                title: buildEmailOpportunityTitle({
                  kind: "email_inquiry",
                  candidates: [
                    {
                      source: "inbound_sender",
                      name: contact.name,
                      email: contact.fromEmail,
                    },
                  ],
                }),
                stage: OpportunityStage.NewLead,
                source: OpportunitySource.Email,
                contactName: contact.name,
                contactEmail: contact.fromEmail,
                contactPhone: null,
                description: null,
                priority: null,
                estimatedValue: null,
                actualValue: null,
                winProbability: 20,
                expectedCloseDate: null,
                actualCloseDate: null,
                projectId: null,
                lostReason: null,
                lostNotes: null,
                quoteDeliveryMethod: null,
                address: null,
                latitude: null,
                longitude: null,
                tags: ["email-import"],
              });
              leadsCreated++;
            }
          }
        } catch (err) {
          throw new Error(
            `Failed to create client/lead for ${contact.fromEmail}: ${errorMessage(err)}`
          );
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[gmail-import] Created ${clientsCreated} clients, ${leadsCreated} leads`
      );
    }

    // ── Mark job as completed ─────────────────────────────────────────────
    const { error: completedError } = await supabase
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
    if (completedError) {
      throw new Error(
        `Failed to complete import job: ${completedError.message}`
      );
    }

    // Advance only to the pre-list boundary, and only after every message and
    // direct database write has succeeded. Anything newer remains in history.
    const { error: cursorError } = await supabase
      .from("email_connections")
      .update({ history_id: historyBoundary })
      .eq("id", connectionId)
      .eq("company_id", companyId);
    if (cursorError) {
      throw new Error(
        `Failed to persist historical import history boundary: ${cursorError.message}`
      );
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
    let failure = errorMessage(err);
    if (jobId) {
      failure = await markImportJobFailed(supabase, jobId, failure);
    }
    console.error("[gmail-historical-import]", failure);
    return NextResponse.json(
      { error: failure || "Internal error" },
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
  connectionId: string,
  connectionEmail: string,
  operatorEmailAddresses: string[],
  operatorDomains: string[],
  syncFilters: GmailSyncFilters,
  blocklist: { domains: Set<string>; keywords: string[] },
  supabase: ReturnType<typeof requireSupabase>
): Promise<{
  matched: boolean;
  needsReview: boolean;
  leadCreated: boolean;
} | null> {
  const providerMessageId = normalizeHistoricalImportMessageId(
    msgId,
    companyId
  );
  if (!providerMessageId) return null;

  // Dedup: check if we already have this message
  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("id, opportunity_id, client_id, is_read")
    .eq("company_id", companyId)
    .eq("email_connection_id", connectionId)
    .eq("email_message_id", providerMessageId)
    .limit(1);
  if (existingError) {
    throw new Error(
      `Failed to check historical activity deduplication: ${existingError.message}`
    );
  }

  const existingActivity = (existing ?? [])[0] as
    | {
        id: string;
        opportunity_id: string | null;
        client_id: string | null;
        is_read: boolean | null;
      }
    | undefined;

  // Full payload is required: form submitter identity, job details, and body
  // facts do not exist in Gmail metadata/snippets reliably.
  const msgResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${providerMessageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!msgResp.ok) {
    throw new Error(
      `Failed to fetch message ${providerMessageId}: ${msgResp.status} ${msgResp.statusText}`
    );
  }

  const msg: GmailMessage = await msgResp.json();
  if (
    (msg.labelIds ?? []).some((label) =>
      NON_DELIVERY_GMAIL_LABELS.has(label.toUpperCase())
    )
  ) {
    return null;
  }
  const from = headerValue(msg, "From");
  const to = headerValue(msg, "To");
  const cc = headerValue(msg, "Cc");
  const subject = headerValue(msg, "Subject") || "(no subject)";
  const threadId = msg.threadId;
  const fromEmail = normalizeEmailAddress(from);
  const fromName = verifiedMailboxDisplayName(from, fromEmail) ?? "";
  const toMailboxes = mailboxList(to);
  const ccMailboxes = mailboxList(cc);
  const bodyText = extractGmailBody(msg.payload) || msg.snippet || "";
  const occurredAt = messageDate(msg);

  const providerIds = validateProviderEmailIds({
    boundary: "gmail_historical_import_activity",
    providerThreadId: threadId,
    providerMessageId,
    requireMessageId: true,
  });

  if (!providerIds.ok) {
    logInvalidProviderEmailIds(providerIds, {
      companyId,
      subject,
      fromEmail: fromEmail || null,
    });
    return null;
  }

  // Provider IDs stay raw at the mailbox boundary. A legacy retry can surface
  // a previously-scoped routing key, so canonicalize before any matching,
  // correspondence, activity, or opportunity write sees the value.
  const providerThreadId = canonicalizeProviderThreadId(
    providerIds.providerThreadId,
    { provider: "gmail", connectionId }
  );

  const normalizedEmail = {
    id: providerMessageId,
    threadId: providerThreadId,
    from,
    fromName,
    to: toMailboxes,
    cc: ccMailboxes,
    subject,
    snippet: msg.snippet ?? "",
    bodyText,
    date: occurredAt,
    labelIds: msg.labelIds ?? [],
    isRead: true,
    hasAttachments: false,
    sizeEstimate: 0,
  } satisfies NormalizedEmail;
  const direction = resolvePersistedEmailDirection(normalizedEmail, {
    connectionEmail,
    companyDomains: operatorDomains,
    userEmailAddresses: operatorEmailAddresses,
  });
  const routingIdentity = buildLeadRoutingIdentity(normalizedEmail, {
    provider: "gmail",
    connectionId,
  });
  const submitter =
    direction === "inbound"
      ? extractContactFormSubmission(subject, bodyText)
      : null;
  const outboundRecipient =
    direction === "outbound"
      ? externalRecipient(
          [...toMailboxes, ...ccMailboxes],
          operatorEmailAddresses,
          operatorDomains
        )
      : null;
  const customerEmail =
    submitter?.email ??
    (direction === "outbound" ? (outboundRecipient?.email ?? "") : fromEmail);
  const customerName =
    submitter?.name ??
    (direction === "outbound" ? (outboundRecipient?.name ?? "") : fromName);
  const customerDescription = submitter?.message || bodyText || null;

  // Noise filter: skip automated/marketing emails
  if (
    EmailFilterService.shouldFilter(
      customerEmail,
      subject,
      blocklist,
      syncFilters,
      msg.labelIds,
      bodyText
    )
  ) {
    return null;
  }

  // 5-tier matching via EmailMatchingServiceV2. V2 handles exact, domain,
  // name, and thread-CC tiers and is consistent with what sync-engine uses
  // for real-time sync — historical-import stays in parity instead of
  // running the deprecated 3-tier matcher that relied on phone signatures
  // from body text (often missing / unreliable).
  //
  const matchResult: MatchResultV2 = customerEmail
    ? await EmailMatchingServiceV2.match(companyId, customerEmail, {
        ...(routingIdentity.mayInheritProviderThread
          ? { threadId: providerThreadId, connectionId }
          : {}),
        name: customerName,
      })
    : {
        clientId: null,
        subClientId: null,
        confidence: "unmatched",
        needsReview: false,
        suggestedClientId: null,
        reason: "No external customer recipient",
        action: "create_new",
      };

  const clientId = matchResult.clientId;
  let activityClientId = clientId;

  const enrichmentFacts: LeadEnrichmentFacts = {
    contactName: customerName || null,
    companyName: submitter?.company ?? null,
    contactEmail: customerEmail || null,
    contactPhone: submitter?.phone ?? null,
    address: submitter?.address ?? null,
    estimatedValue: submitter?.estimatedValue ?? null,
    description: customerDescription,
    source: "email",
    sourcePlatform: routingIdentity.isContactFormSubmission
      ? "contact_form"
      : null,
    providerThreadId,
    providerMessageId,
    extractionSource: routingIdentity.isContactFormSubmission
      ? "contact_form"
      : direction === "outbound"
        ? "outbound_recipient"
        : "historical_metadata",
  };

  const persistOpportunitySideEffects = async (
    opportunityId: string,
    resolvedClientId: string | null
  ): Promise<void> => {
    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId,
      clientId: resolvedClientId,
      facts: enrichmentFacts,
      companyId,
    });

    const { error: sourceKeyError } = await supabase
      .from("opportunities")
      .update({ source_thread_key: routingIdentity.sourceKey })
      .eq("id", opportunityId)
      .is("source_thread_key", null);
    if (sourceKeyError) {
      throw new Error(
        `Failed to persist historical lead source key: ${sourceKeyError.message}`
      );
    }

    if (routingIdentity.mayInheritProviderThread) {
      const { error: threadLinkError } = await supabase
        .from("opportunity_email_threads")
        .upsert(
          {
            opportunity_id: opportunityId,
            thread_id: providerThreadId,
            connection_id: connectionId,
          },
          { onConflict: "thread_id,connection_id", ignoreDuplicates: true }
        );
      if (threadLinkError) {
        throw new Error(
          `Failed to persist historical opportunity thread link: ${threadLinkError.message}`
        );
      }
      const { data: canonicalThreadLink, error: canonicalThreadLinkError } =
        await supabase
          .from("opportunity_email_threads")
          .select("opportunity_id")
          .eq("thread_id", providerThreadId)
          .eq("connection_id", connectionId)
          .limit(1)
          .maybeSingle();
      if (
        canonicalThreadLinkError ||
        canonicalThreadLink?.opportunity_id !== opportunityId
      ) {
        throw new Error(
          `Historical provider thread already belongs to another opportunity: ${canonicalThreadLinkError?.message ?? canonicalThreadLink?.opportunity_id ?? "missing owner"}`
        );
      }
    }
  };

  const persistActivitySemanticSideEffects = async (
    activityId: string,
    opportunityId: string | null
  ): Promise<void> => {
    const correspondence =
      await OpportunityLifecycleService.recordCorrespondenceEvent({
        supabase,
        companyId,
        opportunityId,
        activityId,
        connectionId,
        providerThreadId,
        providerMessageId,
        requireProviderMessageId: true,
        direction,
        occurredAt,
        source: "gmail_historical_import",
        applyOpportunityProjection: true,
        fromEmail: fromEmail || null,
        fromName,
        toEmails: toMailboxes.map(normalizeEmailAddress).filter(Boolean),
        ccEmails: ccMailboxes.map(normalizeEmailAddress).filter(Boolean),
        subject,
        bodyText: bodyText || null,
        labels: msg.labelIds ?? [],
        connectionEmail,
        companyDomains: operatorDomains,
        userEmailAddresses: operatorEmailAddresses,
        knownPlatformSenders: [],
        contactEmail: customerEmail || null,
      });

    if (
      !correspondence.created &&
      correspondence.reason !== "duplicate_provider_message_id" &&
      opportunityId
    ) {
      throw new Error(
        `Historical correspondence event rejected: ${correspondence.reason}`
      );
    }

    if (opportunityId) {
      const { data: projectionRows, error: projectionError } =
        await supabase.rpc("apply_opportunity_correspondence_event", {
          p_company_id: companyId,
          p_opportunity_id: opportunityId,
          p_connection_id: connectionId,
          p_provider_message_id: providerMessageId,
        });
      const projectionRow = Array.isArray(projectionRows)
        ? projectionRows[0]
        : projectionRows;
      if (projectionError || !projectionRow) {
        throw new Error(
          `Historical correspondence projection failed for ${opportunityId}: ${projectionError?.message ?? "RPC returned no rows"}`
        );
      }
    }

    const { error: activityMetadataError } = await supabase
      .from("activities")
      .update({
        match_confidence: matchResult.confidence,
        match_needs_review: matchResult.needsReview,
        suggested_client_id: matchResult.suggestedClientId,
      })
      .eq("id", activityId);
    if (activityMetadataError) {
      throw new Error(
        `Failed to persist historical activity matching metadata: ${activityMetadataError.message}`
      );
    }
  };

  const refreshCanonicalThread = async ({
    opportunityId,
    clientId,
    isRead,
  }: {
    opportunityId: string | null;
    clientId: string | null;
    isRead: boolean;
  }): Promise<void> => {
    await EmailThreadService.upsertFromEmail({
      companyId,
      connectionId,
      providerThreadId,
      email: { ...normalizedEmail, isRead },
      direction,
      opportunityId,
      clientId,
      markClassificationDirty: true,
    });
  };

  // Activity creation can succeed immediately before a later semantic write
  // fails. A retry must repair those idempotent side effects instead of
  // treating the activity row as proof that the message fully completed.
  if (existingActivity) {
    if (existingActivity.opportunity_id) {
      await persistOpportunitySideEffects(
        existingActivity.opportunity_id,
        existingActivity.client_id
      );
    }
    await persistActivitySemanticSideEffects(
      existingActivity.id,
      existingActivity.opportunity_id
    );
    await refreshCanonicalThread({
      opportunityId: existingActivity.opportunity_id,
      clientId: existingActivity.client_id,
      isRead: existingActivity.is_read === true,
    });
    return {
      matched:
        Boolean(existingActivity.opportunity_id) ||
        matchResult.confidence !== "unmatched",
      needsReview: matchResult.needsReview,
      leadCreated: false,
    };
  }

  let opportunityId: string | null = null;
  let leadCreated = false;

  const relationshipDecision = await findOpportunityRelationshipMatch({
    supabase,
    companyId,
    connectionId,
    providerThreadId: routingIdentity.mayInheritProviderThread
      ? providerThreadId
      : null,
    clientId,
    facts: {
      contactName: customerName || null,
      contactEmail: customerEmail || null,
      contactPhone: submitter?.phone ?? null,
      address: submitter?.address ?? null,
      description: customerDescription,
      subject,
      providerThreadId: routingIdentity.mayInheritProviderThread
        ? providerThreadId
        : null,
      sourcePlatform: routingIdentity.isContactFormSubmission
        ? "contact_form"
        : null,
      phaseCEnabled: false,
    },
  });

  if (relationshipDecision.action === "link") {
    opportunityId = relationshipDecision.opportunityId;
    activityClientId = relationshipDecision.clientId ?? clientId;
  } else if (clientId) {
    const opportunity = await OpportunityService.createOpportunity({
      companyId,
      clientId,
      title: buildEmailOpportunityTitle({
        kind: "email_inquiry",
        candidates: [
          {
            source: routingIdentity.isContactFormSubmission
              ? "contact_form"
              : direction === "outbound"
                ? "outbound_recipient"
                : "inbound_sender",
            name: customerName,
            email: customerEmail,
          },
        ],
      }),
      stage: OpportunityStage.NewLead,
      source: OpportunitySource.Email,
      contactName: customerName || null,
      contactEmail: customerEmail || null,
      contactPhone: submitter?.phone ?? null,
      description: customerDescription,
      priority: null,
      estimatedValue: null,
      actualValue: null,
      winProbability: 20,
      expectedCloseDate: null,
      actualCloseDate: null,
      projectId: null,
      lostReason: null,
      lostNotes: null,
      sourceEmailId: providerThreadId,
      sourceThreadKey: routingIdentity.sourceKey,
      quoteDeliveryMethod: null,
      address: submitter?.address ?? null,
      latitude: null,
      longitude: null,
      tags: ["email-import", "historical-import"],
    });
    opportunityId = opportunity.id;
    leadCreated = true;
  }

  if (opportunityId) {
    await persistOpportunitySideEffects(opportunityId, activityClientId);
  }

  // Create activity
  const activity = await OpportunityService.createActivity({
    companyId,
    opportunityId,
    clientId: activityClientId,
    estimateId: null,
    invoiceId: null,
    projectId: null,
    siteVisitId: null,
    type: ActivityType.Email,
    subject,
    content: bodyText || null,
    outcome: null,
    direction,
    durationMinutes: null,
    attachments: [],
    emailThreadId: providerThreadId,
    emailMessageId: providerMessageId,
    emailConnectionId: connectionId,
    isRead: !!clientId,
    fromEmail: fromEmail || null,
    occurredAt,
    createdBy: null,
  });

  await persistActivitySemanticSideEffects(activity.id, opportunityId);
  await refreshCanonicalThread({
    opportunityId,
    clientId: activityClientId,
    isRead: Boolean(clientId),
  });

  const isMatched =
    Boolean(opportunityId) || matchResult.confidence !== "unmatched";

  return {
    matched: isMatched,
    needsReview: matchResult.needsReview,
    leadCreated,
  };
}

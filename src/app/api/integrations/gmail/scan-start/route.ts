/**
 * OPS Web - Gmail Scan Start (Async Job)
 *
 * POST /api/integrations/gmail/scan-start
 * Body: { connectionId: string, days?: number }
 *
 * Creates a scan job in Supabase and returns { jobId } immediately.
 * The heavy work (Gmail fetch + AI classification) runs in the background
 * via Next.js after(), updating the job row with progress as it goes.
 *
 * Client polls GET /api/integrations/gmail/scan-status?jobId=... for updates.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { EmailFilterService } from "@/lib/api/services/email-filter-service";
import { DEFAULT_SYNC_FILTERS } from "@/lib/types/pipeline";
import type { GmailSyncFilters } from "@/lib/types/pipeline";
import {
  classifyEmails,
  type EmailForClassification,
} from "@/lib/api/services/email-classifier";
import {
  getValidGmailToken,
  type GmailConnectionRow,
} from "@/lib/api/services/gmail-token";
import {
  fetchGmailRead,
  mapGmailReads,
} from "@/lib/api/services/providers/gmail-read";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import {
  acquireEmailConnectionSyncLock,
  renewEmailConnectionSyncLock,
  releaseEmailConnectionSyncLock,
} from "@/lib/api/services/email-connection-sync-lock";

export const maxDuration = 300;

// ─── Types ───────────────────────────────────────────────────────────────────

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
  snippet?: string;
  labelIds?: string[];
}

interface ScanEmail {
  id: string;
  from: string;
  fromEmail: string;
  domain: string;
  subject: string;
  snippet: string;
  labels: string[];
  date: string;
  wouldImport: boolean;
  reason: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SCAN = 500;
const GMAIL_SCAN_JOB_DEADLINE_MS = 270 * 1000;
const NON_DELIVERY_GMAIL_LABELS = new Set(["DRAFT", "SPAM", "TRASH"]);

function isDeliveryMessage(labelIds: string[] | undefined): boolean {
  return !(labelIds ?? []).some((label) =>
    NON_DELIVERY_GMAIL_LABELS.has(label.toUpperCase())
  );
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  let lockedConnectionId: string | null = null;
  let lockOwner: string | null = null;
  let lockHandedToBackground = false;
  let createdJobId: string | null = null;

  try {
    const body = await request.json();
    const connectionId = body.connectionId;
    const rawDays = parseInt(body.days ?? "30", 10);
    const days = Number.isFinite(rawDays)
      ? Math.min(Math.max(rawDays, 1), 365)
      : 30;

    if (!connectionId) {
      return NextResponse.json(
        { error: "connectionId required" },
        { status: 400 }
      );
    }

    const access = await resolveEmailConnectionOperationAccess({
      request,
      connectionId,
      requireUsable: true,
      supabase,
    });
    if (!access.allowed) {
      return NextResponse.json(
        {
          error:
            access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
        },
        { status: access.status }
      );
    }
    if (access.connections[0]?.provider !== "gmail") {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    // Load only the authorized Gmail connection after the actor/provider gate.
    const { data: connRow, error: connError } = await supabase
      .from("email_connections")
      .select(
        "id, company_id, provider, access_token, refresh_token, expires_at"
      )
      .eq("id", connectionId)
      .eq("company_id", access.actor.companyId)
      .eq("provider", "gmail")
      .single();

    if (connError || !connRow) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }
    lockOwner = await acquireEmailConnectionSyncLock(
      connectionId,
      "gmail-scan-start",
      supabase
    );
    if (!lockOwner) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again in a few minutes." },
        { status: 409 }
      );
    }
    lockedConnectionId = connectionId;

    // Check for an existing in-progress scan — return its jobId instead of starting a new one.
    // Only reuse jobs created in the last 5 minutes to avoid returning stale/crashed jobs.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: existing } = await supabase
      .from("gmail_scan_jobs")
      .select("id, updated_at")
      .eq("connection_id", connectionId)
      .in("status", [
        "pending",
        "listing",
        "fetching",
        "pre_filtering",
        "classifying",
      ])
      .gte("updated_at", fiveMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ jobId: existing.id });
    }

    // Mark any older stuck jobs as expired so they don't interfere
    await supabase
      .from("gmail_scan_jobs")
      .update({
        status: "error",
        error_message: "Job expired (no progress for 5+ minutes)",
        progress: {
          stage: "error",
          current: 0,
          total: 0,
          message: "Scan expired",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("connection_id", connectionId)
      .in("status", [
        "pending",
        "listing",
        "fetching",
        "pre_filtering",
        "classifying",
      ])
      .lt("updated_at", fiveMinutesAgo);

    // Create job row
    const { data: job, error: jobError } = await supabase
      .from("gmail_scan_jobs")
      .insert({
        connection_id: connectionId,
        company_id: connRow.company_id,
        status: "pending",
        progress: {
          stage: "pending",
          current: 0,
          total: 0,
          message: "Starting scan...",
        },
      })
      .select("id")
      .single();

    if (jobError || !job) {
      console.error("[scan-start] Failed to create job:", jobError);
      return NextResponse.json(
        { error: "Failed to create scan job" },
        { status: 500 }
      );
    }
    createdJobId = job.id as string;

    const conn = connRow as unknown as GmailConnectionRow;

    // Return jobId immediately — heavy work runs after response is sent
    after(async () => {
      await processScanJob(job.id, conn, days, lockOwner!);
    });
    lockHandedToBackground = true;

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    console.error("[scan-start]", err);
    if (createdJobId) {
      const { error: handoffFailureError } = await supabase
        .from("gmail_scan_jobs")
        .update({
          status: "error",
          error_message: `Scan did not start: ${err instanceof Error ? err.message : "Unknown error"}`,
          progress: {
            stage: "error",
            current: 0,
            total: 0,
            message: "Scan failed to start",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", createdJobId);
      if (handoffFailureError) {
        console.error(
          "[scan-start] Failed to persist handoff failure:",
          handoffFailureError
        );
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    if (lockedConnectionId && lockOwner && !lockHandedToBackground) {
      await releaseEmailConnectionSyncLock(
        lockedConnectionId,
        lockOwner,
        "gmail-scan-start",
        supabase
      );
    }
  }
}

// ─── Background Processing ──────────────────────────────────────────────────

async function processScanJob(
  jobId: string,
  conn: GmailConnectionRow,
  days: number,
  lockOwner: string
) {
  const supabase = getServiceRoleClient();
  const deadlineAt = Date.now() + GMAIL_SCAN_JOB_DEADLINE_MS;

  async function updateJob(
    status: string,
    progress: { stage: string; current: number; total: number; message: string }
  ) {
    const { error } = await supabase
      .from("gmail_scan_jobs")
      .update({ status, progress, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) {
      throw new Error(
        `Failed to persist Gmail scan job ${status}: ${error.message}`
      );
    }
  }

  try {
    await renewEmailConnectionSyncLock(
      conn.id,
      lockOwner,
      "gmail-scan-start",
      supabase
    );
    // ── Stage 1: Get valid token ──────────────────────────────────────────
    const token = await getValidGmailToken(conn, {
      deadlineAt,
      context: "Gmail scan job",
      client: supabase,
    });

    // ── Stage 2: List message IDs ─────────────────────────────────────────
    await updateJob("listing", {
      stage: "listing",
      current: 0,
      total: 0,
      message: "Scanning your inbox...",
    });

    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - days);
    const queryDate = afterDate.toISOString().split("T")[0].replace(/-/g, "/");

    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const listUrl = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages"
      );
      listUrl.searchParams.set("q", `after:${queryDate}`);
      listUrl.searchParams.set("maxResults", "200");
      if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

      const listResp = await fetchGmailRead(
        listUrl,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        { deadlineAt, context: "messages.list (scan job)" }
      );

      if (!listResp.ok) {
        throw new Error(`Gmail messages.list failed: ${listResp.status}`);
      }

      const listData: GmailMessageListResponse = await listResp.json();
      for (const msg of listData.messages ?? []) {
        allMessageIds.push(msg.id);
      }
      pageToken = listData.nextPageToken;
    } while (pageToken && allMessageIds.length < MAX_SCAN);

    if (allMessageIds.length > MAX_SCAN) {
      allMessageIds.length = MAX_SCAN;
    }

    const totalMessages = allMessageIds.length;

    if (totalMessages === 0) {
      const { error: completeEmptyError } = await supabase
        .from("gmail_scan_jobs")
        .update({
          status: "complete",
          progress: {
            stage: "complete",
            current: 100,
            total: 100,
            message: "No emails found.",
          },
          result: {
            emails: [],
            total: 0,
            preFiltered: 0,
            aiAnalyzed: 0,
            recommendedFilters: null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      if (completeEmptyError) {
        throw new Error(
          `Failed to persist empty Gmail scan result: ${completeEmptyError.message}`
        );
      }
      return;
    }

    // ── Stage 3: Fetch email metadata — batched to avoid Gmail rate limits ─
    await updateJob("fetching", {
      stage: "fetching",
      current: 0,
      total: totalMessages,
      message: `Reading ${totalMessages} emails...`,
    });

    const results = await mapGmailReads(
      allMessageIds,
      async (msgId, _index, readPolicy): Promise<ScanEmail | null> => {
        const msgResp = await fetchGmailRead(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } },
          { ...readPolicy, context: `messages.get (${msgId})` }
        );

        if (msgResp.status === 404 || msgResp.status === 410) return null;
        if (!msgResp.ok) {
          throw new Error(
            `Gmail messages.get failed for ${msgId}: ${msgResp.status}`
          );
        }

        const msg: GmailMessage = await msgResp.json();
        if (!isDeliveryMessage(msg.labelIds)) return null;
        const headers = msg.payload?.headers ?? [];
        const from = headers.find((h) => h.name === "From")?.value ?? "";
        const subject =
          headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        const date = headers.find((h) => h.name === "Date")?.value ?? "";
        const fromEmail =
          (from.match(/<(.+?)>/) ?? [, from])[1]?.toLowerCase() ?? "";
        const domain = fromEmail.split("@")[1] ?? "";

        return {
          id: msgId,
          from,
          fromEmail,
          domain,
          subject,
          snippet: msg.snippet ?? "",
          labels: msg.labelIds ?? [],
          date,
          wouldImport: true,
          reason: "",
        };
      },
      {
        deadlineAt,
        context: "scan job message reads",
        onBatchComplete: async (_batchResults, completedItems) => {
          await updateJob("fetching", {
            stage: "fetching",
            current: completedItems,
            total: totalMessages,
            message: `Read ${completedItems} of ${totalMessages} emails`,
          });
        },
      }
    );
    const emails = results.filter(
      (email): email is ScanEmail => email !== null
    );

    // ── Stage 4: Pre-filter known noise domains ───────────────────────────
    await updateJob("pre_filtering", {
      stage: "pre_filtering",
      current: 0,
      total: emails.length,
      message: "Pre-filtering known noise...",
    });

    const presetFilters: GmailSyncFilters = {
      ...DEFAULT_SYNC_FILTERS,
      usePresetBlocklist: true,
    };
    const blocklist = await EmailFilterService.buildBlocklist(presetFilters);
    const presetDomains = blocklist.domains;
    const autoFiltered: ScanEmail[] = [];
    const ambiguous: ScanEmail[] = [];

    // Subdomain-aware preset check: "intuit.com" catches "dp.intuit.com"
    const isPresetBlocked = (emailDomain: string): boolean => {
      const d = emailDomain.toLowerCase();
      if (presetDomains.has(d)) return true;
      for (const blocked of presetDomains) {
        if (d.endsWith("." + blocked)) return true;
      }
      return false;
    };

    for (const email of emails) {
      if (isPresetBlocked(email.domain)) {
        email.wouldImport = false;
        email.reason = "Blocked domain (preset)";
        autoFiltered.push(email);
      } else {
        ambiguous.push(email);
      }
    }

    // ── Stage 5: AI Classification ────────────────────────────────────────
    await updateJob("classifying", {
      stage: "classifying",
      current: 0,
      total: ambiguous.length,
      message: `AI analyzing ${ambiguous.length} emails...`,
    });

    let recommendedFilters = null;
    let aiError: string | null = null;

    try {
      const emailsForAI: EmailForClassification[] = ambiguous.map((e) => ({
        id: e.id,
        fromEmail: e.fromEmail,
        subject: e.subject,
        snippet: e.snippet,
      }));

      const aiResult = await classifyEmails(emailsForAI);
      recommendedFilters = aiResult.filters;

      // Apply AI-recommended filters to determine per-email import/filter status
      // Subdomain-aware: "marks.com" catches "email.marks.com"
      const blockedDomainList = aiResult.filters.excludeDomains.map((d) =>
        d.toLowerCase()
      );
      const blockedAddresses = new Set(
        aiResult.filters.excludeAddresses.map((a) => a.toLowerCase())
      );
      const blockedKeywords = aiResult.filters.excludeSubjectKeywords.map((k) =>
        k.toLowerCase()
      );

      const isDomainBlocked = (emailDomain: string): boolean => {
        const d = emailDomain.toLowerCase();
        return blockedDomainList.some(
          (blocked) => d === blocked || d.endsWith("." + blocked)
        );
      };

      for (const email of ambiguous) {
        const domainBlocked = isDomainBlocked(email.domain);
        const addressBlocked = blockedAddresses.has(
          email.fromEmail.toLowerCase()
        );
        const keywordBlocked = blockedKeywords.some((kw) =>
          email.subject.toLowerCase().includes(kw)
        );

        if (domainBlocked || addressBlocked || keywordBlocked) {
          email.wouldImport = false;
          email.reason = domainBlocked
            ? "AI: blocked domain"
            : addressBlocked
              ? "AI: blocked address"
              : "AI: blocked keyword";
        } else {
          email.wouldImport = true;
          email.reason = "AI: import";
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[scan-job] AI classification failed:", msg);
      aiError = msg;
      for (const email of ambiguous) {
        email.reason = "Unclassified (AI unavailable)";
      }
    }

    // ── Stage 6: Complete ─────────────────────────────────────────────────
    const allResults = [...autoFiltered, ...ambiguous];
    const importedCount = allResults.filter((e) => e.wouldImport).length;
    const filteredCount = allResults.length - importedCount;
    const completeMessage = aiError
      ? `Scan complete with warnings — AI analysis failed: ${aiError}`
      : `Scan complete! ${importedCount} to import, ${filteredCount} filtered out of ${allResults.length} total.`;

    const { error: completeError } = await supabase
      .from("gmail_scan_jobs")
      .update({
        status: "complete",
        progress: {
          stage: "complete",
          current: 100,
          total: 100,
          message: completeMessage,
        },
        result: {
          emails: allResults,
          total: emails.length,
          preFiltered: autoFiltered.length,
          aiAnalyzed: ambiguous.length,
          recommendedFilters,
          aiError,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (completeError) {
      throw new Error(
        `Failed to persist final Gmail scan result: ${completeError.message}`
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `[scan-job] Job ${jobId} complete: ${allResults.length} emails processed`
    );
  } catch (err) {
    console.error(`[scan-job] Job ${jobId} failed:`, err);
    const { error: failureStateError } = await supabase
      .from("gmail_scan_jobs")
      .update({
        status: "error",
        error_message: err instanceof Error ? err.message : "Unknown error",
        progress: {
          stage: "error",
          current: 0,
          total: 0,
          message: "Scan failed",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (failureStateError) {
      throw new Error(
        `Failed to persist Gmail scan job error: ${failureStateError.message}`
      );
    }
  } finally {
    await releaseEmailConnectionSyncLock(
      conn.id,
      lockOwner,
      "gmail-scan-start",
      supabase
    );
  }
}

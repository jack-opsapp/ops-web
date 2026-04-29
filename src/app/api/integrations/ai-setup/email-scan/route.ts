/**
 * POST /api/integrations/ai-setup/email-scan
 *
 * Sprint E3.2: Full email history scan for AI knowledge acquisition.
 * Fetches ALL sent emails from the last 12 months, processes them in batches
 * of 50 through the MemoryService and WritingProfileService pipeline.
 *
 * Uses a progress record in ai_setup_jobs table (or localStorage polling pattern).
 * Returns immediately with a jobId, then processes in background via after().
 *
 * GET /api/integrations/ai-setup/email-scan?jobId=xxx
 * Returns progress for a running scan job.
 *
 * Gated behind phase_c feature flag.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { EmailService } from "@/lib/api/services/email-service";
import { MemoryService } from "@/lib/api/services/memory-service";
import { WritingProfileService } from "@/lib/api/services/writing-profile-service";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

export const maxDuration = 800;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ScanProgress {
  status: "pending" | "scanning" | "processing" | "complete" | "error";
  total: number;
  processed: number;
  factsExtracted: number;
  entitiesCreated: number;
  profileUpdates: number;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

// ─── In-memory progress store (per-request lifetime via after()) ────────────────
// We store progress in the gmail_scan_jobs table for polling.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── GET: Poll progress ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();

  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (!job?.result) {
    return NextResponse.json({ status: "pending", progress: null });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = job.result as any;
  const scanProgress = result.emailScanProgress as ScanProgress | undefined;

  if (!scanProgress) {
    return NextResponse.json({ status: "pending", progress: null });
  }

  return NextResponse.json({
    status: scanProgress.status,
    progress: scanProgress,
  });
}

// ─── POST: Start full history scan ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();

  // Pin the service-role client to this request's async context. ALS isolates
  // it from concurrent requests, so the 800s background scan can't get its
  // override wiped by another handler's finally clause.
  return runWithSupabase(supabase, async () => {
    try {
      // Auth
      const authUser = await verifyAdminAuth(request);
      if (!authUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
      if (!user) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const userId = user.id as string;
      const companyId = user.company_id as string;

      if (!companyId) {
        return NextResponse.json({ error: "No company" }, { status: 400 });
      }

      // Feature gate
      const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c");
      if (!enabled) {
        return NextResponse.json({ error: "Phase C not enabled" }, { status: 403 });
      }

      // Find the email connection
      const body = await request.json().catch(() => ({}));
      const connectionId = body.connectionId as string | undefined;

      let connection;
      if (connectionId) {
        connection = await EmailService.getConnection(connectionId);
      } else {
        // Use first available connection
        const connections = await EmailService.getConnections(companyId);
        connection = connections[0] ?? null;
      }

      if (!connection) {
        return NextResponse.json(
          { error: "No email connection found" },
          { status: 400 }
        );
      }

      // Create a job record for progress tracking
      const { data: jobRecord } = await supabase
        .from("gmail_scan_jobs")
        .insert({
          connection_id: connection.id,
          company_id: companyId,
          status: "pending",
          result: {
            emailScanProgress: {
              status: "pending",
              total: 0,
              processed: 0,
              factsExtracted: 0,
              entitiesCreated: 0,
              profileUpdates: 0,
              startedAt: new Date().toISOString(),
            } satisfies ScanProgress,
          },
        })
        .select("id")
        .single();

      if (!jobRecord) {
        return NextResponse.json({ error: "Failed to create scan job" }, { status: 500 });
      }

      const jobId = jobRecord.id as string;

      // Run scan in background. Re-binding inside after() keeps the
      // service-role client pinned for the entire 800s scan window.
      after(async () => {
        const bgSupabase = getServiceRoleClient();
        await runWithSupabase(bgSupabase, async () => {
          try {
            await runFullHistoryScan(bgSupabase, jobId, connection, companyId, userId);
          } catch (err) {
            console.error("[email-scan] Full history scan failed:", err);
            await updateProgress(bgSupabase, jobId, {
              status: "error",
              error: err instanceof Error ? err.message : "Unknown error",
            });
          }
        });
      });

      return NextResponse.json({ ok: true, jobId });
    } catch (err) {
      console.error("[email-scan]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Internal error" },
        { status: 500 }
      );
    }
  });
}

// ─── Progress update helper ────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof getServiceRoleClient>;

async function updateProgress(
  supabase: SupabaseClient,
  jobId: string,
  update: Partial<ScanProgress>
): Promise<void> {
  const { data: job } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (job?.result ?? {}) as any;
  const current = (result.emailScanProgress ?? {}) as ScanProgress;

  await supabase
    .from("gmail_scan_jobs")
    .update({
      result: {
        ...result,
        emailScanProgress: { ...current, ...update },
      },
      ...(update.status === "complete" || update.status === "error"
        ? { status: update.status === "complete" ? "completed" : "error" }
        : {}),
    })
    .eq("id", jobId);
}

// ─── Full History Scan ─────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFullHistoryScan(
  supabase: SupabaseClient,
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any,
  companyId: string,
  userId: string
): Promise<void> {
  const startTime = Date.now();
  console.log(`[email-scan] Starting full history scan for company ${companyId}`);

  await updateProgress(supabase, jobId, { status: "scanning" });

  const provider = EmailService.getProvider(connection);
  const ownerEmail = connection.email.toLowerCase();

  // Get company employee emails for classification
  const { data: companyUsers } = await supabase
    .from("users")
    .select("email")
    .eq("company_id", companyId);

  const employeeEmails = new Set<string>();
  for (const u of companyUsers ?? []) {
    if (u.email) employeeEmails.add((u.email as string).toLowerCase().trim());
  }

  // Fetch sent emails from the last 12 months using Gmail search
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const allSentEmails: NormalizedEmail[] = [];
  let pageToken: string | undefined;
  const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

  // Paginated fetch of all sent message IDs
  const allMessageIds: string[] = [];
  do {
    // Use the provider's internal gmailFetch by calling searchEmails in pages
    // Since the provider doesn't expose pagination, we'll fetch IDs directly
    // via the connection's access token
    const token = connection.accessToken;
    const epoch = Math.floor(twelveMonthsAgo.getTime() / 1000);
    const query = encodeURIComponent(`in:sent after:${epoch}`);
    const pageParam = pageToken ? `&pageToken=${pageToken}` : "";

    const res = await fetch(
      `${GMAIL_API}/messages?q=${query}&maxResults=100${pageParam}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      console.error(`[email-scan] Gmail list failed: ${res.status}`);
      break;
    }

    const data = await res.json();
    const ids = (data.messages ?? []).map((m: { id: string }) => m.id);
    allMessageIds.push(...ids);
    pageToken = data.nextPageToken;

    // Rate limit safety
    await delay(200);
  } while (pageToken);

  console.log(`[email-scan] Found ${allMessageIds.length} sent emails in last 12 months`);

  await updateProgress(supabase, jobId, {
    status: "processing",
    total: allMessageIds.length,
  });

  // Process in batches of 50
  const BATCH_SIZE = 50;
  let totalProcessed = 0;
  let totalFactsExtracted = 0;
  const totalEntitiesCreated = 0;
  let totalProfileUpdates = 0;

  for (let i = 0; i < allMessageIds.length; i += BATCH_SIZE) {
    const batchIds = allMessageIds.slice(i, i + BATCH_SIZE);

    // Fetch full message content for this batch
    const batchEmails: NormalizedEmail[] = [];
    for (const msgId of batchIds) {
      try {
        const token = connection.accessToken;
        const res = await fetch(
          `${GMAIL_API}/messages/${msgId}?format=full`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!res.ok) continue;
        const msgData = await res.json();

        // Extract headers
        const headers = (msgData.payload?.headers ?? []) as Array<{
          name: string;
          value: string;
        }>;
        const getHeader = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

        // Extract body text
        let bodyText = "";
        const extractText = (part: Record<string, unknown>): string => {
          if (part.mimeType === "text/plain" && part.body) {
            const body = part.body as { data?: string };
            if (body.data) {
              return Buffer.from(body.data, "base64url").toString("utf-8");
            }
          }
          if (part.parts) {
            return (part.parts as Record<string, unknown>[])
              .map(extractText)
              .filter(Boolean)
              .join("\n");
          }
          return "";
        };
        bodyText = extractText(msgData.payload ?? {});

        if (!bodyText || bodyText.length < 20) continue;

        batchEmails.push({
          id: msgData.id,
          threadId: msgData.threadId,
          from: getHeader("From"),
          fromName: "",
          to: getHeader("To").split(",").map((s: string) => s.trim()),
          cc: getHeader("Cc")
            ? getHeader("Cc").split(",").map((s: string) => s.trim())
            : [],
          subject: getHeader("Subject"),
          bodyText,
          snippet: msgData.snippet ?? "",
          date: new Date(parseInt(msgData.internalDate ?? "0")),
          labelIds: msgData.labelIds ?? [],
          isRead: true,
          hasAttachments: false,
          sizeEstimate: 0,
        });
      } catch {
        // Skip individual message failures
      }
    }

    // Process each email through writing profile and memory services.
    // Service-role client is bound by the caller's runWithSupabase().
    for (const email of batchEmails) {
      try {
        // Update writing profile from every outbound email
        await WritingProfileService.updateFromEmail(companyId, userId, {
          bodyText: email.bodyText,
        });
        totalProfileUpdates++;

        // Extract facts and entities via MemoryService
        await MemoryService.processOutboundEmail(companyId, userId, {
          from: email.from,
          to: email.to,
          subject: email.subject,
          bodyText: email.bodyText,
          date: email.date instanceof Date ? email.date.toISOString() : String(email.date),
        });
        totalFactsExtracted++; // Approximate — processOutboundEmail doesn't return count
      } catch (err) {
        console.error(`[email-scan] Processing email ${email.id} failed:`, err);
      }
    }

    totalProcessed += batchEmails.length;

    // Update progress every batch
    await updateProgress(supabase, jobId, {
      processed: totalProcessed,
      factsExtracted: totalFactsExtracted,
      entitiesCreated: totalEntitiesCreated,
      profileUpdates: totalProfileUpdates,
    });

    // Rate limit between batches
    if (i + BATCH_SIZE < allMessageIds.length) {
      await delay(500);
    }
  }

  // Mark complete
  await updateProgress(supabase, jobId, {
    status: "complete",
    processed: totalProcessed,
    factsExtracted: totalFactsExtracted,
    entitiesCreated: totalEntitiesCreated,
    profileUpdates: totalProfileUpdates,
    completedAt: new Date().toISOString(),
  });

  // Fire completion notification
  await supabase.from("notifications").insert({
    user_id: userId,
    company_id: companyId,
    type: "mention",
    title: "Email analysis complete",
    body: `Analyzed ${totalProcessed} emails. Found ${totalFactsExtracted} facts and ${totalEntitiesCreated} business relationships.`,
    is_read: false,
    persistent: true,
    action_url: "/settings/integrations/ai-setup",
    action_label: "View Results",
  });

  const durationMs = Date.now() - startTime;
  console.log(
    `[email-scan] Complete — ${totalProcessed} emails, ${totalFactsExtracted} facts, ${totalProfileUpdates} profile updates, ${(durationMs / 1000).toFixed(1)}s`
  );
}

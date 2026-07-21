/**
 * POST /api/integrations/ai-setup/email-scan
 *
 * Sprint E3.2: Full email history scan for AI knowledge acquisition.
 * Fetches ALL sent emails from the last 12 months, processes them in batches
 * of 50 through the receipt-idempotent outbound-learning queue.
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
import { EmailOutboundLearningService } from "@/lib/api/services/email-outbound-learning-service";
import {
  isPersonalHistoricalLearningConnection,
  prepareHistoricalOutboundBodyForLearning,
} from "@/lib/email/email-signature-runtime";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import { fetchGmailRead } from "@/lib/api/services/providers/gmail-read";
import { GmailProvider } from "@/lib/api/services/providers/gmail-provider";
import {
  acquireEmailConnectionSyncLock,
  createEmailConnectionSyncLockRenewer,
  releaseEmailConnectionSyncLock,
  type EmailConnectionSyncLockRenewer,
} from "@/lib/api/services/email-connection-sync-lock";

export const maxDuration = 800;
const GMAIL_HISTORY_SCAN_DEADLINE_MS = 12 * 60 * 1000;

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── GET: Poll progress ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();

  const { data: job, error: jobReadError } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (jobReadError) {
    console.error("[email-scan] Failed to load scan progress:", jobReadError);
    return NextResponse.json(
      { error: "Couldn't load scan progress. Try again." },
      { status: 500 }
    );
  }

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
    let lockedConnectionId: string | null = null;
    let lockOwner: string | null = null;
    let lockHandedToBackground = false;
    let createdJobId: string | null = null;

    try {
      // Auth
      const authUser = await verifyAdminAuth(request);
      if (!authUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const user = await findUserByAuth(
        authUser.uid,
        authUser.email,
        "id, company_id"
      );
      if (!user) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const userId = user.id as string;
      const companyId = user.company_id as string;

      if (!companyId) {
        return NextResponse.json({ error: "No company" }, { status: 400 });
      }

      // Feature gate
      const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
        companyId,
        "phase_c"
      );
      if (!enabled) {
        return NextResponse.json(
          { error: "Phase C not enabled" },
          { status: 403 }
        );
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

      if (
        !connection ||
        connection.companyId !== companyId ||
        (connectionId !== undefined && connection.id !== connectionId)
      ) {
        return NextResponse.json(
          { error: "No email connection found" },
          { status: 400 }
        );
      }

      if (!isPersonalHistoricalLearningConnection(connection, userId)) {
        return NextResponse.json(
          { error: "Connect your own inbox to build your email profile." },
          { status: 403 }
        );
      }

      lockOwner = await acquireEmailConnectionSyncLock(
        connection.id,
        "phase-c-email-scan",
        supabase
      );
      if (!lockOwner) {
        return NextResponse.json(
          { error: "Mailbox is busy. Try again in a few minutes." },
          { status: 409 }
        );
      }
      lockedConnectionId = connection.id;

      // Create a job record for progress tracking
      const { data: jobRecord, error: jobInsertError } = await supabase
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

      if (jobInsertError || !jobRecord) {
        console.error(
          "[email-scan] Failed to create durable scan job:",
          jobInsertError
        );
        return NextResponse.json(
          { error: "Failed to create scan job" },
          { status: 500 }
        );
      }

      const jobId = jobRecord.id as string;
      createdJobId = jobId;

      // Run scan in background. Re-binding inside after() keeps the
      // service-role client pinned for the entire 800s scan window.
      after(async () => {
        const bgSupabase = getServiceRoleClient();
        await runWithSupabase(bgSupabase, async () => {
          const renewLockIfNeeded = createEmailConnectionSyncLockRenewer({
            connectionId: connection.id,
            ownerId: lockOwner!,
            context: "phase-c-email-scan",
            client: bgSupabase,
          });
          try {
            // Revalidate both the lease and the connection after the async
            // handoff. Never run a long scan with a pre-lock token snapshot.
            await renewLockIfNeeded(true);
            const currentConnection = await EmailService.getConnection(
              connection.id
            );
            if (
              !currentConnection ||
              currentConnection.companyId !== companyId ||
              !isPersonalHistoricalLearningConnection(currentConnection, userId)
            ) {
              throw new Error(
                "Personal mailbox access changed before the scan started"
              );
            }
            await runFullHistoryScan(
              bgSupabase,
              jobId,
              currentConnection,
              companyId,
              userId,
              renewLockIfNeeded
            );
          } catch (err) {
            console.error("[email-scan] Full history scan failed:", err);
            try {
              await updateProgress(bgSupabase, jobId, {
                status: "error",
                error: err instanceof Error ? err.message : "Unknown error",
              });
            } catch (persistenceError) {
              console.error(
                "[email-scan] Failed to persist scan error state:",
                persistenceError
              );
              throw persistenceError;
            }
          } finally {
            await renewLockIfNeeded.stop().catch(() => {});
            await releaseEmailConnectionSyncLock(
              connection.id,
              lockOwner!,
              "phase-c-email-scan",
              bgSupabase
            );
          }
        });
      });
      lockHandedToBackground = true;

      return NextResponse.json({ ok: true, jobId });
    } catch (err) {
      console.error("[email-scan]", err);
      if (createdJobId) {
        await updateProgress(supabase, createdJobId, {
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
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
          "phase-c-email-scan",
          supabase
        );
      }
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
  const { data: job, error: progressReadError } = await supabase
    .from("gmail_scan_jobs")
    .select("result")
    .eq("id", jobId)
    .single();

  if (progressReadError) {
    throw new Error(
      `Failed to read email scan progress: ${progressReadError.message}`
    );
  }
  if (!job) {
    throw new Error("Failed to read email scan progress: job not found");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (job?.result ?? {}) as any;
  const current = (result.emailScanProgress ?? {}) as ScanProgress;

  const { error: progressWriteError } = await supabase
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

  if (progressWriteError) {
    throw new Error(
      `Failed to persist email scan progress: ${progressWriteError.message}`
    );
  }
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
  userId: string,
  renewLockIfNeeded: EmailConnectionSyncLockRenewer
): Promise<void> {
  const startTime = Date.now();
  const deadlineAt = startTime + GMAIL_HISTORY_SCAN_DEADLINE_MS;
  const gmailProvider = new GmailProvider(connection);
  const validToken = await gmailProvider.getValidAccessToken({
    deadlineAt,
    context: "Phase C history scan",
  });
  // eslint-disable-next-line no-console
  console.log(
    `[email-scan] Starting full history scan for company ${companyId}`
  );

  await updateProgress(supabase, jobId, { status: "scanning" });

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

  let pageToken: string | undefined;
  const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

  // Paginated fetch of all sent message IDs
  const allMessageIds: string[] = [];
  do {
    // Use the provider's internal gmailFetch by calling searchEmails in pages
    // Since the provider doesn't expose pagination, we'll fetch IDs directly
    // via the connection's access token
    const epoch = Math.floor(twelveMonthsAgo.getTime() / 1000);
    const query = encodeURIComponent(`in:sent after:${epoch}`);
    const pageParam = pageToken ? `&pageToken=${pageToken}` : "";

    const res = await fetchGmailRead(
      `${GMAIL_API}/messages?q=${query}&maxResults=100${pageParam}`,
      {
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
      },
      {
        deadlineAt,
        context: "messages.list (Phase C history scan)",
      }
    );

    if (!res.ok) {
      throw new Error(`Gmail messages.list failed: ${res.status}`);
    }

    const data = await res.json();
    const ids = (data.messages ?? []).map((m: { id: string }) => m.id);
    allMessageIds.push(...ids);
    pageToken = data.nextPageToken;

    // Rate limit safety
    await delay(200);
  } while (pageToken);

  // eslint-disable-next-line no-console
  console.log(
    `[email-scan] Found ${allMessageIds.length} sent emails in last 12 months`
  );

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
    await renewLockIfNeeded();
    const batchIds = allMessageIds.slice(i, i + BATCH_SIZE);

    // Fetch full message content for this batch
    const batchEmails: NormalizedEmail[] = [];
    for (const msgId of batchIds) {
      await renewLockIfNeeded();
      const res = await fetchGmailRead(
        `${GMAIL_API}/messages/${msgId}?format=full`,
        {
          headers: {
            Authorization: `Bearer ${validToken}`,
            "Content-Type": "application/json",
          },
        },
        {
          deadlineAt,
          context: `messages.get (${msgId})`,
        }
      );

      if (res.status === 404 || res.status === 410) continue;
      if (!res.ok) {
        throw new Error(
          `Gmail messages.get failed for ${msgId}: ${res.status}`
        );
      }
      const msgData = await res.json();

      // Extract headers
      const headers = (msgData.payload?.headers ?? []) as Array<{
        name: string;
        value: string;
      }>;
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
          ?.value ?? "";

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
        to: getHeader("To")
          .split(",")
          .map((s: string) => s.trim()),
        cc: getHeader("Cc")
          ? getHeader("Cc")
              .split(",")
              .map((s: string) => s.trim())
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
    }

    // Queue each immutable provider message through the same receipt-backed
    // learning path used by live sync. Re-running onboarding/history scans can
    // repair missing jobs but can never increment a profile twice.
    const outboundLearning = new EmailOutboundLearningService(supabase);
    for (const email of batchEmails) {
      await renewLockIfNeeded();
      const preparedBody = await prepareHistoricalOutboundBodyForLearning({
        connection,
        userId,
        body: email.bodyText,
        subject: email.subject,
      });
      if (!preparedBody.exactSignatureRemoved) continue;

      const queued = await outboundLearning.enqueueIfEnabled({
        companyId,
        connectionId: connection.id,
        providerMessageId: email.id,
        providerThreadId: email.threadId,
        userId,
        fromEmail: email.from,
        toEmails: email.to,
        subject: email.subject,
        bodyText: preparedBody.authoredBody,
        authoredBody: preparedBody.authoredBody,
        cleanBody: preparedBody.cleanBody,
        occurredAt: email.date,
        labelIds: email.labelIds,
        profileType: "general",
        learningAuthority: "operator_authored",
      });
      if (queued) {
        totalProfileUpdates++;
        totalFactsExtracted++;
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
  // eslint-disable-next-line no-console
  console.log(
    `[email-scan] Complete — ${totalProcessed} emails, ${totalFactsExtracted} facts, ${totalProfileUpdates} profile updates, ${(durationMs / 1000).toFixed(1)}s`
  );
}

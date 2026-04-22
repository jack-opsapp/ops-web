/**
 * OPS Web — Phase C Backfill
 *
 * POST /api/inbox/phase-c-backfill
 *
 * Runs Phase C fact extraction over a targeted slice of the company's
 * email_threads corpus — LEAD + CLIENT threads, last 90 days, not
 * archived, never previously extracted. Each processed thread produces
 * zero or more agent_memories rows (facts, commitments, pricing, etc.)
 * plus entity + edge updates.
 *
 * Why targeted instead of full-corpus: Phase C extraction costs an LLM
 * call per thread (~$0.0003 each on gpt-4o-mini) plus a provider
 * messages.get round-trip. The LEAD + CLIENT slice is the commercially
 * relevant subset — marketing/receipt/vendor content is either noise
 * or served by other paths. See
 * docs/superpowers/research/2026-04-21-phase-c-email-backfill.md § 3–5.
 *
 * Bounded per-invocation:
 *   - LIMIT_PER_RUN caps threads per HTTP call (default 10).
 *   - CONCURRENCY = 2 mirrors the OpenAI tier-1 budget used elsewhere.
 *   - MAX_CALLS is a hard ceiling so a stuck client can't rack up cost.
 *   - Returns `remaining` so the caller (UI button or cron) can loop
 *     until the backlog is empty.
 *
 * Idempotent: the WHERE clause skips threads that already have at least
 * one commitment memory, which means re-running the endpoint after a
 * partial success picks up only the still-unprocessed tail.
 *
 * Auth: Firebase JWT + `inbox.configure_phase_c` permission. A cron
 * path is accepted via `CRON_SECRET` bearer + `companyId` query param
 * so this can be scheduled.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailService } from "@/lib/api/services/email-service";
import { MemoryService } from "@/lib/api/services/memory-service";
import type { ClassifiedThread } from "@/lib/api/services/memory-service";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import type { EmailConnection } from "@/lib/types/email-connection";

// ─── Tuning ─────────────────────────────────────────────────────────────────

const LIMIT_PER_RUN = 10;
const LIMIT_HARD_MAX = 30;
const CONCURRENCY = 2;
const MAX_CALLS = 40; // safety ceiling across CONCURRENCY workers
const TARGET_CATEGORIES: readonly EmailThreadCategory[] = ["LEAD", "CLIENT"];
const LOOKBACK_DAYS = 90;

interface BackfillResult {
  /** How many threads were actually attempted (some may have errored). */
  scanned: number;
  /** Successful extractions (new facts written or existing reinforced). */
  processed: number;
  /** Threads that threw — provider fetch failure, LLM timeout, etc. */
  errors: number;
  /** Aggregate facts added across this run. */
  factsAdded: number;
  /** Aggregate edges added across this run. */
  edgesAdded: number;
  /** Threads still awaiting backfill after this run — null on cron-auth path
   *  (we skip the count query to shave a round-trip). */
  remaining: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map `email_threads.primary_category` onto the coarser memory-service
 * `ClassifiedThread.classification`. memory-service uses this to steer
 * its extraction prompt (e.g. "client" vs "vendor"). We only ever
 * backfill LEAD + CLIENT today, so the mapping is trivial.
 */
function mapCategoryToClassification(
  category: EmailThreadCategory
): ClassifiedThread["classification"] {
  switch (category) {
    case "LEAD":
    case "CLIENT":
      return "client";
    case "VENDOR":
      return "vendor";
    case "SUBTRADE":
      return "subtrade";
    case "INTERNAL":
      return "internal";
    default:
      return "unknown";
  }
}

/**
 * Map an `email_connections` DB row into the shape `EmailService.getProvider`
 * expects. Pulled inline (rather than imported) because this route is the
 * only consumer and the shared mapping helper sits in a file we'd have to
 * re-export.
 */
function mapConnectionFromDb(row: Record<string, unknown>): EmailConnection {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as EmailConnection["provider"],
    type: row.type as EmailConnection["type"],
    userId: (row.user_id as string) ?? null,
    email: row.email as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: new Date(row.expires_at as string),
    historyId: (row.history_id as string) ?? null,
    syncEnabled: (row.sync_enabled as boolean) ?? true,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
    syncIntervalMinutes: (row.sync_interval_minutes as number) ?? 60,
    syncFilters: (row.sync_filters as EmailConnection["syncFilters"]) ?? {},
    webhookSubscriptionId: (row.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: row.webhook_expires_at ? new Date(row.webhook_expires_at as string) : null,
    opsLabelId: (row.ops_label_id as string) ?? null,
    aiReviewEnabled: (row.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (row.ai_memory_enabled as boolean) ?? false,
    status: (row.status as EmailConnection["status"]) ?? "active",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Dual auth — Firebase JWT for admin-triggered runs, CRON_SECRET bearer
  // for scheduled invocations. Matches /api/inbox/reclassify conventions.
  const authHeader = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  const { searchParams } = new URL(request.url);
  let companyId: string;
  let resolvedUserId: string;

  if (isCronAuth) {
    const qp = searchParams.get("companyId");
    const userQp = searchParams.get("userId");
    if (!qp) {
      return NextResponse.json(
        { error: "companyId query param required for cron auth" },
        { status: 400 }
      );
    }
    companyId = qp;
    resolvedUserId = userQp ?? ""; // memory rows need a user; owner fills in
  } else {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    resolvedUserId = user.id as string;
    companyId = user.company_id as string;
    if (!companyId) {
      return NextResponse.json(
        { error: "No company associated with user" },
        { status: 400 }
      );
    }
    // Permission matches the admin "configure Phase C" gate — extracting
    // facts across the whole corpus is an owner/admin action, not a per-user
    // triage action.
    const canConfigure = await checkPermissionById(
      resolvedUserId,
      "inbox.configure_phase_c"
    );
    if (!canConfigure) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Limit parsing ─────────────────────────────────────────────────────────
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(limitRaw ? parseInt(limitRaw, 10) || LIMIT_PER_RUN : LIMIT_PER_RUN, 1),
    LIMIT_HARD_MAX
  );

  const supabase = getServiceRoleClient();

  // ── Target thread selection ───────────────────────────────────────────────
  //
  // Skip threads that have ANY agent_memories row attributed to them —
  // those have been through Phase C extraction already and re-running
  // would just burn tokens on the dedup NOOP path. Checking for any
  // row (not only category='commitment') also filters out threads that
  // produced pricing/service/preference facts but no commitment — those
  // would otherwise get re-processed on every run because a dateless
  // extraction produces no new commitment rows.
  //
  // If a future run needs to reprocess (e.g., prompt revision) the
  // caller can delete the relevant memories first; we deliberately
  // don't expose a force-reprocess flag here because it's a surface
  // for expensive mistakes.
  const sinceIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // `phase_c_extracted_at IS NULL` is a fast partial-index hit after the
  // migration 078 backfill. The over-fetch window is removed because the
  // index already narrows the candidate set — every returned row is
  // unprocessed, so we can request exactly `limit` threads.
  const { data: threadRows, error: threadError } = await supabase
    .from("email_threads")
    .select("*")
    .eq("company_id", companyId)
    .in("primary_category", TARGET_CATEGORIES as unknown as string[])
    .gt("last_message_at", sinceIso)
    .is("archived_at", null)
    .is("phase_c_extracted_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (threadError) {
    return NextResponse.json(
      { error: `Thread query failed: ${threadError.message}` },
      { status: 500 }
    );
  }

  const targetRows = threadRows ?? [];
  if (targetRows.length === 0) {
    return NextResponse.json<BackfillResult>({
      scanned: 0,
      processed: 0,
      errors: 0,
      factsAdded: 0,
      edgesAdded: 0,
      remaining: 0,
    });
  }

  // ── Pre-fetch connections used by the target set ──────────────────────────
  //
  // One connection row can back many threads; fetching once and caching by
  // id saves N−1 DB round-trips during the fetch-messages phase.
  const connectionIds = Array.from(
    new Set(targetRows.map((r) => r.connection_id as string))
  );
  const { data: connRows } = await supabase
    .from("email_connections")
    .select("*")
    .in("id", connectionIds);

  const connectionsById = new Map<string, EmailConnection>();
  for (const row of connRows ?? []) {
    connectionsById.set(row.id as string, mapConnectionFromDb(row));
  }

  // ── Worker pool ───────────────────────────────────────────────────────────

  const result: BackfillResult = {
    scanned: 0,
    processed: 0,
    errors: 0,
    factsAdded: 0,
    edgesAdded: 0,
    remaining: null,
  };

  let calls = 0;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= targetRows.length) return;
      if (calls >= MAX_CALLS) return;
      calls++;

      const row = targetRows[idx];
      const threadId = row.id as string;
      const connection = connectionsById.get(row.connection_id as string);

      if (!connection) {
        result.errors++;
        result.scanned++;
        continue;
      }

      // Memory rows need a user_id; prefer the row-owning user (connection
      // type=user) and fall back to whoever triggered the run. Company
      // connections leave user_id null, so the caller's id is the correct
      // attribution target.
      const memoryUserId = connection.userId ?? resolvedUserId;
      if (!memoryUserId) {
        result.errors++;
        result.scanned++;
        continue;
      }

      try {
        const provider = EmailService.getProvider(connection);
        const providerMessages = await provider.fetchThread(
          row.provider_thread_id as string
        );

        if (providerMessages.length === 0) {
          result.scanned++;
          continue;
        }

        const thread: ClassifiedThread = {
          threadId,
          classification: mapCategoryToClassification(
            row.primary_category as EmailThreadCategory
          ),
          profileType: null,
          confidence: (row.category_confidence as number) ?? 0.8,
          messages: providerMessages.map((m) => ({
            from: m.from,
            fromName: m.fromName ?? "",
            to: m.to ?? [],
            subject: m.subject ?? "",
            bodyText: m.bodyText ?? "",
            date: m.date.toISOString(),
            // direction is derived from connection email in memory-service's
            // prompts; we pass a best-effort inbound/outbound tag using the
            // same comparison rule the thread-detail route uses.
            direction:
              m.from?.toLowerCase().includes(connection.email.toLowerCase())
                ? "outbound"
                : "inbound",
          })),
        };

        const stats = await runWithSupabase(supabase, () =>
          MemoryService.extractFromThread(companyId, memoryUserId, thread)
        );

        result.factsAdded += stats.factsAdded;
        result.edgesAdded += stats.edgesAdded;
        result.processed++;
        result.scanned++;

        // Stamp the thread as processed so it drops out of future
        // candidate sets, even when the LLM returned zero new facts.
        // Fire-and-forget — a failed stamp just means we re-process the
        // thread once more next run, never lose data.
        await supabase
          .from("email_threads")
          .update({ phase_c_extracted_at: new Date().toISOString() })
          .eq("id", threadId);
      } catch (err) {
        console.error(
          "[/api/inbox/phase-c-backfill] extraction failed for thread",
          threadId,
          err instanceof Error ? err.message : err
        );
        result.errors++;
        result.scanned++;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // ── Remaining count ───────────────────────────────────────────────────────
  //
  // Skipped on the cron path because cron doesn't need it (it'll invoke
  // again on its own cadence). For the UI path it drives "Processed X of Y
  // — click again to continue" messaging.
  if (!isCronAuth) {
    const { count } = await supabase
      .from("email_threads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("primary_category", TARGET_CATEGORIES as unknown as string[])
      .gt("last_message_at", sinceIso)
      .is("archived_at", null)
      .is("phase_c_extracted_at", null);
    result.remaining = count ?? 0;
  }

  return NextResponse.json<BackfillResult>(result);
}

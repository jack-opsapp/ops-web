/**
 * OPS Web — Inbox Reclassifier
 *
 * POST /api/inbox/reclassify
 *
 * Clears the backlog of email_threads rows whose classification payload is
 * dirty (`category_classified_at IS NULL`). This includes manually-categorized
 * rows: classifyAndUpdate preserves their human category while refreshing the
 * summary, labels, classifier version, and classified timestamp.
 *
 * Why this exists: historical backfill used to default `classify=false`, so
 * the initial import of a user's mailbox landed every thread in
 * `primary_category='OTHER'`. This endpoint walks the backlog in bounded
 * batches and runs `EmailThreadService.classifyAndUpdate` on each.
 *
 * Bounded per-invocation:
 *   - LIMIT_PER_RUN threads max per HTTP call (default 200) — keeps wall
 *     time inside the Vercel function timeout even when per-call OpenAI
 *     latency spikes.
 *   - Work-stealing pool with CONCURRENCY=2 workers. Matches the
 *     concurrency used by memory-service's writing-profile pool to stay
 *     inside OpenAI tier-1 rate limits (~30k TPM on gpt-*-mini).
 *   - Exponential backoff on 429 — re-sleeps and retries the single call,
 *     does NOT abandon the whole run on one rate-limit hit.
 *   - Per-run cost ceiling: MAX_CALLS bounds how many classifier calls a
 *     single HTTP request can make. A stuck cron can't rack up unbounded $$.
 *
 * Idempotent: the WHERE clause excludes any row whose classified_at has been
 * written, so re-running after a partial success picks up only what's missing.
 *
 * Auth: `inbox.categorize` (same permission as the recategorize action).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { mapEmailThreadFromDb } from "@/lib/types/email-thread";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import { isOpenAIRetryableRateLimitError } from "@/lib/api/services/openai-monitoring";

// ─── Tuning ─────────────────────────────────────────────────────────────────
const LIMIT_PER_RUN = 200;
const CONCURRENCY = 2;
const MAX_CALLS = 250; // safety ceiling; should == LIMIT_PER_RUN in steady state
const BACKOFF_INITIAL_MS = 1_500;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_ATTEMPTS = 4;

interface ReclassifyResult {
  scanned: number;
  classified: number;
  stillOther: number;
  errors: number;
  rateLimitHits: number;
  remaining: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

/**
 * Run `classifyAndUpdate` with a tight retry-on-rate-limit loop. 429s and
 * similar throttle signals get exponential backoff; everything else throws
 * out immediately so the outer loop can log + keep moving.
 */
async function classifyWithBackoff(
  threadRow: Parameters<typeof EmailThreadService.classifyAndUpdate>[0],
  onRateLimitHit: () => void
): Promise<{ ok: boolean; primaryCategory: string | null }> {
  let delay = BACKOFF_INITIAL_MS;
  for (let attempt = 0; attempt <= BACKOFF_ATTEMPTS; attempt++) {
    try {
      const updated = await EmailThreadService.classifyAndUpdate(threadRow);
      return { ok: true, primaryCategory: updated.primaryCategory };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = isOpenAIRetryableRateLimitError(err);
      if (isRateLimit && attempt < BACKOFF_ATTEMPTS) {
        onRateLimitHit();
        await sleep(Math.min(delay, BACKOFF_MAX_MS));
        delay *= 2;
        continue;
      }
      console.error("[/api/inbox/reclassify] classifyAndUpdate failed:", msg);
      return { ok: false, primaryCategory: null };
    }
  }
  return { ok: false, primaryCategory: null };
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Two auth modes: normal user-initiated (Firebase JWT + permission check)
  // and cron/internal (CRON_SECRET bearer, requires `companyId` query param
  // because there's no user context). Matches the pattern other /api/cron/*
  // routes use. Fail-closed on both paths.
  const authHeader = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  let companyId: string;
  let connectionIds: string[] | null = null;
  const { searchParams } = new URL(request.url);
  const supabase = getServiceRoleClient();

  if (isCronAuth) {
    const qp = searchParams.get("companyId");
    if (!qp) {
      return NextResponse.json(
        { error: "companyId query param required for cron auth" },
        { status: 400 }
      );
    }
    companyId = qp;
  } else {
    const access = await resolveEmailConnectionOperationAccess({
      request,
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
    const userId = access.actor.userId;
    companyId = access.actor.companyId;
    connectionIds = access.connectionIds;
    // Same permission as the manual recategorize action — anyone who can
    // fix a single thread's category can kick off the batch reclassifier.
    const canCategorize = await checkPermissionById(
      userId,
      "inbox.categorize",
      "all"
    );
    if (!canCategorize) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(
      limitRaw ? parseInt(limitRaw, 10) || LIMIT_PER_RUN : LIMIT_PER_RUN,
      1
    ),
    LIMIT_PER_RUN
  );

  // ── Pull a page of unclassified threads ───────────────────────────────────
  // Company-scoped — a user can only reclassify their own company's threads.
  // Manual categories remain eligible because classifyAndUpdate preserves the
  // human category while refreshing the rest of the classification payload.
  let rowsQuery = supabase
    .from("email_threads")
    .select("*")
    .eq("company_id", companyId)
    .is("category_classified_at", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (connectionIds) {
    rowsQuery = rowsQuery.in("connection_id", connectionIds);
  }
  const { data: rows, error } = await rowsQuery;

  if (error) {
    return NextResponse.json(
      { error: `Query failed: ${error.message}` },
      { status: 500 }
    );
  }

  const threadRows = (rows ?? []).map((r) => mapEmailThreadFromDb(r));
  if (threadRows.length === 0) {
    return NextResponse.json<ReclassifyResult>({
      scanned: 0,
      classified: 0,
      stillOther: 0,
      errors: 0,
      rateLimitHits: 0,
      remaining: 0,
    });
  }

  const result: ReclassifyResult = {
    scanned: 0,
    classified: 0,
    stillOther: 0,
    errors: 0,
    rateLimitHits: 0,
    remaining: null,
  };

  let calls = 0;
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= threadRows.length) return;
      if (calls >= MAX_CALLS) return; // hard ceiling
      calls++;
      const thread = threadRows[idx];
      const outcome = await runWithSupabase(supabase, () =>
        classifyWithBackoff(thread, () => {
          result.rateLimitHits++;
        })
      );
      result.scanned++;
      if (outcome.ok) {
        result.classified++;
        if (outcome.primaryCategory === "OTHER") result.stillOther++;
      } else {
        result.errors++;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // ── Remaining count (cheap head() query) ──────────────────────────────────
  // Tells the caller whether to fire another invocation. Cron/UI consumers
  // loop until remaining hits 0.
  let remainingQuery = supabase
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("category_classified_at", null);
  if (connectionIds) {
    remainingQuery = remainingQuery.in("connection_id", connectionIds);
  }
  const { count } = await remainingQuery;

  result.remaining = count ?? null;

  return NextResponse.json(result);
}

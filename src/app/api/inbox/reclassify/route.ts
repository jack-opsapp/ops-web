/**
 * OPS Web — Inbox Reclassifier
 *
 * POST /api/inbox/reclassify
 *
 * Clears the backlog of never-classified email_threads rows
 * (`category_classified_at IS NULL AND category_manually_set = false`).
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
 * Idempotent: the WHERE clause excludes manually-set rows and any row
 * whose classified_at has been written, so re-running after a partial
 * success picks up only what's still missing.
 *
 * Auth: `inbox.categorize` (same permission as the recategorize action).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { mapEmailThreadFromDb } from "@/lib/types/email-thread";

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
      const isRateLimit =
        /rate.?limit|429|tpm|too many requests/i.test(msg) ||
        (err as { status?: number })?.status === 429;
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
  const isCronAuth =
    !!cronSecret &&
    authHeader === `Bearer ${cronSecret}`;

  let companyId: string;
  const { searchParams } = new URL(request.url);

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
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = user.id as string;
    companyId = user.company_id as string;
    if (!companyId) {
      return NextResponse.json(
        { error: "No company associated with user" },
        { status: 400 }
      );
    }
    // Same permission as the manual recategorize action — anyone who can
    // fix a single thread's category can kick off the batch reclassifier.
    const canCategorize = await checkPermissionById(userId, "inbox.categorize");
    if (!canCategorize) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const limitRaw = searchParams.get("limit");
  const limit = Math.min(
    Math.max(limitRaw ? parseInt(limitRaw, 10) || LIMIT_PER_RUN : LIMIT_PER_RUN, 1),
    LIMIT_PER_RUN
  );

  const supabase = getServiceRoleClient();

  // ── Pull a page of unclassified threads ───────────────────────────────────
  // Company-scoped — a user can only reclassify their own company's
  // threads. manual_set=false guard ensures we never steamroll a category
  // a human explicitly corrected.
  const { data: rows, error } = await supabase
    .from("email_threads")
    .select("*")
    .eq("company_id", companyId)
    .is("category_classified_at", null)
    .eq("category_manually_set", false)
    .order("last_message_at", { ascending: false })
    .limit(limit);

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
  const { count } = await supabase
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("category_classified_at", null)
    .eq("category_manually_set", false);

  result.remaining = count ?? null;

  return NextResponse.json(result);
}

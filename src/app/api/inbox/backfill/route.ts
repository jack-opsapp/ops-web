/**
 * OPS Web — Inbox Historical Backfill
 *
 * POST /api/inbox/backfill
 *   Body: { connectionId: string, monthsBack?: number, maxPages?: number,
 *           classify?: boolean, dryRun?: boolean }
 *
 * The inbox cache (`email_threads`) is delta-populated by the sync engine —
 * new emails flowing through the sync pipeline get a row, but anything
 * pre-existing the connection (or predating the rebuild) is invisible until
 * something pulls it in. This endpoint does that pull: it walks the
 * provider's full thread list page by page (Gmail: `messages.list`; M365:
 * `/me/messages`), skips threads we already have, fetches full content for
 * the rest via `provider.fetchThread`, and upserts every message through
 * `EmailThreadService.upsertFromEmail` so the result matches exactly what
 * live sync would have produced.
 *
 * Deliberately synchronous. Vercel's 300s maxDuration is enough for a
 * mailbox up to ~5,000 new threads in one pass with conservative rate
 * limiting; larger inboxes re-run until the response reports no more pages.
 * Classification is off by default (OpenAI-per-thread would be expensive on
 * a cold backfill); threads land as 'OTHER' and get classified on the next
 * inbound message or on manual reclassify.
 *
 * Auth: Firebase/Supabase JWT. Permissions: `inbox.view` on the connection's
 * company. Idempotent via the `(connection_id, provider_thread_id)` unique
 * constraint on `email_threads`, so re-runs are safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { EmailService } from "@/lib/api/services/email-service";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import { resolveEmailConnectionOperationAccess } from "@/lib/email/email-connection-operation-access";
import {
  acquireEmailConnectionSyncLock,
  createEmailConnectionSyncLockRenewer,
  releaseEmailConnectionSyncLock,
} from "@/lib/api/services/email-connection-sync-lock";

export const maxDuration = 300; // 5 min — the Vercel ceiling.

interface BackfillRequestBody {
  connectionId?: string;
  /** Only pull threads with a message received within the last N months. */
  monthsBack?: number;
  /**
   * Number of provider list pages to walk before fetching full threads. One
   * page is ~500 messages → ~200-400 unique threads for most mailboxes.
   * Default 1 keeps each run well under Vercel's 300s budget on mailboxes
   * up to ~5,000 threads. Raise only if you know the mailbox is small.
   */
  maxPages?: number;
  /**
   * Continuation token returned by the previous call. Lets the backfill
   * resume where the last page walk stopped.
   */
  startPageToken?: string | null;
  /** Run classification during upsert. Off by default — expensive on cold backfill. */
  classify?: boolean;
  /** If true, walk + report counts without writing anything. */
  dryRun?: boolean;
}

interface BackfillResult {
  connectionId: string;
  provider: "gmail" | "microsoft365";
  pagesWalked: number;
  threadsSeen: number;
  threadsAlreadyPresent: number;
  threadsBackfilled: number;
  messagesUpserted: number;
  errors: Array<{ threadId: string; message: string }>;
  /** Next page token if the walk was cut short by maxPages. */
  nextPageToken: string | null;
  /** True when the walk reached the end of the mailbox. */
  completed: boolean;
  dryRun: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: BackfillRequestBody;
  try {
    body = (await request.json()) as BackfillRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    connectionId,
    monthsBack = 12,
    maxPages = 1,
    startPageToken = null,
    // Historical backfill should classify by default — otherwise imported
    // threads land at primary_category='OTHER' / category_classified_at=NULL
    // and stay there (only live sync classifies). First run of this endpoint
    // on an empty inbox dumped 3,316 rows into OTHER because this was false.
    // Callers can still override to skip classification for migration passes.
    classify = true,
    dryRun = false,
  } = body;

  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const access = await resolveEmailConnectionOperationAccess({
    request,
    connectionId,
    requireUsable: true,
    supabase,
  });
  if (!access.allowed) {
    return NextResponse.json(
      {
        error: access.reason === "unauthorized" ? "Unauthorized" : "Forbidden",
      },
      { status: access.status }
    );
  }
  const companyId = access.actor.companyId;

  // Verify connection belongs to this user's company before we ever hit the
  // provider. A malicious or buggy client can't use this endpoint to pull
  // mail from another company's mailbox.
  const { data: connRow, error: connErr } = await supabase
    .from("email_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (connErr || !connRow) {
    return NextResponse.json(
      { error: "Connection not found or not accessible" },
      { status: 404 }
    );
  }

  // Hydrate the connection into the shape EmailService.getProvider wants.
  // Mirrors the conversion used by /api/inbox/threads/[id] — if the shape
  // drifts we'll catch it in code review rather than at runtime.
  const connection: Parameters<typeof EmailService.getProvider>[0] = {
    id: connRow.id as string,
    companyId: connRow.company_id as string,
    provider: connRow.provider,
    type: connRow.type,
    userId:
      connRow.type === "individual"
        ? ((connRow.user_id as string) ?? null)
        : null,
    email: connRow.email as string,
    accessToken: connRow.access_token as string,
    refreshToken: connRow.refresh_token as string,
    expiresAt: new Date(connRow.expires_at as string),
    historyId: (connRow.history_id as string) ?? null,
    syncEnabled: (connRow.sync_enabled as boolean) ?? true,
    lastSyncedAt: connRow.last_synced_at
      ? new Date(connRow.last_synced_at as string)
      : null,
    syncIntervalMinutes: (connRow.sync_interval_minutes as number) ?? 60,
    syncFilters: connRow.sync_filters ?? {},
    webhookSubscriptionId: (connRow.webhook_subscription_id as string) ?? null,
    webhookExpiresAt: connRow.webhook_expires_at
      ? new Date(connRow.webhook_expires_at as string)
      : null,
    opsLabelId: (connRow.ops_label_id as string) ?? null,
    aiReviewEnabled: (connRow.ai_review_enabled as boolean) ?? false,
    aiMemoryEnabled: (connRow.ai_memory_enabled as boolean) ?? false,
    status: (connRow.status as string) ?? "active",
    createdAt: new Date(connRow.created_at as string),
    updatedAt: new Date(connRow.updated_at as string),
    // Fields touched by newer migrations; fall back gracefully if absent.
    archiveWritebackPreference:
      (connRow.archive_writeback_preference as
        | "never"
        | "always"
        | "ask_first"
        | null) ?? null,
  } as Parameters<typeof EmailService.getProvider>[0];

  const provider = EmailService.getProvider(connection);
  const after = new Date();
  after.setMonth(after.getMonth() - Math.max(monthsBack, 1));

  const result: BackfillResult = {
    connectionId,
    provider: connection.provider as "gmail" | "microsoft365",
    pagesWalked: 0,
    threadsSeen: 0,
    threadsAlreadyPresent: 0,
    threadsBackfilled: 0,
    messagesUpserted: 0,
    errors: [],
    nextPageToken: null,
    completed: false,
    dryRun,
  };

  let lockOwner: string;
  try {
    const acquiredOwner = await acquireEmailConnectionSyncLock(
      connectionId,
      "inbox-backfill",
      supabase
    );
    if (!acquiredOwner) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again in a few minutes." },
        { status: 409 }
      );
    }
    lockOwner = acquiredOwner;
  } catch (error) {
    console.error("[/api/inbox/backfill] lock acquisition failed:", error);
    return NextResponse.json(
      { error: "Backfill could not safely start" },
      { status: 500 }
    );
  }
  const renewLockIfNeeded = createEmailConnectionSyncLockRenewer({
    connectionId,
    ownerId: lockOwner,
    context: "inbox-backfill",
    client: supabase,
  });

  try {
    // ─── 1. Walk the provider's thread list, dedupe across pages ────────────
    const allThreadIds = new Set<string>();
    let pageToken: string | null = startPageToken;

    for (let page = 0; page < maxPages; page++) {
      await renewLockIfNeeded();
      const { threadIds, nextPageToken } = await provider.listThreadIds({
        pageSize: 500,
        after,
        pageToken,
      });
      await renewLockIfNeeded();
      result.pagesWalked += 1;
      for (const id of threadIds) allThreadIds.add(id);

      if (!nextPageToken) {
        result.completed = true;
        result.nextPageToken = null;
        break;
      }
      pageToken = nextPageToken;
      result.nextPageToken = nextPageToken;
    }

    result.threadsSeen = allThreadIds.size;

    // ─── 2. Skip thread IDs already present for this connection ────────────
    //
    // Supabase has a 1k-row limit on `.in()`, so batch the lookup. The alt
    // — a server function or CTE — is overkill for an operation this is
    // called maybe once per connection lifetime.
    const idList = Array.from(allThreadIds);
    const present = new Set<string>();
    for (let i = 0; i < idList.length; i += 500) {
      const slice = idList.slice(i, i + 500);
      const { data: existing } = await supabase
        .from("email_threads")
        .select("provider_thread_id")
        .eq("connection_id", connectionId)
        .in("provider_thread_id", slice);
      for (const row of existing ?? []) {
        present.add(row.provider_thread_id as string);
      }
    }

    const missingIds = idList.filter((id) => !present.has(id));
    result.threadsAlreadyPresent = idList.length - missingIds.length;

    if (dryRun) {
      return NextResponse.json(result);
    }

    // ─── 3. For each missing thread, pull full content + upsert messages ───
    //
    // fetchThread is already rate-limited inside the provider's
    // fetchMessagesByIds helper. We add per-thread error isolation so a
    // single 404 (rare — message deleted between the list call and the
    // thread fetch) doesn't abort the whole backfill.
    for (const threadId of missingIds) {
      await renewLockIfNeeded();
      let messages: NormalizedEmail[];
      try {
        messages = await provider.fetchThread(threadId);
      } catch (err) {
        result.errors.push({
          threadId,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      await renewLockIfNeeded();

      try {
        if (messages.length === 0) continue;

        // Order matters for denormalized fields (last_message_at etc.) —
        // upsertFromEmail updates those based on the message passed in, and
        // later messages should overwrite earlier ones. Order ASC so the
        // newest message's metadata is the final write.
        messages.sort((a, b) => a.date.getTime() - b.date.getTime());

        let threadRowAfterUpsert = null;
        for (const msg of messages) {
          const connectionEmail = connection.email.toLowerCase();
          // Gmail/M365 "from" may arrive as "Display Name <email@host>".
          // upsertFromEmail handles that via extractEmailAddress internally,
          // so we only need to classify direction for the label+outcome
          // bookkeeping here.
          const fromAddr = msg.from.includes("<")
            ? (msg.from.match(/<([^>]+)>/)?.[1] ?? msg.from).toLowerCase()
            : msg.from.toLowerCase();
          const direction: "inbound" | "outbound" =
            fromAddr === connectionEmail ? "outbound" : "inbound";

          const { threadRow } = await runWithSupabase(supabase, () =>
            EmailThreadService.upsertFromEmail({
              companyId: connection.companyId,
              connectionId: connection.id,
              providerThreadId: threadId,
              email: msg,
              direction,
            })
          );
          threadRowAfterUpsert = threadRow;
          result.messagesUpserted += 1;
        }

        if (classify && threadRowAfterUpsert) {
          // Best-effort classification — swallow errors so a rate-limited
          // OpenAI call doesn't block the backfill loop.
          try {
            await runWithSupabase(supabase, () =>
              EmailThreadService.classifyAndUpdate(threadRowAfterUpsert)
            );
          } catch (err) {
            result.errors.push({
              threadId,
              message: `classify: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        result.threadsBackfilled += 1;
      } catch (err) {
        result.errors.push({
          threadId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/inbox/backfill] failed:", err);
    return NextResponse.json(
      {
        error: `Backfill failed: ${err instanceof Error ? err.message : String(err)}`,
        partial: result,
      },
      { status: 500 }
    );
  } finally {
    try {
      await renewLockIfNeeded.stop();
    } finally {
      await releaseEmailConnectionSyncLock(
        connectionId,
        lockOwner,
        "inbox-backfill",
        supabase
      );
    }
  }
}

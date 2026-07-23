/**
 * OPS Web — Inbox Drafts
 *
 * GET    /api/inbox/drafts?scope=own|company
 * POST   /api/inbox/drafts                    — create-or-update a provider draft
 * DELETE /api/inbox/drafts?source=provider|ai&id=...&connectionId=...
 *
 * Merges two sources into one list:
 *   - `ai_draft_history` rows with status='drafted'  (OPS AI-generated drafts)
 *   - provider Drafts folder (Gmail `/drafts`, M365 Drafts mailFolder)
 *   - `opportunity_follow_up_drafts` rows with origin='template_follow_up'
 *     and status='drafted' (local lifecycle drafts, no provider draft)
 *
 * Dedupe rule: when both an AI draft and a provider draft reference the same
 * thread, the AI draft wins. Rationale: the user is almost certainly editing
 * an AI suggestion through OPS (which mirrors to the provider), and showing
 * two rows for "the same conversation" confuses the inbox. Pure provider
 * drafts (typed directly in Gmail/Outlook, no OPS AI) still surface.
 *
 * Auth:
 *   - inbox.view                       required for GET
 *   - inbox.view_company               required for scope=company
 *   - inbox.view for DELETE (user can always discard their own drafts)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { EmailService } from "@/lib/api/services/email-service";
import { runWithEmailConnectionSyncLock } from "@/lib/api/services/email-connection-sync-lock";
import {
  isEmailProviderMailboxBusyError,
  isEmailProviderMailboxLeaseError,
  runEmailProviderMailboxOperation,
  type EmailProviderMailboxCheckpoint,
} from "@/lib/api/services/email-provider-mailbox-operation";
import {
  loadKnownEmailSignaturesForMessage,
  normalizeMailboxDraftAuthoredBody,
  renderMailboxDraftWithSignature,
  resolveEmailSignatureForMessage,
} from "@/lib/email/email-signature-runtime";
import type {
  EmailProviderInterface,
  NormalizedDraft,
} from "@/lib/api/services/email-provider";
import type { InboxDraftRow, InboxScope } from "@/lib/types/email-thread";
import { DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT } from "@/lib/email/opportunity-lifecycle-evaluator";
import {
  buildEmailThreadListAuthorizationFilter,
  resolveEmailInboxListAccess,
  resolveEmailOpportunityAccess,
  type AllowedEmailInboxListAccess,
} from "@/lib/email/email-opportunity-access";
import {
  resolveEmailRouteActor,
  type EmailRouteActor,
} from "@/lib/email/email-route-auth";
import { canUseEmailMailboxForSend } from "@/lib/email/server-mailbox-access";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmailProviderMutationFingerprint,
  createEmailProviderMutationAttemptService,
  isEmailProviderMutationReconciliationRequiredError,
} from "@/lib/api/services/email-provider-mutation-attempt-service";

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseScope(raw: string | null): InboxScope {
  return raw === "company" ? "company" : "own";
}

const LOCAL_FOLLOW_UP_DRAFT_ORIGINS = [
  "template_follow_up",
  "phase_c",
  "system_handoff",
] as const;

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function threadMapKey(
  connectionId: string | null,
  providerThreadId: string | null
) {
  return `${connectionId ?? ""}:${providerThreadId ?? ""}`;
}

async function findInternalThreadId({
  supabase,
  companyId,
  connectionId,
  providerThreadId,
}: {
  supabase: SupabaseClient;
  companyId: string;
  connectionId: string;
  providerThreadId: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("email_threads")
    .select("id")
    .eq("company_id", companyId)
    .eq("connection_id", connectionId)
    .eq("provider_thread_id", providerThreadId)
    .maybeSingle();
  if (error) return null;
  return nonEmptyText(data?.id);
}

async function canReadDraftContext({
  actor,
  listAccess,
  supabase,
  connectionId,
  providerThreadId,
  opportunityId,
}: {
  actor: EmailRouteActor;
  listAccess: AllowedEmailInboxListAccess;
  supabase: SupabaseClient;
  connectionId: string | null;
  providerThreadId: string | null;
  opportunityId: string | null;
}): Promise<boolean> {
  if (!connectionId) return false;

  if (providerThreadId) {
    const internalThreadId = await findInternalThreadId({
      supabase,
      companyId: actor.companyId,
      connectionId,
      providerThreadId,
    });
    if (internalThreadId) {
      const access = await resolveEmailOpportunityAccess({
        actor,
        operation: "read",
        threadId: internalThreadId,
        connectionId,
        providerThreadId,
        ...(opportunityId ? { opportunityId } : {}),
        supabase,
      });
      return access.allowed;
    }
  }

  if (opportunityId) {
    const access = await resolveEmailOpportunityAccess({
      actor,
      operation: "read",
      connectionId,
      opportunityId,
      supabase,
    });
    return access.allowed;
  }

  return (
    listAccess.inboxScope === "all" ||
    listAccess.ownPersonalConnectionIds.includes(connectionId)
  );
}

async function canMutateDraftContext({
  actor,
  supabase,
  connectionId,
  providerThreadId,
  opportunityId,
  requireCanonicalProviderThread = false,
}: {
  actor: EmailRouteActor;
  supabase: SupabaseClient;
  connectionId: string;
  providerThreadId?: string | null;
  opportunityId?: string | null;
  requireCanonicalProviderThread?: boolean;
}): Promise<boolean> {
  if (providerThreadId) {
    const internalThreadId = await findInternalThreadId({
      supabase,
      companyId: actor.companyId,
      connectionId,
      providerThreadId,
    });
    if (internalThreadId) {
      const access = await resolveEmailOpportunityAccess({
        actor,
        operation: "send",
        threadId: internalThreadId,
        connectionId,
        providerThreadId,
        ...(opportunityId ? { opportunityId } : {}),
        supabase,
      });
      return access.allowed;
    }
    if (requireCanonicalProviderThread) return false;
  }

  if (opportunityId) {
    const access = await resolveEmailOpportunityAccess({
      actor,
      operation: "send",
      connectionId,
      opportunityId,
      supabase,
    });
    return access.allowed;
  }

  const canSendUnlinked = await checkPermissionById(
    actor.userId,
    "inbox.send",
    "all"
  );
  if (!canSendUnlinked) return false;
  const { data: connection, error } = await supabase
    .from("email_connections")
    .select("id, type, user_id, status")
    .eq("id", connectionId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  return Boolean(
    !error &&
    connection &&
    canUseEmailMailboxForSend(
      connection as {
        id: string;
        type: "company" | "individual";
        user_id: string | null;
        status: string | null;
      },
      actor.userId
    )
  );
}

async function bindProviderDraftForMutation({
  actor,
  supabase,
  provider,
  connectionId,
  draftId,
  expectedProviderThreadId,
  checkpoint,
}: {
  actor: EmailRouteActor;
  supabase: SupabaseClient;
  provider: Pick<EmailProviderInterface, "getDraft">;
  connectionId: string;
  draftId: string;
  expectedProviderThreadId?: string | null;
  checkpoint: EmailProviderMailboxCheckpoint;
}): Promise<{ providerThreadId: string | null } | null> {
  const existingProviderDraft = await provider.getDraft(draftId);
  await checkpoint();

  const actualProviderThreadId = nonEmptyText(existingProviderDraft?.threadId);
  const expectedThreadId = nonEmptyText(expectedProviderThreadId);
  if (
    !existingProviderDraft ||
    existingProviderDraft.id !== draftId ||
    (expectedThreadId && actualProviderThreadId !== expectedThreadId)
  ) {
    return null;
  }

  const contextAuthorized = await canMutateDraftContext({
    actor,
    supabase,
    connectionId,
    providerThreadId: actualProviderThreadId,
    requireCanonicalProviderThread: Boolean(expectedThreadId),
  });
  return contextAuthorized
    ? { providerThreadId: actualProviderThreadId }
    : null;
}

// ─── GET — list merged drafts ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const { userId, companyId } = actor;

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get("scope"));

  const supabase = getServiceRoleClient();
  const listAccess = await resolveEmailInboxListAccess({ actor, supabase });
  if (!listAccess.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const draftAuthorizationFilter =
    buildEmailThreadListAuthorizationFilter(listAccess);
  if (draftAuthorizationFilter.empty) {
    return NextResponse.json({ drafts: [] });
  }

  // ── Collect the in-scope email connections ───────────────────────────────
  // scope=own filters to connections owned by the caller plus company-type
  // mailboxes they can see (matches the threads list scope semantics).
  const allConnections = await runWithSupabase(supabase, () =>
    EmailService.getConnections(companyId)
  );
  const connectionById = new Map(
    allConnections.map((connection) => [connection.id, connection])
  );
  const connections = allConnections.filter((c) => {
    if (c.status !== "active") return false; // skip revoked / needs-reconnect
    if (listAccess.inboxScope === "all") {
      if (scope === "company") return true;
      return c.type === "company" || c.userId === userId;
    }
    if (listAccess.inboxScope === "assigned") {
      return c.type === "company" || c.userId === userId;
    }
    return c.type === "individual" && c.userId === userId;
  });

  // ── Fetch provider drafts in parallel, per connection ────────────────────
  // Each mailbox is isolated: an expired token on one must not take down
  // the whole list. We swallow per-connection errors and log, same pattern
  // as the threads-list endpoint.
  const providerBatches = await Promise.all(
    connections.map(async (conn) => {
      try {
        const locked = await runWithEmailConnectionSyncLock({
          connectionId: conn.id,
          context: "inbox-drafts-list",
          client: supabase,
          run: (checkpoint) =>
            runWithSupabase(supabase, async () => {
              const provider = EmailService.getProvider(conn);
              const drafts = await provider.listDrafts();
              const signature = await resolveEmailSignatureForMessage({
                supabase,
                connection: conn,
                userId,
                providerLockCheckpoint: checkpoint,
              });
              const knownSignatures = await loadKnownEmailSignaturesForMessage({
                connection: conn,
              });
              return drafts.map<InboxDraftRow>((d: NormalizedDraft) => ({
                source: "provider",
                id: d.id,
                threadId: d.threadId,
                connectionId: conn.id,
                fromEmail: conn.email,
                to: d.to,
                cc: d.cc,
                subject: d.subject,
                bodyText: normalizeMailboxDraftAuthoredBody(
                  d.bodyText,
                  signature,
                  knownSignatures
                ),
                updatedAt: d.updatedAt.toISOString(),
              }));
            }),
        });
        return locked.acquired ? locked.value : [];
      } catch (err) {
        console.error(
          `[/api/inbox/drafts] listDrafts failed for connection ${conn.id}:`,
          err
        );
        return [] as InboxDraftRow[];
      }
    })
  );
  const providerDraftCandidates = providerBatches.flat();
  const providerDrafts = (
    await Promise.all(
      providerDraftCandidates.map(async (draft) => ({
        draft,
        allowed: await canReadDraftContext({
          actor,
          listAccess,
          supabase,
          connectionId: draft.connectionId,
          providerThreadId: draft.threadId,
          opportunityId: null,
        }),
      }))
    )
  )
    .filter((entry) => entry.allowed)
    .map((entry) => entry.draft);

  // ── Fetch OPS AI drafts (status='drafted') ──────────────────────────────
  // Scope=own → only this user's drafts; scope=company → every user in the
  // company. Matches the "is this actionable for me right now" mental model.
  //
  // Migration 040 declared `updated_at` on ai_draft_history but production
  // only has `created_at` — the column was dropped (or the migration never
  // fully applied). We sort + project by created_at and surface it as
  // `updatedAt` on the wire; the row is effectively immutable after creation
  // anyway (edits produce a new row via the learning pipeline, not an
  // in-place update), so created_at is the authoritative "last touched" time.
  let aiQuery = supabase
    .from("ai_draft_history")
    .select(
      "id, user_id, connection_id, thread_id, opportunity_id, subject, original_draft, final_version, created_at"
    )
    .eq("company_id", companyId)
    .eq("status", "drafted")
    .order("created_at", { ascending: false })
    .limit(200);

  if (draftAuthorizationFilter.connectionIds) {
    aiQuery = aiQuery.in(
      "connection_id",
      draftAuthorizationFilter.connectionIds
    );
  }
  if (draftAuthorizationFilter.unlinkedOnly) {
    aiQuery = aiQuery.is("opportunity_id", null);
  }
  if (draftAuthorizationFilter.or) {
    aiQuery = aiQuery.or(draftAuthorizationFilter.or);
  }

  if (scope === "own" && listAccess.inboxScope !== "assigned") {
    aiQuery = aiQuery.eq("user_id", userId);
  }

  const { data: aiRows, error: aiErr } = await aiQuery;
  if (aiErr) {
    console.error("[/api/inbox/drafts] ai_draft_history query failed:", aiErr);
  }

  // Recipient fields still come from thread context. Subject is durable draft
  // provenance and must round-trip so edits can be compared against the exact
  // suggestion the operator saw.
  const authorizedAiRows = (
    await Promise.all(
      (aiRows ?? []).map(async (row) => ({
        row,
        allowed: await canReadDraftContext({
          actor,
          listAccess,
          supabase,
          connectionId: nonEmptyText(row.connection_id),
          providerThreadId: nonEmptyText(row.thread_id),
          opportunityId: nonEmptyText(row.opportunity_id),
        }),
      }))
    )
  )
    .filter((entry) => entry.allowed)
    .map((entry) => entry.row);

  const aiDrafts: InboxDraftRow[] = authorizedAiRows.map((r) => {
    const conn = connectionById.get(r.connection_id as string) ?? null;
    return {
      source: "ai",
      id: r.id as string,
      threadId: (r.thread_id as string) || null,
      connectionId: (r.connection_id as string) || null,
      fromEmail: conn?.email ?? "",
      to: [],
      cc: [],
      subject: nonEmptyText(r.subject) ?? "",
      bodyText: (
        (r.final_version as string) ||
        (r.original_draft as string) ||
        ""
      ).trim(),
      updatedAt: (r.created_at as string) ?? new Date().toISOString(),
    };
  });

  // ── Fetch local lifecycle drafts ────────────────────────────────────────
  // P5 lifecycle drafts deliberately stay local until an operator edits/sends
  // through the inbox. They must not create or update provider draft rows.
  // P4-C: surface phase_c auto-drafts alongside template_follow_up drafts.
  // Both are local lifecycle drafts the operator reviews in the inbox; phase_c
  // rows carry an ai_draft_history_id bridge to their generated provenance.
  let lifecycleQuery = supabase
    .from("opportunity_follow_up_drafts")
    .select(
      "id, opportunity_id, connection_id, provider_thread_id, recipient_email, recipient_name, source_event_id, origin, subject, original_body, current_body, edited_at, updated_at, created_at"
    )
    .eq("company_id", companyId)
    .in("origin", [...LOCAL_FOLLOW_UP_DRAFT_ORIGINS])
    .eq("status", "drafted")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (draftAuthorizationFilter.connectionIds) {
    lifecycleQuery = lifecycleQuery.in(
      "connection_id",
      draftAuthorizationFilter.connectionIds
    );
  }
  if (draftAuthorizationFilter.unlinkedOnly) {
    lifecycleQuery = lifecycleQuery.is("opportunity_id", null);
  }
  if (draftAuthorizationFilter.or) {
    lifecycleQuery = lifecycleQuery.or(draftAuthorizationFilter.or);
  }

  const { data: lifecycleRows, error: lifecycleErr } = await lifecycleQuery;
  if (lifecycleErr) {
    console.error(
      "[/api/inbox/drafts] opportunity_follow_up_drafts query failed:",
      lifecycleErr
    );
  }

  const scopedLifecycleRows = (
    await Promise.all(
      (lifecycleRows ?? []).map(async (row) => ({
        row,
        allowed: await canReadDraftContext({
          actor,
          listAccess,
          supabase,
          connectionId: nonEmptyText(row.connection_id),
          providerThreadId: nonEmptyText(row.provider_thread_id),
          opportunityId: nonEmptyText(row.opportunity_id),
        }),
      }))
    )
  )
    .filter((entry) => entry.allowed)
    .map((entry) => entry.row);
  const sourceEventIds = Array.from(
    new Set(
      scopedLifecycleRows
        .map((row) => nonEmptyText(row.source_event_id))
        .filter((value): value is string => value !== null)
    )
  );
  const sourceEventById = new Map<
    string,
    {
      connectionId: string | null;
      providerThreadId: string | null;
      providerMessageId: string | null;
    }
  >();
  if (sourceEventIds.length > 0) {
    const { data: sourceEventRows, error: sourceEventErr } = await supabase
      .from("opportunity_correspondence_events")
      .select("id, connection_id, provider_thread_id, provider_message_id")
      .eq("company_id", companyId)
      .in("id", sourceEventIds);
    if (sourceEventErr) {
      console.error(
        "[/api/inbox/drafts] opportunity_correspondence_events query failed:",
        sourceEventErr
      );
    } else {
      for (const row of sourceEventRows ?? []) {
        const id = nonEmptyText(row.id);
        if (!id) continue;
        sourceEventById.set(id, {
          connectionId: nonEmptyText(row.connection_id),
          providerThreadId: nonEmptyText(row.provider_thread_id),
          providerMessageId: nonEmptyText(row.provider_message_id),
        });
      }
    }
  }
  const providerThreadIds = Array.from(
    new Set(
      [
        ...scopedLifecycleRows.map((row) =>
          nonEmptyText(row.provider_thread_id)
        ),
        ...Array.from(sourceEventById.values()).map(
          (event) => event.providerThreadId
        ),
      ].filter((value): value is string => value !== null)
    )
  );

  const threadByProvider = new Map<string, string>();
  if (providerThreadIds.length > 0) {
    const { data: threadRows, error: threadErr } = await supabase
      .from("email_threads")
      .select("id, connection_id, provider_thread_id")
      .eq("company_id", companyId)
      .in("provider_thread_id", providerThreadIds);
    if (threadErr) {
      console.error(
        "[/api/inbox/drafts] email_threads query failed:",
        threadErr
      );
    } else {
      for (const row of threadRows ?? []) {
        const providerThreadId = nonEmptyText(row.provider_thread_id);
        const connectionId = nonEmptyText(row.connection_id);
        const id = nonEmptyText(row.id);
        if (providerThreadId && id) {
          threadByProvider.set(
            threadMapKey(connectionId, providerThreadId),
            id
          );
        }
      }
    }
  }

  const lifecycleDrafts: InboxDraftRow[] = scopedLifecycleRows.map((row) => {
    const connectionId = nonEmptyText(row.connection_id);
    const providerThreadId = nonEmptyText(row.provider_thread_id);
    const sourceEventId = nonEmptyText(row.source_event_id);
    const sourceEvent = sourceEventId
      ? (sourceEventById.get(sourceEventId) ?? null)
      : null;
    const navigationConnectionId = sourceEvent?.connectionId ?? connectionId;
    const navigationProviderThreadId =
      providerThreadId ?? sourceEvent?.providerThreadId ?? null;
    const recipientEmail =
      nonEmptyText(row.recipient_email)?.toLowerCase() ?? null;
    const conn = connectionId ? connectionById.get(connectionId) : null;
    return {
      source: "lifecycle",
      id: row.id as string,
      threadId: providerThreadId,
      inboxThreadId:
        threadByProvider.get(
          threadMapKey(navigationConnectionId, navigationProviderThreadId)
        ) ?? null,
      opportunityId: nonEmptyText(row.opportunity_id),
      origin: nonEmptyText(row.origin) as InboxDraftRow["origin"],
      recipientEmail,
      recipientName: nonEmptyText(row.recipient_name),
      sourceEventId,
      sourceProviderMessageId: sourceEvent?.providerMessageId ?? null,
      connectionId,
      fromEmail: conn?.email ?? "",
      to: recipientEmail ? [recipientEmail] : [],
      cc: [],
      subject: nonEmptyText(row.subject) ?? DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
      bodyText:
        nonEmptyText(row.current_body) ?? nonEmptyText(row.original_body) ?? "",
      updatedAt:
        nonEmptyText(row.edited_at) ??
        nonEmptyText(row.updated_at) ??
        nonEmptyText(row.created_at) ??
        new Date().toISOString(),
    };
  });

  // ── Merge + dedupe ───────────────────────────────────────────────────────
  // Dedupe by threadId: for each thread with competing AI + provider drafts,
  // render whichever was edited most recently. Previously AI unconditionally
  // won, which hid the user's direct edits in Gmail/Outlook. The losing row
  // stays in the DB (the AI learning pipeline still reads discarded + stale
  // AI drafts) — we just don't render it. Standalones (threadId=null) are
  // always kept, on both sides.
  const aiByThread = new Map<string, InboxDraftRow>();
  for (const d of aiDrafts) {
    if (d.threadId) aiByThread.set(d.threadId, d);
  }
  const providerByThread = new Map<string, InboxDraftRow>();
  for (const d of providerDrafts) {
    if (d.threadId) providerByThread.set(d.threadId, d);
  }
  const contestedThreads = new Set<string>([
    ...aiByThread.keys(),
    ...providerByThread.keys(),
  ]);

  const kept: InboxDraftRow[] = [];
  // Standalones — always keep.
  for (const d of aiDrafts) if (!d.threadId) kept.push(d);
  for (const d of providerDrafts) if (!d.threadId) kept.push(d);
  // Lifecycle drafts are local operator work and must not be hidden by
  // provider/Phase C dedupe. They are independently editable/discardable.
  for (const d of lifecycleDrafts) kept.push(d);
  // Per-thread: newer updatedAt wins. If only one side has a row, it wins
  // trivially.
  for (const tid of contestedThreads) {
    const ai = aiByThread.get(tid);
    const prov = providerByThread.get(tid);
    if (ai && prov) {
      const aiTs = new Date(ai.updatedAt).getTime();
      const provTs = new Date(prov.updatedAt).getTime();
      kept.push(provTs > aiTs ? prov : ai);
    } else if (ai) {
      kept.push(ai);
    } else if (prov) {
      kept.push(prov);
    }
  }

  // Sort newest-first by updatedAt.
  kept.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return NextResponse.json({ drafts: kept });
}

// ─── POST — create or update a provider draft ───────────────────────────────
//
// Body shape:
//   {
//     connectionId: string,    // mailbox the draft should land in
//     to: string,              // recipient (bare addr or RFC 5322 mailbox)
//     subject: string,
//     body: string,
//     providerThreadId?: string, // pin reply-drafts to a conversation
//     draftId?: string,        // present → updateDraft; absent → createDraft
//   }
//
// Returns: { ok: true, draftId, source: "provider" } — caller stores the
// draftId locally so subsequent saves PATCH the same row instead of creating
// duplicates.
//
// Permission gate: `inbox.view` (anyone who can see the inbox can stash a
// draft into their own provider). The connection's company_id is verified
// against the caller's company.

interface SaveDraftBody {
  source?: "provider" | "lifecycle";
  connectionId?: string;
  to?: string;
  subject?: string;
  body?: string;
  providerThreadId?: string | null;
  draftId?: string | null;
  idempotencyKey?: string | null;
}

export async function POST(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const { userId, companyId } = actor;

  const payload = (await request
    .json()
    .catch(() => null)) as SaveDraftBody | null;
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    connectionId,
    to,
    subject,
    body,
    providerThreadId,
    draftId,
    idempotencyKey,
    source,
  } = payload;

  if (source === "lifecycle") {
    if (!draftId || typeof draftId !== "string") {
      return NextResponse.json(
        { error: "draftId is required for lifecycle drafts" },
        { status: 400 }
      );
    }
    if (typeof body !== "string") {
      return NextResponse.json(
        { error: "body is required for lifecycle drafts" },
        { status: 400 }
      );
    }

    // P4-C: phase_c auto-drafts are editable through the same path as
    // template_follow_up drafts — both are local lifecycle drafts.
    const supabase = getServiceRoleClient();
    const { data: existing, error: existingErr } = await supabase
      .from("opportunity_follow_up_drafts")
      .select("id, opportunity_id, connection_id, provider_thread_id")
      .eq("id", draftId)
      .eq("company_id", companyId)
      .in("origin", [...LOCAL_FOLLOW_UP_DRAFT_ORIGINS])
      .eq("status", "drafted")
      .single();
    if (existingErr || !existing) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    const lifecycleConnectionId = nonEmptyText(existing.connection_id);
    if (
      !lifecycleConnectionId ||
      !(await canMutateDraftContext({
        actor,
        supabase,
        connectionId: lifecycleConnectionId,
        providerThreadId: nonEmptyText(existing.provider_thread_id),
        opportunityId: nonEmptyText(existing.opportunity_id),
      }))
    ) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("opportunity_follow_up_drafts")
      .update({
        subject: nonEmptyText(subject) ?? DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
        current_body: body,
        edited_by: userId,
        edited_at: now,
        updated_at: now,
      })
      .eq("id", draftId)
      .eq("company_id", companyId)
      .in("origin", [...LOCAL_FOLLOW_UP_DRAFT_ORIGINS])
      .eq("status", "drafted");

    if (error) {
      console.error("[/api/inbox/drafts] lifecycle save failed:", error);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      draftId,
      source: "lifecycle" as const,
    });
  }

  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }
  if (
    typeof to !== "string" ||
    typeof subject !== "string" ||
    typeof body !== "string"
  ) {
    return NextResponse.json(
      { error: "to, subject, and body are required strings" },
      { status: 400 }
    );
  }
  const durableOperationKey = nonEmptyText(idempotencyKey);
  if (!draftId && (!durableOperationKey || durableOperationKey.length > 180)) {
    return NextResponse.json(
      {
        error:
          "A stable draft key is required before creating a mailbox draft.",
        code: "EMAIL_DRAFT_IDEMPOTENCY_KEY_REQUIRED",
      },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const conn = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );
  if (!conn) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  if (conn.companyId !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canMutate = await canMutateDraftContext({
    actor,
    supabase,
    connectionId,
    providerThreadId,
    requireCanonicalProviderThread: Boolean(providerThreadId),
  });
  if (!canMutate) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const authorizeDraftProviderMutation = () =>
    canMutateDraftContext({
      actor,
      supabase,
      connectionId,
      providerThreadId,
      requireCanonicalProviderThread: Boolean(providerThreadId),
    });

  try {
    const savedDraftId = await runEmailProviderMailboxOperation({
      supabase,
      connectionId,
      context: "inbox-draft-save",
      busyError: "EMAIL_DRAFT_MAILBOX_BUSY",
      run: async (checkpoint) => {
        const provider = EmailService.getProvider(conn);
        const signature = await resolveEmailSignatureForMessage({
          supabase,
          connection: conn,
          userId,
          providerLockCheckpoint: checkpoint,
        });
        if (!signature) {
          throw new Error("EMAIL_SIGNATURE_REQUIRED");
        }
        const knownSignatures = await loadKnownEmailSignaturesForMessage({
          connection: conn,
        });
        const rendered = renderMailboxDraftWithSignature(
          body,
          signature,
          knownSignatures
        );
        await checkpoint();
        if (draftId) {
          const binding = await bindProviderDraftForMutation({
            actor,
            supabase,
            provider,
            connectionId,
            draftId,
            expectedProviderThreadId: providerThreadId,
            checkpoint,
          });
          if (!binding) {
            throw new Error("EMAIL_DRAFT_AUTHORIZATION_REVOKED");
          }
          await provider.updateDraft(
            draftId,
            to,
            subject,
            rendered.body,
            binding.providerThreadId ?? undefined,
            rendered.contentType
          );
          return draftId;
        }
        const mutationService =
          createEmailProviderMutationAttemptService(supabase);
        let createdThisInvocation = false;
        const completed = await mutationService.execute({
          actorUserId: userId,
          connectionId,
          operationKind: "draft_create",
          operationKey: `inbox-composer:${durableOperationKey}`,
          requestFingerprint: buildEmailProviderMutationFingerprint({
            version: 1,
            connectionId,
            providerThreadId: providerThreadId ?? null,
            to: to.trim().toLowerCase(),
          }),
          assertMailboxLease: () => checkpoint(true),
          executeProvider: async () => {
            await checkpoint();
            if (!(await authorizeDraftProviderMutation())) {
              throw new Error("EMAIL_DRAFT_AUTHORIZATION_REVOKED");
            }
            const providerDraftId = await provider.createDraft(
              to,
              subject,
              rendered.body,
              providerThreadId ?? undefined,
              rendered.contentType
            );
            createdThisInvocation = true;
            return {
              resourceId: providerDraftId,
              result: { draftId: providerDraftId },
            };
          },
          reconcile: async (acceptance) => {
            if (createdThisInvocation) return;
            // A lost response may leave the browser without the accepted id.
            // Reconcile only by updating that exact durable provider draft.
            await checkpoint();
            const binding = await bindProviderDraftForMutation({
              actor,
              supabase,
              provider,
              connectionId,
              draftId: acceptance.resourceId,
              expectedProviderThreadId: providerThreadId,
              checkpoint,
            });
            if (!binding) {
              throw new Error("EMAIL_DRAFT_AUTHORIZATION_REVOKED");
            }
            await provider.updateDraft(
              acceptance.resourceId,
              to,
              subject,
              rendered.body,
              binding.providerThreadId ?? undefined,
              rendered.contentType
            );
            await checkpoint();
          },
        });
        if (!completed.providerResourceId) {
          throw new Error("EMAIL_DRAFT_PROVIDER_IDENTITY_MISSING");
        }
        return completed.providerResourceId;
      },
    });
    return NextResponse.json({
      ok: true,
      draftId: savedDraftId,
      source: "provider" as const,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === "EMAIL_DRAFT_AUTHORIZATION_REVOKED"
    ) {
      return NextResponse.json(
        {
          error: "Draft access changed. Refresh before trying again.",
          code: err.message,
        },
        { status: 404 }
      );
    }
    if (isEmailProviderMutationReconciliationRequiredError(err)) {
      return NextResponse.json(
        {
          error: "Draft placement needs review. Check Drafts before retrying.",
          code: err.code,
        },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === "EMAIL_SIGNATURE_REQUIRED") {
      return NextResponse.json(
        {
          error: "Create an email signature before saving mailbox drafts.",
          code: "EMAIL_SIGNATURE_REQUIRED",
        },
        { status: 409 }
      );
    }
    if (isEmailProviderMailboxBusyError(err)) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again.", code: err.code },
        { status: 409 }
      );
    }
    if (isEmailProviderMailboxLeaseError(err)) {
      return NextResponse.json(
        { error: "Mailbox operation interrupted. Try again.", code: err.code },
        { status: 503 }
      );
    }
    console.error("[/api/inbox/drafts] save failed:", err);
    return NextResponse.json(
      { error: `Save failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

// ─── DELETE — discard a draft ────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const { userId, companyId } = actor;

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const id = searchParams.get("id");
  const connectionId = searchParams.get("connectionId");

  if (
    !id ||
    (source !== "provider" && source !== "ai" && source !== "lifecycle")
  ) {
    return NextResponse.json(
      { error: "Missing or invalid source/id" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();

  if (source === "lifecycle") {
    // P4-C: phase_c auto-drafts are discardable through the same path as
    // template_follow_up drafts.
    const { data: row, error } = await supabase
      .from("opportunity_follow_up_drafts")
      .select(
        "id, company_id, opportunity_id, connection_id, provider_thread_id"
      )
      .eq("id", id)
      .in("origin", [...LOCAL_FOLLOW_UP_DRAFT_ORIGINS])
      .eq("status", "drafted")
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (row.company_id !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const lifecycleConnectionId = nonEmptyText(row.connection_id);
    if (
      !lifecycleConnectionId ||
      !(await canMutateDraftContext({
        actor,
        supabase,
        connectionId: lifecycleConnectionId,
        providerThreadId: nonEmptyText(row.provider_thread_id),
        opportunityId: nonEmptyText(row.opportunity_id),
      }))
    ) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("opportunity_follow_up_drafts")
      .update({
        status: "discarded",
        discarded_at: now,
        edited_by: userId,
        edited_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .in("origin", [...LOCAL_FOLLOW_UP_DRAFT_ORIGINS])
      .eq("status", "drafted");
    if (updErr) {
      console.error("[/api/inbox/drafts] lifecycle discard failed:", updErr);
      return NextResponse.json({ error: "Discard failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (source === "ai") {
    // Scope check — the row must belong to the caller's company.
    const { data: row, error } = await supabase
      .from("ai_draft_history")
      .select("id, company_id, opportunity_id, connection_id, thread_id")
      .eq("id", id)
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (row.company_id !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const aiConnectionId = nonEmptyText(row.connection_id);
    if (
      !aiConnectionId ||
      !(await canMutateDraftContext({
        actor,
        supabase,
        connectionId: aiConnectionId,
        providerThreadId: nonEmptyText(row.thread_id),
        opportunityId: nonEmptyText(row.opportunity_id),
      }))
    ) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // P4-B: stamp discarded_at now that the column exists. (`updated_at`
    // still doesn't exist on this table — see GET path note — but the
    // dedicated discard timestamp is now first-class provenance.)
    const { error: updErr } = await supabase
      .from("ai_draft_history")
      .update({ status: "discarded", discarded_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) {
      console.error("[/api/inbox/drafts] ai discard failed:", updErr);
      return NextResponse.json({ error: "Discard failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // source === "provider": need the connection to route to the right provider.
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId required for provider drafts" },
      { status: 400 }
    );
  }

  const conn = await runWithSupabase(supabase, () =>
    EmailService.getConnection(connectionId)
  );
  if (!conn) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }
  if (conn.companyId !== companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (
    !(await canMutateDraftContext({
      actor,
      supabase,
      connectionId,
    }))
  ) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  try {
    await runEmailProviderMailboxOperation({
      supabase,
      connectionId,
      context: "inbox-draft-delete",
      busyError: "EMAIL_DRAFT_MAILBOX_BUSY",
      run: async (checkpoint) => {
        const provider = EmailService.getProvider(conn);
        const binding = await bindProviderDraftForMutation({
          actor,
          supabase,
          provider,
          connectionId,
          draftId: id,
          checkpoint,
        });
        if (!binding) {
          throw new Error("EMAIL_DRAFT_AUTHORIZATION_REVOKED");
        }
        await provider.deleteDraft(id);
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === "EMAIL_DRAFT_AUTHORIZATION_REVOKED"
    ) {
      return NextResponse.json(
        {
          error: "Draft access changed. Refresh before trying again.",
          code: err.message,
        },
        { status: 404 }
      );
    }
    if (isEmailProviderMailboxBusyError(err)) {
      return NextResponse.json(
        { error: "Mailbox is busy. Try again.", code: err.code },
        { status: 409 }
      );
    }
    if (isEmailProviderMailboxLeaseError(err)) {
      return NextResponse.json(
        { error: "Mailbox operation interrupted. Try again.", code: err.code },
        { status: 503 }
      );
    }
    console.error("[/api/inbox/drafts] provider discard failed:", err);
    return NextResponse.json(
      { error: `Discard failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

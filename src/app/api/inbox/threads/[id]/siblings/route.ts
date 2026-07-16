import { NextRequest, NextResponse } from "next/server";

import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import {
  resolveEmailInboxListAccess,
  resolveEmailOpportunityAccess,
} from "@/lib/email/email-opportunity-access";
import { resolveEmailRouteActor } from "@/lib/email/email-route-auth";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const THREAD_PICKER_LIMIT = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const actorResolution = await resolveEmailRouteActor(request);
  if (!actorResolution.ok) return actorResolution.response;
  const { actor } = actorResolution;
  const supabase = getServiceRoleClient();

  const anchorAccess = await resolveEmailOpportunityAccess({
    actor,
    operation: "read",
    threadId: id,
    supabase,
  });
  if (!anchorAccess.allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const listAccess = await resolveEmailInboxListAccess({ actor, supabase });
  if (!listAccess.allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const anchor = await runWithSupabase(supabase, () =>
    EmailThreadService.getThread(id, actor.companyId)
  );
  if (
    anchor &&
    (anchor.id !== anchorAccess.threadId ||
      anchor.connectionId !== anchorAccess.connectionId ||
      anchor.providerThreadId !== anchorAccess.providerThreadId ||
      anchor.opportunityId !== anchorAccess.opportunityId)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!anchor?.clientId) {
    return NextResponse.json({ threads: [] });
  }

  const candidates = await runWithSupabase(supabase, () =>
    EmailThreadService.listSiblings(
      actor.companyId,
      anchor.clientId as string,
      anchor.id,
      listAccess,
      THREAD_PICKER_LIMIT
    )
  );
  const authorized = await Promise.all(
    candidates.map(async (thread) => ({
      thread,
      access: await resolveEmailOpportunityAccess({
        actor,
        operation: "read",
        threadId: thread.id,
        supabase,
      }),
    }))
  );

  return NextResponse.json({
    threads: authorized
      .filter(
        (entry) =>
          entry.access.allowed &&
          entry.thread.id === entry.access.threadId &&
          entry.thread.connectionId === entry.access.connectionId &&
          entry.thread.providerThreadId === entry.access.providerThreadId &&
          entry.thread.opportunityId === entry.access.opportunityId
      )
      .map(({ thread }) => ({
        id: thread.id,
        subject: thread.subject,
        labels: thread.labels,
        unreadCount: thread.unreadCount,
        lastMessageAt: thread.lastMessageAt.toISOString(),
        latestDirection: thread.latestDirection,
        archivedAt: thread.archivedAt?.toISOString() ?? null,
      })),
  });
}

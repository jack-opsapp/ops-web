/**
 * GET /api/integrations/email/attachment?companyId=...&messageId=...&attachmentId=...
 *
 * Proxies Gmail/M365 attachment downloads. Returns the raw binary with correct
 * Content-Type so it can be used as an <img src="..."> directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { EmailService } from "@/lib/api/services/email-service";
import type { EmailConnection } from "@/lib/types/email-connection";

function mapFromDb(row: Record<string, unknown>): EmailConnection {
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

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const messageId = searchParams.get("messageId");
    const attachmentId = searchParams.get("attachmentId");
    const mimeType = searchParams.get("mimeType") || "image/jpeg";

    if (!companyId || !messageId || !attachmentId) {
      return NextResponse.json(
        { error: "companyId, messageId, and attachmentId are required" },
        { status: 400 }
      );
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user || (user.company_id as string) !== companyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const { data: connRows } = await supabase
      .from("email_connections")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("sync_enabled", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!connRows || connRows.length === 0) {
      return NextResponse.json({ error: "No email connection" }, { status: 404 });
    }

    const connection = mapFromDb(connRows[0]);
    const provider = EmailService.getProvider(connection);

    const buffer = await provider.fetchAttachment(messageId, attachmentId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=86400", // Cache 24h
      },
    });
  } catch (err) {
    console.error("Attachment fetch error:", err);
    return NextResponse.json(
      { error: `Failed to fetch attachment: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * Authenticated browser boundary for mailbox connection management.
 *
 * GET    /api/integrations/email/connection[?id=...]
 * PATCH  /api/integrations/email/connection
 * DELETE /api/integrations/email/connection?id=...
 *
 * Provider credentials never cross this route. Company mailbox mutations
 * require settings.integrations; an individual mailbox can only be managed
 * by its canonical OPS user_id owner.
 */

import { NextRequest, NextResponse } from "next/server";

import { EmailService } from "@/lib/api/services/email-service";
import { PersonalEmailConnectionLifecycleService } from "@/lib/api/services/personal-email-connection-lifecycle-service";
import {
  resolveEmailRouteActor,
  type EmailRouteActor,
} from "@/lib/email/email-route-auth";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { runWithSupabase } from "@/lib/supabase/helpers";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  BrowserUpdateEmailConnection,
  EmailConnection,
  EmailConnectionDescriptor,
  SyncProfile,
} from "@/lib/types/email-connection";

const ALLOWED_UPDATE_FIELDS = new Set<keyof BrowserUpdateEmailConnection>([
  "syncEnabled",
  "syncIntervalMinutes",
  "syncFilters",
  "aiReviewEnabled",
  "aiMemoryEnabled",
]);

function isSameCompany(
  actor: EmailRouteActor,
  connection: EmailConnection
): boolean {
  return connection.companyId === actor.companyId;
}

function canReadDescriptor(
  actor: EmailRouteActor,
  connection: EmailConnection
): boolean {
  if (!isSameCompany(actor, connection)) return false;
  if (connection.type === "company") return true;
  return connection.type === "individual" && connection.userId === actor.userId;
}

async function canManageConnection(
  actor: EmailRouteActor,
  connection: EmailConnection
): Promise<boolean> {
  if (!isSameCompany(actor, connection)) return false;
  if (connection.type === "individual") {
    return connection.userId === actor.userId;
  }
  if (connection.type !== "company") return false;
  return checkPermissionById(actor.userId, "settings.integrations");
}

function toDescriptor(
  connection: EmailConnection,
  includeConfiguration = true
): EmailConnectionDescriptor {
  return {
    id: connection.id,
    companyId: connection.companyId,
    provider: connection.provider,
    type: connection.type,
    userId: connection.userId,
    email: connection.email,
    syncEnabled: connection.syncEnabled,
    lastSyncedAt: connection.lastSyncedAt,
    syncIntervalMinutes: connection.syncIntervalMinutes,
    syncFilters: includeConfiguration ? connection.syncFilters : {},
    opsLabelId: includeConfiguration ? connection.opsLabelId : null,
    aiReviewEnabled: includeConfiguration ? connection.aiReviewEnabled : false,
    aiMemoryEnabled: includeConfiguration ? connection.aiMemoryEnabled : false,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUpdate(
  raw: unknown,
  existingFilters: SyncProfile
): BrowserUpdateEmailConnection | null {
  if (!isPlainObject(raw)) return null;
  const keys = Object.keys(raw);
  if (
    keys.length === 0 ||
    keys.some(
      (key) =>
        !ALLOWED_UPDATE_FIELDS.has(key as keyof BrowserUpdateEmailConnection)
    )
  ) {
    return null;
  }

  const update: BrowserUpdateEmailConnection = {};
  if (raw.syncEnabled !== undefined) {
    if (typeof raw.syncEnabled !== "boolean") return null;
    update.syncEnabled = raw.syncEnabled;
  }
  if (raw.syncIntervalMinutes !== undefined) {
    if (
      typeof raw.syncIntervalMinutes !== "number" ||
      !Number.isInteger(raw.syncIntervalMinutes) ||
      raw.syncIntervalMinutes < 1 ||
      raw.syncIntervalMinutes > 1440
    ) {
      return null;
    }
    update.syncIntervalMinutes = raw.syncIntervalMinutes;
  }
  if (raw.syncFilters !== undefined) {
    if (!isPlainObject(raw.syncFilters)) return null;
    update.syncFilters = {
      ...existingFilters,
      ...(raw.syncFilters as Partial<SyncProfile>),
    };
  }
  if (raw.aiReviewEnabled !== undefined) {
    if (typeof raw.aiReviewEnabled !== "boolean") return null;
    update.aiReviewEnabled = raw.aiReviewEnabled;
  }
  if (raw.aiMemoryEnabled !== undefined) {
    if (typeof raw.aiMemoryEnabled !== "boolean") return null;
    update.aiMemoryEnabled = raw.aiMemoryEnabled;
  }
  return update;
}

export async function GET(request: NextRequest) {
  const actorResult = await resolveEmailRouteActor(request);
  if (!actorResult.ok) return actorResult.response;
  const { actor } = actorResult;

  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      const id = request.nextUrl.searchParams.get("id");
      if (id) {
        const connection = await EmailService.getConnection(id);
        if (!connection) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (!canReadDescriptor(actor, connection)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const includeConfiguration =
          connection.type === "individual" ||
          (await checkPermissionById(actor.userId, "settings.integrations"));
        if (!includeConfiguration) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json(toDescriptor(connection));
      }

      const [connections, canManageCompany] = await Promise.all([
        EmailService.getConnections(actor.companyId),
        checkPermissionById(actor.userId, "settings.integrations"),
      ]);
      return NextResponse.json({
        connections: connections
          .filter((connection) => canReadDescriptor(actor, connection))
          .map((connection) =>
            toDescriptor(
              connection,
              connection.type === "individual" || canManageCompany
            )
          ),
      });
    } catch (error) {
      console.error("[email connection GET] Failed", error);
      return NextResponse.json(
        { error: "Failed to load connections" },
        { status: 500 }
      );
    }
  });
}

export async function PATCH(request: NextRequest) {
  const actorResult = await resolveEmailRouteActor(request);
  if (!actorResult.ok) return actorResult.response;
  const { actor } = actorResult;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isPlainObject(parsedBody)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = parsedBody;

  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      const existing = await EmailService.getConnection(connectionId);
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!(await canManageConnection(actor, existing))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const rawUpdate =
        body.data !== undefined
          ? body.data
          : body.syncFilters !== undefined
            ? { syncFilters: body.syncFilters }
            : null;
      const update = parseUpdate(rawUpdate, existing.syncFilters ?? {});
      if (!update) {
        return NextResponse.json(
          { error: "No supported update fields supplied" },
          { status: 400 }
        );
      }

      const updated = await EmailService.updateConnection(connectionId, update);
      return NextResponse.json({
        ok: true,
        connection: toDescriptor(updated),
      });
    } catch (error) {
      console.error("[email connection PATCH] Failed", error);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  });
}

export async function DELETE(request: NextRequest) {
  const actorResult = await resolveEmailRouteActor(request);
  if (!actorResult.ok) return actorResult.response;
  const { actor } = actorResult;

  const connectionId = request.nextUrl.searchParams.get("id")?.trim();
  if (!connectionId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  return runWithSupabase(supabase, async () => {
    try {
      const connection = await EmailService.getConnection(connectionId);
      if (!connection) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!(await canManageConnection(actor, connection))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (connection.type === "individual") {
        await PersonalEmailConnectionLifecycleService.disconnect(
          connection,
          supabase
        );
      } else {
        await EmailService.deleteConnection(connectionId);
      }
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[email connection DELETE] Failed", error);
      return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
    }
  });
}

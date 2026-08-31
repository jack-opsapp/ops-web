import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod-v4";

import {
  authenticateRequest,
  isErrorResponse,
} from "@/app/api/agent/_lib/auth";
import {
  DayCloseoutRoutineConfigStoreError,
  listDayCloseoutRoutineConfigs,
  upsertDayCloseoutRoutineConfig,
  type DayCloseoutRoutineConfigRpcClient,
} from "@/lib/agent-control-plane/services/day-closeout/day-closeout-routine-config";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });
const ALLOWED_METHODS = "GET, PUT";
const BodySchema = z
  .object({
    grantId: z.uuid(),
    enabled: z.boolean(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

function rpcClient(): DayCloseoutRoutineConfigRpcClient {
  return getServiceRoleClient() as unknown as DayCloseoutRoutineConfigRpcClient;
}

function responseError(
  status: number,
  error: "invalid_request" | "forbidden" | "server_error"
): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function authorize(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (isErrorResponse(auth)) return auth;
  const allowed = await checkPermissionById(
    auth.id,
    "settings.integrations",
    "all"
  );
  return allowed ? auth : responseError(403, "forbidden");
}

function storageError(operation: "list" | "upsert", error: unknown) {
  const forbidden =
    error instanceof DayCloseoutRoutineConfigStoreError &&
    error.kind === "forbidden";
  if (!forbidden) {
    console.error(
      `[day-closeout-routine-config] ${operation} failed`,
      error instanceof DayCloseoutRoutineConfigStoreError
        ? error.name
        : error instanceof Error
          ? error.name
          : "unknown"
    );
  }
  return responseError(
    forbidden ? 403 : 500,
    forbidden ? "forbidden" : "server_error"
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (isErrorResponse(auth)) return auth;

  try {
    const routines = await listDayCloseoutRoutineConfigs(rpcClient(), {
      actorUserId: auth.id,
      companyId: auth.companyId,
    });
    return NextResponse.json({ routines }, { headers: NO_STORE });
  } catch (error) {
    return storageError("list", error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (isErrorResponse(auth)) return auth;

  if (
    (request.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  ) {
    return responseError(400, "invalid_request");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return responseError(400, "invalid_request");
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return responseError(400, "invalid_request");

  try {
    const routine = await upsertDayCloseoutRoutineConfig(rpcClient(), {
      actorUserId: auth.id,
      companyId: auth.companyId,
      grantId: parsed.data.grantId,
      enabled: parsed.data.enabled,
      localTime: parsed.data.localTime,
    });
    return NextResponse.json({ routine }, { headers: NO_STORE });
  } catch (error) {
    return storageError("upsert", error);
  }
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: "method_not_allowed" },
    {
      status: 405,
      headers: { ...NO_STORE, Allow: ALLOWED_METHODS },
    }
  );
}

export const POST = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

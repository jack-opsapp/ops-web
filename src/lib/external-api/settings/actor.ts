import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";

export type ExternalApiSettingsActor = Readonly<{
  userId: string;
  companyId: string;
}>;

type ActorResult =
  | Readonly<{ actor: ExternalApiSettingsActor; response: null }>
  | Readonly<{ actor: null; response: NextResponse }>;

function denied(status: 401 | 403 | 404): ActorResult {
  const error =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : "Not found";
  return {
    actor: null,
    response: NextResponse.json({ error }, { status }),
  };
}

export async function requireExternalApiSettingsActor(
  request: NextRequest
): Promise<ActorResult> {
  const identity = await verifyAdminAuth(request);
  if (!identity?.uid) return denied(401);

  // Deliberately omit the verified email. This surface accepts only a
  // cryptographic UID link and never the legacy email fallback.
  let user: Record<string, unknown> | null;
  try {
    user = await findUserByAuth(
      identity.uid,
      undefined,
      "id, company_id, is_active, deleted_at"
    );
  } catch {
    return denied(403);
  }
  if (
    !user ||
    typeof user.id !== "string" ||
    typeof user.company_id !== "string" ||
    user.is_active !== true ||
    user.deleted_at != null
  ) {
    return denied(403);
  }

  let permitted = false;
  try {
    permitted = await checkPermissionById(
      user.id,
      "settings.integrations",
      "all"
    );
  } catch {
    return denied(403);
  }
  if (!permitted) return denied(403);

  try {
    const overrides = await AdminFeatureOverrideService.getOverrides(
      user.company_id
    );
    const enabled = overrides.some(
      (override) =>
        override.featureKey === "external_api" && override.enabled === true
    );
    if (!enabled) return denied(404);
  } catch {
    // A pilot-gate read must never turn an unavailable decision into access.
    return denied(404);
  }

  return {
    actor: Object.freeze({
      userId: user.id,
      companyId: user.company_id,
    }),
    response: null,
  };
}

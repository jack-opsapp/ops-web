import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveEmailRouteActor,
  type EmailRouteActor,
} from "@/lib/email/email-route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export type PhaseCCategorySettingsAccess =
  | { allowed: true; actor: EmailRouteActor }
  | { allowed: false; status: 401 | 403 | 500 };

export async function resolvePhaseCCategorySettingsAccess({
  request,
  claimedCompanyId,
  connectionId,
  supabase = getServiceRoleClient(),
}: {
  request: NextRequest;
  claimedCompanyId: string;
  connectionId: string;
  supabase?: SupabaseClient;
}): Promise<PhaseCCategorySettingsAccess> {
  const actorResolution = await resolveEmailRouteActor(request, {
    claimedCompanyId,
  });
  if (!actorResolution.ok) {
    return {
      allowed: false,
      status: actorResolution.response.status === 401 ? 401 : 403,
    };
  }

  const { data, error } = await supabase.rpc(
    "authorize_phase_c_category_settings_as_system",
    {
      p_actor_user_id: actorResolution.actor.userId,
      p_connection_id: connectionId,
    }
  );
  if (error) {
    console.error("[phase-c-category-settings] authorization failed", {
      actorUserId: actorResolution.actor.userId,
      connectionId,
      error,
    });
    return { allowed: false, status: 500 };
  }
  if (data !== true) return { allowed: false, status: 403 };

  return { allowed: true, actor: actorResolution.actor };
}

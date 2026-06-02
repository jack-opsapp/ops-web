/**
 * OPS Web - Inbox UI Server-Side Gate
 *
 * Resolves whether the current session's company has the inbox_ui flag
 * enabled. Runs server-side (Server Components / Layouts) — never import
 * from client code.
 *
 * Auth flow mirrors admin/layout.tsx:
 *   1. Read the Firebase / custom token from cookies.
 *   2. Verify it via verifyFirebaseToken (jose JWKS check).
 *   3. Look up the Supabase user → company_id via findUserByAuth.
 *   4. Query admin_feature_overrides via the service-role client.
 *
 * Returns false (fail-closed) if the token is missing, invalid, or the DB
 * call throws — the caller should redirect("/pipeline") on false.
 */

import { cookies } from "next/headers";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";

/**
 * Check whether the authenticated company has inbox_ui enabled.
 *
 * Fail-closed: any error (missing cookie, bad token, DB failure) → false.
 */
export async function isInboxUiEnabled(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token =
      cookieStore.get("ops-auth-token")?.value ||
      cookieStore.get("__session")?.value;

    if (!token) return false;

    const authUser = await verifyFirebaseToken(token);

    const user = await findUserByAuth(authUser.uid, authUser.email, "company_id");
    const companyId = user?.company_id as string | undefined;
    if (!companyId) return false;

    return await AdminFeatureOverrideService.isFeatureEnabled(companyId, "inbox_ui");
  } catch {
    return false;
  }
}

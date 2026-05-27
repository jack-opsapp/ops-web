/**
 * SPEC operator guard for server actions.
 *
 * The `/admin/spec/layout.tsx` enforces the operator gate before any page
 * renders. Server actions, however, can be invoked from anywhere — they
 * MUST re-check the gate independently before mutating any SPEC table.
 *
 * Re-check protocol:
 *  1. Resolve Firebase token from cookies (`__session` / `ops-auth-token`).
 *  2. Verify the token, derive the OPS user_id.
 *  3. Call `isSpecOperator(userId)` — the same TS mirror the layout uses.
 *  4. Return `{ userId }` on success or `null` on any failure.
 *
 * Failure modes intentionally return `null` (no granular error) — the caller
 * decides between throwing, redirecting, or responding 403. Never include
 * the failing reason in any response body that ships to the customer side
 * (mirror Stage D's existence-disclosure conservatism).
 */

import { cookies, headers } from "next/headers";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { isSpecOperator } from "@/lib/admin/spec-permissions";

export interface SpecOperatorContext {
  userId: string;
}

export async function requireSpecOperatorAction(): Promise<SpecOperatorContext | null> {
  try {
    const cookieStore = await cookies();
    const headersList = await headers();

    const token =
      headersList.get("authorization")?.replace("Bearer ", "") ||
      cookieStore.get("__session")?.value ||
      cookieStore.get("ops-auth-token")?.value;
    if (!token) return null;

    const fbUser = await verifyAuthToken(token);
    if (!fbUser.email) return null;

    const opsUser = await findUserByAuth(fbUser.uid, fbUser.email, "id");
    if (!opsUser || typeof opsUser.id !== "string") return null;

    const ok = await isSpecOperator(opsUser.id);
    if (!ok) return null;

    return { userId: opsUser.id };
  } catch (err) {
    console.error("[requireSpecOperatorAction] failed:", err);
    return null;
  }
}

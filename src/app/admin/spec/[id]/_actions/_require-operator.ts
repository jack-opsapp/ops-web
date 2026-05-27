/**
 * SPEC server-action operator gate.
 *
 * Every action under `/admin/spec/[id]/_actions/*` calls this BEFORE
 * mutating. The route layout already enforces the gate for the rendered page,
 * but server actions can be invoked by any logged-in user (the framework will
 * accept the form post regardless of the page they originated from). Re-checking
 * here closes that hole. Returns the operator's OPS `users.id` on success, or
 * `null` if the caller is not an operator — actions translate `null` into a
 * thrown `Error` with a tactical message.
 *
 * Mirrors the same source-of-truth as `src/app/admin/spec/layout.tsx` — Firebase
 * (or Supabase) JWT → OPS `users.id` → `isSpecOperator(userId)`.
 *
 * NEVER use `has_permission(...)` here. That helper short-circuits to true for
 * any customer-company admin via `is_company_admin / account_holder_id /
 * admin_ids`, which would let a customer admin fire milestone invoices on any
 * project they could URL-guess. The dedicated `isSpecOperator()` only consults
 * `role_permissions(spec.admin/all)` and `user_permission_overrides(spec.admin,
 * granted=true)`.
 */

import { cookies, headers } from "next/headers";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { isSpecOperator } from "@/lib/admin/spec-permissions";

export async function requireSpecOperatorUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const headersList = await headers();
  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value;
  if (!token) return null;
  try {
    const fbUser = await verifyAuthToken(token);
    if (!fbUser.email) return null;
    const opsUser = await findUserByAuth(fbUser.uid, fbUser.email, "id");
    if (!opsUser || typeof opsUser.id !== "string") return null;
    const ok = await isSpecOperator(opsUser.id as string);
    return ok ? (opsUser.id as string) : null;
  } catch {
    return null;
  }
}

export function denyNonOperator(): never {
  throw new Error("SYS :: SPEC OPERATOR GATE DENIED");
}

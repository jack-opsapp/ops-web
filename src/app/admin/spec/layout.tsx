import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { isSpecOperator } from "@/lib/admin/spec-permissions";

/**
 * SPEC admin gate.
 *
 * The parent `/admin/layout.tsx` already enforces OPS staff membership via
 * `isAdminEmail()` against `public.admins`. This nested layout ADDS the
 * dedicated `private.is_spec_operator()` check — a TS mirror that consults
 * `role_permissions(spec.admin/all)` and `user_permission_overrides(spec.admin)`,
 * the same two sources the SQL helper consults. NEVER use `has_permission(...)`
 * here: that helper short-circuits via `is_company_admin / account_holder_id /
 * admin_ids`, so any customer-company admin would bypass the SPEC gate.
 *
 * On gate fail: redirect to `/` (user is signed in but lacks the SPEC
 * permission). Signed-out users were already bounced to `/login` by the
 * parent layout.
 */
async function requireSpecOperator() {
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
    const ok = await isSpecOperator(opsUser.id);
    if (!ok) return null;
    return opsUser;
  } catch {
    return null;
  }
}

export default async function SpecAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSpecOperator();
  if (!user) redirect("/");

  return <>{children}</>;
}

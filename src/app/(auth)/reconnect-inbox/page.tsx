import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { checkPermissionById } from "@/lib/supabase/check-permission";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveEmailOAuthAlertConnection } from "@/lib/email/email-oauth-state";
import { ReconnectInboxClient } from "./ReconnectInboxClient";

interface SearchParams {
  companyId?: string;
  userId?: string;
  type?: string;
  provider?: string;
  connectionId?: string;
  expectedEmail?: string;
}

interface PageProps {
  searchParams: Promise<SearchParams>;
}

/**
 * Pre-OAuth confirmation page for an inbox-down alert. A stale OPS session is
 * sent through login and returned here. Only the exact same-company user with
 * integration permission may see tenant identity or begin the provider grant.
 */
export default async function ReconnectInboxPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const companyId = sp.companyId?.trim();
  const userId = sp.userId?.trim();
  const type = sp.type === "individual" ? "individual" : "company";
  const provider = sp.provider === "microsoft365" ? "microsoft365" : "gmail";
  const connectionId = sp.connectionId?.trim();
  const expectedEmail = sp.expectedEmail?.trim().toLowerCase();

  if (!companyId || !userId || !connectionId || !expectedEmail) {
    redirect("/login");
  }

  const reconnectPath = `/reconnect-inbox?${new URLSearchParams({
    companyId,
    userId,
    type,
    provider,
    connectionId,
    expectedEmail,
  }).toString()}`;
  const loginPath = `/login?redirect=${encodeURIComponent(reconnectPath)}`;

  const cookieStore = await cookies();
  const token =
    cookieStore.get("__session")?.value ??
    cookieStore.get("ops-auth-token")?.value;
  if (!token) redirect(loginPath);

  let authUser;
  try {
    authUser = await verifyAuthToken(token);
  } catch {
    redirect(loginPath);
  }

  const user = await findUserByAuth(
    authUser.uid,
    authUser.email,
    "id, company_id, first_name, last_name, email"
  );
  if (
    !user ||
    user.id !== userId ||
    user.company_id !== companyId ||
    !(await checkPermissionById(userId, "settings.integrations"))
  ) {
    redirect("/settings?tab=integrations");
  }

  const supabase = getServiceRoleClient();
  let alertBinding;
  try {
    alertBinding = await resolveEmailOAuthAlertConnection(supabase, {
      companyId,
      provider,
      type,
      connectionId,
      expectedEmail,
    });
  } catch (error) {
    console.error("[Reconnect inbox] Failed to verify connection:", error);
    redirect("/settings?tab=integrations");
  }
  if (!alertBinding) {
    redirect("/settings?tab=integrations");
  }

  const companyResult = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();

  if (!companyResult.data) {
    // Stale link — the company no longer exists. Push to login so they at
    // least land somewhere they can authenticate from.
    redirect("/login");
  }

  const companyName = (companyResult.data.name as string) ?? "your company";
  const userFirstName = (user.first_name as string | null) ?? null;
  const userLastName = (user.last_name as string | null) ?? null;
  const userEmail = (user.email as string | null) ?? null;
  const fullName =
    [userFirstName, userLastName].filter(Boolean).join(" ").trim() || null;

  return (
    <ReconnectInboxClient
      companyId={companyId}
      userId={userId}
      type={type}
      provider={provider}
      connectionId={alertBinding.connectionId}
      expectedEmail={alertBinding.expectedEmail}
      companyName={companyName}
      userName={fullName}
      userEmail={userEmail}
    />
  );
}

import { redirect } from "next/navigation";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { ReconnectInboxClient } from "./ReconnectInboxClient";

interface SearchParams {
  companyId?: string;
  userId?: string;
  type?: string;
  provider?: string;
}

interface PageProps {
  searchParams: Promise<SearchParams>;
}

/**
 * Pre-OAuth confirmation page. Shown to anyone landing from an inbox-down
 * alert email *before* we hand them off to Google / Microsoft for the
 * actual re-grant. Confirms the company + the user-of-record so the
 * operator can spot a wrong-account click before granting full mailbox
 * scope.
 *
 * Public route by design — auth might be expired (the alert lives in
 * email and may be read days later). The (auth) group's RouteGate
 * allowlist exempts /reconnect-inbox so authed users see the same
 * confirmation instead of being bounced to /dashboard.
 *
 * Identity attribution is verified server-side: the page only displays
 * a user name if that user's company_id actually matches the URL's
 * companyId. Mismatches render an anonymous "your team" so a crafted URL
 * can't be used to enumerate names.
 */
export default async function ReconnectInboxPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const companyId = sp.companyId?.trim();
  const userId = sp.userId?.trim();
  const type = sp.type === "individual" ? "individual" : "company";
  const provider = sp.provider === "microsoft365" ? "microsoft365" : "gmail";

  if (!companyId || !userId) {
    redirect("/login");
  }

  const supabase = getServiceRoleClient();

  const [companyResult, userResult] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("id, first_name, last_name, email, company_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (!companyResult.data) {
    // Stale link — the company no longer exists. Push to login so they at
    // least land somewhere they can authenticate from.
    redirect("/login");
  }

  const companyName = (companyResult.data.name as string) ?? "your company";
  const userBelongsToCompany =
    userResult.data?.company_id === companyId;
  const userFirstName = userBelongsToCompany
    ? ((userResult.data?.first_name as string | null) ?? null)
    : null;
  const userLastName = userBelongsToCompany
    ? ((userResult.data?.last_name as string | null) ?? null)
    : null;
  const userEmail = userBelongsToCompany
    ? ((userResult.data?.email as string | null) ?? null)
    : null;
  const fullName =
    [userFirstName, userLastName].filter(Boolean).join(" ").trim() || null;

  return (
    <ReconnectInboxClient
      companyId={companyId}
      userId={userId}
      type={type}
      provider={provider}
      companyName={companyName}
      userName={fullName}
      userEmail={userEmail}
    />
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { ReconnectSuccessClient } from "./SuccessClient";

interface SearchParams {
  companyId?: string;
  email?: string;
  provider?: string;
}

interface PageProps {
  searchParams: Promise<SearchParams>;
}

/**
 * Post-OAuth confirmation page — the landing the OAuth callback redirects to
 * when the inbound was started from an alert email (state.source === "alert").
 *
 * Auth-aware: a logged-in user gets a "Open settings" CTA; a logged-out user
 * (cookie expired between email click and now) gets a "Log in to OPS" CTA.
 * The connection itself was already saved by the callback regardless — this
 * page is the visual confirmation, not the write step.
 */
export default async function ReconnectInboxSuccessPage({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const companyId = sp.companyId?.trim();
  const inboxAddress = sp.email?.trim();
  const provider = sp.provider === "microsoft365" ? "microsoft365" : "gmail";

  if (!companyId || !inboxAddress) {
    redirect("/login");
  }

  const supabase = getServiceRoleClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();

  const companyName = (company?.name as string) ?? "your company";

  // Mirror middleware's auth heuristic. A live OPS session writes either
  // `__session` (Firebase server cookie) or `ops-auth-token` (custom).
  const cookieStore = await cookies();
  const isAuthenticated = !!(
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value
  );

  return (
    <ReconnectSuccessClient
      companyName={companyName}
      inboxAddress={inboxAddress}
      provider={provider}
      isAuthenticated={isAuthenticated}
    />
  );
}

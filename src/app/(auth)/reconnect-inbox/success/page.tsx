import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getFirebaseIdTokenCookieMaxAge,
  LEGACY_SESSION_COOKIE_NAME,
  OPS_AUTH_COOKIE_NAME,
  selectFirebaseIdTokenCookie,
} from "@/lib/auth/firebase-id-token-cookie";
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

  // This unverified freshness check only selects the CTA. Authorization still
  // requires server-side token verification on the destination route.
  const cookieStore = await cookies();
  const token = selectFirebaseIdTokenCookie(
    cookieStore.get(OPS_AUTH_COOKIE_NAME)?.value,
    cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value
  );
  const isAuthenticated =
    token !== null && getFirebaseIdTokenCookieMaxAge(token) !== null;

  return (
    <ReconnectSuccessClient
      companyName={companyName}
      inboxAddress={inboxAddress}
      provider={provider}
      isAuthenticated={isAuthenticated}
    />
  );
}

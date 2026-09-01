import type { Metadata } from "next";

import { ConsentPanel } from "./_components/consent-panel";

/**
 * OAuth 2.1 consent surface for the OPS remote MCP mount (P1 plan §D5).
 *
 * Presentation only: every authorization parameter arrives here untrusted and
 * is forwarded verbatim to the client panel, which round-trips it to the
 * Firebase-authenticated context/decision endpoints. All validation —
 * client identity, redirect-URI allowlisting, PKCE, scope ceiling, RFC 8707
 * audience — happens server-side in those endpoints, never here. A page that
 * validated locally would be a second, weaker copy of the same policy.
 */
export const metadata: Metadata = {
  title: "Connect",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/** Repeated query params are an attack shape, not a feature — take the first. */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function McpOAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-2 py-3">
      <ConsentPanel
        clientId={firstValue(params.client_id)}
        redirectUri={firstValue(params.redirect_uri)}
        responseType={firstValue(params.response_type)}
        scope={firstValue(params.scope)}
        state={firstValue(params.state)}
        codeChallenge={firstValue(params.code_challenge)}
        codeChallengeMethod={firstValue(params.code_challenge_method)}
        resource={firstValue(params.resource)}
      />
    </main>
  );
}

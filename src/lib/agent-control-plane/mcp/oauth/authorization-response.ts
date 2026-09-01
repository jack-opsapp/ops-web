import "server-only";

type AuthorizationResponse =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "error"; readonly error: "access_denied" };

interface AuthorizationResponseInput {
  readonly redirectUri: string;
  readonly issuer: string;
  readonly state: string | null;
  readonly response: AuthorizationResponse;
}

/**
 * Build the one trusted redirect emitted by the authorization server.
 *
 * RFC 9207 requires the exact metadata issuer on successful and error
 * authorization responses. Redirect targets have already passed the strict
 * client allowlist and byte-exact registration checks; rejecting any embedded
 * query or fragment here keeps response parameters single-valued.
 */
export function buildAuthorizationResponseUrl(
  input: AuthorizationResponseInput
): string {
  const url = new URL(input.redirectUri);
  if (url.search !== "" || url.hash !== "") {
    throw new Error("authorization_redirect_must_be_parameter_free");
  }

  if (input.response.kind === "code") {
    url.searchParams.set("code", input.response.code);
  } else {
    url.searchParams.set("error", input.response.error);
  }
  url.searchParams.set("iss", input.issuer);
  if (input.state !== null) url.searchParams.set("state", input.state);
  return url.toString();
}

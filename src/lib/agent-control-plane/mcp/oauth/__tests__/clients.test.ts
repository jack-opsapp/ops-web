import { describe, expect, it } from "vitest";

import {
  REDIRECT_URI_ALLOWLIST,
  isAllowlistedRedirectUri,
  validateClientRegistration,
  type ClientRegistrationResult,
} from "@/lib/agent-control-plane/mcp/oauth/clients";
import { SUPPORTED_READ_SCOPES } from "@/lib/agent-control-plane/mcp/oauth/scopes";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_COM_CALLBACK = "https://claude.com/api/mcp/auth_callback";
const FULL_SCOPE = SUPPORTED_READ_SCOPES.join(" ");

/** The exact payload claude.ai posts to /register for a custom connector. */
function claudePayload(
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    redirect_uris: [CLAUDE_CALLBACK],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Claude",
    ...overrides,
  };
}

function expectAccepted(result: ClientRegistrationResult) {
  if (!result.ok) {
    throw new Error(
      `expected acceptance, got ${result.rejection.error}: ${result.rejection.errorDescription}`
    );
  }
  return result.registration;
}

function expectRejected(result: ClientRegistrationResult) {
  if (result.ok) {
    throw new Error("expected rejection, got an accepted registration");
  }
  return result.rejection;
}

describe("Claude connector redirect allowlist", () => {
  it("allowlists exactly the two published callback URLs", () => {
    expect([...REDIRECT_URI_ALLOWLIST]).toEqual([
      CLAUDE_CALLBACK,
      CLAUDE_COM_CALLBACK,
    ]);
    expect(Object.isFrozen(REDIRECT_URI_ALLOWLIST)).toBe(true);
  });

  it.each([
    { label: "the claude.ai callback", uri: CLAUDE_CALLBACK, allowed: true },
    { label: "the claude.com twin", uri: CLAUDE_COM_CALLBACK, allowed: true },
    {
      label: "a trailing slash variant",
      uri: `${CLAUDE_CALLBACK}/`,
      allowed: false,
    },
    {
      label: "a query-string variant",
      uri: `${CLAUDE_CALLBACK}?next=/`,
      allowed: false,
    },
    {
      label: "an uppercase host variant",
      uri: "https://CLAUDE.AI/api/mcp/auth_callback",
      allowed: false,
    },
    {
      label: "a look-alike host",
      uri: "https://claude.ai.evil.example/api/mcp/auth_callback",
      allowed: false,
    },
    {
      label: "a subdomain of the allowlisted host",
      uri: "https://auth.claude.ai/api/mcp/auth_callback",
      allowed: false,
    },
    {
      label: "the plaintext scheme",
      uri: "http://claude.ai/api/mcp/auth_callback",
      allowed: false,
    },
    { label: "a loopback redirect", uri: "http://127.0.0.1:8976/callback", allowed: false },
    { label: "an empty string", uri: "", allowed: false },
  ])("exact-matches $label", ({ uri, allowed }) => {
    expect(isAllowlistedRedirectUri(uri)).toBe(allowed);
  });
});

describe("dynamic client registration — accepted shapes", () => {
  it("accepts the Claude custom-connector registration verbatim", () => {
    const registration = expectAccepted(
      validateClientRegistration(claudePayload())
    );

    expect(registration).toEqual({
      clientName: "Claude",
      redirectUris: [CLAUDE_CALLBACK],
      scope: FULL_SCOPE,
      softwareId: null,
      softwareVersion: null,
    });
    expect(Object.isFrozen(registration)).toBe(true);
    expect(Object.isFrozen(registration.redirectUris)).toBe(true);
  });

  it("accepts both allowlisted callbacks registered together", () => {
    const registration = expectAccepted(
      validateClientRegistration(
        claudePayload({ redirect_uris: [CLAUDE_CALLBACK, CLAUDE_COM_CALLBACK] })
      )
    );

    expect(registration.redirectUris).toEqual([
      CLAUDE_CALLBACK,
      CLAUDE_COM_CALLBACK,
    ]);
  });

  it("defaults every optional member the RFC lets a client omit", () => {
    const registration = expectAccepted(
      validateClientRegistration({ redirect_uris: [CLAUDE_CALLBACK] })
    );

    expect(registration).toEqual({
      clientName: "Claude",
      redirectUris: [CLAUDE_CALLBACK],
      scope: FULL_SCOPE,
      softwareId: null,
      softwareVersion: null,
    });
  });

  it("grants the full read set when scope is absent or blank, and clamps to what was asked for", () => {
    expect(
      expectAccepted(validateClientRegistration(claudePayload())).scope
    ).toBe(FULL_SCOPE);
    expect(
      expectAccepted(validateClientRegistration(claudePayload({ scope: "" })))
        .scope
    ).toBe(FULL_SCOPE);
    expect(
      expectAccepted(
        validateClientRegistration(
          claudePayload({ scope: "ops.financials.read ops.jobs.read" })
        )
      ).scope
    ).toBe("ops.jobs.read ops.financials.read");
  });

  it("accepts authorization_code without refresh_token", () => {
    const registration = expectAccepted(
      validateClientRegistration(
        claudePayload({ grant_types: ["authorization_code"] })
      )
    );

    expect(registration.clientName).toBe("Claude");
  });

  it("trims and preserves a well-formed client name and software metadata", () => {
    const registration = expectAccepted(
      validateClientRegistration(
        claudePayload({
          client_name: "  Claude Desktop  ",
          software_id: "  anthropic-claude  ",
          software_version: "2.0.0",
        })
      )
    );

    expect(registration.clientName).toBe("Claude Desktop");
    expect(registration.softwareId).toBe("anthropic-claude");
    expect(registration.softwareVersion).toBe("2.0.0");
  });

  it("normalizes blank software metadata to null rather than an empty string", () => {
    const registration = expectAccepted(
      validateClientRegistration(
        claudePayload({ software_id: "   ", software_version: null })
      )
    );

    expect(registration.softwareId).toBeNull();
    expect(registration.softwareVersion).toBeNull();
  });

  it.each([
    { label: "a null name", value: null },
    { label: "an absent name", value: undefined },
    { label: "a blank name", value: "   " },
    { label: "a non-string name", value: 42 },
    { label: "a name carrying a NUL byte", value: "Claude\u0000" },
    { label: "a name carrying CRLF", value: "Claude\r\nX-Injected: true" },
    { label: "a name carrying a DEL character", value: "Claude\u007f" },
    { label: "a name longer than 256 characters", value: "C".repeat(257) },
  ])("falls back to the default name for $label", ({ value }) => {
    const registration = expectAccepted(
      validateClientRegistration(claudePayload({ client_name: value }))
    );

    expect(registration.clientName).toBe("Claude");
  });
});

describe("dynamic client registration — rejected redirect URIs", () => {
  it.each([
    {
      label: "a non-allowlisted callback",
      payload: claudePayload({
        redirect_uris: ["https://evil.example/api/mcp/auth_callback"],
      }),
      description: /only accepts the Claude connector callback/,
    },
    {
      label: "an allowlisted callback smuggled alongside a foreign one",
      payload: claudePayload({
        redirect_uris: [CLAUDE_CALLBACK, "https://evil.example/callback"],
      }),
      description: /only accepts the Claude connector callback/,
    },
    {
      label: "an empty redirect_uris array",
      payload: claudePayload({ redirect_uris: [] }),
      description: /required/,
    },
    {
      label: "a missing redirect_uris member",
      payload: { token_endpoint_auth_method: "none" },
      description: /required/,
    },
    {
      label: "a null redirect_uris member",
      payload: claudePayload({ redirect_uris: null }),
      description: /required/,
    },
    {
      label: "a string instead of an array",
      payload: claudePayload({ redirect_uris: CLAUDE_CALLBACK }),
      description: /required/,
    },
    {
      label: "a non-string entry",
      payload: claudePayload({ redirect_uris: [CLAUDE_CALLBACK, 42] }),
      description: /required/,
    },
    {
      label: "a duplicated callback",
      payload: claudePayload({
        redirect_uris: [CLAUDE_CALLBACK, CLAUDE_CALLBACK],
      }),
      description: /unique/,
    },
    {
      label: "nine distinct callbacks",
      payload: claudePayload({
        redirect_uris: Array.from(
          { length: 9 },
          (_, index) => `https://claude.ai/api/mcp/auth_callback_${index}`
        ),
      }),
      description: /Too many redirect URIs/,
    },
  ])("rejects $label with invalid_redirect_uri", ({ payload, description }) => {
    const rejection = expectRejected(validateClientRegistration(payload));

    expect(rejection.error).toBe("invalid_redirect_uri");
    expect(rejection.errorDescription).toMatch(description);
  });
});

describe("dynamic client registration — rejected client metadata", () => {
  it.each([
    {
      label: "a confidential authentication method",
      payload: claudePayload({
        token_endpoint_auth_method: "client_secret_basic",
      }),
    },
    {
      label: "a POST-body client secret method",
      payload: claudePayload({
        token_endpoint_auth_method: "client_secret_post",
      }),
    },
    {
      label: "a private_key_jwt authentication method",
      payload: claudePayload({ token_endpoint_auth_method: "private_key_jwt" }),
    },
    {
      label: "a null authentication method",
      payload: claudePayload({ token_endpoint_auth_method: null }),
    },
    {
      label: "grant_types without authorization_code",
      payload: claudePayload({ grant_types: ["refresh_token"] }),
    },
    {
      label: "grant_types carrying a foreign grant",
      payload: claudePayload({
        grant_types: ["authorization_code", "client_credentials"],
      }),
    },
    {
      label: "the implicit grant",
      payload: claudePayload({ grant_types: ["implicit"] }),
    },
    {
      label: "an empty grant_types array",
      payload: claudePayload({ grant_types: [] }),
    },
    {
      label: "a non-array grant_types",
      payload: claudePayload({ grant_types: "authorization_code" }),
    },
    {
      label: "response_types requesting a token",
      payload: claudePayload({ response_types: ["token"] }),
    },
    {
      label: "response_types mixing code with a token",
      payload: claudePayload({ response_types: ["code", "token"] }),
    },
    {
      label: "an empty response_types array",
      payload: claudePayload({ response_types: [] }),
    },
    {
      label: "a non-array response_types",
      payload: claudePayload({ response_types: "code" }),
    },
    {
      label: "a scope naming authority this server does not issue",
      payload: claudePayload({ scope: "ops.jobs.read ops.jobs.write" }),
    },
    {
      label: "a scope naming an unknown read",
      payload: claudePayload({ scope: "ops.everything.read" }),
    },
    {
      label: "a scope requesting more than 32 entries",
      payload: claudePayload({
        scope: Array.from({ length: 33 }, () => "ops.jobs.read").join(" "),
      }),
    },
    {
      label: "a non-string scope",
      payload: claudePayload({ scope: ["ops.jobs.read"] }),
    },
    {
      label: "an oversized software_id",
      payload: claudePayload({ software_id: "s".repeat(129) }),
    },
    {
      label: "an oversized software_version",
      payload: claudePayload({ software_version: "v".repeat(129) }),
    },
    {
      label: "a software_id carrying control characters",
      payload: claudePayload({ software_id: "anthropic\u0000claude" }),
    },
    {
      label: "a software_version carrying CRLF",
      payload: claudePayload({ software_version: "2.0\r\nX-Injected: true" }),
    },
    {
      label: "a non-string software_id",
      payload: claudePayload({ software_id: 7 }),
    },
  ])("rejects $label with invalid_client_metadata", ({ payload }) => {
    const rejection = expectRejected(validateClientRegistration(payload));

    expect(rejection.error).toBe("invalid_client_metadata");
    expect(rejection.errorDescription.length).toBeGreaterThan(0);
  });

  it.each([
    { label: "null", payload: null },
    { label: "undefined", payload: undefined },
    { label: "an array", payload: [{ redirect_uris: [CLAUDE_CALLBACK] }] },
    { label: "a string", payload: JSON.stringify(claudePayload()) },
    { label: "a number", payload: 42 },
    { label: "a boolean", payload: true },
  ])("rejects a $label payload with invalid_client_metadata", ({ payload }) => {
    const rejection = expectRejected(validateClientRegistration(payload));

    expect(rejection.error).toBe("invalid_client_metadata");
    expect(rejection.errorDescription).toMatch(/JSON object/);
  });

  it("ignores unknown RFC 7591 metadata members instead of failing the registration", () => {
    const registration = expectAccepted(
      validateClientRegistration(
        claudePayload({
          client_uri: "https://claude.ai",
          logo_uri: "https://claude.ai/logo.png",
          contacts: ["support@anthropic.com"],
          jwks_uri: "https://claude.ai/.well-known/jwks.json",
        })
      )
    );

    expect(registration).not.toHaveProperty("client_uri");
    expect(registration).not.toHaveProperty("jwks_uri");
    expect(registration.redirectUris).toEqual([CLAUDE_CALLBACK]);
  });
});

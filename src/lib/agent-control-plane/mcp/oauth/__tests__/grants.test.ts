import { describe, expect, it } from "vitest";

import {
  McpOAuthStoreError,
  appendRequestAudit,
  consumeAuthorizationCode,
  createAuthorizationCode,
  getClient,
  listGrantsForUser,
  mintGrant,
  registerClient,
  resolveAccessToken,
  revokeGrant,
  revokeTokenByHash,
  rotateRefreshToken,
  type McpOAuthRpcClient,
} from "@/lib/agent-control-plane/mcp/oauth/grants";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const REVISION = "0123456789abcdef0123456789abcdef";
const CODE_HASH = "a".repeat(64);
const ACCESS_HASH = "b".repeat(64);
const REFRESH_HASH = "c".repeat(64);
const PRESENTED_HASH = "d".repeat(64);
const TOKEN_HASH = "e".repeat(64);
const INPUT_SHA256 = "f".repeat(64);
const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = "https://app.opsapp.co/api/mcp";
const ISSUER = "https://app.opsapp.co";
const SCOPES = ["ops.jobs.read", "ops.schedule.read"] as const;
const SCOPE_PARAMETER = "ops.jobs.read ops.schedule.read";
const CREATED_AT = "2026-08-18T12:00:00+00:00";
const CODE_EXPIRES_AT = new Date("2026-08-18T12:05:00.000Z");
const ACCESS_EXPIRES_AT = new Date("2026-08-18T12:10:00.000Z");
const REFRESH_EXPIRES_AT = new Date("2026-09-17T12:00:00.000Z");

const REGISTERED_CLIENT_ROW = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: SCOPE_PARAMETER,
  created_at: CREATED_AT,
};

const CLIENT_ROW = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [REDIRECT_URI],
  token_endpoint_auth_method: "none",
  scope: SCOPE_PARAMETER,
  disabled: false,
};

const CONSUMED_CODE_ROW = {
  user_id: USER_ID,
  company_id: COMPANY_ID,
  scopes: [...SCOPES],
  code_challenge: CODE_CHALLENGE,
  resource: RESOURCE,
};

const MINTED_GRANT_ROW = { grant_id: GRANT_ID, revision: REVISION };

const ROTATED_GRANT_ROW = {
  grant_id: GRANT_ID,
  client_id: CLIENT_ID,
  user_id: USER_ID,
  company_id: COMPANY_ID,
  scopes: [...SCOPES],
  revision: REVISION,
  issuer: ISSUER,
  audience: RESOURCE,
  reuse_detected: false,
};

const RESOLVED_ACCESS_TOKEN_ROW = {
  grant_id: GRANT_ID,
  client_id: CLIENT_ID,
  client_name: "Claude",
  user_id: USER_ID,
  company_id: COMPANY_ID,
  scopes: [...SCOPES],
  revision: REVISION,
  issuer: ISSUER,
  audience: RESOURCE,
  expires_at: "2026-08-18T12:10:00+00:00",
  token_revoked: false,
  grant_revoked: false,
  client_disabled: false,
};

const GRANT_LIST_ROW = {
  grant_id: GRANT_ID,
  client_name: "Claude",
  scopes: [...SCOPES],
  created_at: CREATED_AT,
  last_used_at: null,
};

const REGISTER_INPUT = {
  clientName: "Claude",
  redirectUris: [REDIRECT_URI],
  scope: SCOPE_PARAMETER,
  softwareId: null,
  softwareVersion: null,
};

const CREATE_CODE_INPUT = {
  codeHash: CODE_HASH,
  clientId: CLIENT_ID,
  userId: USER_ID,
  companyId: COMPANY_ID,
  scopes: [...SCOPES],
  redirectUri: REDIRECT_URI,
  codeChallenge: CODE_CHALLENGE,
  resource: RESOURCE,
  expiresAt: CODE_EXPIRES_AT,
};

const MINT_GRANT_INPUT = {
  codeHash: CODE_HASH,
  clientId: CLIENT_ID,
  userId: USER_ID,
  companyId: COMPANY_ID,
  scopes: [...SCOPES],
  accessHash: ACCESS_HASH,
  refreshHash: REFRESH_HASH,
  issuer: ISSUER,
  audience: RESOURCE,
  accessExpiresAt: ACCESS_EXPIRES_AT,
  refreshExpiresAt: REFRESH_EXPIRES_AT,
};

const ROTATE_INPUT = {
  presentedHash: PRESENTED_HASH,
  newAccessHash: ACCESS_HASH,
  newRefreshHash: REFRESH_HASH,
  accessExpiresAt: ACCESS_EXPIRES_AT,
  refreshExpiresAt: REFRESH_EXPIRES_AT,
};

const AUDIT_INPUT = {
  requestId: "req-01J8MCP",
  grantId: GRANT_ID,
  clientId: CLIENT_ID,
  actorUserId: USER_ID,
  companyId: COMPANY_ID,
  tool: "list_scheduled_jobs",
  protocolEra: "2025-11-25",
  outcome: "ok" as const,
  errorCode: null,
  inputSha256: INPUT_SHA256,
  resultBytes: 2048,
  latencyMs: 87,
};

interface RecordedCall {
  readonly functionName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

function clientReturning(result: {
  readonly data: unknown;
  readonly error: unknown;
}): { readonly client: McpOAuthRpcClient; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: McpOAuthRpcClient = {
    rpc(functionName, args) {
      calls.push({ functionName, args });
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

function clientFailing(
  mode: "throws" | "rejects",
  failure: unknown = new Error("connection reset by peer")
): { readonly client: McpOAuthRpcClient; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: McpOAuthRpcClient = {
    rpc(functionName, args) {
      calls.push({ functionName, args });
      if (mode === "throws") throw failure;
      return Promise.reject(failure);
    },
  };
  return { client, calls };
}

function rowsOf(row: Readonly<Record<string, unknown>>, count: number) {
  return Array.from({ length: count }, () => ({ ...row }));
}

function without(row: Readonly<Record<string, unknown>>, key: string) {
  const copy = { ...row };
  delete copy[key];
  return copy;
}

interface StoreOperation {
  readonly label: string;
  readonly functionName: string;
  readonly invoke: (client: McpOAuthRpcClient) => Promise<unknown>;
}

const OPERATIONS: readonly StoreOperation[] = [
  {
    label: "registerClient",
    functionName: "register_mcp_oauth_client_as_system",
    invoke: (client) => registerClient(client, REGISTER_INPUT),
  },
  {
    label: "getClient",
    functionName: "get_mcp_oauth_client_as_system",
    invoke: (client) => getClient(client, CLIENT_ID),
  },
  {
    label: "createAuthorizationCode",
    functionName: "create_mcp_oauth_authorization_code_as_system",
    invoke: (client) => createAuthorizationCode(client, CREATE_CODE_INPUT),
  },
  {
    label: "consumeAuthorizationCode",
    functionName: "consume_mcp_oauth_authorization_code_as_system",
    invoke: (client) =>
      consumeAuthorizationCode(client, {
        codeHash: CODE_HASH,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      }),
  },
  {
    label: "mintGrant",
    functionName: "mint_mcp_oauth_grant_as_system",
    invoke: (client) => mintGrant(client, MINT_GRANT_INPUT),
  },
  {
    label: "rotateRefreshToken",
    functionName: "rotate_mcp_oauth_refresh_token_as_system",
    invoke: (client) => rotateRefreshToken(client, ROTATE_INPUT),
  },
  {
    label: "resolveAccessToken",
    functionName: "resolve_mcp_oauth_access_token_as_system",
    invoke: (client) => resolveAccessToken(client, TOKEN_HASH),
  },
  {
    label: "revokeGrant",
    functionName: "revoke_mcp_oauth_grant_as_system",
    invoke: (client) => revokeGrant(client, { grantId: GRANT_ID, userId: USER_ID }),
  },
  {
    label: "revokeTokenByHash",
    functionName: "revoke_mcp_oauth_token_as_system",
    invoke: (client) => revokeTokenByHash(client, TOKEN_HASH),
  },
  {
    label: "listGrantsForUser",
    functionName: "list_mcp_oauth_grants_for_user_as_system",
    invoke: (client) =>
      listGrantsForUser(client, { userId: USER_ID, companyId: COMPANY_ID }),
  },
  {
    label: "appendRequestAudit",
    functionName: "append_mcp_request_audit_as_system",
    invoke: (client) => appendRequestAudit(client, AUDIT_INPUT),
  },
];

describe.each(OPERATIONS)("$label transport failures", ({ functionName, invoke }) => {
  it("fails closed when the RPC returns an error", async () => {
    const { client, calls } = clientReturning({
      data: null,
      error: { code: "42501", message: "access_denied" },
    });

    await expect(invoke(client)).rejects.toBeInstanceOf(McpOAuthStoreError);
    expect(calls.map((call) => call.functionName)).toEqual([functionName]);
  });

  it("fails closed when the RPC throws synchronously", async () => {
    const { client } = clientFailing("throws");

    await expect(invoke(client)).rejects.toBeInstanceOf(McpOAuthStoreError);
  });

  it("fails closed when the RPC rejects", async () => {
    const { client } = clientFailing("rejects");

    await expect(invoke(client)).rejects.toBeInstanceOf(McpOAuthStoreError);
  });

  it("fails closed when the RPC resolves to a malformed envelope", async () => {
    const client: McpOAuthRpcClient = {
      rpc: () => Promise.resolve(undefined as unknown as never),
    };

    await expect(invoke(client)).rejects.toBeInstanceOf(McpOAuthStoreError);
  });

  it("names the operation without leaking the database failure detail", async () => {
    const { client } = clientReturning({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table mcp_oauth_tokens",
        details: "user postgres",
      },
    });

    const failure = await invoke(client).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(McpOAuthStoreError);
    expect((failure as Error).name).toBe("McpOAuthStoreError");
    expect((failure as Error).message).toBe(
      `MCP OAuth store operation failed: ${functionName}`
    );
  });
});

describe("registerClient", () => {
  it("passes the registration through under the exact RPC parameter names", async () => {
    const { client, calls } = clientReturning({
      data: [REGISTERED_CLIENT_ROW],
      error: null,
    });

    const row = await registerClient(client, {
      clientName: "Claude",
      redirectUris: [REDIRECT_URI],
      scope: SCOPE_PARAMETER,
      softwareId: "anthropic-claude",
      softwareVersion: "2.0.0",
    });

    expect(calls).toEqual([
      {
        functionName: "register_mcp_oauth_client_as_system",
        args: {
          p_client_name: "Claude",
          p_redirect_uris: [REDIRECT_URI],
          p_scope: SCOPE_PARAMETER,
          p_software_id: "anthropic-claude",
          p_software_version: "2.0.0",
        },
      },
    ]);
    expect(row).toEqual(REGISTERED_CLIENT_ROW);
  });

  it("forwards absent software metadata as SQL NULL", async () => {
    const { client, calls } = clientReturning({
      data: [REGISTERED_CLIENT_ROW],
      error: null,
    });

    await registerClient(client, REGISTER_INPUT);

    expect(calls[0].args.p_software_id).toBeNull();
    expect(calls[0].args.p_software_version).toBeNull();
  });

  it.each([
    { label: "no rows", data: [] },
    { label: "a null result", data: null },
    { label: "a non-array result", data: REGISTERED_CLIENT_ROW },
    { label: "two rows", data: rowsOf(REGISTERED_CLIENT_ROW, 2) },
    {
      label: "a row missing client_id",
      data: [without(REGISTERED_CLIENT_ROW, "client_id")],
    },
    {
      label: "a row whose client_id is not a UUID",
      data: [{ ...REGISTERED_CLIENT_ROW, client_id: "client-1" }],
    },
    {
      label: "a row claiming a confidential auth method",
      data: [
        {
          ...REGISTERED_CLIENT_ROW,
          token_endpoint_auth_method: "client_secret_basic",
        },
      ],
    },
    {
      label: "a row with no redirect URIs",
      data: [{ ...REGISTERED_CLIENT_ROW, redirect_uris: [] }],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(registerClient(client, REGISTER_INPUT)).rejects.toBeInstanceOf(
      McpOAuthStoreError
    );
  });
});

describe("getClient", () => {
  it("looks a client up by id and returns the stored row", async () => {
    const { client, calls } = clientReturning({
      data: [CLIENT_ROW],
      error: null,
    });

    const row = await getClient(client, CLIENT_ID);

    expect(calls).toEqual([
      {
        functionName: "get_mcp_oauth_client_as_system",
        args: { p_client_id: CLIENT_ID },
      },
    ]);
    expect(row).toEqual(CLIENT_ROW);
  });

  it("surfaces a disabled client rather than hiding it — the policy call is the caller's", async () => {
    const { client } = clientReturning({
      data: [{ ...CLIENT_ROW, disabled: true }],
      error: null,
    });

    await expect(getClient(client, CLIENT_ID)).resolves.toMatchObject({
      disabled: true,
    });
  });

  it.each([
    { label: "an unknown client id", data: [] },
    { label: "a null result", data: null },
  ])("returns null for $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(getClient(client, CLIENT_ID)).resolves.toBeNull();
  });

  it.each([
    { label: "two rows", data: rowsOf(CLIENT_ROW, 2) },
    { label: "a non-array result", data: CLIENT_ROW },
    { label: "a null row", data: [null] },
    { label: "a row missing disabled", data: [without(CLIENT_ROW, "disabled")] },
    {
      label: "a row whose disabled flag is a string",
      data: [{ ...CLIENT_ROW, disabled: "false" }],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(getClient(client, CLIENT_ID)).rejects.toBeInstanceOf(
      McpOAuthStoreError
    );
  });
});

describe("createAuthorizationCode", () => {
  it("binds the code to client, user, company, redirect, challenge, and resource", async () => {
    const { client, calls } = clientReturning({ data: null, error: null });

    await expect(
      createAuthorizationCode(client, CREATE_CODE_INPUT)
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        functionName: "create_mcp_oauth_authorization_code_as_system",
        args: {
          p_code_hash: CODE_HASH,
          p_client_id: CLIENT_ID,
          p_user_id: USER_ID,
          p_company_id: COMPANY_ID,
          p_scopes: [...SCOPES],
          p_redirect_uri: REDIRECT_URI,
          p_code_challenge: CODE_CHALLENGE,
          p_resource: RESOURCE,
          p_expires_at: "2026-08-18T12:05:00.000Z",
        },
      },
    ]);
  });
});

describe("consumeAuthorizationCode", () => {
  it("consumes the code under its exact client and redirect binding", async () => {
    const { client, calls } = clientReturning({
      data: [CONSUMED_CODE_ROW],
      error: null,
    });

    const row = await consumeAuthorizationCode(client, {
      codeHash: CODE_HASH,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    });

    expect(calls).toEqual([
      {
        functionName: "consume_mcp_oauth_authorization_code_as_system",
        args: {
          p_code_hash: CODE_HASH,
          p_client_id: CLIENT_ID,
          p_redirect_uri: REDIRECT_URI,
        },
      },
    ]);
    expect(row).toEqual(CONSUMED_CODE_ROW);
  });

  it.each([
    { label: "an expired, replayed, or unknown code", data: [] },
    { label: "a null result", data: null },
  ])("returns null for $label so the caller can answer invalid_grant", async ({
    data,
  }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(
      consumeAuthorizationCode(client, {
        codeHash: CODE_HASH,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      })
    ).resolves.toBeNull();
  });

  it.each([
    { label: "two rows", data: rowsOf(CONSUMED_CODE_ROW, 2) },
    { label: "a non-array result", data: CONSUMED_CODE_ROW },
    {
      label: "a row with an empty scope set",
      data: [{ ...CONSUMED_CODE_ROW, scopes: [] }],
    },
    {
      label: "a row with a truncated code challenge",
      data: [{ ...CONSUMED_CODE_ROW, code_challenge: "a".repeat(42) }],
    },
    {
      label: "a row missing the bound resource",
      data: [without(CONSUMED_CODE_ROW, "resource")],
    },
    {
      label: "a row whose user_id is not a UUID",
      data: [{ ...CONSUMED_CODE_ROW, user_id: "user-1" }],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(
      consumeAuthorizationCode(client, {
        codeHash: CODE_HASH,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
      })
    ).rejects.toBeInstanceOf(McpOAuthStoreError);
  });
});

describe("mintGrant", () => {
  it("mints the grant with both token digests and both expiries as ISO strings", async () => {
    const { client, calls } = clientReturning({
      data: [MINTED_GRANT_ROW],
      error: null,
    });

    const row = await mintGrant(client, MINT_GRANT_INPUT);

    expect(calls).toEqual([
      {
        functionName: "mint_mcp_oauth_grant_as_system",
        args: {
          p_code_hash: CODE_HASH,
          p_client_id: CLIENT_ID,
          p_user_id: USER_ID,
          p_company_id: COMPANY_ID,
          p_scopes: [...SCOPES],
          p_access_hash: ACCESS_HASH,
          p_refresh_hash: REFRESH_HASH,
          p_issuer: ISSUER,
          p_audience: RESOURCE,
          p_access_expires_at: "2026-08-18T12:10:00.000Z",
          p_refresh_expires_at: "2026-09-17T12:00:00.000Z",
        },
      },
    ]);
    expect(row).toEqual(MINTED_GRANT_ROW);
  });

  it.each([
    { label: "no rows", data: [] },
    { label: "a null result", data: null },
    { label: "two rows", data: rowsOf(MINTED_GRANT_ROW, 2) },
    {
      label: "a row whose revision is not a 32-character digest",
      data: [{ ...MINTED_GRANT_ROW, revision: "revision-1" }],
    },
    {
      label: "a row whose revision is uppercase hex",
      data: [{ ...MINTED_GRANT_ROW, revision: REVISION.toUpperCase() }],
    },
    {
      label: "a row missing grant_id",
      data: [without(MINTED_GRANT_ROW, "grant_id")],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(mintGrant(client, MINT_GRANT_INPUT)).rejects.toBeInstanceOf(
      McpOAuthStoreError
    );
  });
});

describe("rotateRefreshToken", () => {
  it("rotates against the presented digest and returns the refreshed grant", async () => {
    const { client, calls } = clientReturning({
      data: [ROTATED_GRANT_ROW],
      error: null,
    });

    const row = await rotateRefreshToken(client, ROTATE_INPUT);

    expect(calls).toEqual([
      {
        functionName: "rotate_mcp_oauth_refresh_token_as_system",
        args: {
          p_presented_hash: PRESENTED_HASH,
          p_new_access_hash: ACCESS_HASH,
          p_new_refresh_hash: REFRESH_HASH,
          p_access_expires_at: "2026-08-18T12:10:00.000Z",
          p_refresh_expires_at: "2026-09-17T12:00:00.000Z",
        },
      },
    ]);
    expect(row).toEqual(ROTATED_GRANT_ROW);
    expect(row?.reuse_detected).toBe(false);
  });

  it("surfaces the reuse-detection verdict verbatim", async () => {
    const { client } = clientReturning({
      data: [{ ...ROTATED_GRANT_ROW, reuse_detected: true }],
      error: null,
    });

    await expect(rotateRefreshToken(client, ROTATE_INPUT)).resolves.toMatchObject(
      { grant_id: GRANT_ID, reuse_detected: true }
    );
  });

  it.each([
    { label: "an unknown refresh digest", data: [] },
    { label: "a null result", data: null },
  ])("returns null for $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(rotateRefreshToken(client, ROTATE_INPUT)).resolves.toBeNull();
  });

  it.each([
    { label: "two rows", data: rowsOf(ROTATED_GRANT_ROW, 2) },
    { label: "a non-array result", data: ROTATED_GRANT_ROW },
    {
      label: "a row missing the reuse verdict",
      data: [without(ROTATED_GRANT_ROW, "reuse_detected")],
    },
    {
      label: "a row whose reuse verdict is a string",
      data: [{ ...ROTATED_GRANT_ROW, reuse_detected: "false" }],
    },
    {
      label: "a row missing the audience",
      data: [without(ROTATED_GRANT_ROW, "audience")],
    },
    {
      label: "a row with more than 32 scopes",
      data: [
        {
          ...ROTATED_GRANT_ROW,
          scopes: Array.from({ length: 33 }, () => "ops.jobs.read"),
        },
      ],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(
      rotateRefreshToken(client, ROTATE_INPUT)
    ).rejects.toBeInstanceOf(McpOAuthStoreError);
  });
});

describe("resolveAccessToken", () => {
  it("resolves a presented digest to the full grant claim set", async () => {
    const { client, calls } = clientReturning({
      data: [RESOLVED_ACCESS_TOKEN_ROW],
      error: null,
    });

    const row = await resolveAccessToken(client, TOKEN_HASH);

    expect(calls).toEqual([
      {
        functionName: "resolve_mcp_oauth_access_token_as_system",
        args: { p_token_hash: TOKEN_HASH },
      },
    ]);
    expect(row).toEqual(RESOLVED_ACCESS_TOKEN_ROW);
  });

  it("returns the revocation and disablement flags untouched for the caller to enforce", async () => {
    const { client } = clientReturning({
      data: [
        {
          ...RESOLVED_ACCESS_TOKEN_ROW,
          token_revoked: true,
          grant_revoked: true,
          client_disabled: true,
        },
      ],
      error: null,
    });

    await expect(resolveAccessToken(client, TOKEN_HASH)).resolves.toMatchObject({
      token_revoked: true,
      grant_revoked: true,
      client_disabled: true,
    });
  });

  it.each([
    { label: "an unknown token digest", data: [] },
    { label: "a null result", data: null },
  ])("returns null for $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(resolveAccessToken(client, TOKEN_HASH)).resolves.toBeNull();
  });

  it.each([
    { label: "two rows", data: rowsOf(RESOLVED_ACCESS_TOKEN_ROW, 2) },
    { label: "a non-array result", data: RESOLVED_ACCESS_TOKEN_ROW },
    {
      label: "a row missing the company binding",
      data: [without(RESOLVED_ACCESS_TOKEN_ROW, "company_id")],
    },
    {
      label: "a row whose company binding is not a UUID",
      data: [{ ...RESOLVED_ACCESS_TOKEN_ROW, company_id: "maverick" }],
    },
    {
      label: "a row missing the expiry",
      data: [without(RESOLVED_ACCESS_TOKEN_ROW, "expires_at")],
    },
    {
      label: "a row with an empty scope set",
      data: [{ ...RESOLVED_ACCESS_TOKEN_ROW, scopes: [] }],
    },
    {
      label: "a row missing the revocation flag",
      data: [without(RESOLVED_ACCESS_TOKEN_ROW, "grant_revoked")],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(resolveAccessToken(client, TOKEN_HASH)).rejects.toBeInstanceOf(
      McpOAuthStoreError
    );
  });
});

describe("revokeGrant", () => {
  it("revokes only the caller's own grant", async () => {
    const { client, calls } = clientReturning({ data: true, error: null });

    const revoked = await revokeGrant(client, {
      grantId: GRANT_ID,
      userId: USER_ID,
    });

    expect(calls).toEqual([
      {
        functionName: "revoke_mcp_oauth_grant_as_system",
        args: { p_grant_id: GRANT_ID, p_user_id: USER_ID },
      },
    ]);
    expect(revoked).toBe(true);
  });

  it.each([
    { label: "false", data: false },
    { label: "null", data: null },
    { label: "an empty array", data: [] },
    { label: "the string \"true\"", data: "true" },
    { label: "the number 1", data: 1 },
  ])("reports no revocation when the RPC answers $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(
      revokeGrant(client, { grantId: GRANT_ID, userId: USER_ID })
    ).resolves.toBe(false);
  });
});

describe("revokeTokenByHash", () => {
  it("revokes by digest and resolves regardless of the RPC's return shape", async () => {
    const { client, calls } = clientReturning({ data: true, error: null });

    await expect(
      revokeTokenByHash(client, TOKEN_HASH)
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        functionName: "revoke_mcp_oauth_token_as_system",
        args: { p_token_hash: TOKEN_HASH },
      },
    ]);
  });

  it("stays silent for an unknown token, as RFC 7009 requires", async () => {
    const { client } = clientReturning({ data: false, error: null });

    await expect(
      revokeTokenByHash(client, TOKEN_HASH)
    ).resolves.toBeUndefined();
  });
});

describe("listGrantsForUser", () => {
  it("maps every live grant row for the settings surface", async () => {
    const secondRow = {
      ...GRANT_LIST_ROW,
      grant_id: "55555555-5555-4555-8555-555555555555",
      client_name: "Claude Desktop",
      last_used_at: "2026-08-18T13:30:00+00:00",
    };
    const { client, calls } = clientReturning({
      data: [GRANT_LIST_ROW, secondRow],
      error: null,
    });

    const rows = await listGrantsForUser(client, {
      userId: USER_ID,
      companyId: COMPANY_ID,
    });

    expect(calls).toEqual([
      {
        functionName: "list_mcp_oauth_grants_for_user_as_system",
        args: { p_user_id: USER_ID, p_company_id: COMPANY_ID },
      },
    ]);
    expect(rows).toEqual([GRANT_LIST_ROW, secondRow]);
    expect(Object.isFrozen(rows)).toBe(true);
  });

  it.each([
    { label: "no grants", data: [] },
    { label: "a null result", data: null },
  ])("returns an empty frozen list for $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    const rows = await listGrantsForUser(client, {
      userId: USER_ID,
      companyId: COMPANY_ID,
    });

    expect(rows).toEqual([]);
    expect(Object.isFrozen(rows)).toBe(true);
  });

  it.each([
    { label: "a non-array result", data: GRANT_LIST_ROW },
    { label: "a null row", data: [null] },
    {
      label: "one malformed row among valid ones",
      data: [GRANT_LIST_ROW, without(GRANT_LIST_ROW, "client_name")],
    },
    {
      label: "a row whose grant id is not a UUID",
      data: [{ ...GRANT_LIST_ROW, grant_id: "grant-1" }],
    },
    {
      label: "a row with an empty scope set",
      data: [{ ...GRANT_LIST_ROW, scopes: [] }],
    },
    {
      label: "a row whose last_used_at is a number",
      data: [{ ...GRANT_LIST_ROW, last_used_at: 1_755_000_000 }],
    },
  ])("rejects $label", async ({ data }) => {
    const { client } = clientReturning({ data, error: null });

    await expect(
      listGrantsForUser(client, { userId: USER_ID, companyId: COMPANY_ID })
    ).rejects.toBeInstanceOf(McpOAuthStoreError);
  });
});

describe("appendRequestAudit", () => {
  it("appends one row carrying every audit column under its RPC parameter name", async () => {
    const { client, calls } = clientReturning({ data: null, error: null });

    await expect(
      appendRequestAudit(client, AUDIT_INPUT)
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        functionName: "append_mcp_request_audit_as_system",
        args: {
          p_request_id: "req-01J8MCP",
          p_grant_id: GRANT_ID,
          p_client_id: CLIENT_ID,
          p_actor_user_id: USER_ID,
          p_company_id: COMPANY_ID,
          p_tool: "list_scheduled_jobs",
          p_protocol_era: "2025-11-25",
          p_outcome: "ok",
          p_error_code: null,
          p_input_sha256: INPUT_SHA256,
          p_result_bytes: 2048,
          p_latency_ms: 87,
        },
      },
    ]);
  });

  it("appends an unauthenticated denial with no actor, tool, or input digest", async () => {
    const { client, calls } = clientReturning({ data: null, error: null });

    await appendRequestAudit(client, {
      requestId: "req-01J8DENY",
      grantId: null,
      clientId: null,
      actorUserId: null,
      companyId: null,
      tool: null,
      protocolEra: null,
      outcome: "unauthenticated",
      errorCode: "invalid_token",
      inputSha256: null,
      resultBytes: null,
      latencyMs: 3,
    });

    expect(calls[0].args).toEqual({
      p_request_id: "req-01J8DENY",
      p_grant_id: null,
      p_client_id: null,
      p_actor_user_id: null,
      p_company_id: null,
      p_tool: null,
      p_protocol_era: null,
      p_outcome: "unauthenticated",
      p_error_code: "invalid_token",
      p_input_sha256: null,
      p_result_bytes: null,
      p_latency_ms: 3,
    });
  });

  it.each([
    { label: "domain_error" as const },
    { label: "forbidden" as const },
    { label: "rate_limited" as const },
    { label: "internal" as const },
  ])("records the $label outcome verbatim", async ({ label }) => {
    const { client, calls } = clientReturning({ data: null, error: null });

    await appendRequestAudit(client, { ...AUDIT_INPUT, outcome: label });

    expect(calls[0].args.p_outcome).toBe(label);
  });

  it.each([
    { label: "an uppercase digest", value: INPUT_SHA256.toUpperCase() },
    { label: "a 63-character digest", value: "f".repeat(63) },
    { label: "a 65-character digest", value: "f".repeat(65) },
    { label: "a non-hex digest", value: "z".repeat(64) },
    { label: "an empty digest", value: "" },
    { label: "a whitespace-padded digest", value: ` ${"f".repeat(63)}` },
  ])("refuses $label without touching the database", async ({ value }) => {
    const { client, calls } = clientReturning({ data: null, error: null });

    await expect(
      appendRequestAudit(client, { ...AUDIT_INPUT, inputSha256: value })
    ).rejects.toBeInstanceOf(McpOAuthStoreError);
    expect(calls).toEqual([]);
  });
});

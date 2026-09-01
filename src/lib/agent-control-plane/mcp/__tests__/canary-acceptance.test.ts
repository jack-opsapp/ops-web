import { describe, expect, it, vi } from "vitest";
import { createConnection } from "node:net";

import {
  MCP_V3_CANARY_REVISIONS,
  createLoopbackAuthorizationReceiver,
  runMcpV3CanaryAcceptance,
  type CanaryAcceptanceRpcClient,
} from "@/lib/agent-control-plane/mcp/canary-acceptance";

const ISSUER = "https://app.opsapp.co";
const USER_ID = "ca000000-0000-4000-8000-000000000011";
const COMPANY_ID = "ca000000-0000-4000-8000-000000000001";
const CLIENT_ID = "ca000000-0000-4000-8000-000000000021";
const CODE = `ops_mcp_ac_${"c".repeat(43)}`;
const ACCESS_ONE = `ops_mcp_at_${"a".repeat(43)}`;
const ACCESS_TWO = `ops_mcp_at_${"b".repeat(43)}`;
const REFRESH_ONE = `ops_mcp_rt_${"d".repeat(43)}`;
const REFRESH_TWO = `ops_mcp_rt_${"e".repeat(43)}`;
const RUN_ID = "ca000000-0000-4000-8000-000000000061";
const CHANGE_SET_ID = "ca000000-0000-4000-8000-000000000062";
const ACTION_ID = "ca000000-0000-4000-8000-000000000071";
const CONFIRMATION_ID = "ca000000-0000-4000-8000-000000000063";
const PREVIEW_SHA256 = `sha256:${"1".repeat(64)}`;
const RECEIPT_SHA256 = `sha256:${"2".repeat(64)}`;
const HOST_SUMMARY = Object.freeze({
  protocolVersion: "2025-03-26",
  toolNames: Object.freeze(["prepare_day_closeout"] as const),
  state: "attention" as const,
  findingCount: 1,
  filingKind: "approval_required" as const,
  completeComponents: 7,
  partialComponents: 0,
});
const HOST_PROOF = Object.freeze({
  runId: RUN_ID,
  actionId: ACTION_ID,
  changeSetId: CHANGE_SET_ID,
  previewSha256: PREVIEW_SHA256,
});
const HOST_RESULT = Object.freeze({ summary: HOST_SUMMARY, proof: HOST_PROOF });

async function visitLoopback(url: URL): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = createConnection(
      { host: "127.0.0.1", port: Number(url.port) },
      () => {
        socket.write(
          `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`
        );
      }
    );
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", reject);
    socket.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const separator = raw.indexOf("\r\n\r\n");
      if (!raw.startsWith("HTTP/1.1 200") || separator < 0) {
        reject(new Error("loopback response failed"));
        return;
      }
      resolve(raw.slice(separator + 4));
    });
  });
}

function rpcFixture(input?: {
  provisionFails?: boolean;
  cleanupFails?: boolean;
  operatorProofStalls?: boolean;
}) {
  let disabled = false;
  const calls: Array<{
    readonly functionName: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];
  const rpc = vi.fn<CanaryAcceptanceRpcClient["rpc"]>(
    async (functionName, args, signal) => {
      calls.push({ functionName, args });
      if (functionName === "register_mcp_oauth_client_as_system") {
        return {
          data: [
            {
              client_id: CLIENT_ID,
              scope: MCP_V3_CANARY_REVISIONS.scopes.join(" "),
              exposure_revision: MCP_V3_CANARY_REVISIONS.exposure,
              consent_catalog_revision: MCP_V3_CANARY_REVISIONS.consentCatalog,
            },
          ],
          error: null,
        };
      }
      if (functionName === "provision_mcp_oauth_canary_as_system") {
        return input?.provisionFails
          ? { data: null, error: { code: "23505" } }
          : {
              data: [
                {
                  exposure_revision: MCP_V3_CANARY_REVISIONS.exposure,
                  consent_catalog_revision:
                    MCP_V3_CANARY_REVISIONS.consentCatalog,
                  expires_at: args.p_expires_at,
                  enabled: true,
                },
              ],
              error: null,
            };
      }
      if (functionName === "disable_mcp_oauth_canary_as_system") {
        if (input?.cleanupFails) {
          return { data: null, error: { code: "55000" } };
        }
        disabled = true;
        return { data: true, error: null };
      }
      if (functionName === "resolve_mcp_oauth_canary_as_system") {
        return { data: disabled ? [] : [{}], error: null };
      }
      if (functionName === "inspect_mcp_oauth_canary_acceptance_as_system") {
        if (input?.operatorProofStalls) {
          return await new Promise((resolve) => {
            signal?.addEventListener(
              "abort",
              () => resolve({ data: null, error: { code: "57014" } }),
              { once: true }
            );
          });
        }
        return {
          data: [
            {
              prepared_with_approval: true,
              receipt_verified: true,
              routine_enabled: true,
            },
          ],
          error: null,
        };
      }
      if (functionName === "commit_agent_day_closeout_as_actor") {
        return {
          data: {
            ok: true,
            effect: "filed_inside_ops",
            run_id: RUN_ID,
            action_id: ACTION_ID,
            change_set_id: CHANGE_SET_ID,
            preview_sha256: PREVIEW_SHA256,
            messages_sent: 0,
            money_moved: false,
            replayed: true,
            confirmation_receipt_id: CONFIRMATION_ID,
            receipt_sha256: RECEIPT_SHA256,
          },
          error: null,
        };
      }
      if (functionName === "verify_mcp_oauth_canary_cleanup_as_system") {
        return {
          data: [
            {
              binding_inactive: true,
              client_disabled: true,
              grants_inactive: true,
              tokens_inactive: true,
              routines_safe: true,
            },
          ],
          error: null,
        };
      }
      if (functionName === "get_mcp_oauth_client_as_system") {
        return { data: [{ disabled }], error: null };
      }
      if (
        functionName === "list_mcp_oauth_grants_for_user_as_system" ||
        functionName === "list_agent_day_closeout_routine_configs_as_system"
      ) {
        return { data: [], error: null };
      }
      throw new Error("unexpected RPC");
    }
  );
  return { calls, client: { rpc }, rpc };
}

function tokenFetcher() {
  let tokenCalls = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    if (url.pathname === "/api/mcp/oauth/token") {
      tokenCalls += 1;
      if (tokenCalls === 3) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({
        access_token: tokenCalls === 1 ? ACCESS_ONE : ACCESS_TWO,
        refresh_token: tokenCalls === 1 ? REFRESH_ONE : REFRESH_TWO,
        token_type: "Bearer",
        scope: MCP_V3_CANARY_REVISIONS.scopes.join(" "),
      });
    }
    if (url.pathname === "/api/mcp") {
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TWO}`,
      });
      return new Response(null, { status: 401 });
    }
    throw new Error("unexpected fetch");
  });
}

describe("MCP v3 synthetic canary acceptance", () => {
  it("runs real loopback consent, refresh reuse proof, and exact cleanup without leaking secrets", async () => {
    const rpc = rpcFixture();
    const fetcher = tokenFetcher();
    const progress: string[] = [];
    const operatorUrls: string[] = [];
    let redirectUri = "";
    let authorizationState = "";
    let codeChallenge = "";
    const hostAcceptance = vi.fn(async (input) => {
      expect(input.bearer).toBe(ACCESS_TWO);
      return HOST_RESULT;
    });

    const summary = await runMcpV3CanaryAcceptance(
      {
        rpcClient: rpc.client,
        issuer: ISSUER,
        userId: USER_ID,
        companyId: COMPANY_ID,
      },
      {
        fetcher,
        runHostAcceptance: hostAcceptance,
        onProgress: (stage) => progress.push(stage),
        openOperatorSurface: async (url) => {
          operatorUrls.push(url.toString());
        },
        openAuthorization: async (authorizationUrl) => {
          expect(authorizationUrl.origin).toBe(ISSUER);
          expect(authorizationUrl.pathname).toBe("/oauth/authorize");
          expect(authorizationUrl.searchParams.get("response_type")).toBe(
            "code"
          );
          expect(authorizationUrl.searchParams.get("scope")).toBe(
            MCP_V3_CANARY_REVISIONS.scopes.join(" ")
          );
          expect(
            authorizationUrl.searchParams.get("code_challenge_method")
          ).toBe("S256");
          authorizationState = authorizationUrl.searchParams.get("state") ?? "";
          codeChallenge =
            authorizationUrl.searchParams.get("code_challenge") ?? "";
          expect(authorizationState).toMatch(/^[A-Za-z0-9_-]{43}$/u);
          expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
          const redirect = new URL(
            authorizationUrl.searchParams.get("redirect_uri") ?? ""
          );
          redirectUri = redirect.toString();
          redirect.search = new URLSearchParams({
            code: CODE,
            state: authorizationUrl.searchParams.get("state") ?? "",
            iss: ISSUER,
          }).toString();
          expect(await visitLoopback(redirect)).toBe(
            "Consent received. Return to OPS."
          );
        },
      }
    );

    expect(progress).toEqual([
      "waiting_for_consent",
      "waiting_for_filing",
      "waiting_for_routine",
    ]);
    expect(operatorUrls).toEqual([
      "https://app.opsapp.co/agent/queue",
      "https://app.opsapp.co/settings?tab=integrations",
    ]);
    expect(summary).toEqual({
      status: "passed",
      exposureRevision: MCP_V3_CANARY_REVISIONS.exposure,
      consentCatalogRevision: MCP_V3_CANARY_REVISIONS.consentCatalog,
      oauth: {
        authorizationCode: true,
        refreshRotation: true,
        refreshReuseRevoked: true,
        bearerRejectedAfterRevocation: true,
      },
      operator: {
        approvalReceipt: true,
        idempotentReplay: true,
        routineHandoff: true,
      },
      host: HOST_SUMMARY,
      cleanupVerified: true,
    });
    const authorizationForm = new URLSearchParams(
      String(fetcher.mock.calls[0]?.[1]?.body)
    );
    const verifier = authorizationForm.get("code_verifier") ?? "";
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(verifier).not.toBe(codeChallenge);
    const serialized = JSON.stringify({ summary, progress });
    for (const secret of [
      CODE,
      ACCESS_ONE,
      ACCESS_TWO,
      REFRESH_ONE,
      REFRESH_TWO,
      USER_ID,
      COMPANY_ID,
      CLIENT_ID,
      redirectUri,
      authorizationState,
      codeChallenge,
      verifier,
      RUN_ID,
      ACTION_ID,
      CHANGE_SET_ID,
      PREVIEW_SHA256,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(rpc.calls.map(({ functionName }) => functionName).slice(-6)).toEqual(
      [
        "disable_mcp_oauth_canary_as_system",
        "resolve_mcp_oauth_canary_as_system",
        "get_mcp_oauth_client_as_system",
        "list_mcp_oauth_grants_for_user_as_system",
        "list_agent_day_closeout_routine_configs_as_system",
        "verify_mcp_oauth_canary_cleanup_as_system",
      ]
    );
    expect(
      rpc.calls.find(
        ({ functionName }) =>
          functionName === "inspect_mcp_oauth_canary_acceptance_as_system"
      )?.args
    ).toMatchObject({
      p_run_id: RUN_ID,
      p_action_id: ACTION_ID,
      p_change_set_id: CHANGE_SET_ID,
      p_preview_sha256: PREVIEW_SHA256,
    });
    expect(
      rpc.calls.find(
        ({ functionName }) =>
          functionName === "commit_agent_day_closeout_as_actor"
      )?.args
    ).toEqual({
      p_actor_user_id: USER_ID,
      p_company_id: COMPANY_ID,
      p_action_id: ACTION_ID,
      p_change_set_id: CHANGE_SET_ID,
      p_preview_sha256: PREVIEW_SHA256,
      p_idempotency_key: `file-day-closeout:${ACTION_ID}`,
    });
  });

  it("cleans up the inert client when provisioning conflicts", async () => {
    const rpc = rpcFixture({ provisionFails: true });
    const openAuthorization = vi.fn();

    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        { openAuthorization }
      )
    ).rejects.toThrow("MCP canary acceptance failed at canary_provision");
    expect(openAuthorization).not.toHaveBeenCalled();
    expect(
      rpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("rejects a state mismatch and still proves cleanup", async () => {
    const rpc = rpcFixture();
    const fetcher = tokenFetcher();

    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          fetcher,
          openAuthorization: async (authorizationUrl) => {
            const redirect = new URL(
              authorizationUrl.searchParams.get("redirect_uri") ?? ""
            );
            redirect.search = new URLSearchParams({
              code: CODE,
              state: "wrong-state",
              iss: ISSUER,
            }).toString();
            await visitLoopback(redirect);
          },
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at consent_callback");
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      rpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("rejects denied consent and still proves cleanup", async () => {
    const rpc = rpcFixture();

    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          openAuthorization: async (authorizationUrl) => {
            const redirect = new URL(
              authorizationUrl.searchParams.get("redirect_uri") ?? ""
            );
            redirect.search = new URLSearchParams({
              error: "access_denied",
              state: authorizationUrl.searchParams.get("state") ?? "",
              iss: ISSUER,
            }).toString();
            expect(await visitLoopback(redirect)).toBe(
              "Consent stopped. Return to OPS."
            );
          },
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at consent_callback");
    expect(
      rpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("refuses an approval summary without the exact private proof and still proves cleanup", async () => {
    const rpc = rpcFixture();
    const fetcher = tokenFetcher();
    const openOperatorSurface = vi.fn();

    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          fetcher,
          openOperatorSurface,
          runHostAcceptance: async () => ({
            summary: HOST_SUMMARY,
            proof: null,
          }),
          openAuthorization: async (authorizationUrl) => {
            const redirect = new URL(
              authorizationUrl.searchParams.get("redirect_uri") ?? ""
            );
            redirect.search = new URLSearchParams({
              code: CODE,
              state: authorizationUrl.searchParams.get("state") ?? "",
              iss: ISSUER,
            }).toString();
            await visitLoopback(redirect);
          },
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at approval_fixture");
    expect(openOperatorSurface).not.toHaveBeenCalled();
    expect(
      rpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("redacts browser and token transport details and still proves cleanup", async () => {
    const browserRpc = rpcFixture();
    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: browserRpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          openAuthorization: async (authorizationUrl) => {
            throw new Error(`sensitive browser failure ${authorizationUrl}`);
          },
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at browser_open");
    expect(
      browserRpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);

    const tokenRpc = rpcFixture();
    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: tokenRpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          fetcher: async () => new Response("sensitive non-json response"),
          openAuthorization: async (authorizationUrl) => {
            const redirect = new URL(
              authorizationUrl.searchParams.get("redirect_uri") ?? ""
            );
            redirect.search = new URLSearchParams({
              code: CODE,
              state: authorizationUrl.searchParams.get("state") ?? "",
              iss: ISSUER,
            }).toString();
            await visitLoopback(redirect);
          },
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at token_response");
    expect(
      tokenRpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("cancels consent safely and still proves cleanup", async () => {
    const rpc = rpcFixture();
    const controller = new AbortController();

    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          signal: controller.signal,
          openAuthorization: async () => controller.abort(),
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at cancelled");
    expect(
      rpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("bounds a stalled operator proof RPC and still proves cleanup", async () => {
    const rpc = rpcFixture({ operatorProofStalls: true });

    await expect(
      runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          fetcher: tokenFetcher(),
          runHostAcceptance: async () => HOST_RESULT,
          openOperatorSurface: async () => undefined,
          operatorProofTimeoutMs: 1_000,
          operatorProofPollMs: 100,
          openAuthorization: async (authorizationUrl) => {
            const redirect = new URL(
              authorizationUrl.searchParams.get("redirect_uri") ?? ""
            );
            redirect.search = new URLSearchParams({
              code: CODE,
              state: authorizationUrl.searchParams.get("state") ?? "",
              iss: ISSUER,
            }).toString();
            await visitLoopback(redirect);
          },
        }
      )
    ).rejects.toThrow("MCP canary acceptance failed at operator_proof_timeout");
    expect(
      rpc.calls.some(
        ({ functionName }) =>
          functionName === "disable_mcp_oauth_canary_as_system"
      )
    ).toBe(true);
  });

  it("preserves both the primary and cleanup failure without leaking details", async () => {
    const rpc = rpcFixture({ cleanupFails: true });
    let caught: unknown;

    try {
      await runMcpV3CanaryAcceptance(
        {
          rpcClient: rpc.client,
          issuer: ISSUER,
          userId: USER_ID,
          companyId: COMPANY_ID,
        },
        {
          openAuthorization: async () => {
            throw new Error("sensitive primary detail");
          },
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.message).toBe(
      "MCP canary acceptance failed at acceptance_and_cleanup"
    );
    expect(aggregate.errors.map((error) => (error as Error).message)).toEqual([
      "MCP canary acceptance failed at browser_open",
      "MCP canary acceptance failed at cleanup",
    ]);
    expect(JSON.stringify(aggregate.errors)).not.toContain("sensitive");
  });

  it("times out an unused real loopback callback without exposing its URI", async () => {
    const receiver = await createLoopbackAuthorizationReceiver({
      timeoutMs: 5,
    });
    try {
      await expect(receiver.wait()).rejects.toThrow(
        "MCP canary acceptance failed at consent_timeout"
      );
    } finally {
      await receiver.close();
    }
  });
});

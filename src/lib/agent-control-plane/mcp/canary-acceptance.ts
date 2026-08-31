import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  runDayCloseoutHostAcceptance,
  type DayCloseoutHostAcceptanceSummary,
} from "./host-acceptance";

const EXPOSURE_REVISION = "2026-08-30.mcp-exposure.v3" as const;
const CONSENT_CATALOG_REVISION = "2026-08-30.mcp-consent-catalog.v2" as const;
const CANARY_SCOPES = Object.freeze([
  "ops.correspondence.read",
  "ops.financial_documents.read",
  "ops.jobs.read",
  "ops.operations.prepare",
  "ops.operations.read",
  "ops.schedule.read",
  "ops.tasks.read",
] as const);
const CANARY_SCOPE = CANARY_SCOPES.join(" ");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE_PATTERN = /^ops_mcp_ac_[A-Za-z0-9_-]{43}$/u;
const ACCESS_PATTERN = /^ops_mcp_at_[A-Za-z0-9_-]{43}$/u;
const REFRESH_PATTERN = /^ops_mcp_rt_[A-Za-z0-9_-]{43}$/u;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface CanaryAcceptanceRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
}

export interface CanaryAuthorizationCallback {
  readonly code: string | null;
  readonly state: string | null;
  readonly issuer: string | null;
  readonly error: string | null;
}

export interface CanaryAuthorizationReceiver {
  readonly redirectUri: string;
  wait(): Promise<CanaryAuthorizationCallback>;
  close(): Promise<void>;
}

export interface McpV3CanaryAcceptanceSummary {
  readonly status: "passed";
  readonly exposureRevision: typeof EXPOSURE_REVISION;
  readonly consentCatalogRevision: typeof CONSENT_CATALOG_REVISION;
  readonly oauth: {
    readonly authorizationCode: true;
    readonly refreshRotation: true;
    readonly refreshReuseRevoked: true;
    readonly bearerRejectedAfterRevocation: true;
  };
  readonly operator: {
    readonly approvalReceipt: true;
    readonly routineHandoff: true;
  };
  readonly host: DayCloseoutHostAcceptanceSummary;
  readonly cleanupVerified: true;
}

interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface CanaryAcceptanceDependencies {
  readonly fetcher?: Fetcher;
  readonly openAuthorization: (url: URL, signal?: AbortSignal) => Promise<void>;
  readonly openOperatorSurface?: (
    url: URL,
    signal?: AbortSignal
  ) => Promise<void>;
  readonly createReceiver?: () => Promise<CanaryAuthorizationReceiver>;
  readonly runHostAcceptance?: typeof runDayCloseoutHostAcceptance;
  readonly now?: () => number;
  readonly onProgress?: (
    stage: "waiting_for_consent" | "waiting_for_filing" | "waiting_for_routine"
  ) => void;
  readonly signal?: AbortSignal;
  readonly operatorProofTimeoutMs?: number;
  readonly operatorProofPollMs?: number;
}

function failure(stage: string): Error {
  return new Error(`MCP canary acceptance failed at ${stage}`);
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw failure("cancelled");
}

function boundedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function waitForAuthorization(
  receiver: CanaryAuthorizationReceiver,
  signal?: AbortSignal
): Promise<CanaryAuthorizationCallback> {
  if (!signal) return await receiver.wait();
  ensureNotAborted(signal);

  let cancel: (() => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(failure("cancelled"));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([receiver.wait(), cancellation]);
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(failure("cancelled"));
      return;
    }
    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      reject(failure("cancelled"));
    };
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    timeout.unref();
  });
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function s256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function exactHttpsOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw failure("configuration");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw failure("configuration");
  }
  url.pathname = "/";
  return url;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function rpc(
  client: CanaryAcceptanceRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
  stage: string
): Promise<unknown> {
  let result: { readonly data: unknown; readonly error: unknown };
  try {
    result = await client.rpc(functionName, args);
  } catch {
    throw failure(stage);
  }
  if (result.error != null) throw failure(stage);
  return result.data;
}

function oneRow(value: unknown, stage: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) throw failure(stage);
  const row = jsonObject(value[0]);
  if (!row) throw failure(stage);
  return row;
}

async function inspectOperatorProof(input: {
  readonly rpcClient: CanaryAcceptanceRpcClient;
  readonly clientId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly startedAt: string;
}): Promise<{
  readonly preparedWithApproval: boolean;
  readonly receiptVerified: boolean;
  readonly routineEnabled: boolean;
}> {
  const row = oneRow(
    await rpc(
      input.rpcClient,
      "inspect_mcp_oauth_canary_acceptance_as_system",
      {
        p_oauth_client_id: input.clientId,
        p_user_id: input.userId,
        p_company_id: input.companyId,
        p_not_before: input.startedAt,
      },
      "operator_proof"
    ),
    "operator_proof"
  );
  if (
    typeof row.prepared_with_approval !== "boolean" ||
    typeof row.receipt_verified !== "boolean" ||
    typeof row.routine_enabled !== "boolean"
  ) {
    throw failure("operator_proof");
  }
  return Object.freeze({
    preparedWithApproval: row.prepared_with_approval,
    receiptVerified: row.receipt_verified,
    routineEnabled: row.routine_enabled,
  });
}

async function waitForOperatorProof(input: {
  readonly rpcClient: CanaryAcceptanceRpcClient;
  readonly clientId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly startedAt: string;
  readonly requirement: "receipt" | "routine";
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  for (;;) {
    ensureNotAborted(input.signal);
    const proof = await inspectOperatorProof(input);
    if (!proof.preparedWithApproval) throw failure("operator_proof");
    if (
      proof.receiptVerified &&
      (input.requirement === "receipt" || proof.routineEnabled)
    ) {
      return;
    }
    if (Date.now() >= deadline) throw failure("operator_proof_timeout");
    await delay(Math.min(input.pollMs, deadline - Date.now()), input.signal);
  }
}

function parseTokenPair(value: unknown): TokenPair {
  const row = jsonObject(value);
  if (
    !row ||
    typeof row.access_token !== "string" ||
    !ACCESS_PATTERN.test(row.access_token) ||
    typeof row.refresh_token !== "string" ||
    !REFRESH_PATTERN.test(row.refresh_token) ||
    row.token_type !== "Bearer" ||
    row.scope !== CANARY_SCOPE
  ) {
    throw failure("token_response");
  }
  return Object.freeze({
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
  });
}

async function tokenRequest(
  fetcher: Fetcher,
  tokenEndpoint: URL,
  form: URLSearchParams,
  signal?: AbortSignal
): Promise<TokenPair> {
  let response: Response;
  try {
    response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: boundedSignal(30_000, signal),
    });
  } catch {
    throw failure("token_exchange");
  }
  if (!response.ok) throw failure("token_exchange");
  try {
    return parseTokenPair(await response.json());
  } catch {
    throw failure("token_response");
  }
}

async function expectRefreshReuseRevoked(
  fetcher: Fetcher,
  tokenEndpoint: URL,
  clientId: string,
  refreshToken: string,
  signal?: AbortSignal
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
      signal: boundedSignal(30_000, signal),
    });
  } catch {
    throw failure("refresh_reuse");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw failure("refresh_reuse");
  }
  if (response.status !== 400 || jsonObject(body)?.error !== "invalid_grant") {
    throw failure("refresh_reuse");
  }
}

async function expectBearerRejected(
  fetcher: Fetcher,
  endpoint: URL,
  bearer: string,
  signal?: AbortSignal
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
      signal: boundedSignal(30_000, signal),
    });
  } catch {
    throw failure("bearer_revocation");
  }
  if (response.status !== 401) throw failure("bearer_revocation");
}

async function listen(server: Server): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (!address || typeof address === "string") throw failure("loopback_bind");
  return address;
}

function sendLoopbackResponse(
  response: ServerResponse,
  status: number,
  body: string
): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  response.end(body);
}

export async function createLoopbackAuthorizationReceiver(input?: {
  readonly timeoutMs?: number;
}): Promise<CanaryAuthorizationReceiver> {
  const callbackId = base64url(randomBytes(18));
  const callbackPath = `/callback/${callbackId}`;
  let settle:
    | {
        resolve(value: CanaryAuthorizationCallback): void;
        reject(reason: Error): void;
      }
    | undefined;
  const callback = new Promise<CanaryAuthorizationCallback>(
    (resolve, reject) => {
      settle = { resolve, reject };
    }
  );
  let completed = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== callbackPath) {
      sendLoopbackResponse(response, 404, "Not found.");
      return;
    }
    if (completed) {
      sendLoopbackResponse(
        response,
        410,
        "Consent already received. Return to OPS."
      );
      return;
    }
    completed = true;
    const result = Object.freeze({
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      issuer: url.searchParams.get("iss"),
      error: url.searchParams.get("error"),
    });
    sendLoopbackResponse(
      response,
      200,
      result.error
        ? "Consent stopped. Return to OPS."
        : "Consent received. Return to OPS."
    );
    settle?.resolve(result);
  });
  let address: AddressInfo;
  try {
    address = await listen(server);
  } catch {
    throw failure("loopback_bind");
  }
  const timeoutMs = input?.timeoutMs ?? 300_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 900_000
  ) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw failure("configuration");
  }
  const timeout = setTimeout(() => {
    if (completed) return;
    completed = true;
    settle?.reject(failure("consent_timeout"));
  }, timeoutMs);
  timeout.unref();

  return Object.freeze({
    redirectUri: `http://127.0.0.1:${address.port}${callbackPath}`,
    async wait() {
      return await callback;
    },
    async close() {
      clearTimeout(timeout);
      await new Promise<void>((resolve) => {
        if (!server.listening) resolve();
        else server.close(() => resolve());
      });
    },
  });
}

export async function runMcpV3CanaryAcceptance(
  input: {
    readonly rpcClient: CanaryAcceptanceRpcClient;
    readonly issuer: string;
    readonly userId: string;
    readonly companyId: string;
    readonly expiresInMinutes?: number;
  },
  dependencies: CanaryAcceptanceDependencies
): Promise<McpV3CanaryAcceptanceSummary> {
  const issuer = exactHttpsOrigin(input.issuer);
  ensureNotAborted(dependencies.signal);
  if (!UUID_PATTERN.test(input.userId) || !UUID_PATTERN.test(input.companyId)) {
    throw failure("configuration");
  }
  const expiresInMinutes = input.expiresInMinutes ?? 30;
  if (
    !Number.isSafeInteger(expiresInMinutes) ||
    expiresInMinutes < 5 ||
    expiresInMinutes > 60
  ) {
    throw failure("configuration");
  }
  const operatorProofTimeoutMs = dependencies.operatorProofTimeoutMs ?? 600_000;
  const operatorProofPollMs = dependencies.operatorProofPollMs ?? 2_000;
  if (
    !Number.isSafeInteger(operatorProofTimeoutMs) ||
    operatorProofTimeoutMs < 1_000 ||
    operatorProofTimeoutMs > 900_000 ||
    !Number.isSafeInteger(operatorProofPollMs) ||
    operatorProofPollMs < 100 ||
    operatorProofPollMs > 10_000 ||
    operatorProofPollMs >= operatorProofTimeoutMs
  ) {
    throw failure("configuration");
  }

  const fetcher = dependencies.fetcher ?? fetch;
  let receiver: CanaryAuthorizationReceiver;
  try {
    receiver = await (
      dependencies.createReceiver ?? createLoopbackAuthorizationReceiver
    )();
  } catch {
    throw failure("loopback_bind");
  }
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = s256(verifier);
  const endpoint = new URL("/api/mcp", issuer);
  const tokenEndpoint = new URL("/api/mcp/oauth/token", issuer);
  const now = dependencies.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const hostAcceptance =
    dependencies.runHostAcceptance ?? runDayCloseoutHostAcceptance;
  let clientId: string | null = null;
  let result: Omit<McpV3CanaryAcceptanceSummary, "cleanupVerified"> | null =
    null;
  let primaryFailure: Error | null = null;

  try {
    ensureNotAborted(dependencies.signal);
    const registered = oneRow(
      await rpc(
        input.rpcClient,
        "register_mcp_oauth_client_as_system",
        {
          p_client_name: "OPS synthetic canary",
          p_redirect_uris: [receiver.redirectUri],
          p_scope: CANARY_SCOPE,
          p_scope_ceiling: [...CANARY_SCOPES],
          p_consent_catalog_revision: CONSENT_CATALOG_REVISION,
          p_exposure_revision: EXPOSURE_REVISION,
          p_software_id: "ops-mcp-synthetic-canary",
          p_software_version: "1",
        },
        "client_registration"
      ),
      "client_registration"
    );
    if (
      typeof registered.client_id !== "string" ||
      !UUID_PATTERN.test(registered.client_id) ||
      registered.scope !== CANARY_SCOPE ||
      registered.exposure_revision !== EXPOSURE_REVISION ||
      registered.consent_catalog_revision !== CONSENT_CATALOG_REVISION
    ) {
      throw failure("client_registration");
    }
    clientId = registered.client_id;
    ensureNotAborted(dependencies.signal);

    oneRow(
      await rpc(
        input.rpcClient,
        "provision_mcp_oauth_canary_as_system",
        {
          p_oauth_client_id: clientId,
          p_user_id: input.userId,
          p_company_id: input.companyId,
          p_exposure_revision: EXPOSURE_REVISION,
          p_consent_catalog_revision: CONSENT_CATALOG_REVISION,
          p_expires_at: new Date(
            now() + expiresInMinutes * 60_000
          ).toISOString(),
        },
        "canary_provision"
      ),
      "canary_provision"
    );
    ensureNotAborted(dependencies.signal);

    const authorizationUrl = new URL("/oauth/authorize", issuer);
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: receiver.redirectUri,
      response_type: "code",
      scope: CANARY_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: endpoint.toString(),
    }).toString();
    dependencies.onProgress?.("waiting_for_consent");
    try {
      await dependencies.openAuthorization(
        authorizationUrl,
        dependencies.signal
      );
    } catch {
      ensureNotAborted(dependencies.signal);
      throw failure("browser_open");
    }
    const authorization = await waitForAuthorization(
      receiver,
      dependencies.signal
    );
    if (
      authorization.error !== null ||
      authorization.code === null ||
      !CODE_PATTERN.test(authorization.code) ||
      authorization.state === null ||
      !sameSecret(authorization.state, state) ||
      authorization.issuer !== issuer.origin
    ) {
      throw failure("consent_callback");
    }

    const initial = await tokenRequest(
      fetcher,
      tokenEndpoint,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: authorization.code,
        redirect_uri: receiver.redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource: endpoint.toString(),
      }),
      dependencies.signal
    );
    const rotated = await tokenRequest(
      fetcher,
      tokenEndpoint,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: initial.refreshToken,
        client_id: clientId,
        resource: endpoint.toString(),
      }),
      dependencies.signal
    );
    let host: DayCloseoutHostAcceptanceSummary;
    try {
      host = await hostAcceptance({
        endpoint: endpoint.toString(),
        bearer: rotated.accessToken,
        idempotencyKey: `canary:${base64url(randomBytes(18))}`,
        fetcher,
        signal: dependencies.signal,
      });
    } catch {
      throw failure("host_acceptance");
    }
    if (host.filingKind !== "approval_required" || host.findingCount < 1) {
      throw failure("approval_fixture");
    }
    if (!dependencies.openOperatorSurface) {
      throw failure("operator_surface");
    }

    dependencies.onProgress?.("waiting_for_filing");
    try {
      await dependencies.openOperatorSurface(
        new URL("/agent/queue", issuer),
        dependencies.signal
      );
    } catch {
      ensureNotAborted(dependencies.signal);
      throw failure("operator_surface");
    }
    await waitForOperatorProof({
      rpcClient: input.rpcClient,
      clientId,
      userId: input.userId,
      companyId: input.companyId,
      startedAt,
      requirement: "receipt",
      timeoutMs: operatorProofTimeoutMs,
      pollMs: operatorProofPollMs,
      signal: dependencies.signal,
    });

    dependencies.onProgress?.("waiting_for_routine");
    try {
      await dependencies.openOperatorSurface(
        new URL("/settings?tab=integrations", issuer),
        dependencies.signal
      );
    } catch {
      ensureNotAborted(dependencies.signal);
      throw failure("operator_surface");
    }
    await waitForOperatorProof({
      rpcClient: input.rpcClient,
      clientId,
      userId: input.userId,
      companyId: input.companyId,
      startedAt,
      requirement: "routine",
      timeoutMs: operatorProofTimeoutMs,
      pollMs: operatorProofPollMs,
      signal: dependencies.signal,
    });

    await expectRefreshReuseRevoked(
      fetcher,
      tokenEndpoint,
      clientId,
      initial.refreshToken,
      dependencies.signal
    );
    await expectBearerRejected(
      fetcher,
      endpoint,
      rotated.accessToken,
      dependencies.signal
    );

    result = Object.freeze({
      status: "passed",
      exposureRevision: EXPOSURE_REVISION,
      consentCatalogRevision: CONSENT_CATALOG_REVISION,
      oauth: Object.freeze({
        authorizationCode: true,
        refreshRotation: true,
        refreshReuseRevoked: true,
        bearerRejectedAfterRevocation: true,
      }),
      operator: Object.freeze({
        approvalReceipt: true,
        routineHandoff: true,
      }),
      host,
    });
  } catch (error) {
    primaryFailure = error instanceof Error ? error : failure("unknown");
  }

  let cleanupFailure: Error | null = null;
  try {
    if (clientId !== null) {
      await rpc(
        input.rpcClient,
        "disable_mcp_oauth_canary_as_system",
        {
          p_oauth_client_id: clientId,
          p_user_id: input.userId,
          p_company_id: input.companyId,
        },
        "cleanup"
      );
      const binding = await rpc(
        input.rpcClient,
        "resolve_mcp_oauth_canary_as_system",
        {
          p_oauth_client_id: clientId,
          p_user_id: input.userId,
          p_company_id: input.companyId,
          p_exposure_revision: EXPOSURE_REVISION,
          p_consent_catalog_revision: CONSENT_CATALOG_REVISION,
        },
        "cleanup"
      );
      const client = oneRow(
        await rpc(
          input.rpcClient,
          "get_mcp_oauth_client_as_system",
          { p_client_id: clientId },
          "cleanup"
        ),
        "cleanup"
      );
      const grants = await rpc(
        input.rpcClient,
        "list_mcp_oauth_grants_for_user_as_system",
        { p_user_id: input.userId, p_company_id: input.companyId },
        "cleanup"
      );
      const routines = await rpc(
        input.rpcClient,
        "list_agent_day_closeout_routine_configs_as_system",
        { p_actor_user_id: input.userId, p_company_id: input.companyId },
        "cleanup"
      );
      const cleanup = oneRow(
        await rpc(
          input.rpcClient,
          "verify_mcp_oauth_canary_cleanup_as_system",
          {
            p_oauth_client_id: clientId,
            p_user_id: input.userId,
            p_company_id: input.companyId,
          },
          "cleanup"
        ),
        "cleanup"
      );
      if (
        !Array.isArray(binding) ||
        binding.length !== 0 ||
        client.disabled !== true ||
        !Array.isArray(grants) ||
        grants.length !== 0 ||
        !Array.isArray(routines) ||
        routines.length !== 0 ||
        cleanup.binding_inactive !== true ||
        cleanup.client_disabled !== true ||
        cleanup.grants_inactive !== true ||
        cleanup.tokens_inactive !== true ||
        cleanup.routines_safe !== true
      ) {
        throw failure("cleanup");
      }
    }
  } catch {
    cleanupFailure = failure("cleanup");
  }
  try {
    await receiver.close();
  } catch {
    cleanupFailure = failure("cleanup");
  }

  if (cleanupFailure) throw cleanupFailure;
  if (primaryFailure) throw primaryFailure;
  if (!result) throw failure("unknown");
  return Object.freeze({ ...result, cleanupVerified: true });
}

export const MCP_V3_CANARY_REVISIONS = Object.freeze({
  exposure: EXPOSURE_REVISION,
  consentCatalog: CONSENT_CATALOG_REVISION,
  scopes: CANARY_SCOPES,
});

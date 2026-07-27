import "server-only";

import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import {
  ExternalApiAuthError,
  type ExternalApiAuthRpcClient,
  type ExternalApiRequestActor,
  authenticateExternalApiCredential,
  inspectExternalApiPresentedPrefix,
} from "../auth/credential-auth";
import { readExternalApiCredentialHmacKeyRing } from "../auth/credential-secret";
import type { CredentialGrant, ExternalApiScope } from "../contracts/common";
import {
  ExternalApiSafeError,
  type ExternalApiErrorCode,
} from "../contracts/errors";
import { RequestBodyError } from "./request-body";
import {
  type ExternalRequestIdentity,
  createExternalRequestIdentity,
} from "./request-id";
import { createErrorResponse } from "./responses";
import {
  type ExternalApiAuditBaseEvidence,
  type ExternalApiAuditOutcome,
  type ExternalApiAuditRecorder,
  type ExternalApiAuditRpcClient,
  type ExternalApiCacheAuditResult,
  type ExternalApiIdempotencyAuditResult,
  commitExternalApiAuditBase,
  createSupabaseExternalApiAuditRecorder,
  isExternalApiAuditBaseFor,
} from "../security/audit";
import {
  type ExternalApiAuthenticatedRateLimitIdentities,
  type ExternalApiNetworkFingerprint,
  NetworkFingerprintUnavailableError,
  createExternalApiAuthenticatedRateLimitIdentities,
  createExternalApiNetworkFingerprint,
  readExternalApiNetworkHmacKeyRing,
} from "../security/network-fingerprint";
import {
  type ExternalApiRateLimitDecision,
  RateLimitUnavailableError,
  createConfiguredStrictRateLimiter,
} from "../security/strict-rate-limit";
import {
  recordExternalApiAuthorizationDenial,
  type ExternalApiAuthorizationDenialCode,
  type ExternalApiAuthorizationDenialClient,
} from "../security/security-alerts";

type ResponseClass = 2 | 3 | 4 | 5;

export type ExternalApiHandlerAudit = Readonly<{
  outcome: ExternalApiAuditOutcome;
  idempotencyResult: ExternalApiIdempotencyAuditResult;
  cacheResult: ExternalApiCacheAuditResult;
  metricSet: readonly string[];
  grouping: readonly string[];
  resultSize: number | null;
}>;

export type ExternalApiHandlerResult<TResult> = Readonly<{
  result: TResult;
  auditBase: ExternalApiAuditBaseEvidence;
  audit: ExternalApiHandlerAudit;
}>;

export type ExternalApiBoundaryHandlerContext<TInput> = Readonly<{
  request: Request;
  requestId: string;
  auditRequestId: string;
  requestReceivedAt: string;
  route: string;
  method: string;
  networkFingerprint: ExternalApiNetworkFingerprint;
  actor: ExternalApiRequestActor;
  input: TInput;
}>;

type AuthenticateInput = Readonly<{
  request: Request;
  requiredCredentialClass: CredentialGrant["credentialClass"];
  requiredScopes: readonly ExternalApiScope[];
}>;

type NetworkFingerprintInput = Readonly<{
  request: Request;
  presentedPrefix: string;
}>;

export interface ExternalApiBoundaryDependencies {
  createRequestIdentity(): ExternalRequestIdentity;
  inspectPresentedPrefix(request: Request): string;
  createNetworkFingerprint(
    input: NetworkFingerprintInput
  ): ExternalApiNetworkFingerprint;
  checkPreAuthRateLimit(input: {
    networkFingerprint: string;
    presentedPrefix: string;
  }): Promise<ExternalApiRateLimitDecision>;
  authenticate(input: AuthenticateInput): Promise<ExternalApiRequestActor>;
  createAuthenticatedRateLimitIdentities(
    actor: ExternalApiRequestActor
  ): ExternalApiAuthenticatedRateLimitIdentities;
  checkAuthenticatedRateLimit(input: {
    credentialClass: CredentialGrant["credentialClass"];
    principalIdentity: string;
    companyIdentity: string;
  }): Promise<ExternalApiRateLimitDecision>;
  recordAuthorizationDenial?(
    actor: ExternalApiRequestActor,
    code: ExternalApiAuthorizationDenialCode
  ): Promise<void>;
  audit: ExternalApiAuditRecorder;
  now(): Date;
}

export type ExternalApiRequestBoundaryConfig<TInput, TResult> = Readonly<{
  route: string;
  method: string;
  requiredCredentialClass: CredentialGrant["credentialClass"];
  requiredScopes: readonly ExternalApiScope[];
  parseRequest(request: Request): Promise<TInput>;
  handler(
    context: ExternalApiBoundaryHandlerContext<TInput>
  ): Promise<ExternalApiHandlerResult<TResult>>;
  createResponse(
    result: TResult,
    options: { requestId: string; serverTimestamp: string }
  ): Response;
  dependencies?: ExternalApiBoundaryDependencies;
}>;

type SafeBoundaryFailure = Readonly<{
  code: ExternalApiErrorCode;
  details?: ReadonlyArray<{
    reason:
      | "unsupported_content_type"
      | "body_missing"
      | "body_too_large"
      | "invalid_utf8"
      | "malformed_json"
      | "validation_failed";
  }>;
}>;

function createDefaultDependencies(): ExternalApiBoundaryDependencies {
  const limiter = createConfiguredStrictRateLimiter();
  let client:
    | (ExternalApiAuthRpcClient &
        ExternalApiAuditRpcClient &
        ExternalApiAuthorizationDenialClient)
    | undefined;
  let credentialKeyRing:
    | ReturnType<typeof readExternalApiCredentialHmacKeyRing>
    | undefined;
  let networkKeyRing:
    | ReturnType<typeof readExternalApiNetworkHmacKeyRing>
    | undefined;
  let auditRecorder: ExternalApiAuditRecorder | undefined;

  function serviceClient(): ExternalApiAuthRpcClient &
    ExternalApiAuditRpcClient &
    ExternalApiAuthorizationDenialClient {
    client ??= getServiceRoleClient() as unknown as ExternalApiAuthRpcClient &
      ExternalApiAuditRpcClient &
      ExternalApiAuthorizationDenialClient;
    return client;
  }

  function credentialKeys(): ReturnType<
    typeof readExternalApiCredentialHmacKeyRing
  > {
    try {
      credentialKeyRing ??= readExternalApiCredentialHmacKeyRing();
      return credentialKeyRing;
    } catch {
      throw new ExternalApiAuthError("temporarily_unavailable", 503);
    }
  }

  function networkKeys(): ReturnType<typeof readExternalApiNetworkHmacKeyRing> {
    try {
      networkKeyRing ??= readExternalApiNetworkHmacKeyRing();
      return networkKeyRing;
    } catch {
      throw new NetworkFingerprintUnavailableError();
    }
  }

  const defaultDependencies: ExternalApiBoundaryDependencies = {
    createRequestIdentity: createExternalRequestIdentity,
    inspectPresentedPrefix: inspectExternalApiPresentedPrefix,
    createNetworkFingerprint(input) {
      return createExternalApiNetworkFingerprint({
        ...input,
        keyRing: networkKeys(),
      });
    },
    checkPreAuthRateLimit(input) {
      return limiter.checkPreAuth(input);
    },
    async authenticate(input) {
      try {
        return await authenticateExternalApiCredential({
          ...input,
          keyRing: credentialKeys(),
          client: serviceClient(),
        });
      } catch (error) {
        if (error instanceof ExternalApiAuthError) throw error;
        throw new ExternalApiAuthError("temporarily_unavailable", 503);
      }
    },
    createAuthenticatedRateLimitIdentities(actor) {
      return createExternalApiAuthenticatedRateLimitIdentities(
        actor,
        networkKeys()
      );
    },
    checkAuthenticatedRateLimit(input) {
      return limiter.checkAuthenticated(input);
    },
    recordAuthorizationDenial(actor, code) {
      return recordExternalApiAuthorizationDenial(serviceClient(), actor, code);
    },
    get audit() {
      auditRecorder ??= createSupabaseExternalApiAuditRecorder(serviceClient());
      return auditRecorder;
    },
    now: () => new Date(),
  };
  return Object.freeze(defaultDependencies);
}

function responseClass(status: number): ResponseClass {
  const value = Math.floor(status / 100);
  return value === 2 || value === 3 || value === 4 || value === 5 ? value : 5;
}

function elapsedMilliseconds(start: Date, end: Date): number {
  const elapsed = end.getTime() - start.getTime();
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

function safeFailure(error: unknown): SafeBoundaryFailure {
  if (error instanceof ExternalApiAuthError) {
    return { code: error.code };
  }
  if (error instanceof ExternalApiSafeError) {
    return { code: error.code };
  }
  if (
    error instanceof RateLimitUnavailableError ||
    error instanceof NetworkFingerprintUnavailableError
  ) {
    return { code: "rate_limit_unavailable" };
  }
  if (error instanceof RequestBodyError) {
    return {
      code: "invalid_request",
      details: [{ reason: error.reason }],
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "invalid_request",
      details: [{ reason: "validation_failed" }],
    };
  }
  return { code: "internal_error" };
}

function failureOutcome(
  code: ExternalApiErrorCode
): Exclude<ExternalApiAuditOutcome, "accepted" | "conflict"> {
  if (code === "rate_limited") return "rate_limited";
  if (code === "submission_not_found" || code === "upload_not_found") {
    return "not_found";
  }
  if (code === "rate_limit_unavailable" || code === "temporarily_unavailable") {
    return "unavailable";
  }
  if (code === "internal_error") return "error";
  return "rejected";
}

function createFailureResponse(
  failure: SafeBoundaryFailure,
  identity: ExternalRequestIdentity,
  timestamp: Date
): Response {
  return createErrorResponse(failure.code, {
    requestId: identity.publicRequestId,
    serverTimestamp: timestamp.toISOString(),
    details: failure.details ? [...failure.details] : undefined,
  });
}

function applyRateLimitHeaders(
  response: Response,
  decision: ExternalApiRateLimitDecision
): Response {
  response.headers.set(
    "ratelimit-remaining",
    String(Math.max(0, Math.trunc(decision.remaining)))
  );
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.trunc(decision.retryAfterSeconds)))
  );
  return response;
}

async function recordFailureAudit(input: {
  dependencies: ExternalApiBoundaryDependencies;
  identity: ExternalRequestIdentity;
  route: string;
  method: string;
  receivedAt: Date;
  response: Response;
  failure: SafeBoundaryFailure;
  rateLimitResult: "allowed" | "denied" | "unavailable" | "not_applicable";
  networkFingerprint?: ExternalApiNetworkFingerprint;
}): Promise<boolean> {
  try {
    await input.dependencies.audit.recordPreAuth({
      requestId: input.identity.auditRequestId,
      route: input.route,
      method: input.method,
      requestReceivedAt: input.receivedAt,
      outcome: failureOutcome(input.failure.code),
      errorCode: input.failure.code,
      responseClass: responseClass(input.response.status),
      durationMs: elapsedMilliseconds(
        input.receivedAt,
        input.dependencies.now()
      ),
      rateLimitResult: input.rateLimitResult,
      networkFingerprint: input.networkFingerprint,
    });
    return true;
  } catch {
    return false;
  }
}

async function finalizePossibleAuthenticatedFailure(input: {
  dependencies: ExternalApiBoundaryDependencies;
  identity: ExternalRequestIdentity;
  receivedAt: Date;
  response: Response;
  failure: SafeBoundaryFailure;
}): Promise<boolean> {
  try {
    await input.dependencies.audit.finalizeAuthenticated({
      base: commitExternalApiAuditBase(input.identity.auditRequestId),
      outcome: failureOutcome(input.failure.code),
      errorCode: input.failure.code,
      responseClass: responseClass(input.response.status),
      durationMs: elapsedMilliseconds(
        input.receivedAt,
        input.dependencies.now()
      ),
      rateLimitResult: "allowed",
      idempotencyResult: "not_applicable",
      cacheResult: "not_applicable",
      metricSet: [],
      grouping: [],
      resultSize: null,
    });
    return true;
  } catch {
    return false;
  }
}

function rateLimitUnavailableResponse(
  identity: ExternalRequestIdentity,
  now: Date
): Response {
  return createFailureResponse(
    { code: "rate_limit_unavailable" },
    identity,
    now
  );
}

export function createExternalApiRequestBoundary<TInput, TResult>(
  config: ExternalApiRequestBoundaryConfig<TInput, TResult>
): (request: Request) => Promise<Response> {
  if (config.requiredScopes.length < 1) {
    throw new Error("external API boundary requires at least one scope");
  }
  const route = config.route;
  const method = config.method;
  const requiredCredentialClass = config.requiredCredentialClass;
  const requiredScopes = Object.freeze([...config.requiredScopes]);
  const parseRequest = config.parseRequest;
  const handler = config.handler;
  const createResponse = config.createResponse;
  const configuredDependencies = config.dependencies;
  let defaultDependencies: ExternalApiBoundaryDependencies | undefined;

  function dependencies(): ExternalApiBoundaryDependencies {
    if (configuredDependencies) return configuredDependencies;
    defaultDependencies ??= createDefaultDependencies();
    return defaultDependencies;
  }

  return async function handleExternalApiRequest(
    request: Request
  ): Promise<Response> {
    const deps = dependencies();
    const identity = deps.createRequestIdentity();
    const receivedAt = deps.now();
    let parsedInput: TInput | undefined;
    let parseSucceeded = false;
    let parseFailure: SafeBoundaryFailure | undefined;
    let networkFingerprint: ExternalApiNetworkFingerprint | undefined;
    let preAuthDecision: ExternalApiRateLimitDecision | undefined;
    let authenticatedDecision: ExternalApiRateLimitDecision | undefined;
    let actor: ExternalApiRequestActor | undefined;

    try {
      try {
        parsedInput = await parseRequest(request);
        parseSucceeded = true;
      } catch (error) {
        parseFailure = safeFailure(error);
      }

      const presentedPrefix = deps.inspectPresentedPrefix(request);
      networkFingerprint = deps.createNetworkFingerprint({
        request,
        presentedPrefix,
      });
      preAuthDecision = await deps.checkPreAuthRateLimit({
        networkFingerprint: networkFingerprint.redisIdentity,
        presentedPrefix,
      });

      if (!preAuthDecision.allowed) {
        const failure = { code: "rate_limited" } as const;
        const response = applyRateLimitHeaders(
          createFailureResponse(failure, identity, deps.now()),
          preAuthDecision
        );
        const audited = await recordFailureAudit({
          dependencies: deps,
          identity,
          route,
          method,
          receivedAt,
          response,
          failure,
          rateLimitResult: "denied",
          networkFingerprint,
        });
        return audited
          ? response
          : rateLimitUnavailableResponse(identity, deps.now());
      }

      actor = await deps.authenticate({
        request,
        requiredCredentialClass,
        requiredScopes,
      });
      const limiterIdentities =
        deps.createAuthenticatedRateLimitIdentities(actor);
      authenticatedDecision = await deps.checkAuthenticatedRateLimit({
        credentialClass: actor.credentialClass,
        principalIdentity: limiterIdentities.principalIdentity,
        companyIdentity: limiterIdentities.companyIdentity,
      });

      if (!authenticatedDecision.allowed) {
        const failure = { code: "rate_limited" } as const;
        const response = applyRateLimitHeaders(
          createFailureResponse(failure, identity, deps.now()),
          authenticatedDecision
        );
        const audited = await recordFailureAudit({
          dependencies: deps,
          identity,
          route,
          method,
          receivedAt,
          response,
          failure,
          rateLimitResult: "denied",
          networkFingerprint,
        });
        return audited
          ? response
          : rateLimitUnavailableResponse(identity, deps.now());
      }

      if (parseFailure || !parseSucceeded) {
        const failure = parseFailure ?? {
          code: "invalid_request",
          details: [{ reason: "validation_failed" as const }],
        };
        const response = createFailureResponse(failure, identity, deps.now());
        const audited = await recordFailureAudit({
          dependencies: deps,
          identity,
          route,
          method,
          receivedAt,
          response,
          failure,
          rateLimitResult: "allowed",
          networkFingerprint,
        });
        return audited
          ? response
          : rateLimitUnavailableResponse(identity, deps.now());
      }

      let handled: ExternalApiHandlerResult<TResult>;
      try {
        const handlerInput = parsedInput as TInput;
        handled = await handler(
          Object.freeze({
            request,
            requestId: identity.publicRequestId,
            auditRequestId: identity.auditRequestId,
            requestReceivedAt: receivedAt.toISOString(),
            route,
            method,
            networkFingerprint,
            actor,
            input: handlerInput,
          })
        );
      } catch (error) {
        let failure = safeFailure(error);
        if (
          actor &&
          deps.recordAuthorizationDenial &&
          (failure.code === "source_not_allowed" ||
            failure.code === "form_not_allowed")
        ) {
          try {
            await deps.recordAuthorizationDenial(actor, failure.code);
          } catch {
            failure = { code: "temporarily_unavailable" };
          }
        }
        const response = createFailureResponse(failure, identity, deps.now());
        const finalized = await finalizePossibleAuthenticatedFailure({
          dependencies: deps,
          identity,
          receivedAt,
          response,
          failure,
        });
        if (finalized) return response;
        const audited = await recordFailureAudit({
          dependencies: deps,
          identity,
          route,
          method,
          receivedAt,
          response,
          failure,
          rateLimitResult: "allowed",
          networkFingerprint,
        });
        return audited
          ? response
          : rateLimitUnavailableResponse(identity, deps.now());
      }

      if (
        !isExternalApiAuditBaseFor(handled.auditBase, identity.auditRequestId)
      ) {
        const failure = { code: "internal_error" } as const;
        const response = createFailureResponse(failure, identity, deps.now());
        const finalized = await finalizePossibleAuthenticatedFailure({
          dependencies: deps,
          identity,
          receivedAt,
          response,
          failure,
        });
        if (finalized) return response;
        const audited = await recordFailureAudit({
          dependencies: deps,
          identity,
          route,
          method,
          receivedAt,
          response,
          failure,
          rateLimitResult: "allowed",
          networkFingerprint,
        });
        return audited
          ? response
          : rateLimitUnavailableResponse(identity, deps.now());
      }

      let response: Response;
      try {
        response = createResponse(handled.result, {
          requestId: identity.publicRequestId,
          serverTimestamp: deps.now().toISOString(),
        });
      } catch {
        response = createFailureResponse(
          { code: "internal_error" },
          identity,
          deps.now()
        );
      }

      try {
        await deps.audit.finalizeAuthenticated({
          base: handled.auditBase,
          outcome: response.status >= 500 ? "error" : handled.audit.outcome,
          errorCode: response.status >= 500 ? "internal_error" : null,
          responseClass: responseClass(response.status),
          durationMs: elapsedMilliseconds(receivedAt, deps.now()),
          rateLimitResult: "allowed",
          idempotencyResult: handled.audit.idempotencyResult,
          cacheResult: handled.audit.cacheResult,
          metricSet: handled.audit.metricSet,
          grouping: handled.audit.grouping,
          resultSize: handled.audit.resultSize,
        });
      } catch {
        // The command/read already committed its authenticated base audit row.
        // Finalization is best-effort and must not erase or roll back the result.
        console.error("External API audit finalization failed");
      }
      return response;
    } catch (error) {
      const failure = safeFailure(error);
      const response = createFailureResponse(failure, identity, deps.now());
      const rateLimitResult =
        error instanceof RateLimitUnavailableError ||
        error instanceof NetworkFingerprintUnavailableError
          ? "unavailable"
          : preAuthDecision?.allowed
            ? authenticatedDecision?.allowed === false
              ? "denied"
              : "allowed"
            : "not_applicable";
      const audited = await recordFailureAudit({
        dependencies: deps,
        identity,
        route,
        method,
        receivedAt,
        response,
        failure,
        rateLimitResult,
        networkFingerprint,
      });
      return audited
        ? response
        : rateLimitUnavailableResponse(identity, deps.now());
    }
  };
}

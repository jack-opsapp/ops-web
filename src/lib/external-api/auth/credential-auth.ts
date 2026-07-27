import "server-only";

import { z } from "zod";

import type { CredentialGrant, ExternalApiScope } from "../contracts/common";
import type { ExternalApiErrorCode } from "../contracts/errors";
import {
  type ExternalApiHmacKeyRing,
  deriveCredentialLookupDigest,
} from "./credential-secret";
import {
  recordExternalApiAuthorizationDenial,
  type ExternalApiAuthorizationDenialCode,
} from "../security/security-alerts";

const MAX_AUTHORIZATION_HEADER_BYTES = 256;
const QUERY_CREDENTIAL_NAMES = new Set([
  "access_token",
  "api_key",
  "apikey",
  "authorization",
  "credential",
  "key",
  "secret",
  "token",
]);
const QUERY_CREDENTIAL_SEGMENTS = new Set([
  "authorization",
  "credential",
  "key",
  "secret",
  "token",
]);
const bearerCredentialPattern =
  /^opsx_([1-9][0-9]{0,4})_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/;

export class ExternalApiAuthError extends Error {
  constructor(
    readonly code: Extract<
      ExternalApiErrorCode,
      "invalid_credentials" | "insufficient_scope" | "temporarily_unavailable"
    >,
    readonly status: 401 | 403 | 503
  ) {
    super(code);
    this.name = "ExternalApiAuthError";
  }
}

export type ParsedExternalApiBearer = Readonly<{
  digestVersion: number;
  secret: string;
  visiblePrefix: string;
}>;

export type ExternalApiRequestActor = Readonly<{
  principalId: string;
  credentialId: string;
  companyId: string;
  credentialClass: CredentialGrant["credentialClass"];
  scopes: readonly ExternalApiScope[];
  allowedSourceIds: readonly string[];
  authorizationEpoch: number;
  digestVersion: number;
  credentialDigest: string;
  visiblePrefix: string;
}>;

export interface ExternalApiAuthRpcClient {
  rpc(
    name: "authenticate_external_api_credential_as_system",
    args: {
      p_digest_version: number;
      p_secret_digest: string;
      p_visible_prefix: string;
    }
  ): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
  rpc(
    name: "record_external_api_authorization_denial_as_system",
    args: {
      p_principal_id: string;
      p_credential_id: string;
      p_company_id: string;
      p_failure_code: ExternalApiAuthorizationDenialCode;
    }
  ): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
}

const authenticationRowSchema = z
  .object({
    authenticated: z.boolean(),
    denial_code: z.string().nullable(),
    principal_id: z.string().uuid().nullable(),
    credential_id: z.string().uuid().nullable(),
    company_id: z.string().uuid().nullable(),
    credential_class: z.enum(["intake", "analytics"]).nullable(),
    scopes: z.array(z.string()).nullable(),
    allowed_source_ids: z.array(z.string().uuid()).nullable(),
    authorization_epoch: z.number().int().positive().nullable(),
  })
  .strict();

function rejectInvalidCredentials(): never {
  throw new ExternalApiAuthError("invalid_credentials", 401);
}

function isCredentialLikeQueryName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (QUERY_CREDENTIAL_NAMES.has(normalized)) return true;
  return normalized
    .split(/[_-]/)
    .some((segment) => QUERY_CREDENTIAL_SEGMENTS.has(segment));
}

function requestUsesAlternateCredentialChannel(request: Request): boolean {
  if (request.headers.has("cookie")) return true;
  const url = new URL(request.url);
  for (const name of url.searchParams.keys()) {
    if (isCredentialLikeQueryName(name)) return true;
  }
  return false;
}

export function parseExternalApiBearer(
  request: Request
): ParsedExternalApiBearer {
  if (requestUsesAlternateCredentialChannel(request)) {
    return rejectInvalidCredentials();
  }

  const authorization = request.headers.get("authorization");
  if (
    authorization === null ||
    Buffer.byteLength(authorization, "utf8") > MAX_AUTHORIZATION_HEADER_BYTES ||
    authorization.includes(",") ||
    authorization.includes("\r") ||
    authorization.includes("\n")
  ) {
    return rejectInvalidCredentials();
  }
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) return rejectInvalidCredentials();

  const secret = match[1];
  const parsed = secret.match(bearerCredentialPattern);
  if (!parsed) return rejectInvalidCredentials();
  const digestVersion = Number(parsed[1]);
  if (digestVersion > 32_767) return rejectInvalidCredentials();

  return Object.freeze({
    digestVersion,
    secret,
    visiblePrefix: `opsx_${digestVersion}_${parsed[2]}`,
  });
}

export function inspectExternalApiPresentedPrefix(request: Request): string {
  if (requestUsesAlternateCredentialChannel(request)) return "malformed";
  const authorization = request.headers.get("authorization");
  if (
    authorization === null ||
    Buffer.byteLength(authorization, "utf8") > MAX_AUTHORIZATION_HEADER_BYTES ||
    authorization.includes(",")
  ) {
    return authorization === null ? "missing" : "malformed";
  }
  const match = authorization.match(
    /^Bearer (opsx_[1-9][0-9]{0,4}_[A-Za-z0-9_-]{12})_[A-Za-z0-9_-]{43}$/i
  );
  if (!match || match[1].length > 32) return "malformed";
  return match[1];
}

function byteaHex(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function immutableActor(
  row: z.infer<typeof authenticationRowSchema>,
  bearer: ParsedExternalApiBearer,
  lookupDigest: Uint8Array
): ExternalApiRequestActor {
  if (
    !row.authenticated ||
    !row.principal_id ||
    !row.credential_id ||
    !row.company_id ||
    !row.credential_class ||
    !row.scopes ||
    !row.allowed_source_ids ||
    !row.authorization_epoch
  ) {
    return rejectInvalidCredentials();
  }
  const parsedScopes = z
    .array(
      z.enum([
        "intake.write",
        "analytics.leads.read",
        "analytics.financial.read",
      ])
    )
    .parse(row.scopes);

  return Object.freeze({
    principalId: row.principal_id,
    credentialId: row.credential_id,
    companyId: row.company_id,
    credentialClass: row.credential_class,
    scopes: Object.freeze([...parsedScopes]),
    allowedSourceIds: Object.freeze([...row.allowed_source_ids]),
    authorizationEpoch: row.authorization_epoch,
    digestVersion: bearer.digestVersion,
    credentialDigest: byteaHex(lookupDigest),
    visiblePrefix: bearer.visiblePrefix,
  });
}

export async function authenticateExternalApiCredential(input: {
  request: Request;
  requiredCredentialClass: CredentialGrant["credentialClass"];
  requiredScopes: readonly ExternalApiScope[];
  keyRing: ExternalApiHmacKeyRing;
  client: ExternalApiAuthRpcClient;
}): Promise<ExternalApiRequestActor> {
  const bearer = parseExternalApiBearer(input.request);
  let lookupDigest: Buffer;
  try {
    lookupDigest = deriveCredentialLookupDigest(
      bearer.secret,
      bearer.digestVersion,
      input.keyRing
    );
  } catch {
    return rejectInvalidCredentials();
  }

  let response: { data: unknown; error: unknown };
  try {
    response = await input.client.rpc(
      "authenticate_external_api_credential_as_system",
      {
        p_digest_version: bearer.digestVersion,
        p_secret_digest: byteaHex(lookupDigest),
        p_visible_prefix: bearer.visiblePrefix,
      }
    );
  } catch {
    throw new ExternalApiAuthError("temporarily_unavailable", 503);
  }
  if (response.error) {
    throw new ExternalApiAuthError("temporarily_unavailable", 503);
  }

  const parsed = z
    .array(authenticationRowSchema)
    .length(1)
    .safeParse(response.data);
  if (!parsed.success) {
    throw new ExternalApiAuthError("temporarily_unavailable", 503);
  }
  const actor = immutableActor(parsed.data[0], bearer, lookupDigest);
  if (actor.credentialClass !== input.requiredCredentialClass) {
    try {
      await recordExternalApiAuthorizationDenial(
        input.client,
        actor,
        "insufficient_scope"
      );
    } catch {
      throw new ExternalApiAuthError("temporarily_unavailable", 503);
    }
    throw new ExternalApiAuthError("insufficient_scope", 403);
  }
  const grantedScopes = new Set(actor.scopes);
  if (!input.requiredScopes.every((scope) => grantedScopes.has(scope))) {
    try {
      await recordExternalApiAuthorizationDenial(
        input.client,
        actor,
        "insufficient_scope"
      );
    } catch {
      throw new ExternalApiAuthError("temporarily_unavailable", 503);
    }
    throw new ExternalApiAuthError("insufficient_scope", 403);
  }
  return actor;
}

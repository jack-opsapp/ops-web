import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import {
  type ExternalApiHmacKeyRing,
  parseExternalApiHmacKeyRing,
} from "../auth/credential-secret";

export class NetworkFingerprintUnavailableError extends Error {
  readonly code = "rate_limit_unavailable" as const;
  readonly status = 503;

  constructor() {
    super("rate_limit_unavailable");
    this.name = "NetworkFingerprintUnavailableError";
  }
}

export type ExternalApiNetworkFingerprint = Readonly<{
  version: number;
  digest: Buffer;
  redisIdentity: string;
  presentedPrefix: string;
}>;

export type ExternalApiAuthenticatedRateLimitIdentities = Readonly<{
  principalIdentity: string;
  companyIdentity: string;
}>;

function trustedClientAddress(request: Request): string {
  const candidate =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  if (
    !candidate ||
    candidate !== candidate.trim() ||
    candidate.includes(",") ||
    isIP(candidate) === 0
  ) {
    throw new NetworkFingerprintUnavailableError();
  }
  return candidate.toLowerCase();
}

function activeKey(keyRing: ExternalApiHmacKeyRing): Buffer {
  const key = keyRing.keys.get(keyRing.activeKid);
  if (!key) throw new NetworkFingerprintUnavailableError();
  return key;
}

function fingerprint(
  namespace: string,
  value: string,
  keyRing: ExternalApiHmacKeyRing
): Buffer {
  return createHmac("sha256", activeKey(keyRing))
    .update(`${namespace}\0${value}`, "utf8")
    .digest();
}

export function readExternalApiNetworkHmacKeyRing(): ExternalApiHmacKeyRing {
  return parseExternalApiHmacKeyRing(
    process.env.EXTERNAL_API_NETWORK_HMAC_KEYS,
    "EXTERNAL_API_NETWORK_HMAC_KEYS"
  );
}

export function createExternalApiNetworkFingerprint(input: {
  request: Request;
  keyRing: ExternalApiHmacKeyRing;
  presentedPrefix: string;
}): ExternalApiNetworkFingerprint {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.presentedPrefix)) {
    throw new NetworkFingerprintUnavailableError();
  }
  const address = trustedClientAddress(input.request);
  const digest = fingerprint("network", address, input.keyRing);
  return Object.freeze({
    version: input.keyRing.activeKid,
    digest,
    redisIdentity: digest.toString("base64url"),
    presentedPrefix: input.presentedPrefix,
  });
}

export function createExternalApiAuthenticatedRateLimitIdentities(
  actor: ExternalApiRequestActor,
  keyRing: ExternalApiHmacKeyRing
): ExternalApiAuthenticatedRateLimitIdentities {
  const principal = fingerprint("principal", actor.principalId, keyRing);
  const company = fingerprint("company", actor.companyId, keyRing);
  return Object.freeze({
    principalIdentity: principal.toString("base64url"),
    companyIdentity: company.toString("base64url"),
  });
}

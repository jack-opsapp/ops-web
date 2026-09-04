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
  rateLimitIdentity: string;
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

function parseIpv4Words(address: string): readonly [number, number] {
  const octets = address.split(".").map((octet) => Number(octet));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    throw new NetworkFingerprintUnavailableError();
  }
  return [octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]];
}

function parseIpv6Words(address: string): readonly number[] {
  if (address.includes("%")) {
    throw new NetworkFingerprintUnavailableError();
  }

  let hexadecimal = address;
  if (hexadecimal.includes(".")) {
    const lastColon = hexadecimal.lastIndexOf(":");
    if (lastColon < 0) throw new NetworkFingerprintUnavailableError();
    const [high, low] = parseIpv4Words(hexadecimal.slice(lastColon + 1));
    hexadecimal = `${hexadecimal.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = hexadecimal.split("::");
  if (halves.length > 2) throw new NetworkFingerprintUnavailableError();
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const compressedWordCount = 8 - left.length - right.length;
  if (
    (halves.length === 1 && compressedWordCount !== 0) ||
    (halves.length === 2 && compressedWordCount < 1)
  ) {
    throw new NetworkFingerprintUnavailableError();
  }

  const words = [
    ...left,
    ...Array.from({ length: compressedWordCount }, () => "0"),
    ...right,
  ].map((word) => {
    if (!/^[0-9a-f]{1,4}$/.test(word)) {
      throw new NetworkFingerprintUnavailableError();
    }
    return Number.parseInt(word, 16);
  });
  if (words.length !== 8) throw new NetworkFingerprintUnavailableError();
  return words;
}

function mappedIpv4Address(words: readonly number[]): string | null {
  if (words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) {
    return null;
  }
  return [
    words[6] >>> 8,
    words[6] & 0xff,
    words[7] >>> 8,
    words[7] & 0xff,
  ].join(".");
}

function addressForFingerprint(
  address: string,
  ipv6PrefixLength: 64 | undefined
): string {
  if (ipv6PrefixLength === undefined || isIP(address) === 4) return address;
  if (ipv6PrefixLength !== 64 || isIP(address) !== 6) {
    throw new NetworkFingerprintUnavailableError();
  }

  const words = parseIpv6Words(address);
  const mapped = mappedIpv4Address(words);
  if (mapped) return mapped;
  const prefix = words
    .slice(0, 4)
    .map((word) => word.toString(16).padStart(4, "0"))
    .join("");
  return `ipv6-prefix-64:${prefix}`;
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
  ipv6PrefixLength?: 64;
}): ExternalApiNetworkFingerprint {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(input.presentedPrefix)) {
    throw new NetworkFingerprintUnavailableError();
  }
  const address = trustedClientAddress(input.request);
  const digest = fingerprint(
    "network",
    addressForFingerprint(address, input.ipv6PrefixLength),
    input.keyRing
  );
  return Object.freeze({
    version: input.keyRing.activeKid,
    digest,
    rateLimitIdentity: digest.toString("base64url"),
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

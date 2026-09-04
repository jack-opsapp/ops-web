import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import { CustomerIdentityUnavailableError } from "./errors";
import type { CustomerAuthAdminClient, CustomerIdentityRpcClient } from "./rpc";

/**
 * Server-only configuration for the customer identity broker.
 *
 * The customer auth project is a separate Supabase project (design D1). Its
 * URL and secret key live only in server env, are never prefixed
 * `NEXT_PUBLIC_`, and are blank in production until Jackson's G1 gate. Blank
 * means every broker entry point fails closed with
 * `customer_identity_unavailable` before any network call.
 */

export const CUSTOMER_AUTH_URL_ENV = "OPS_CUSTOMER_AUTH_URL" as const;
export const CUSTOMER_AUTH_SECRET_KEY_ENV =
  "OPS_CUSTOMER_AUTH_SECRET_KEY" as const;
export const CUSTOMER_IDENTITY_HMAC_KEYS_ENV =
  "OPS_CUSTOMER_IDENTITY_HMAC_KEYS" as const;

const MINIMUM_HMAC_KEY_BYTES = 32;
const MAXIMUM_HMAC_KEY_BYTES = 64;
const MAXIMUM_VALIDATION_KEYS = 3;
const MAXIMUM_KEY_VERSION = 32_767;

export type CustomerIdentityHmacKeyRing = Readonly<{
  activeKid: number;
  keys: ReadonlyMap<number, Buffer>;
}>;

export interface CustomerIdentityConfig {
  readonly authUrl: string;
  readonly authSecretKey: string;
  readonly keyRing: CustomerIdentityHmacKeyRing;
}

/** Everything a broker operation needs; routes obtain it from `getCustomerIdentityDeps`. */
export interface CustomerIdentityDeps {
  /** Service-role client on the main OPS project (the `*_as_system` RPCs). */
  readonly rpc: CustomerIdentityRpcClient;
  /** Admin client on the dedicated customer auth project. */
  readonly auth: CustomerAuthAdminClient;
  readonly keyRing: CustomerIdentityHmacKeyRing;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

function malformed(name: string, reason: string): CustomerIdentityUnavailableError {
  return new CustomerIdentityUnavailableError("malformed", `${name} ${reason}`);
}

function parseKeyVersion(input: unknown, name: string, field: string): number {
  if (typeof input !== "string" || !/^[1-9][0-9]{0,4}$/.test(input)) {
    throw malformed(name, `${field} is malformed`);
  }
  const version = Number(input);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > MAXIMUM_KEY_VERSION
  ) {
    throw malformed(name, `${field} is out of range`);
  }
  return version;
}

function decodeKey(input: unknown, name: string, kid: string): Buffer {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw malformed(name, `key ${kid} is malformed`);
  }
  const decoded = Buffer.from(input, "base64url");
  if (decoded.toString("base64url") !== input) {
    throw malformed(name, `key ${kid} is malformed`);
  }
  if (decoded.byteLength < MINIMUM_HMAC_KEY_BYTES) {
    throw malformed(name, `key ${kid} must contain at least 32 bytes`);
  }
  if (decoded.byteLength > MAXIMUM_HMAC_KEY_BYTES) {
    throw malformed(name, `key ${kid} must contain at most 64 bytes`);
  }
  return decoded;
}

/**
 * Key ring format (identical to the intake credential ring):
 * `{"activeKid":"2","keys":{"1":"<base64url 32–64 bytes>","2":"<…>"}}`.
 * At most three keys so a rotation always has a bounded validation set.
 */
export function parseCustomerIdentityHmacKeyRing(
  serialized: string | undefined,
  name: string = CUSTOMER_IDENTITY_HMAC_KEYS_ENV
): CustomerIdentityHmacKeyRing {
  if (!serialized || serialized.trim() === "") {
    throw new CustomerIdentityUnavailableError("blank", `${name} is blank`);
  }

  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    throw malformed(name, "is malformed");
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw malformed(name, "is malformed");
  }
  const object = input as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    !Object.hasOwn(object, "activeKid") ||
    !Object.hasOwn(object, "keys") ||
    typeof object.keys !== "object" ||
    object.keys === null ||
    Array.isArray(object.keys)
  ) {
    throw malformed(name, "is malformed");
  }

  const activeKid = parseKeyVersion(object.activeKid, name, "activeKid");
  const entries = Object.entries(object.keys as Record<string, unknown>);
  if (entries.length < 1) {
    throw malformed(name, "must contain at least 1 key");
  }
  if (entries.length > MAXIMUM_VALIDATION_KEYS) {
    throw malformed(name, "must contain at most 3 keys");
  }

  const keys = new Map<number, Buffer>();
  const encodedMaterials = new Set<string>();
  for (const [kid, value] of entries) {
    const version = parseKeyVersion(kid, name, `key id ${kid}`);
    if (keys.has(version)) {
      throw malformed(name, "contains duplicate key versions");
    }
    const material = decodeKey(value, name, kid);
    const encodedMaterial = material.toString("base64url");
    if (encodedMaterials.has(encodedMaterial)) {
      throw malformed(name, "contains duplicate key material");
    }
    encodedMaterials.add(encodedMaterial);
    keys.set(version, material);
  }
  if (!keys.has(activeKid)) {
    throw malformed(name, "active key is unavailable");
  }

  return Object.freeze({
    activeKid,
    keys: keys as ReadonlyMap<number, Buffer>,
  });
}

function readRequired(env: EnvSource, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CustomerIdentityUnavailableError("blank", `${name} is blank`);
  }
  return value.trim();
}

function validateAuthUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw malformed(CUSTOMER_AUTH_URL_ENV, "is not a URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw malformed(CUSTOMER_AUTH_URL_ENV, "must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw malformed(CUSTOMER_AUTH_URL_ENV, "must not carry credentials");
  }
  if (parsed.search || parsed.hash) {
    throw malformed(CUSTOMER_AUTH_URL_ENV, "must be a bare origin");
  }
  return parsed.origin;
}

/**
 * Read and validate the broker configuration. Blank → `reason: "blank"`;
 * present but wrong → `reason: "malformed"`. Both fail closed.
 */
export function readCustomerIdentityConfig(
  env: EnvSource = process.env
): CustomerIdentityConfig {
  const authUrl = validateAuthUrl(readRequired(env, CUSTOMER_AUTH_URL_ENV));
  const authSecretKey = readRequired(env, CUSTOMER_AUTH_SECRET_KEY_ENV);
  const keyRing = parseCustomerIdentityHmacKeyRing(
    env[CUSTOMER_IDENTITY_HMAC_KEYS_ENV]
  );
  return Object.freeze({ authUrl, authSecretKey, keyRing });
}

let cachedAuthClient: {
  readonly authUrl: string;
  readonly authSecretKey: string;
  readonly client: CustomerAuthAdminClient;
} | null = null;

/**
 * Admin client on the customer auth project. Sessions are never persisted:
 * the broker discards every Supabase session the moment `verifyOtp` returns
 * (design §5.1) and only the broker's own opaque credential leaves the server.
 */
export function getCustomerAuthAdminClient(
  config: CustomerIdentityConfig
): CustomerAuthAdminClient {
  if (
    cachedAuthClient &&
    cachedAuthClient.authUrl === config.authUrl &&
    cachedAuthClient.authSecretKey === config.authSecretKey
  ) {
    return cachedAuthClient.client;
  }
  const client = createClient(config.authUrl, config.authSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  cachedAuthClient = {
    authUrl: config.authUrl,
    authSecretKey: config.authSecretKey,
    client,
  };
  return client;
}

/** Route entry point. Throws `CustomerIdentityUnavailableError` when unconfigured. */
export function getCustomerIdentityDeps(
  env: EnvSource = process.env
): CustomerIdentityDeps {
  const config = readCustomerIdentityConfig(env);
  return Object.freeze({
    rpc: getServiceRoleClient(),
    auth: getCustomerAuthAdminClient(config),
    keyRing: config.keyRing,
  });
}

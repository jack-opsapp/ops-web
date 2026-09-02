import "server-only";

import { z } from "zod";
import {
  createCredentialSecret,
  readExternalApiCredentialHmacKeyRing,
} from "@/lib/external-api/auth/credential-secret";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type { ExternalApiSettingsActor } from "./actor";

const UUID = z.string().uuid();
const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const NULLABLE_TIMESTAMP = ISO_TIMESTAMP.nullable();
const RAW_CREDENTIAL_PATTERN =
  /opsx_[1-9][0-9]{0,4}_[A-Za-z0-9_-]{6,32}_[A-Za-z0-9_-]{24,64}/;
const COARSE_SOURCE = z.enum([
  "referral",
  "website",
  "email",
  "phone",
  "walk_in",
  "social_media",
  "repeat_client",
  "other",
]);

function safeText(minimum: number, maximum: number) {
  return z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => !RAW_CREDENTIAL_PATTERN.test(value));
}

function safeTrimmedText(minimum: number, maximum: number) {
  return z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !RAW_CREDENTIAL_PATTERN.test(value));
}

const formProjectionSchema = z
  .object({
    formId: UUID,
    key: safeText(1, 80),
    label: safeText(1, 120),
    isDefault: z.boolean(),
    active: z.boolean(),
  })
  .strip();

const sourceProjectionSchema = z
  .object({
    sourceId: UUID,
    integrationType: safeText(1, 64).optional(),
    siteLabel: safeText(1, 120),
    canonicalHost: safeText(1, 253),
    defaultPhoneRegion: z.string().regex(/^[A-Z]{2}$/),
    allowedBrowserOrigins: z.array(safeText(1, 2_048)).max(32),
    defaultCoarseSource: COARSE_SOURCE,
    defaultIntakeOwnerId: UUID.nullable(),
    status: safeText(1, 32),
    createdAt: ISO_TIMESTAMP.optional(),
    updatedAt: ISO_TIMESTAMP,
    forms: z
      .array(formProjectionSchema)
      .min(1)
      .refine(
        (forms) =>
          forms.filter((form) => form.isDefault).length === 1 &&
          forms.some(
            (form) => form.key === "default" && form.isDefault === true
          ) &&
          uniqueByKey(forms, (form) => form.key),
        "source_default_form_required"
      ),
  })
  .strip();

const credentialProjectionSchema = z
  .object({
    credentialId: UUID,
    replacesCredentialId: UUID.optional(),
    name: safeText(1, 120),
    class: z.enum(["intake", "analytics"]),
    scopes: z.array(
      z.enum([
        "intake.write",
        "analytics.leads.read",
        "analytics.financial.read",
      ])
    ),
    sourceIds: z.array(UUID).optional(),
    prefix: safeText(8, 32),
    status: safeText(1, 32),
    createdByUserId: UUID.optional(),
    createdAt: ISO_TIMESTAMP.optional(),
    updatedAt: ISO_TIMESTAMP.optional(),
    lastUsedAt: NULLABLE_TIMESTAMP.optional(),
    expiresAt: NULLABLE_TIMESTAMP.optional(),
    overlapUntil: NULLABLE_TIMESTAMP.optional(),
    priorCredentialOverlapUntil: NULLABLE_TIMESTAMP.optional(),
    rejectionCount: z.number().int().nonnegative().optional(),
    recentRejectionCount: z.number().int().nonnegative().optional(),
  })
  .strip();

const listedSourceProjectionSchema = sourceProjectionSchema.extend({
  integrationType: safeText(1, 64),
  createdAt: ISO_TIMESTAMP,
});

const listedCredentialProjectionSchema = credentialProjectionSchema.extend({
  sourceIds: z.array(UUID),
  createdByUserId: UUID,
  createdAt: ISO_TIMESTAMP,
  updatedAt: ISO_TIMESTAMP,
  lastUsedAt: NULLABLE_TIMESTAMP,
  expiresAt: NULLABLE_TIMESTAMP,
  overlapUntil: NULLABLE_TIMESTAMP,
  rejectionCount: z.number().int().nonnegative(),
  recentRejectionCount: z.number().int().nonnegative(),
});

const settingsProjectionSchema = z
  .object({
    featureEnabled: z.literal(true),
    sources: z.array(listedSourceProjectionSchema),
    credentials: z.array(listedCredentialProjectionSchema),
  })
  .strip();

const revocationProjectionSchema = z
  .object({
    credentialId: UUID,
    status: z.literal("revoked"),
    revokedAt: ISO_TIMESTAMP,
    idempotent: z.boolean(),
  })
  .strip();

const customFormInputSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_-]*$/)
      .refine((key) => key !== "default" && !RAW_CREDENTIAL_PATTERN.test(key)),
    label: safeTrimmedText(1, 120),
    active: z.boolean(),
  })
  .strict();

function uniqueByKey<T>(
  values: readonly T[],
  getKey: (value: T) => string
): boolean {
  return new Set(values.map(getKey)).size === values.length;
}

const sourceFields = {
  siteLabel: safeTrimmedText(1, 120),
  canonicalHost: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/)
    .refine((host) => !host.includes("..")),
  defaultPhoneRegion: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  allowedBrowserOrigins: z
    .array(
      z
        .string()
        .url()
        .refine((origin) => !RAW_CREDENTIAL_PATTERN.test(origin))
    )
    .max(32)
    .refine((origins) => uniqueByKey(origins, (origin) => origin)),
  defaultCoarseSource: COARSE_SOURCE,
  defaultIntakeOwnerId: UUID.nullable(),
};

export const createSourceInputSchema = z
  .object({
    ...sourceFields,
    forms: z
      .array(customFormInputSchema)
      .max(50)
      .refine((forms) => uniqueByKey(forms, (form) => form.key)),
  })
  .strict();

export const updateSourceInputSchema = z
  .object({
    expectedUpdatedAt: ISO_TIMESTAMP,
    ...sourceFields,
    active: z.boolean(),
    forms: z
      .array(customFormInputSchema)
      .max(50)
      .refine((forms) => uniqueByKey(forms, (form) => form.key))
      .nullable(),
  })
  .strict();

const credentialBaseInputSchema = z
  .object({
    name: safeTrimmedText(1, 120),
    class: z.enum(["intake", "analytics"]),
    scopes: z.array(
      z.enum([
        "intake.write",
        "analytics.leads.read",
        "analytics.financial.read",
      ])
    ),
    sourceIds: z.array(UUID),
    expiresAt: NULLABLE_TIMESTAMP,
  })
  .strict();

export const createCredentialInputSchema =
  credentialBaseInputSchema.superRefine((value, context) => {
    if (!uniqueByKey(value.scopes, (scope) => scope)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "credential_scopes_duplicate",
      });
    }
    if (!uniqueByKey(value.sourceIds, (sourceId) => sourceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "credential_sources_duplicate",
      });
    }

    if (value.class === "intake") {
      if (
        value.scopes.length !== 1 ||
        value.scopes[0] !== "intake.write" ||
        value.sourceIds.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "credential_scope_policy_invalid",
        });
      }
      return;
    }

    const allowedAnalytics =
      value.sourceIds.length === 0 &&
      value.scopes.includes("analytics.leads.read") &&
      value.scopes.every(
        (scope) =>
          scope === "analytics.leads.read" ||
          scope === "analytics.financial.read"
      );
    if (!allowedAnalytics) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "credential_scope_policy_invalid",
      });
    }
  });

export const updateCredentialInputSchema = z
  .object({
    expectedUpdatedAt: ISO_TIMESTAMP,
    name: safeTrimmedText(1, 120),
    expiresAt: NULLABLE_TIMESTAMP,
  })
  .strict();

export const rotateCredentialInputSchema = z
  .object({
    expectedUpdatedAt: ISO_TIMESTAMP,
    overlapSeconds: z.number().int().min(0).max(86_400),
    expiresAt: NULLABLE_TIMESTAMP,
  })
  .strict();

export const revokeCredentialInputSchema = z
  .object({
    reasonCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .default("owner_revoked"),
  })
  .strict();

export class ExternalApiSettingsServiceError extends Error {
  constructor(
    readonly responseStatus: 400 | 403 | 404 | 409 | 500,
    readonly safeMessage: string
  ) {
    super(safeMessage);
    this.name = "ExternalApiSettingsServiceError";
  }
}

export function settingsRequestUsesJson(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
}

function isFutureOrNull(value: string | null): boolean {
  return value === null || new Date(value).getTime() > Date.now();
}

export function assertFutureExpiry(value: string | null): void {
  if (!isFutureOrNull(value)) {
    throw new ExternalApiSettingsServiceError(
      400,
      "Expiry must be in the future"
    );
  }
}

function byteaHex(input: Uint8Array): string {
  return `\\x${Buffer.from(input).toString("hex")}`;
}

function mapRpcFailure(error: { code?: string } | null): never {
  switch (error?.code) {
    case "42501":
      throw new ExternalApiSettingsServiceError(403, "Forbidden");
    case "P0002":
      throw new ExternalApiSettingsServiceError(404, "Not found");
    case "40001":
      throw new ExternalApiSettingsServiceError(409, "Settings changed");
    case "22023":
      throw new ExternalApiSettingsServiceError(400, "Invalid settings");
    case "23514":
      throw new ExternalApiSettingsServiceError(
        409,
        "Credential is not active"
      );
    default:
      throw new ExternalApiSettingsServiceError(500, "Settings unavailable");
  }
}

async function guardedRpc(
  name:
    | "list_external_api_settings_as_system"
    | "create_lead_intake_source_as_system"
    | "update_lead_intake_source_as_system"
    | "create_external_api_credential_as_system"
    | "update_external_api_credential_as_system"
    | "rotate_external_api_credential_as_system"
    | "revoke_external_api_credential_as_system",
  args: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await getServiceRoleClient().rpc(name, args);
  if (error) mapRpcFailure(error);
  return data;
}

function parseProjection<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ExternalApiSettingsServiceError(500, "Settings unavailable");
  }
  return parsed.data;
}

function actorArgs(actor: ExternalApiSettingsActor) {
  return { p_actor_user_id: actor.userId };
}

export async function listExternalApiSettings(actor: ExternalApiSettingsActor) {
  const data = await guardedRpc(
    "list_external_api_settings_as_system",
    actorArgs(actor)
  );
  return parseProjection(settingsProjectionSchema, data);
}

export async function createLeadIntakeSource(
  actor: ExternalApiSettingsActor,
  input: z.infer<typeof createSourceInputSchema>
) {
  const data = await guardedRpc("create_lead_intake_source_as_system", {
    ...actorArgs(actor),
    p_site_label: input.siteLabel,
    p_canonical_host: input.canonicalHost,
    p_default_phone_region: input.defaultPhoneRegion,
    p_allowed_browser_origins: input.allowedBrowserOrigins,
    p_default_coarse_source: input.defaultCoarseSource,
    p_default_intake_owner_id: input.defaultIntakeOwnerId,
    p_forms: input.forms,
  });
  return parseProjection(sourceProjectionSchema, data);
}

export async function updateLeadIntakeSource(
  actor: ExternalApiSettingsActor,
  sourceId: string,
  input: z.infer<typeof updateSourceInputSchema>
) {
  const data = await guardedRpc("update_lead_intake_source_as_system", {
    ...actorArgs(actor),
    p_source_id: sourceId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_site_label: input.siteLabel,
    p_canonical_host: input.canonicalHost,
    p_default_phone_region: input.defaultPhoneRegion,
    p_allowed_browser_origins: input.allowedBrowserOrigins,
    p_default_coarse_source: input.defaultCoarseSource,
    p_default_intake_owner_id: input.defaultIntakeOwnerId,
    p_active: input.active,
    p_forms: input.forms,
  });
  return parseProjection(sourceProjectionSchema, data);
}

export async function createExternalApiCredential(
  actor: ExternalApiSettingsActor,
  input: z.infer<typeof createCredentialInputSchema>
) {
  assertFutureExpiry(input.expiresAt);
  const secret = createCredentialSecret(readExternalApiCredentialHmacKeyRing());
  const scopes =
    input.class === "analytics" &&
    input.scopes.includes("analytics.financial.read")
      ? ["analytics.leads.read", "analytics.financial.read"]
      : input.scopes;

  const data = await guardedRpc("create_external_api_credential_as_system", {
    ...actorArgs(actor),
    p_name: input.name,
    p_credential_class: input.class,
    p_scopes: scopes,
    p_source_ids: input.sourceIds,
    p_digest_version: secret.digestVersion,
    p_secret_digest: byteaHex(secret.lookupDigest),
    p_visible_prefix: secret.visiblePrefix,
    p_expires_at: input.expiresAt,
  });
  return {
    credential: parseProjection(credentialProjectionSchema, data),
    secret: secret.secret,
  };
}

export async function updateExternalApiCredential(
  actor: ExternalApiSettingsActor,
  credentialId: string,
  input: z.infer<typeof updateCredentialInputSchema>
) {
  assertFutureExpiry(input.expiresAt);
  const data = await guardedRpc("update_external_api_credential_as_system", {
    ...actorArgs(actor),
    p_credential_id: credentialId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_name: input.name,
    p_expires_at: input.expiresAt,
  });
  return parseProjection(credentialProjectionSchema, data);
}

export async function rotateExternalApiCredential(
  actor: ExternalApiSettingsActor,
  credentialId: string,
  input: z.infer<typeof rotateCredentialInputSchema>
) {
  assertFutureExpiry(input.expiresAt);
  const secret = createCredentialSecret(readExternalApiCredentialHmacKeyRing());
  const data = await guardedRpc("rotate_external_api_credential_as_system", {
    ...actorArgs(actor),
    p_credential_id: credentialId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_digest_version: secret.digestVersion,
    p_secret_digest: byteaHex(secret.lookupDigest),
    p_visible_prefix: secret.visiblePrefix,
    p_overlap_seconds: input.overlapSeconds,
    p_expires_at: input.expiresAt,
  });
  return {
    credential: parseProjection(credentialProjectionSchema, data),
    secret: secret.secret,
  };
}

export async function revokeExternalApiCredential(
  actor: ExternalApiSettingsActor,
  credentialId: string,
  input: z.infer<typeof revokeCredentialInputSchema>
) {
  const data = await guardedRpc("revoke_external_api_credential_as_system", {
    ...actorArgs(actor),
    p_credential_id: credentialId,
    p_reason_code: input.reasonCode,
  });
  return parseProjection(revocationProjectionSchema, data);
}

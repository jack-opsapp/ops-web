import "server-only";

import { z } from "zod";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import {
  EXTERNAL_API_VERSION,
  MAX_ANSWER_COUNT,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BATCH_BYTES,
} from "../contracts/common";
import { ExternalApiSafeError } from "../contracts/errors";
import {
  acceptedUploadContentTypeSchema,
  intakeConfigResultSchema,
} from "../contracts/intake";
import { encodeOpaqueUuid } from "../contracts/opaque-id";
import { commitExternalApiAuditBase } from "../security/audit";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface ConfigRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface ConfigServiceDependencies {
  client?: ConfigRpcClient;
}

const configSourceSchema = z
  .object({
    public_source_id: z.string().uuid(),
    label: z.string(),
    canonical_site_host: z.string(),
    default_phone_region: z.string(),
    default_owner_configured: z.boolean(),
    forms: z.array(
      z
        .object({
          public_form_id: z.string().uuid(),
          label: z.string(),
          is_default: z.boolean(),
        })
        .strict()
    ),
  })
  .strict();

const configCommandSchema = z
  .object({
    status: z.literal("ready"),
    sources: z.array(configSourceSchema),
  })
  .strict();

function actorArguments(actor: ExternalApiRequestActor) {
  return {
    p_principal_id: actor.principalId,
    p_credential_id: actor.credentialId,
    p_company_id: actor.companyId,
    p_digest_version: actor.digestVersion,
    p_credential_digest: actor.credentialDigest,
    p_visible_prefix: actor.visiblePrefix,
    p_authorization_epoch: actor.authorizationEpoch,
  };
}

export async function getExternalIntakeConfig(
  input: Readonly<{
    actor: ExternalApiRequestActor;
    auditRequestId: string;
    requestReceivedAt: string;
  }>,
  dependencies: ConfigServiceDependencies = {}
) {
  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as ConfigRpcClient);
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc("get_external_intake_config_as_system", {
      p_request_id: input.auditRequestId,
      ...actorArguments(input.actor),
      p_route: "/v1/intake/config",
      p_method: "GET",
      p_request_received_at: input.requestReceivedAt,
    });
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (response.error) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  const parsed = configCommandSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  const result = intakeConfigResultSchema.parse({
    contractVersion: EXTERNAL_API_VERSION,
    sources: parsed.data.sources.map((source) => ({
      sourceId: encodeOpaqueUuid("src", source.public_source_id),
      label: source.label,
      canonicalSiteHost: source.canonical_site_host,
      defaultPhoneRegion: source.default_phone_region,
      defaultOwnerConfigured: source.default_owner_configured,
      forms: source.forms.map((form) => ({
        formId: encodeOpaqueUuid("frm", form.public_form_id),
        label: form.label,
        isDefault: form.is_default,
      })),
    })),
    acceptedFilePolicy: {
      contentTypes: acceptedUploadContentTypeSchema.options,
      maxFiles: MAX_FILES_PER_BATCH,
      maxFileBytes: MAX_FILE_BYTES,
      maxBatchBytes: MAX_UPLOAD_BATCH_BYTES,
    },
    requestLimits: {
      maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
      maxAnswers: MAX_ANSWER_COUNT,
    },
  });

  return {
    result,
    auditBase: commitExternalApiAuditBase(input.auditRequestId),
  };
}

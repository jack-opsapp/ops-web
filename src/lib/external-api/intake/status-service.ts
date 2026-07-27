import "server-only";

import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import { ExternalApiSafeError } from "../contracts/errors";
import {
  attachmentStateSchema,
  submissionStatusResultSchema,
} from "../contracts/intake";
import { decodeOpaqueUuid, encodeOpaqueUuid } from "../contracts/opaque-id";
import { commitExternalApiAuditBase } from "../security/audit";

interface StatusRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface StatusServiceDependencies {
  client?: StatusRpcClient;
}

const statusAttachmentSchema = z
  .object({
    public_upload_id: z.string().uuid(),
    caller_file_id: z.string(),
    state: attachmentStateSchema,
    safe_code: z.string().nullable(),
  })
  .strict();

const statusCommandSchema = z.union([
  z.object({ status: z.literal("not_found") }).strict(),
  z
    .object({
      status: z.literal("found"),
      public_submission_id: z.string().uuid(),
      public_lead_id: z.string().uuid(),
      created_at: z.string().datetime({ offset: true }),
      customer_outcome: z.enum([
        "created",
        "matched",
        "created_possible_duplicate",
      ]),
      attachments: z.array(statusAttachmentSchema).max(10),
      attachment_processing_terminal: z.boolean(),
      poll_after_seconds: z.number().int().min(5).max(300).nullable(),
    })
    .strict(),
]);

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

export async function getExternalIntakeSubmissionStatus(
  input: Readonly<{
    actor: ExternalApiRequestActor;
    auditRequestId: string;
    requestReceivedAt: string;
    publicSubmissionId: string;
  }>,
  dependencies: StatusServiceDependencies = {}
) {
  let publicSubmissionUuid: string;
  try {
    publicSubmissionUuid = decodeOpaqueUuid(input.publicSubmissionId, "sub");
  } catch {
    throw new ExternalApiSafeError("submission_not_found");
  }
  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as StatusRpcClient);
  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc(
      "get_external_intake_submission_status_as_system",
      {
        p_request_id: input.auditRequestId,
        ...actorArguments(input.actor),
        p_public_submission_id: publicSubmissionUuid,
        p_route: "/v1/intake/submissions/{publicSubmissionId}",
        p_method: "GET",
        p_request_received_at: input.requestReceivedAt,
      }
    );
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (response.error) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  const parsed = statusCommandSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (parsed.data.status === "not_found") {
    throw new ExternalApiSafeError("submission_not_found");
  }

  return {
    result: submissionStatusResultSchema.parse({
      publicSubmissionId: encodeOpaqueUuid(
        "sub",
        parsed.data.public_submission_id
      ),
      publicLeadId: encodeOpaqueUuid("lead", parsed.data.public_lead_id),
      createdAt: parsed.data.created_at,
      customerOutcome: parsed.data.customer_outcome,
      attachments: parsed.data.attachments.map((attachment) => ({
        uploadId: encodeOpaqueUuid("upl", attachment.public_upload_id),
        callerFileId: attachment.caller_file_id,
        state: attachment.state,
        safeCode: attachment.safe_code,
      })),
      attachmentProcessingTerminal: parsed.data.attachment_processing_terminal,
      pollAfterSeconds: parsed.data.poll_after_seconds,
    }),
    auditBase: commitExternalApiAuditBase(input.auditRequestId),
  };
}

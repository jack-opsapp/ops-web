import "server-only";

import { randomUUID } from "node:crypto";

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { InvalidPhoneError, normalizePhoneE164 } from "@/lib/sms/phone-utils";

import type { ExternalApiRequestActor } from "../auth/credential-auth";
import { ExternalApiSafeError } from "../contracts/errors";
import {
  submissionRequestSchema,
  submissionResultSchema,
  type SubmissionRequest,
} from "../contracts/intake";
import { decodeOpaqueUuid, encodeOpaqueUuid } from "../contracts/opaque-id";
import {
  getExternalIntakeWorkerS3Client,
  readExternalIntakeStorageConfig,
} from "../uploads/s3-client";
import {
  canonicalizeSubmission,
  normalizeAttributionUrl,
} from "./canonicalize";
import { commitExternalApiAuditBase } from "../security/audit";
import {
  canonicalizeContactIdentity,
  normalizeValidatedEmail,
} from "./contact-identity";
import {
  deriveActiveIdempotencyDigest,
  deriveIdempotencyLookupCandidates,
  readIdempotencyHmacKeyRing,
  type VersionedHmacKeyRing,
} from "./idempotency";
import {
  deriveAttributionLookupCandidates,
  readAttributionHmacKeyRing,
  type AttributionDimension,
} from "./source-attribution";
import {
  readEmailCorrelationKeyRing,
  sealEmailCorrelationMarker,
  type EmailCorrelationKeyRing,
} from "./email-correlation";

interface SubmissionRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface ExternalIntakeObjectHead {
  versionId: string;
  sizeBytes: number;
  checksumSha256: string | null;
  occurredAt: string;
}

interface SubmissionServiceDependencies {
  client?: SubmissionRpcClient;
  idempotencyKeyRing?: VersionedHmacKeyRing;
  attributionKeyRing?: VersionedHmacKeyRing;
  headObject?: (input: {
    objectKey: string;
  }) => Promise<ExternalIntakeObjectHead | null>;
  emailCorrelationKeyRing?: EmailCorrelationKeyRing;
  emailCorrelationNonceSource?: (size: number) => Buffer;
  randomUUID?: () => string;
}

const contextUploadSchema = z
  .object({
    public_upload_id: z.string().uuid(),
    storage_object_key: z.string().min(1).max(1024),
    state: z.enum([
      "issued",
      "uploaded",
      "claimed",
      "pending_inspection",
      "accepted",
      "rejected",
      "closed_missing",
      "expired",
    ]),
    expected_size_bytes: z.number().int().positive(),
    expected_checksum_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    object_version_id: z.string().nullable(),
    observed_size_bytes: z.number().int().positive().nullable(),
    observed_checksum_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

const readyContextSchema = z
  .object({
    status: z.literal("ready"),
    source_id: z.string().uuid(),
    form_id: z.string().uuid(),
    default_phone_region: z.string().regex(/^[A-Z]{2}$/),
    uploads: z.array(contextUploadSchema).max(10),
  })
  .strict();

const contextResultSchema = z.union([
  readyContextSchema,
  z
    .object({
      status: z.enum([
        "source_not_allowed",
        "form_not_allowed",
        "upload_not_found",
        "upload_scope_mismatch",
      ]),
    })
    .strict(),
]);

const commandAttachmentSchema = z
  .object({
    public_upload_id: z.string().uuid(),
    caller_file_id: z.string().min(1).max(128),
    state: z.enum([
      "accepted",
      "pending_inspection",
      "rejected",
      "missing",
      "expired",
    ]),
    safe_code: z.string().nullable(),
  })
  .strict();

const completedCommandSchema = z
  .object({
    status: z.enum(["created", "replayed"]),
    public_submission_id: z.string().uuid(),
    public_lead_id: z.string().uuid(),
    customer_outcome: z.enum([
      "created",
      "matched",
      "created_possible_duplicate",
    ]),
    lead_created_at: z.string().datetime({ offset: true }),
    initial_lead_stage: z.literal("new_lead"),
    replayed: z.boolean(),
    attachments: z.array(commandAttachmentSchema).max(10),
    email_correlation: z
      .object({
        company_id: z.string().uuid(),
        mailbox_id: z.string().uuid(),
        source_id: z.string().uuid(),
        submission_id: z.string().uuid(),
        lead_id: z.string().uuid(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const commandResultSchema = z.union([
  completedCommandSchema,
  z
    .object({
      status: z.enum([
        "source_not_allowed",
        "form_not_allowed",
        "idempotency_conflict",
        "external_submission_conflict",
        "upload_not_found",
        "upload_scope_mismatch",
        "upload_claim_conflict",
      ]),
    })
    .strict(),
]);

function byteaHex(hex: string | null): string | null {
  return hex === null ? null : `\\x${hex}`;
}

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

function base64ChecksumToHex(value: string | undefined): string | null {
  if (!value) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength !== 32 || bytes.toString("base64") !== value) {
    throw new Error("external_intake_object_checksum_invalid");
  }
  return bytes.toString("hex");
}

function isS3NotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    value.name === "NotFound" ||
    value.name === "NoSuchKey" ||
    value.Code === "NoSuchKey" ||
    value.$metadata?.httpStatusCode === 404
  );
}

async function headExternalIntakeObject(input: {
  objectKey: string;
}): Promise<ExternalIntakeObjectHead | null> {
  const config = readExternalIntakeStorageConfig();
  try {
    const result = await getExternalIntakeWorkerS3Client().send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
        ChecksumMode: "ENABLED",
      })
    );
    if (
      !result.VersionId ||
      !Number.isSafeInteger(result.ContentLength) ||
      !result.ContentLength ||
      result.ContentLength < 1
    ) {
      throw new Error("external_intake_object_evidence_invalid");
    }
    return {
      versionId: result.VersionId,
      sizeBytes: result.ContentLength,
      checksumSha256: base64ChecksumToHex(result.ChecksumSHA256),
      occurredAt: (result.LastModified ?? new Date()).toISOString(),
    };
  } catch (error) {
    if (isS3NotFound(error)) return null;
    throw error;
  }
}

function digestCandidates(
  candidates: ReturnType<typeof deriveIdempotencyLookupCandidates>
) {
  return candidates.map((candidate) => ({
    kid: candidate.kid,
    digest: byteaHex(candidate.digest),
  }));
}

type AttributionCandidateInput = Readonly<{
  dimension: AttributionDimension;
  rawValue: string;
}>;

function attributionInputs(
  attribution: SubmissionRequest["attribution"]
): AttributionCandidateInput[] {
  if (!attribution) return [];
  const candidates: AttributionCandidateInput[] = [];
  const append = (
    dimension: AttributionDimension,
    rawValue: string | undefined
  ) => {
    if (rawValue !== undefined) candidates.push({ dimension, rawValue });
  };
  append("campaign", attribution.externalCampaignId);
  append("utm_source", attribution.utmSource);
  append("utm_medium", attribution.utmMedium);
  append("utm_campaign", attribution.utmCampaign);
  append("utm_term", attribution.utmTerm);
  append("utm_content", attribution.utmContent);
  if (attribution.landingPageUrl) {
    const page = normalizeAttributionUrl(attribution.landingPageUrl);
    append("landing_path", `${page.host}\n${page.path}`);
  }
  if (attribution.referrerUrl) {
    const page = normalizeAttributionUrl(attribution.referrerUrl);
    append("referrer_path", `${page.host}\n${page.path}`);
  }
  return candidates;
}

function attributionCandidates(input: {
  companyId: string;
  sourceId: string;
  attribution: SubmissionRequest["attribution"];
  keyRing: VersionedHmacKeyRing;
  random: () => string;
}) {
  return attributionInputs(input.attribution).map((entry) => {
    const candidates = deriveAttributionLookupCandidates(
      {
        companyId: input.companyId,
        sourceId: input.sourceId,
        dimension: entry.dimension,
        rawValue: entry.rawValue,
      },
      input.keyRing
    );
    const active = candidates.find((candidate) => candidate.writeEligible);
    if (!active) {
      throw new Error("external intake attribution active key unavailable");
    }
    return {
      dimension: entry.dimension,
      activeKid: active.kid,
      activeDigest: byteaHex(active.digest),
      publicId: input.random(),
      candidates: candidates.map((candidate) => ({
        kid: candidate.kid,
        digest: byteaHex(candidate.digest),
      })),
    };
  });
}

async function resolveContext(input: {
  client: SubmissionRpcClient;
  actor: ExternalApiRequestActor;
  sourceId: string;
  formId: string;
  uploadIds: string[];
  requestedOrigin: string | null;
}) {
  let response: { data: unknown; error: unknown };
  try {
    response = await input.client.rpc(
      "resolve_external_intake_submission_context_as_system",
      {
        ...actorArguments(input.actor),
        p_source_public_id: input.sourceId,
        p_form_public_id: input.formId,
        p_public_upload_ids: input.uploadIds,
        p_requested_origin: input.requestedOrigin,
      }
    );
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (response.error) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  const parsed = contextResultSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  switch (parsed.data.status) {
    case "source_not_allowed":
      throw new ExternalApiSafeError("source_not_allowed");
    case "form_not_allowed":
      throw new ExternalApiSafeError("form_not_allowed");
    case "upload_not_found":
      throw new ExternalApiSafeError("upload_not_found");
    case "upload_scope_mismatch":
      throw new ExternalApiSafeError("invalid_request");
    case "ready":
      return parsed.data;
  }
}

async function reconcileDelayedUploads(input: {
  client: SubmissionRpcClient;
  uploads: z.infer<typeof contextUploadSchema>[];
  headObject: (input: {
    objectKey: string;
  }) => Promise<ExternalIntakeObjectHead | null>;
}) {
  for (const upload of input.uploads) {
    if (upload.state !== "issued" || upload.object_version_id !== null) {
      continue;
    }
    let observed: ExternalIntakeObjectHead | null;
    try {
      observed = await input.headObject({
        objectKey: upload.storage_object_key,
      });
    } catch {
      throw new ExternalApiSafeError("temporarily_unavailable");
    }
    if (observed === null) continue;
    if (
      observed.sizeBytes !== upload.expected_size_bytes ||
      (upload.expected_checksum_sha256 !== null &&
        observed.checksumSha256 !== upload.expected_checksum_sha256)
    ) {
      throw new ExternalApiSafeError("invalid_request");
    }
    const providerEventId = [
      "synchronous-head",
      upload.public_upload_id,
      observed.versionId,
    ].join(":");
    let response: { data: unknown; error: unknown };
    try {
      response = await input.client.rpc(
        "record_external_intake_object_event_as_system",
        {
          p_provider_event_id: providerEventId,
          p_event_type: "object_created",
          p_storage_object_key: upload.storage_object_key,
          p_object_version_id: observed.versionId,
          p_provider_sequencer: null,
          p_observed_size_bytes: observed.sizeBytes,
          p_observed_checksum_sha256: byteaHex(observed.checksumSha256),
          p_guardduty_status: null,
          p_occurred_at: observed.occurredAt,
        }
      );
    } catch {
      throw new ExternalApiSafeError("temporarily_unavailable");
    }
    if (response.error) {
      throw new ExternalApiSafeError("temporarily_unavailable");
    }
  }
}

function commandError(status: z.infer<typeof commandResultSchema>["status"]) {
  switch (status) {
    case "source_not_allowed":
      return new ExternalApiSafeError("source_not_allowed");
    case "form_not_allowed":
      return new ExternalApiSafeError("form_not_allowed");
    case "idempotency_conflict":
      return new ExternalApiSafeError("idempotency_conflict");
    case "external_submission_conflict":
      return new ExternalApiSafeError("external_submission_conflict");
    case "upload_not_found":
      return new ExternalApiSafeError("upload_not_found");
    case "upload_scope_mismatch":
    case "upload_claim_conflict":
      return new ExternalApiSafeError("invalid_request");
    default:
      return new ExternalApiSafeError("temporarily_unavailable");
  }
}

export async function createExternalIntakeSubmission(
  input: Readonly<{
    actor: ExternalApiRequestActor;
    auditRequestId: string;
    requestReceivedAt: string;
    idempotencyKey: string;
    requestedOrigin: string | null;
    submission: SubmissionRequest;
  }>,
  dependencies: SubmissionServiceDependencies = {}
) {
  const client =
    dependencies.client ??
    (getServiceRoleClient() as unknown as SubmissionRpcClient);
  const parsedSubmission = submissionRequestSchema.safeParse(input.submission);
  if (!parsedSubmission.success) {
    throw new ExternalApiSafeError("invalid_request");
  }

  let sourceId: string;
  let formId: string;
  let uploadIds: string[];
  try {
    sourceId = decodeOpaqueUuid(parsedSubmission.data.sourceId, "src");
    formId = decodeOpaqueUuid(parsedSubmission.data.formId, "frm");
    uploadIds = parsedSubmission.data.uploadIds.map((id) =>
      decodeOpaqueUuid(id, "upl")
    );
  } catch {
    throw new ExternalApiSafeError("invalid_request");
  }

  const context = await resolveContext({
    client,
    actor: input.actor,
    sourceId,
    formId,
    uploadIds,
    requestedOrigin: input.requestedOrigin,
  });
  if (
    context.source_id !== sourceId ||
    context.form_id !== formId ||
    context.uploads.length !== uploadIds.length
  ) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  await reconcileDelayedUploads({
    client,
    uploads: context.uploads,
    headObject: dependencies.headObject ?? headExternalIntakeObject,
  });

  let idempotencyKeyRing: VersionedHmacKeyRing;
  let attributionKeyRing: VersionedHmacKeyRing;
  try {
    idempotencyKeyRing =
      dependencies.idempotencyKeyRing ?? readIdempotencyHmacKeyRing();
    attributionKeyRing =
      dependencies.attributionKeyRing ?? readAttributionHmacKeyRing();
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }

  const canonical = canonicalizeSubmission(parsedSubmission.data, {
    defaultPhoneRegion: context.default_phone_region,
  });
  const contact = canonicalizeContactIdentity(parsedSubmission.data.contact, {
    defaultPhoneRegion: context.default_phone_region,
  });
  const idempotencyIdentity = {
    kind: "principal" as const,
    companyId: input.actor.companyId,
    principalId: input.actor.principalId,
    namespace: "submission" as const,
    key: input.idempotencyKey,
  };
  const activeIdempotency = deriveActiveIdempotencyDigest(
    idempotencyIdentity,
    idempotencyKeyRing
  );
  const idempotencyLookup = deriveIdempotencyLookupCandidates(
    idempotencyIdentity,
    idempotencyKeyRing
  );
  const externalIdentity = parsedSubmission.data.externalSubmissionId
    ? ({
        kind: "external_submission" as const,
        companyId: input.actor.companyId,
        sourceId,
        externalSubmissionId: parsedSubmission.data.externalSubmissionId,
      } as const)
    : null;
  const activeExternal = externalIdentity
    ? deriveActiveIdempotencyDigest(externalIdentity, idempotencyKeyRing)
    : null;
  const externalLookup = externalIdentity
    ? deriveIdempotencyLookupCandidates(externalIdentity, idempotencyKeyRing)
    : [];
  const random = dependencies.randomUUID ?? randomUUID;
  const attribution = attributionCandidates({
    companyId: input.actor.companyId,
    sourceId,
    attribution: parsedSubmission.data.attribution,
    keyRing: attributionKeyRing,
    random,
  });

  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc("create_external_intake_submission_as_system", {
      p_request_id: input.auditRequestId,
      ...actorArguments(input.actor),
      p_source_public_id: sourceId,
      p_form_public_id: formId,
      p_requested_origin: input.requestedOrigin,
      p_idempotency_digest_version: activeIdempotency.kid,
      p_idempotency_digest: byteaHex(activeIdempotency.digest),
      p_idempotency_candidates: digestCandidates(idempotencyLookup),
      p_external_submission_digest_version: activeExternal?.kid ?? null,
      p_external_submission_digest: byteaHex(activeExternal?.digest ?? null),
      p_external_submission_candidates: digestCandidates(externalLookup),
      p_canonicalization_version: canonical.version,
      p_canonical_request_hash: byteaHex(canonical.sha256),
      p_evidence_schema_version: 1,
      p_original_evidence: parsedSubmission.data,
      p_canonical_submission: canonical.value,
      p_normalized_contact: {
        name: contact.evidence.name,
        email: contact.normalizedEmail,
        phone: contact.normalizedPhone,
        organizationName:
          parsedSubmission.data.contact.organizationName ?? null,
      },
      p_upload_ids: uploadIds,
      p_attribution_candidates: attribution,
      p_route: "/v1/intake/submissions",
      p_method: "POST",
      p_request_received_at: input.requestReceivedAt,
    });
  } catch {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (response.error) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  const parsed = commandResultSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new ExternalApiSafeError("temporarily_unavailable");
  }
  if (parsed.data.status !== "created" && parsed.data.status !== "replayed") {
    throw commandError(parsed.data.status);
  }

  let emailCorrelationMarker: string | undefined;
  if (parsed.data.email_correlation !== null) {
    const correlation = parsed.data.email_correlation;
    if (correlation.company_id !== input.actor.companyId) {
      throw new ExternalApiSafeError("temporarily_unavailable");
    }
    try {
      const issuedAt = new Date(input.requestReceivedAt);
      const expiresAt = new Date(
        Math.floor(issuedAt.getTime() / 1000) * 1000 + 30 * 24 * 60 * 60 * 1000
      );
      emailCorrelationMarker = sealEmailCorrelationMarker(
        {
          companyId: correlation.company_id,
          mailboxId: correlation.mailbox_id,
          sourceId: correlation.source_id,
          submissionId: correlation.submission_id,
          leadId: correlation.lead_id,
          expiresAt,
        },
        dependencies.emailCorrelationKeyRing ?? readEmailCorrelationKeyRing(),
        dependencies.emailCorrelationNonceSource
      );
    } catch {
      throw new ExternalApiSafeError("temporarily_unavailable");
    }
  }

  return {
    result: submissionResultSchema.parse({
      publicSubmissionId: encodeOpaqueUuid(
        "sub",
        parsed.data.public_submission_id
      ),
      publicLeadId: encodeOpaqueUuid("lead", parsed.data.public_lead_id),
      customerOutcome: parsed.data.customer_outcome,
      leadCreatedAt: parsed.data.lead_created_at,
      initialLeadStage: parsed.data.initial_lead_stage,
      attachments: parsed.data.attachments.map((attachment) => ({
        uploadId: encodeOpaqueUuid("upl", attachment.public_upload_id),
        callerFileId: attachment.caller_file_id,
        state: attachment.state,
        safeCode: attachment.safe_code,
      })),
      ...(emailCorrelationMarker ? { emailCorrelationMarker } : {}),
      replayed: parsed.data.replayed,
    }),
    auditBase: commitExternalApiAuditBase(input.auditRequestId),
    idempotencyResult: parsed.data.replayed
      ? ("replay" as const)
      : ("new" as const),
  };
}

export function buildContactIdentityBackfillRows(
  rows: readonly Readonly<{
    entityKind: "client" | "sub_client";
    entityId: string;
    email: string | null;
    phone: string | null;
  }>[],
  options: Readonly<{ defaultPhoneRegion?: string }> = {}
) {
  return rows.map((row) => {
    let normalizedEmail: string | null = null;
    let normalizedPhone: string | null = null;
    if (row.email) {
      try {
        normalizedEmail = normalizeValidatedEmail(row.email);
      } catch {
        normalizedEmail = null;
      }
    }
    if (row.phone) {
      const reliableRegion = row.phone.trim().startsWith("+")
        ? undefined
        : options.defaultPhoneRegion;
      if (row.phone.trim().startsWith("+") || reliableRegion) {
        try {
          normalizedPhone = normalizePhoneE164(
            row.phone,
            (reliableRegion ?? "US") as Parameters<typeof normalizePhoneE164>[1]
          );
        } catch (error) {
          if (!(error instanceof InvalidPhoneError)) throw error;
        }
      }
    }
    return {
      entityKind: row.entityKind,
      entityId: row.entityId,
      normalizedEmail,
      normalizedPhone,
    };
  });
}

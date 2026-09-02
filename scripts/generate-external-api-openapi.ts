import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  MAX_ANSWER_COUNT,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BATCH_BYTES,
} from "../src/lib/external-api/contracts/common";
import {
  intakeConfigResultSchema,
  submissionRequestSchema,
  submissionResultSchema,
  submissionStatusResultSchema,
  uploadBatchRequestSchema,
  uploadBatchResultSchema,
} from "../src/lib/external-api/contracts/intake";
import {
  leadFeedQuerySchema,
  leadFeedResultSchema,
} from "../src/lib/external-api/contracts/lead-feed";
import {
  metricQuerySchema,
  metricsResultSchema,
} from "../src/lib/external-api/contracts/metrics";
import {
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from "../src/lib/external-api/http/responses";

const SOURCE_ID = `src_${"A".repeat(22)}`;
const FORM_ID = `frm_${"B".repeat(22)}`;
const UPLOAD_ID = `upl_${"C".repeat(22)}`;
const SUBMISSION_ID = `sub_${"D".repeat(22)}`;
const LEAD_ID = `lead_${"E".repeat(22)}`;
const EMAIL_MARKER = `emc_${"F".repeat(22)}`;
const EXAMPLE_TIME = "2026-07-27T18:00:00.000Z";

export const EXTERNAL_API_EXAMPLES = Object.freeze({
  intakeConfigResult: {
    contractVersion: "v1",
    sources: [
      {
        sourceId: SOURCE_ID,
        label: "Website",
        canonicalSiteHost: "quotes.example.com",
        defaultPhoneRegion: "CA",
        defaultOwnerConfigured: true,
        forms: [{ formId: FORM_ID, label: "Quote request", isDefault: true }],
      },
    ],
    acceptedFilePolicy: {
      contentTypes: ["image/jpeg", "application/pdf"],
      maxFiles: MAX_FILES_PER_BATCH,
      maxFileBytes: MAX_FILE_BYTES,
      maxBatchBytes: MAX_UPLOAD_BATCH_BYTES,
    },
    requestLimits: {
      maxJsonBodyBytes: MAX_JSON_BODY_BYTES,
      maxAnswers: MAX_ANSWER_COUNT,
    },
  },
  uploadBatchRequest: {
    sourceId: SOURCE_ID,
    formId: FORM_ID,
    files: [
      {
        callerFileId: "site-photo-1",
        filename: "site-photo.jpg",
        sizeBytes: 245_760,
        contentType: "image/jpeg",
      },
    ],
  },
  uploadBatchResult: {
    replayed: false,
    uploads: [
      {
        callerFileId: "site-photo-1",
        uploadId: UPLOAD_ID,
        state: "issued",
        capability: {
          method: "PUT",
          url: "https://uploads.example.com/reserved-object",
          expiresAt: EXAMPLE_TIME,
          requiredHeaders: {
            contentType: "image/jpeg",
            contentLength: 245_760,
            ifNoneMatch: "*",
          },
        },
      },
    ],
  },
  submissionRequest: {
    sourceId: SOURCE_ID,
    formId: FORM_ID,
    contact: {
      name: "Sample customer",
      email: "customer@example.com",
    },
    workSummary: "Replace the rear deck.",
    answers: [],
    uploadIds: [UPLOAD_ID],
    externalSubmissionId: "website-form-0001",
  },
  submissionResult: {
    publicSubmissionId: SUBMISSION_ID,
    publicLeadId: LEAD_ID,
    customerOutcome: "created",
    leadCreatedAt: EXAMPLE_TIME,
    initialLeadStage: "new_lead",
    attachments: [
      {
        uploadId: UPLOAD_ID,
        callerFileId: "site-photo-1",
        state: "pending_inspection",
        safeCode: null,
      },
    ],
    emailCorrelationMarker: EMAIL_MARKER,
    replayed: false,
  },
  submissionStatusResult: {
    publicSubmissionId: SUBMISSION_ID,
    publicLeadId: LEAD_ID,
    createdAt: EXAMPLE_TIME,
    customerOutcome: "created",
    attachments: [
      {
        uploadId: UPLOAD_ID,
        callerFileId: "site-photo-1",
        state: "accepted",
        safeCode: null,
      },
    ],
    attachmentProcessingTerminal: true,
    pollAfterSeconds: null,
  },
  leadFeedQuery: {
    mode: "full",
    pageSize: 100,
  },
  leadFeedResult: {
    mode: "full",
    dataThrough: EXAMPLE_TIME,
    items: [
      {
        operation: "delete",
        publicLeadId: LEAD_ID,
        deletedAt: EXAMPLE_TIME,
      },
    ],
    nextCursor: null,
    nextSyncCheckpoint: null,
  },
  metricQuery: {
    preset: "30d",
    metricIds: ["leads_received"],
    definitionVersion: "1",
    groupBy: [],
  },
  metricsResult: {
    from: "2026-06-27T07:00:00.000Z",
    to: "2026-07-27T07:00:00.000Z",
    timezone: "America/Vancouver",
    generatedAt: EXAMPLE_TIME,
    dataThrough: EXAMPLE_TIME,
    metricDefinitionVersion: "1",
    currency: null,
    includedMetricIds: ["leads_received"],
    results: [
      {
        metricId: "leads_received",
        definitionVersion: "1",
        basis: "received_cohort",
        population: "Leads first received during the selected range.",
        value: 42,
        unit: "count",
        numerator: 42,
        denominator: null,
        includedCount: 42,
        missingEvidenceCount: 0,
        grouping: null,
        currency: null,
        suppressed: false,
        cohortCount: 42,
        evidenceCoveragePercent: 100,
      },
    ],
  },
});

type JsonObject = Record<string, unknown>;

export interface ExternalApiOpenApiOperation extends JsonObject {
  security: Array<{ bearerAuth: never[] }>;
  "x-ops-required-scopes": string[];
}

export interface ExternalApiOpenApiDocument {
  openapi: "3.1.0";
  info: JsonObject;
  servers: JsonObject[];
  paths: Record<string, Record<string, ExternalApiOpenApiOperation>>;
  components: {
    securitySchemes: {
      bearerAuth: JsonObject;
    };
    schemas: Record<string, JsonObject>;
  };
}

function rewriteReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteReferences);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "$ref" && typeof entry === "string"
        ? entry.replace("#/definitions/", "#/components/schemas/")
        : rewriteReferences(entry),
    ])
  );
}

function schemaFromZod(schema: z.ZodTypeAny, name: string): JsonObject {
  const converted = zodToJsonSchema(schema, {
    name,
    target: "openApi3",
    errorMessages: false,
  }) as JsonObject & { definitions?: Record<string, JsonObject> };
  const definition = converted.definitions?.[name];
  if (!definition) {
    throw new Error(`OpenAPI schema generation failed for ${name}`);
  }
  return rewriteReferences(definition) as JsonObject;
}

function schemaReference(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

function successEnvelopeExample(result: unknown): JsonObject {
  return {
    requestId: "req_10000000-0000-4000-8000-000000000001",
    apiVersion: "v1",
    serverTimestamp: EXAMPLE_TIME,
    result,
  };
}

function successResponse(
  name: string,
  description: string,
  example: unknown
): JsonObject {
  return {
    description,
    content: {
      "application/json": {
        schema: schemaReference(name),
        example: successEnvelopeExample(example),
      },
    },
  };
}

function errorResponses(): Record<string, JsonObject> {
  const response = {
    description: "Safe error envelope.",
    content: {
      "application/json": {
        schema: schemaReference("ErrorEnvelope"),
      },
    },
  };
  return {
    "400": response,
    "401": response,
    "403": response,
    "409": response,
    "410": response,
    "422": response,
    "429": response,
    "500": response,
    "503": response,
  };
}

function operation(input: {
  operationId: string;
  summary: string;
  description: string;
  scope: "intake.write" | "analytics.leads.read";
  successSchema: string;
  successDescription: string;
  successExample: unknown;
  requestSchema?: string;
  requestExample?: unknown;
  runtimeQuerySchema?: string;
  parameters?: JsonObject[];
  successStatuses?: string[];
}): ExternalApiOpenApiOperation {
  const responses: Record<string, JsonObject> = {
    ...Object.fromEntries(
      (input.successStatuses ?? ["200"]).map((status) => [
        status,
        successResponse(
          input.successSchema,
          input.successDescription,
          input.successExample
        ),
      ])
    ),
    ...errorResponses(),
  };
  return {
    operationId: input.operationId,
    summary: input.summary,
    description: input.description,
    security: [{ bearerAuth: [] }],
    "x-ops-required-scopes": [input.scope],
    ...(input.runtimeQuerySchema
      ? {
          "x-ops-runtime-schema": schemaReference(input.runtimeQuerySchema),
        }
      : {}),
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: schemaReference(input.requestSchema),
                example: input.requestExample,
              },
            },
          },
        }
      : {}),
    responses,
  };
}

function queryParameter(
  name: string,
  description: string,
  schema: JsonObject,
  explode?: boolean
): JsonObject {
  return {
    name,
    in: "query",
    required: false,
    description,
    schema,
    ...(explode === undefined ? {} : { style: "form", explode }),
  };
}

export function generateExternalApiOpenApi(): ExternalApiOpenApiDocument {
  const schemas = {
    IntakeConfigSuccess: schemaFromZod(
      successEnvelopeSchema(intakeConfigResultSchema),
      "IntakeConfigSuccess"
    ),
    UploadBatchRequest: schemaFromZod(
      uploadBatchRequestSchema,
      "UploadBatchRequest"
    ),
    UploadBatchSuccess: schemaFromZod(
      successEnvelopeSchema(uploadBatchResultSchema),
      "UploadBatchSuccess"
    ),
    SubmissionRequest: schemaFromZod(
      submissionRequestSchema,
      "SubmissionRequest"
    ),
    SubmissionSuccess: schemaFromZod(
      successEnvelopeSchema(submissionResultSchema),
      "SubmissionSuccess"
    ),
    SubmissionStatusSuccess: schemaFromZod(
      successEnvelopeSchema(submissionStatusResultSchema),
      "SubmissionStatusSuccess"
    ),
    LeadFeedQuery: schemaFromZod(leadFeedQuerySchema, "LeadFeedQuery"),
    LeadFeedSuccess: schemaFromZod(
      successEnvelopeSchema(leadFeedResultSchema),
      "LeadFeedSuccess"
    ),
    MetricQuery: schemaFromZod(metricQuerySchema, "MetricQuery"),
    MetricsSuccess: schemaFromZod(
      successEnvelopeSchema(metricsResultSchema),
      "MetricsSuccess"
    ),
    ErrorEnvelope: schemaFromZod(errorEnvelopeSchema, "ErrorEnvelope"),
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "OPS External Lead API",
      version: "1.0.0",
      description:
        "Server-to-server lead intake, file handoff, privacy-safe lead sync, and versioned analytics.",
    },
    servers: [{ url: "https://app.opsapp.co" }],
    paths: {
      "/v1/intake/config": {
        get: operation({
          operationId: "getIntakeConfig",
          summary: "Read intake configuration",
          description:
            "Returns the sources, forms, and upload limits available to this intake credential. Requires intake.write.",
          scope: "intake.write",
          successSchema: "IntakeConfigSuccess",
          successDescription: "Current intake configuration.",
          successExample: EXTERNAL_API_EXAMPLES.intakeConfigResult,
        }),
      },
      "/v1/intake/uploads": {
        post: operation({
          operationId: "createUploadBatch",
          summary: "Reserve file uploads",
          description:
            "Creates an idempotent upload batch. Keep the OPS credential on your server; send only the returned single-use upload capability to the browser. Requires intake.write.",
          scope: "intake.write",
          successSchema: "UploadBatchSuccess",
          successDescription: "A new or replayed upload batch.",
          successExample: EXTERNAL_API_EXAMPLES.uploadBatchResult,
          requestSchema: "UploadBatchRequest",
          requestExample: EXTERNAL_API_EXAMPLES.uploadBatchRequest,
          successStatuses: ["200", "201"],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 8, maxLength: 128 },
            },
          ],
        }),
      },
      "/v1/intake/submissions": {
        post: operation({
          operationId: "createIntakeSubmission",
          summary: "Create a lead",
          description:
            "Creates or safely replays the original website submission and its lead/customer records. Later email belongs to the OPS email engine. Requires intake.write.",
          scope: "intake.write",
          successSchema: "SubmissionSuccess",
          successDescription: "A new or replayed lead submission.",
          successExample: EXTERNAL_API_EXAMPLES.submissionResult,
          requestSchema: "SubmissionRequest",
          requestExample: EXTERNAL_API_EXAMPLES.submissionRequest,
          successStatuses: ["200", "201"],
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 8, maxLength: 128 },
            },
          ],
        }),
      },
      "/v1/intake/submissions/{publicSubmissionId}": {
        get: operation({
          operationId: "getIntakeSubmission",
          summary: "Read submission status",
          description:
            "Returns safe file-processing state for the original submission. Requires intake.write.",
          scope: "intake.write",
          successSchema: "SubmissionStatusSuccess",
          successDescription: "Current submission and file-processing state.",
          successExample: EXTERNAL_API_EXAMPLES.submissionStatusResult,
          parameters: [
            {
              name: "publicSubmissionId",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^sub_[A-Za-z0-9_-]+$" },
            },
          ],
        }),
      },
      "/v1/analytics/leads": {
        get: operation({
          operationId: "getLeadFeed",
          summary: "Sync lead projections",
          description:
            "Returns all company lead projections without customer contact details. Commit a terminal full-sync checkpoint before requesting incremental changes. Requires analytics.leads.read.",
          scope: "analytics.leads.read",
          successSchema: "LeadFeedSuccess",
          runtimeQuerySchema: "LeadFeedQuery",
          successDescription: "A full or incremental page of lead projections.",
          successExample: EXTERNAL_API_EXAMPLES.leadFeedResult,
          parameters: [
            queryParameter("mode", "full or incremental", {
              type: "string",
              enum: ["full", "incremental"],
              default: "full",
            }),
            queryParameter("page_size", "Page size from 1 through 250.", {
              type: "integer",
              minimum: 1,
              maximum: 250,
              default: 100,
            }),
            queryParameter("cursor", "Opaque page cursor.", {
              type: "string",
            }),
            queryParameter(
              "sync_checkpoint",
              "Committed checkpoint required for incremental sync.",
              { type: "string" }
            ),
            queryParameter(
              "stage",
              "Repeat to include more than one lead stage.",
              { type: "array", items: { type: "string" } },
              true
            ),
            queryParameter(
              "disposition",
              "Repeat to include more than one terminal disposition.",
              { type: "array", items: { type: "string" } },
              true
            ),
            queryParameter(
              "record_state",
              "Repeat to include more than one record state.",
              { type: "array", items: { type: "string" } },
              true
            ),
            queryParameter(
              "inquiry_received_from",
              "Inclusive inquiry-received lower bound.",
              { type: "string", format: "date-time" }
            ),
            queryParameter(
              "inquiry_received_to",
              "Exclusive inquiry-received upper bound.",
              { type: "string", format: "date-time" }
            ),
            queryParameter("updated_from", "Inclusive updated lower bound.", {
              type: "string",
              format: "date-time",
            }),
            queryParameter("updated_to", "Exclusive updated upper bound.", {
              type: "string",
              format: "date-time",
            }),
            queryParameter("source_id", "Opaque source filter.", {
              type: "string",
            }),
            queryParameter("campaign_handle", "Opaque campaign filter.", {
              type: "string",
            }),
            queryParameter("form_id", "Opaque form filter.", {
              type: "string",
            }),
          ],
          requestSchema: undefined,
        }),
      },
      "/v1/analytics/metrics": {
        get: operation({
          operationId: "getLeadMetrics",
          summary: "Read versioned lead metrics",
          description:
            "Returns metrics with explicit population, denominator, evidence coverage, suppression, timezone, and definition version. Financial metrics additionally require analytics.financial.read.",
          scope: "analytics.leads.read",
          successSchema: "MetricsSuccess",
          runtimeQuerySchema: "MetricQuery",
          successDescription: "Versioned metric cells and evidence coverage.",
          successExample: EXTERNAL_API_EXAMPLES.metricsResult,
          parameters: [
            queryParameter("preset", "7d, 30d, 90d, lifetime, or custom.", {
              type: "string",
              enum: ["7d", "30d", "90d", "lifetime", "custom"],
              default: "30d",
            }),
            queryParameter(
              "metric",
              "Repeat for every requested metric.",
              { type: "array", items: { type: "string" }, minItems: 1 },
              true
            ),
            queryParameter(
              "group_by",
              "Repeat for up to one time and one source dimension.",
              { type: "array", items: { type: "string" }, maxItems: 2 },
              true
            ),
            queryParameter("from", "Company-local custom range start.", {
              type: "string",
            }),
            queryParameter("to", "Company-local custom range end.", {
              type: "string",
            }),
            queryParameter("definition_version", "Metric definition version.", {
              type: "string",
              default: "1",
            }),
            queryParameter("source_id", "Opaque source filter.", {
              type: "string",
            }),
            queryParameter("campaign_handle", "Opaque campaign filter.", {
              type: "string",
            }),
            queryParameter("form_id", "Opaque form filter.", {
              type: "string",
            }),
          ],
        }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "OPS external credential",
          description:
            "Load this credential from a server-side secret. Never place it in browser code, source control, logs, URLs, or analytics.",
        },
      },
      schemas,
    },
  };
}

export function serializeExternalApiOpenApi(): string {
  return `${JSON.stringify(generateExternalApiOpenApi(), null, 2)}\n`;
}

function writeOpenApiArtifact(): void {
  const target = resolve(process.cwd(), "docs/api/openapi-v1.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serializeExternalApiOpenApi(), "utf8");
}

const executedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === executedPath) {
  writeOpenApiArtifact();
}

import { describe, expect, it } from "vitest";

import {
  EXTERNAL_API_VERSION,
  MAX_ANSWER_COUNT,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_UPLOAD_BATCH_BYTES,
  analyticsGrantSchema,
  attachmentResultSchema,
  credentialGrantSchema,
  idempotencyIdentitySchema,
  idempotencyKeySchema,
  intakeConfigResultSchema,
  intakeGrantSchema,
  leadFeedQuerySchema,
  leadFeedResultSchema,
  leadProjectionSchema,
  metricQuerySchema,
  metricsResultSchema,
  opaqueCursorSchema,
  opaqueFormIdSchema,
  opaqueLeadIdSchema,
  opaqueSourceIdSchema,
  opaqueSubmissionIdSchema,
  opaqueUploadIdSchema,
  serializeLeadProjection,
  sourceAttributionSchema,
  submissionRequestSchema,
  submissionResultSchema,
  submissionStatusResultSchema,
  timestampSchema,
  uploadBatchRequestSchema,
  uploadBatchResultSchema,
} from "@/lib/external-api/contracts";
import {
  externalApiErrorCodeSchema,
  externalApiErrorDefinitions,
  getExternalApiErrorStatus,
} from "@/lib/external-api/contracts/errors";

const sourceId = "src_0123456789abcdefghijklm";
const formId = "frm_0123456789abcdefghijklm";
const uploadId = "upl_0123456789abcdefghijklm";
const submissionId = "sub_0123456789abcdefghijklm";
const leadId = "lead_0123456789abcdefghijklm";
const timestamp = "2026-07-24T17:30:00.000Z";

const attribution = {
  sourceChannel: "website",
  sourceIntegrationType: "external_intake",
  sourceId,
  sourceLabel: "Main website",
  siteHost: "example.ca",
  siteLabel: "Main website",
  formId,
  formLabel: "Estimate request",
  campaign: {
    present: true,
    handle: "cmp_0123456789abcdefghijklm",
    label: "Summer decks",
  },
  utm: {
    source: {
      present: true,
      handle: "attr_0123456789abcdefghijkl",
      label: "Google",
    },
    medium: { present: false, handle: null, label: null },
    campaign: { present: false, handle: null, label: null },
    term: { present: false, handle: null, label: null },
    content: { present: false, handle: null, label: null },
  },
  click: { providerCode: "google_ads", captured: true },
  landingPage: {
    host: "example.ca",
    pathHandle: "path_0123456789abcdefghijkl",
    routeLabel: "Decks",
  },
  referrer: {
    host: "google.ca",
    pathHandle: "path_abcdefghijklmnopqrstuvwxyz",
    routeLabel: null,
  },
  inquiryReceivedAt: timestamp,
  leadCreatedAt: timestamp,
  attributionCapturedAt: timestamp,
  timingSource: "authenticated_request",
  timingQuality: "exact",
  completeness: {
    channelKnown: true,
    authenticatedSite: true,
    configuredForm: true,
    campaignObserved: true,
    utmSetObserved: true,
    landingPageObserved: true,
    referrerObserved: true,
  },
} as const;

describe("external API common contract", () => {
  it("accepts prefixed opaque identifiers and rejects raw database UUIDs", () => {
    expect(opaqueSourceIdSchema.parse(sourceId)).toBe(sourceId);
    expect(opaqueFormIdSchema.parse(formId)).toBe(formId);
    expect(opaqueUploadIdSchema.parse(uploadId)).toBe(uploadId);
    expect(opaqueSubmissionIdSchema.parse(submissionId)).toBe(submissionId);
    expect(opaqueLeadIdSchema.parse(leadId)).toBe(leadId);
    expect(() =>
      opaqueLeadIdSchema.parse("550e8400-e29b-41d4-a716-446655440000")
    ).toThrow();
  });

  it("requires timezone-qualified timestamps and opaque authenticated cursors", () => {
    expect(timestampSchema.parse(timestamp)).toBe(timestamp);
    expect(() => timestampSchema.parse("2026-07-24 17:30:00")).toThrow();
    expect(
      opaqueCursorSchema.parse(
        "cur_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
      )
    ).toBeTruthy();
    expect(() => opaqueCursorSchema.parse("101")).toThrow();
  });

  it("validates bounded idempotency keys inside explicit namespaces", () => {
    expect(
      idempotencyIdentitySchema.parse({
        namespace: "upload_batch",
        key: "website-request-0001",
      })
    ).toEqual({
      namespace: "upload_batch",
      key: "website-request-0001",
    });
    expect(
      idempotencyIdentitySchema.parse({
        namespace: "submission",
        key: "website-request-0001",
      }).namespace
    ).toBe("submission");
    expect(() => idempotencyKeySchema.parse("short")).toThrow();
    expect(() =>
      idempotencyKeySchema.parse("contains customer@example.ca")
    ).toThrow();
    expect(() =>
      idempotencyIdentitySchema.parse({
        namespace: "uploads",
        key: "website-request-0001",
      })
    ).toThrow();
    expect(() =>
      idempotencyIdentitySchema.parse({
        namespace: "submission",
        key: "website-request-0001",
        companyId: "must-not-be-callable",
      })
    ).toThrow();
  });

  it("keeps intake and analytics grants separate and makes financial additive", () => {
    expect(
      intakeGrantSchema.parse({
        credentialClass: "intake",
        scopes: ["intake.write"],
        allowedSourceIds: [sourceId],
      })
    ).toBeTruthy();
    expect(
      analyticsGrantSchema.parse({
        credentialClass: "analytics",
        scopes: ["analytics.leads.read", "analytics.financial.read"],
      })
    ).toBeTruthy();
    expect(() =>
      analyticsGrantSchema.parse({
        credentialClass: "analytics",
        scopes: ["analytics.financial.read"],
      })
    ).toThrow();
    expect(() =>
      credentialGrantSchema.parse({
        credentialClass: "intake",
        scopes: ["intake.write", "analytics.leads.read"],
        allowedSourceIds: [sourceId],
      })
    ).toThrow();
  });

  it("rejects unknown fields at every public object boundary", () => {
    expect(() =>
      intakeConfigResultSchema.parse({
        contractVersion: EXTERNAL_API_VERSION,
        sources: [],
        acceptedFilePolicy: {
          contentTypes: ["image/jpeg"],
          maxFiles: 10,
          maxFileBytes: MAX_FILE_BYTES,
          maxBatchBytes: MAX_UPLOAD_BATCH_BYTES,
        },
        requestLimits: {
          maxJsonBodyBytes: 256 * 1024,
          maxAnswers: MAX_ANSWER_COUNT,
        },
        companyId: "internal-company-id",
      })
    ).toThrow();
  });
});

describe("external API intake contract", () => {
  it("accepts the strict configured source/form discovery result", () => {
    const result = intakeConfigResultSchema.parse({
      contractVersion: EXTERNAL_API_VERSION,
      sources: [
        {
          sourceId,
          label: "Main website",
          canonicalSiteHost: "example.ca",
          defaultPhoneRegion: "CA",
          defaultOwnerConfigured: false,
          forms: [{ formId, label: "Estimate request", isDefault: true }],
        },
      ],
      acceptedFilePolicy: {
        contentTypes: ["image/jpeg", "application/pdf"],
        maxFiles: MAX_FILES_PER_BATCH,
        maxFileBytes: MAX_FILE_BYTES,
        maxBatchBytes: MAX_UPLOAD_BATCH_BYTES,
      },
      requestLimits: {
        maxJsonBodyBytes: 256 * 1024,
        maxAnswers: MAX_ANSWER_COUNT,
      },
    });
    expect(result.sources[0]?.forms[0]?.formId).toBe(formId);
  });

  it("enforces ten files, 25 MiB per file, 50 MiB per batch, and unique caller IDs", () => {
    const file = (callerFileId: string, sizeBytes = 1024) => ({
      callerFileId,
      filename: `${callerFileId}.jpg`,
      sizeBytes,
      contentType: "image/jpeg",
      sha256: "a".repeat(64),
    });
    expect(
      uploadBatchRequestSchema.parse({
        sourceId,
        formId,
        files: Array.from({ length: 10 }, (_, index) => file(`photo-${index}`)),
      }).files
    ).toHaveLength(10);
    expect(() =>
      uploadBatchRequestSchema.parse({
        sourceId,
        formId,
        files: [file("oversize", MAX_FILE_BYTES + 1)],
      })
    ).toThrow();
    expect(() =>
      uploadBatchRequestSchema.parse({
        sourceId,
        formId,
        files: [
          file("one", 25 * 1024 * 1024),
          file("two", 25 * 1024 * 1024),
          file("three", 1),
        ],
      })
    ).toThrow();
    expect(() =>
      uploadBatchRequestSchema.parse({
        sourceId,
        formId,
        files: [file("same"), file("same")],
      })
    ).toThrow();
  });

  it("defines replay-safe upload capabilities without storage identifiers", () => {
    const result = uploadBatchResultSchema.parse({
      replayed: false,
      uploads: [
        {
          callerFileId: "front-photo",
          uploadId,
          state: "issued",
          capability: {
            method: "PUT",
            url: "https://uploads.example.ca/opaque-target",
            expiresAt: timestamp,
            requiredHeaders: {
              contentType: "image/jpeg",
              contentLength: 1234,
              ifNoneMatch: "*",
            },
          },
        },
      ],
    });
    expect(result.uploads[0]?.uploadId).toBe(uploadId);
    expect(() =>
      uploadBatchResultSchema.parse({
        replayed: false,
        uploads: [
          {
            callerFileId: "front-photo",
            uploadId,
            state: "issued",
            storageKey: "private/company/file.jpg",
          },
        ],
      })
    ).toThrow();
  });

  it("accepts typed canonical answers and rejects nested or excessive answers", () => {
    const base = {
      sourceId,
      formId,
      contact: { name: "A Customer", email: "customer@example.ca" },
      workSummary: "Replace the back deck.",
      uploadIds: [uploadId],
    };
    const request = submissionRequestSchema.parse({
      ...base,
      answers: [
        {
          fieldKey: "budget",
          label: "Budget",
          type: "number",
          value: 25000,
        },
        {
          fieldKey: "materials",
          label: "Materials",
          type: "string_list",
          value: ["cedar", "aluminum"],
        },
      ],
      attribution: {
        utmSource: "google",
        utmCampaign: "summer decks",
        clickProviderCode: "google_ads",
        clickId: "opaque-provider-value",
        landingPageUrl: "https://example.ca/decks?utm_source=google",
        referrerUrl: "https://google.ca/",
      },
    });
    expect(request.answers).toHaveLength(2);
    expect(() =>
      submissionRequestSchema.parse({
        ...base,
        answers: [
          {
            fieldKey: "nested",
            label: "Nested",
            type: "string",
            value: { forbidden: true },
          },
        ],
      })
    ).toThrow();
    expect(() =>
      submissionRequestSchema.parse({
        ...base,
        answers: Array.from({ length: MAX_ANSWER_COUNT + 1 }, (_, index) => ({
          fieldKey: `field_${index}`,
          label: `Field ${index}`,
          type: "boolean",
          value: true,
        })),
      })
    ).toThrow();
    expect(() =>
      submissionRequestSchema.parse({
        ...base,
        contact: { name: "No reply method" },
      })
    ).toThrow();
  });

  it("defines successful and replayed submission results plus safe status reconciliation", () => {
    const attachment = attachmentResultSchema.parse({
      uploadId,
      callerFileId: "front-photo",
      state: "pending_inspection",
      safeCode: null,
    });
    const result = submissionResultSchema.parse({
      publicSubmissionId: submissionId,
      publicLeadId: leadId,
      customerOutcome: "created",
      leadCreatedAt: timestamp,
      initialLeadStage: "new_lead",
      attachments: [attachment],
      emailCorrelationMarker: "emc_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
      replayed: false,
    });
    expect(result.replayed).toBe(false);
    expect(
      submissionStatusResultSchema.parse({
        publicSubmissionId: submissionId,
        publicLeadId: leadId,
        createdAt: timestamp,
        customerOutcome: "created",
        attachments: [{ ...attachment, state: "accepted", safeCode: null }],
        attachmentProcessingTerminal: true,
        pollAfterSeconds: null,
      }).attachmentProcessingTerminal
    ).toBe(true);
    expect(() =>
      submissionStatusResultSchema.parse({
        ...result,
        contactEmail: "customer@example.ca",
      })
    ).toThrow();
  });
});

describe("external API lead-feed contract", () => {
  const lead = {
    operation: "upsert",
    publicLeadId: leadId,
    inquiryReceivedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    currentStageEnteredAt: timestamp,
    terminalAt: null,
    currentStage: "new_lead",
    disposition: null,
    recordState: "active",
    mergeTargetPublicLeadId: null,
    source: attribution,
    firstResponseAt: null,
    firstResponseMinutes: null,
    wonAt: null,
    lostAt: null,
    disqualifiedAt: null,
    discardedAt: null,
    projectConvertedAt: null,
    minutesToDecision: null,
    minutesToWin: null,
    minutesToProjectConversion: null,
    reached: {
      qualifying: false,
      quoting: false,
      quoted: false,
      followUp: false,
      negotiation: false,
      won: false,
      lost: false,
      projectConverted: false,
    },
  } as const;

  it("defaults full pages to 100 and caps them at 250", () => {
    expect(leadFeedQuerySchema.parse({}).pageSize).toBe(100);
    expect(leadFeedQuerySchema.parse({ pageSize: 250 }).pageSize).toBe(250);
    expect(() => leadFeedQuerySchema.parse({ pageSize: 251 })).toThrow();
  });

  it("keeps incremental checkpoints separate from filtered full snapshots", () => {
    expect(
      leadFeedQuerySchema.parse({
        mode: "incremental",
        syncCheckpoint: "sync_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
      }).mode
    ).toBe("incremental");
    expect(() =>
      leadFeedQuerySchema.parse({
        mode: "incremental",
        syncCheckpoint: "sync_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
        filters: { stage: ["won"] },
      })
    ).toThrow();
  });

  it("serializes only the versioned pseudonymous allowlist", () => {
    expect(leadProjectionSchema.parse(lead).publicLeadId).toBe(leadId);
    expect(serializeLeadProjection(lead)).toEqual(lead);
    expect(() =>
      serializeLeadProjection({
        ...lead,
        company_id: "internal-company",
        customer_email: "customer@example.ca",
        source_metadata: { raw: true },
      })
    ).toThrow();
  });

  it("limits deletion tombstones to public identity, operation, and deletion time", () => {
    expect(
      leadProjectionSchema.parse({
        operation: "delete",
        publicLeadId: leadId,
        deletedAt: timestamp,
      })
    ).toEqual({
      operation: "delete",
      publicLeadId: leadId,
      deletedAt: timestamp,
    });
    expect(() =>
      leadProjectionSchema.parse({
        operation: "delete",
        publicLeadId: leadId,
        deletedAt: timestamp,
        name: "must never leave OPS",
      })
    ).toThrow();
  });

  it("defines stable full and incremental result metadata", () => {
    const result = leadFeedResultSchema.parse({
      mode: "full",
      dataThrough: timestamp,
      items: [lead],
      nextCursor: null,
      nextSyncCheckpoint: "sync_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
    });
    expect(result.items).toHaveLength(1);
  });
});

describe("external API metrics contract", () => {
  it("accepts only the standardized metric catalog and bounded groupings", () => {
    const query = metricQuerySchema.parse({
      preset: "30d",
      metricIds: [
        "leads_received",
        "cohort_decided_win_rate",
        "median_first_response_minutes",
      ],
      groupBy: ["day", "source"],
    });
    expect(query.definitionVersion).toBe("1");
    expect(() =>
      metricQuerySchema.parse({
        preset: "lifetime",
        metricIds: ["leads_received"],
        groupBy: ["day"],
      })
    ).toThrow();
    expect(() =>
      metricQuerySchema.parse({
        preset: "30d",
        metricIds: ["arbitrary_sql"],
      })
    ).toThrow();
    expect(() =>
      metricQuerySchema.parse({
        preset: "custom",
        from: "2025-01-01",
        to: "2026-07-24",
        metricIds: ["leads_received"],
      })
    ).toThrow();
  });

  it("requires explicit definition, basis, evidence, and suppression metadata", () => {
    const result = metricsResultSchema.parse({
      from: "2026-06-24T07:00:00.000Z",
      to: "2026-07-24T07:00:00.000Z",
      timezone: "America/Vancouver",
      generatedAt: timestamp,
      dataThrough: timestamp,
      metricDefinitionVersion: "1",
      currency: null,
      includedMetricIds: ["leads_received"],
      results: [
        {
          metricId: "leads_received",
          definitionVersion: "1",
          basis: "received_cohort",
          population: "Leads received in the requested half-open interval.",
          value: 20,
          unit: "count",
          numerator: 20,
          denominator: null,
          includedCount: 20,
          missingEvidenceCount: 0,
          grouping: null,
          currency: null,
          suppressed: false,
          cohortCount: 20,
          evidenceCoveragePercent: 100,
        },
      ],
    });
    expect(result.results[0]?.metricId).toBe("leads_received");
  });
});

describe("external API error contract", () => {
  it("contains every approved safe error code", () => {
    const codes = [
      "invalid_credentials",
      "credential_expired",
      "credential_revoked",
      "insufficient_scope",
      "source_not_allowed",
      "form_not_allowed",
      "invalid_request",
      "idempotency_conflict",
      "external_submission_conflict",
      "submission_not_found",
      "upload_not_found",
      "upload_expired",
      "upload_batch_expired",
      "upload_rejected",
      "rate_limited",
      "rate_limit_unavailable",
      "cursor_invalid",
      "sync_checkpoint_expired",
      "range_too_large",
      "date_alignment_required",
      "definition_version_unsupported",
      "temporarily_unavailable",
      "internal_error",
    ] as const;
    for (const code of codes) {
      expect(externalApiErrorCodeSchema.parse(code)).toBe(code);
      expect(externalApiErrorDefinitions[code]).toBeDefined();
    }
  });

  it("maps the locked conflict, expiry, and semantic errors exactly", () => {
    expect(getExternalApiErrorStatus("upload_batch_expired")).toBe(410);
    expect(getExternalApiErrorStatus("external_submission_conflict")).toBe(409);
    expect(getExternalApiErrorStatus("sync_checkpoint_expired")).toBe(410);
    expect(getExternalApiErrorStatus("date_alignment_required")).toBe(422);
    expect(getExternalApiErrorStatus("definition_version_unsupported")).toBe(
      422
    );
  });
});

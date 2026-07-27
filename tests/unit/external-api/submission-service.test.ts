import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalApiRequestActor } from "@/lib/external-api/auth/credential-auth";
import type { SubmissionRequest } from "@/lib/external-api/contracts/intake";
import {
  buildContactIdentityBackfillRows,
  createExternalIntakeSubmission,
} from "@/lib/external-api/intake/submission-service";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const PRINCIPAL_ID = "10000000-0000-4000-8000-000000000002";
const CREDENTIAL_ID = "10000000-0000-4000-8000-000000000003";
const SOURCE_UUID = "10000000-0000-4000-8000-000000000004";
const FORM_UUID = "10000000-0000-4000-8000-000000000005";
const UPLOAD_UUID = "10000000-0000-4000-8000-000000000006";
const SUBMISSION_UUID = "10000000-0000-4000-8000-000000000007";
const LEAD_UUID = "10000000-0000-4000-8000-000000000008";
const AUDIT_REQUEST_ID = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-07-26T22:00:00.000Z";

function opaque(prefix: string, uuid: string): string {
  return `${prefix}_${Buffer.from(uuid.replaceAll("-", ""), "hex").toString(
    "base64url"
  )}`;
}

const actor: ExternalApiRequestActor = Object.freeze({
  principalId: PRINCIPAL_ID,
  credentialId: CREDENTIAL_ID,
  companyId: COMPANY_ID,
  credentialClass: "intake",
  scopes: Object.freeze(["intake.write"] as const),
  allowedSourceIds: Object.freeze([SOURCE_UUID]),
  authorizationEpoch: 3,
  digestVersion: 7,
  credentialDigest: `\\x${"ab".repeat(32)}`,
  visiblePrefix: "opsx_7_abcdefghijkl",
});

const submission: SubmissionRequest = {
  sourceId: opaque("src", SOURCE_UUID),
  formId: opaque("frm", FORM_UUID),
  contact: {
    name: "Ana María",
    email: "ANA@example.ca",
    phone: "(604) 555-0199",
    organizationName: "North Shore Decks",
  },
  serviceAddress: {
    line1: "10 Main Street",
    city: "Vancouver",
    region: "BC",
    postalCode: "V6B 1A1",
    countryCode: "CA",
  },
  workSummary: "Replace the deck.",
  preferredTiming: "This fall",
  answers: [
    {
      fieldKey: "material",
      label: "Material",
      type: "single_choice",
      value: "Cedar",
    },
  ],
  attribution: {
    utmSource: "Google",
    landingPageUrl: "https://example.ca/decks?gclid=private",
  },
  uploadIds: [opaque("upl", UPLOAD_UUID)],
  externalSubmissionId: "website-42",
};

const idempotencyKeyRing = {
  activeKid: 2,
  keys: new Map([
    [1, Buffer.alloc(32, 1)],
    [2, Buffer.alloc(32, 2)],
  ]),
};

const attributionKeyRing = {
  activeKid: 4,
  keys: new Map([
    [3, Buffer.alloc(32, 3)],
    [4, Buffer.alloc(32, 4)],
  ]),
};

const context = {
  status: "ready",
  source_id: SOURCE_UUID,
  form_id: FORM_UUID,
  default_phone_region: "CA",
  uploads: [
    {
      public_upload_id: UPLOAD_UUID,
      storage_object_key: `quarantine/${COMPANY_ID}/${SOURCE_UUID}/10000000-0000-4000-8000-000000000010/${UPLOAD_UUID}`,
      state: "issued",
      expected_size_bytes: 4096,
      expected_checksum_sha256: "07".repeat(32),
      object_version_id: null,
      observed_size_bytes: null,
      observed_checksum_sha256: null,
    },
  ],
};

const commandResult = {
  status: "created",
  public_submission_id: SUBMISSION_UUID,
  public_lead_id: LEAD_UUID,
  customer_outcome: "created",
  lead_created_at: NOW,
  initial_lead_stage: "new_lead",
  replayed: false,
  attachments: [
    {
      public_upload_id: UPLOAD_UUID,
      caller_file_id: "front-photo",
      state: "pending_inspection",
      safe_code: null,
    },
  ],
};

describe("external intake submission service", () => {
  const rpc = vi.fn();
  const headObject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation((name: string) => {
      if (name === "resolve_external_intake_submission_context_as_system") {
        return Promise.resolve({ data: context, error: null });
      }
      if (name === "record_external_intake_object_event_as_system") {
        return Promise.resolve({ data: { status: "recorded" }, error: null });
      }
      if (name === "create_external_intake_submission_as_system") {
        return Promise.resolve({ data: commandResult, error: null });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    headObject.mockResolvedValue({
      versionId: "s3-version-1",
      sizeBytes: 4096,
      checksumSha256: "07".repeat(32),
      occurredAt: NOW,
    });
  });

  function dependencies() {
    return {
      client: { rpc },
      idempotencyKeyRing,
      attributionKeyRing,
      headObject,
    };
  }

  it("HEADs an exact delayed object and records the same provider transition before commit", async () => {
    const result = await createExternalIntakeSubmission(
      {
        actor,
        auditRequestId: AUDIT_REQUEST_ID,
        requestReceivedAt: NOW,
        idempotencyKey: "submission-request-42",
        requestedOrigin: "https://example.ca",
        submission,
      },
      dependencies()
    );

    expect(headObject).toHaveBeenCalledWith({
      objectKey: context.uploads[0].storage_object_key,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_external_intake_object_event_as_system",
      expect.objectContaining({
        p_event_type: "object_created",
        p_storage_object_key: context.uploads[0].storage_object_key,
        p_object_version_id: "s3-version-1",
        p_observed_size_bytes: 4096,
        p_observed_checksum_sha256: `\\x${"07".repeat(32)}`,
      })
    );
    expect(result).toEqual({
      publicSubmissionId: opaque("sub", SUBMISSION_UUID),
      publicLeadId: opaque("lead", LEAD_UUID),
      customerOutcome: "created",
      leadCreatedAt: NOW,
      initialLeadStage: "new_lead",
      attachments: [
        {
          uploadId: opaque("upl", UPLOAD_UUID),
          callerFileId: "front-photo",
          state: "pending_inspection",
          safeCode: null,
        },
      ],
      replayed: false,
    });
  });

  it("passes only active write digests while retaining all lookup candidates", async () => {
    await createExternalIntakeSubmission(
      {
        actor,
        auditRequestId: AUDIT_REQUEST_ID,
        requestReceivedAt: NOW,
        idempotencyKey: "submission-request-42",
        requestedOrigin: null,
        submission,
      },
      dependencies()
    );

    const commandCall = rpc.mock.calls.find(
      ([name]) => name === "create_external_intake_submission_as_system"
    );
    expect(commandCall?.[1]).toMatchObject({
      p_idempotency_digest_version: 2,
      p_external_submission_digest_version: 2,
      p_canonicalization_version: 1,
    });
    expect(commandCall?.[1].p_canonical_request_hash).toMatch(
      /^\\x[a-f0-9]{64}$/
    );
    expect(commandCall?.[1].p_idempotency_candidates).toHaveLength(2);
    expect(commandCall?.[1].p_external_submission_candidates).toHaveLength(2);
    expect(commandCall?.[1].p_attribution_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: "utm_source",
          activeKid: 4,
          candidates: expect.arrayContaining([
            expect.objectContaining({ kid: 3 }),
            expect.objectContaining({ kid: 4 }),
          ]),
        }),
        expect.objectContaining({
          dimension: "landing_path",
          activeKid: 4,
        }),
      ])
    );
  });

  it("does not fail a lead when an object is truly absent", async () => {
    headObject.mockResolvedValue(null);

    const result = await createExternalIntakeSubmission(
      {
        actor,
        auditRequestId: AUDIT_REQUEST_ID,
        requestReceivedAt: NOW,
        idempotencyKey: "submission-request-42",
        requestedOrigin: null,
        submission,
      },
      dependencies()
    );

    expect(rpc).not.toHaveBeenCalledWith(
      "record_external_intake_object_event_as_system",
      expect.anything()
    );
    expect(
      rpc.mock.calls.some(
        ([name]) => name === "create_external_intake_submission_as_system"
      )
    ).toBe(true);
    expect(result.publicLeadId).toBe(opaque("lead", LEAD_UUID));
  });

  it("fails closed before the command when HEAD evidence mismatches the intent", async () => {
    headObject.mockResolvedValue({
      versionId: "s3-version-1",
      sizeBytes: 4097,
      checksumSha256: "07".repeat(32),
      occurredAt: NOW,
    });

    await expect(
      createExternalIntakeSubmission(
        {
          actor,
          auditRequestId: AUDIT_REQUEST_ID,
          requestReceivedAt: NOW,
          idempotencyKey: "submission-request-42",
          requestedOrigin: null,
          submission,
        },
        dependencies()
      )
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(rpc).not.toHaveBeenCalledWith(
      "create_external_intake_submission_as_system",
      expect.anything()
    );
  });

  it("maps replay conflicts without exposing private database details", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "resolve_external_intake_submission_context_as_system") {
        return Promise.resolve({
          data: { ...context, uploads: [] },
          error: null,
        });
      }
      if (name === "create_external_intake_submission_as_system") {
        return Promise.resolve({
          data: { status: "idempotency_conflict" },
          error: null,
        });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    await expect(
      createExternalIntakeSubmission(
        {
          actor,
          auditRequestId: AUDIT_REQUEST_ID,
          requestReceivedAt: NOW,
          idempotencyKey: "submission-request-42",
          requestedOrigin: null,
          submission: { ...submission, uploadIds: [] },
        },
        dependencies()
      )
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("builds app-side backfill rows only from reliable identity evidence", () => {
    expect(
      buildContactIdentityBackfillRows(
        [
          {
            entityKind: "client",
            entityId: LEAD_UUID,
            email: " ANA@Example.ca ",
            phone: "(604) 555-0199",
          },
          {
            entityKind: "sub_client",
            entityId: SUBMISSION_UUID,
            email: null,
            phone: "020 7946 0018",
          },
        ],
        { defaultPhoneRegion: "CA" }
      )
    ).toEqual([
      {
        entityKind: "client",
        entityId: LEAD_UUID,
        normalizedEmail: "ana@example.ca",
        normalizedPhone: "+16045550199",
      },
      {
        entityKind: "sub_client",
        entityId: SUBMISSION_UUID,
        normalizedEmail: null,
        normalizedPhone: null,
      },
    ]);
  });
});

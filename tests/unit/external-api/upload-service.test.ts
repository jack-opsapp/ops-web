import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalApiRequestActor } from "@/lib/external-api/auth/credential-auth";
import { deriveActiveIdempotencyDigest } from "@/lib/external-api/intake/idempotency";
import {
  createExternalUploadBatch,
  hashCanonicalUploadManifest,
} from "@/lib/external-api/uploads/upload-service";

const COMPANY_ID = "10000000-0000-4000-8000-000000000001";
const PRINCIPAL_ID = "10000000-0000-4000-8000-000000000002";
const CREDENTIAL_ID = "10000000-0000-4000-8000-000000000003";
const SOURCE_UUID = "10000000-0000-4000-8000-000000000004";
const FORM_UUID = "10000000-0000-4000-8000-000000000005";
const BATCH_ID = "10000000-0000-4000-8000-000000000006";
const UPLOAD_UUID = "10000000-0000-4000-8000-000000000007";
const AUDIT_REQUEST_ID = "10000000-0000-4000-8000-000000000008";
const NOW = "2026-07-26T22:00:00.000Z";
const EXPIRES = "2026-07-26T22:02:00.000Z";
const DELETE_NOT_BEFORE = "2026-07-26T22:03:00.000Z";
const idempotencyKeyRing = {
  activeKid: 2,
  keys: new Map([
    [1, Buffer.alloc(32, 1)],
    [2, Buffer.alloc(32, 2)],
  ]),
};

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

const request = {
  sourceId: opaque("src", SOURCE_UUID),
  formId: opaque("frm", FORM_UUID),
  files: [
    {
      callerFileId: "front-photo",
      filename: "front.jpg",
      sizeBytes: 4_096,
      contentType: "image/jpeg" as const,
      sha256: "07".repeat(32),
    },
  ],
};

const reservedRow = {
  status: "new",
  batch_id: BATCH_ID,
  audit_request_id: AUDIT_REQUEST_ID,
  uploads: [
    {
      public_upload_id: UPLOAD_UUID,
      caller_file_id: "front-photo",
      state: "issued",
      capability_expires_at: EXPIRES,
      delete_not_before: DELETE_NOT_BEFORE,
      safe_code: null,
    },
  ],
};

function rpcData(data: unknown) {
  return Promise.resolve({ data, error: null });
}

describe("external upload batch service", () => {
  const rpc = vi.fn();
  const issueCapability = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue(rpcData(reservedRow));
    issueCapability.mockResolvedValue({
      key: `quarantine/${COMPANY_ID}/${SOURCE_UUID}/${BATCH_ID}/${UPLOAD_UUID}`,
      method: "PUT",
      url: "https://ops-external-intake.test/signed",
      headers: {
        "content-length": "4096",
        "content-type": "image/jpeg",
        "if-none-match": "*",
        "x-amz-checksum-sha256": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      },
      expiresAt: EXPIRES,
      deleteNotBefore: DELETE_NOT_BEFORE,
    });
  });

  function dependencies() {
    return {
      client: { rpc },
      issueCapability,
      idempotencyKeyRing,
    };
  }

  it("hashes a canonical manifest independently of caller file order", () => {
    const second = {
      callerFileId: "plans",
      filename: "plans.pdf",
      sizeBytes: 10,
      contentType: "application/pdf" as const,
    };

    expect(hashCanonicalUploadManifest([...request.files, second])).toEqual(
      hashCanonicalUploadManifest([second, ...request.files])
    );
  });

  it("reserves with principal-scoped digests and returns only safe upload capabilities", async () => {
    const result = await createExternalUploadBatch(
      {
        actor,
        auditRequestId: AUDIT_REQUEST_ID,
        requestReceivedAt: NOW,
        idempotencyKey: "upload-request-0001",
        requestedOrigin: "https://example.test",
        batch: request,
      },
      dependencies()
    );

    expect(result.result).toMatchObject({
      replayed: false,
      uploads: [
        {
          callerFileId: "front-photo",
          uploadId: opaque("upl", UPLOAD_UUID),
          state: "issued",
          capability: {
            method: "PUT",
            url: "https://ops-external-intake.test/signed",
            expiresAt: EXPIRES,
            requiredHeaders: {
              contentType: "image/jpeg",
              contentLength: 4_096,
              ifNoneMatch: "*",
              checksumSha256: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
            },
          },
        },
      ],
    });
    expect(result.idempotencyResult).toBe("new");
    expect(rpc).toHaveBeenCalledWith(
      "reserve_external_intake_upload_batch_rotating_as_system",
      expect.objectContaining({
        p_request_id: AUDIT_REQUEST_ID,
        p_principal_id: PRINCIPAL_ID,
        p_credential_id: CREDENTIAL_ID,
        p_credential_digest: actor.credentialDigest,
        p_authorization_epoch: 3,
        p_source_public_id: SOURCE_UUID,
        p_form_public_id: FORM_UUID,
        p_requested_origin: "https://example.test",
        p_idempotency_digest_version: 2,
        p_idempotency_digest: `\\x${
          deriveActiveIdempotencyDigest(
            {
              kind: "principal",
              companyId: COMPANY_ID,
              principalId: PRINCIPAL_ID,
              namespace: "upload_batch",
              key: "upload-request-0001",
            },
            idempotencyKeyRing
          ).digest
        }`,
        p_idempotency_candidates: expect.arrayContaining([
          expect.objectContaining({ kid: 1 }),
          expect.objectContaining({ kid: 2 }),
        ]),
        p_manifest_hash_version: 1,
      })
    );
    expect(JSON.stringify(result.result)).not.toMatch(
      /storage|object_key|bucket|version_id|checksum_sha256/
    );
  });

  it("replays without a second reservation and refreshes only still-issued capabilities", async () => {
    rpc.mockResolvedValueOnce(
      rpcData({
        ...reservedRow,
        status: "replay",
        uploads: [
          reservedRow.uploads[0],
          {
            ...reservedRow.uploads[0],
            public_upload_id: "10000000-0000-4000-8000-000000000009",
            caller_file_id: "already-uploaded",
            state: "uploaded",
            safe_code: null,
          },
        ],
      })
    );

    const result = await createExternalUploadBatch(
      {
        actor,
        auditRequestId: AUDIT_REQUEST_ID,
        requestReceivedAt: NOW,
        idempotencyKey: "upload-request-0001",
        requestedOrigin: null,
        batch: {
          ...request,
          files: [
            ...request.files,
            {
              callerFileId: "already-uploaded",
              filename: "already-uploaded.pdf",
              sizeBytes: 4_096,
              contentType: "application/pdf",
            },
          ],
        },
      },
      dependencies()
    );

    expect(result.result.replayed).toBe(true);
    expect(result.result.uploads[1]).toMatchObject({
      callerFileId: "already-uploaded",
      state: "uploaded",
      capability: null,
    });
    expect(issueCapability).toHaveBeenCalledOnce();
    expect(result.idempotencyResult).toBe("replay");
  });

  it.each([
    ["conflict", "idempotency_conflict", "conflict"],
    ["expired", "upload_batch_expired", "expired"],
    ["source_not_allowed", "source_not_allowed", "not_applicable"],
    ["form_not_allowed", "form_not_allowed", "not_applicable"],
    ["quota_exceeded", "rate_limited", "not_applicable"],
  ] as const)(
    "maps %s without leaking database detail",
    async (status, code, _idempotency) => {
      rpc.mockResolvedValueOnce(
        rpcData({
          status,
          batch_id: null,
          audit_request_id: AUDIT_REQUEST_ID,
          uploads: [],
        })
      );

      await expect(
        createExternalUploadBatch(
          {
            actor,
            auditRequestId: AUDIT_REQUEST_ID,
            requestReceivedAt: NOW,
            idempotencyKey: "upload-request-0001",
            requestedOrigin: null,
            batch: request,
          },
          dependencies()
        )
      ).rejects.toMatchObject({ code });
    }
  );

  it("compensates every reservation when any capability cannot be signed", async () => {
    issueCapability.mockRejectedValueOnce(new Error("private signer detail"));
    rpc
      .mockResolvedValueOnce(rpcData(reservedRow))
      .mockResolvedValueOnce(rpcData({ released: true }));

    await expect(
      createExternalUploadBatch(
        {
          actor,
          auditRequestId: AUDIT_REQUEST_ID,
          requestReceivedAt: NOW,
          idempotencyKey: "upload-request-0001",
          requestedOrigin: null,
          batch: request,
        },
        dependencies()
      )
    ).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(rpc).toHaveBeenLastCalledWith(
      "release_external_intake_upload_batch_as_system",
      expect.objectContaining({
        p_batch_id: BATCH_ID,
        p_credential_digest: actor.credentialDigest,
      })
    );
  });
});

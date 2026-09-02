import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXTERNAL_API_REFERENCE_OPERATION_IDS,
  buildExternalApiReference,
  externalApiReference,
} from "@/lib/external-api/docs/reference";

const EXPECTED_OPERATION_IDS = [
  "getIntakeConfig",
  "createUploadBatch",
  "createIntakeSubmission",
  "getIntakeSubmission",
  "getLeadFeed",
  "getLeadMetrics",
] as const;

describe("external API reference contract", () => {
  it("publishes the six canonical operations in integration order", () => {
    expect(EXTERNAL_API_REFERENCE_OPERATION_IDS).toEqual(
      EXPECTED_OPERATION_IDS
    );
    expect(
      externalApiReference.operations.map((operation) => operation.operationId)
    ).toEqual(EXPECTED_OPERATION_IDS);
    expect(new Set(EXTERNAL_API_REFERENCE_OPERATION_IDS).size).toBe(6);
  });

  it("provides the contract data needed to render a complete reference", () => {
    expect(externalApiReference.openApiVersion).toBe("3.1.0");
    expect(externalApiReference.apiVersion).toBe("1.0.0");
    expect(externalApiReference.baseUrl).toBe("https://app.opsapp.co");

    for (const operation of externalApiReference.operations) {
      expect(["get", "post"]).toContain(operation.method);
      expect(operation.path).toMatch(/^\/v1\//);
      expect(operation.summary.length).toBeGreaterThan(0);
      expect(operation.description.length).toBeGreaterThan(0);
      expect(operation.requiredScopes).toHaveLength(1);
      expect(operation.successResponses.length).toBeGreaterThan(0);
      expect(operation.successResponses[0]?.example).toBeDefined();
      expect(operation.errorStatuses).toEqual([
        "400",
        "401",
        "403",
        "409",
        "410",
        "422",
        "429",
        "500",
        "503",
      ]);
    }

    expect(
      externalApiReference.operations.find(
        (operation) => operation.operationId === "createUploadBatch"
      )?.request
    ).toMatchObject({
      required: true,
      schemaName: "UploadBatchRequest",
    });
    expect(
      externalApiReference.operations.find(
        (operation) => operation.operationId === "getLeadFeed"
      )?.parameters
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "mode",
          location: "query",
          required: false,
        }),
        expect.objectContaining({
          name: "source_id",
          location: "query",
          required: false,
        }),
      ])
    );
  });

  it("resolves referenced object schemas into field definitions", () => {
    const upload = externalApiReference.operations.find(
      (operation) => operation.operationId === "createUploadBatch"
    );
    const submission = externalApiReference.operations.find(
      (operation) => operation.operationId === "createIntakeSubmission"
    );

    expect(upload?.request?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "sourceId",
          type: "string",
          required: true,
        }),
        expect.objectContaining({
          name: "files",
          type: "array",
          required: true,
        }),
      ])
    );
    expect(submission?.request?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "contact",
          type: "object",
          required: true,
        }),
        expect.objectContaining({
          name: "uploadIds",
          type: "array",
          required: false,
        }),
      ])
    );
  });

  it("fails closed when a required operation is missing", () => {
    const malformed = structuredClone(
      externalApiReference.document
    ) as typeof externalApiReference.document;
    delete malformed.paths["/v1/analytics/metrics"];

    expect(() => buildExternalApiReference(malformed)).toThrow(
      "Missing external API operation: getLeadMetrics"
    );
  });

  it("keeps the public reference free of internal and client-specific data", () => {
    const serialized = JSON.stringify(externalApiReference).toLowerCase();

    for (const forbidden of [
      "norcut",
      "storageobjectkey",
      "secretdigest",
      "credentialid",
      "companyid",
      "opportunityid",
      "supabase",
      "guardduty",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXTERNAL_API_EXAMPLE_LANGUAGES,
  externalApiCodeExamples,
  externalApiWorkflowExamples,
} from "@/lib/external-api/docs/code-examples";
import { externalApiReference } from "@/lib/external-api/docs/reference";

describe("external API reference code examples", () => {
  it("provides four server-side examples for every published operation", () => {
    expect(EXTERNAL_API_EXAMPLE_LANGUAGES).toEqual([
      "curl",
      "javascript",
      "typescript",
      "php",
    ]);
    expect(Object.keys(externalApiCodeExamples)).toEqual(
      externalApiReference.operations.map((operation) => operation.operationId)
    );

    for (const operation of externalApiReference.operations) {
      const examples = externalApiCodeExamples[operation.operationId];
      expect(examples.map((example) => example.language)).toEqual(
        EXTERNAL_API_EXAMPLE_LANGUAGES
      );
      for (const example of examples) {
        expect(example.code).toContain(externalApiReference.baseUrl);
        expect(example.code).toContain(operation.path.split("{")[0]);
        expect(example.code).toContain("OPS_API_TOKEN");
      }
    }
  });

  it("builds request bodies from the canonical OpenAPI examples", () => {
    const upload = externalApiCodeExamples.createUploadBatch;
    const submission = externalApiCodeExamples.createIntakeSubmission;

    for (const example of upload) {
      expect(example.code).toContain("site-photo.jpg");
      expect(example.code).toContain("Idempotency-Key");
    }
    for (const example of submission) {
      expect(example.code).toContain("Replace the rear deck.");
      expect(example.code).toContain("Idempotency-Key");
    }
  });

  it("keeps the browser upload capability isolated from the OPS credential", () => {
    expect(externalApiWorkflowExamples.browserUpload).toContain(
      "capability.url"
    );
    expect(externalApiWorkflowExamples.browserUpload).toContain(
      "capability.requiredHeaders"
    );
    expect(externalApiWorkflowExamples.browserUpload).not.toContain(
      "OPS_API_TOKEN"
    );
    expect(externalApiWorkflowExamples.browserUpload).not.toContain(
      "Authorization"
    );
  });

  it("stops attachment polling at terminal state and honors the server delay", () => {
    const polling = externalApiWorkflowExamples.attachmentPolling;

    expect(polling).toContain("attachmentProcessingTerminal");
    expect(polling).toContain("pollAfterSeconds");
    expect(polling).toContain("break");
  });

  it("documents a full lead sync before incremental changes", () => {
    const sync = externalApiWorkflowExamples.leadSynchronization;
    const fullIndex = sync.indexOf('mode", "full"');
    const incrementalIndex = sync.indexOf('mode", "incremental"');

    expect(fullIndex).toBeGreaterThan(-1);
    expect(incrementalIndex).toBeGreaterThan(fullIndex);
    expect(sync).toContain("nextSyncCheckpoint");
  });

  it("contains no client name, real secret, or browser bearer request", () => {
    const serialized = JSON.stringify({
      externalApiCodeExamples,
      externalApiWorkflowExamples,
    });

    expect(serialized.toLowerCase()).not.toContain("norcut");
    expect(serialized).not.toMatch(/Bearer [A-Za-z0-9_-]{24,}/);
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(externalApiWorkflowExamples.browserUpload).not.toContain("Bearer");
  });
});

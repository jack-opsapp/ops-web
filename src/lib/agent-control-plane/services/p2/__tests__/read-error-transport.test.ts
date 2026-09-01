import { describe, expect, it } from "vitest";

import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts/errors";
import { ArtifactReadError } from "../artifacts/artifact-reads";
import { TeamAvailabilityReadError } from "../availability/availability-reads";
import { CatalogReadError } from "../catalog/catalog-reads";
import { CompanyContextReadError } from "../company/get-company-context";
import { CustomerContextReadError } from "../customer/get-customer-context";
import { DeckGeometryReadError } from "../deck-design/deck-geometry-reads";
import { IntegrationHealthReadError } from "../integrations/get-integration-health";
import { OperationalOverviewReadError } from "../overview/get-operational-overview";
import { PaymentReadError } from "../payments/payment-reads";
import { PurchaseOrderReadError } from "../purchasing/purchase-order-reads";
import { SalesDocumentReadError } from "../sales/sales-reads";
import { TaskReadError } from "../tasks/task-reads";
import { TeamDirectoryReadError } from "../team/team-reads";
import { WorkQueueReadError } from "../work-queue/work-queue-reads";
import { toP2ReadAgentError } from "../shared/read-error-transport";

const REQUEST_ID = "request-p2-read-error-transport";

describe("P2 read-error agent contracts", () => {
  it.each([
    [
      "company",
      new CompanyContextReadError({ code: "NOT_FOUND", requestId: REQUEST_ID }),
      "NOT_FOUND",
    ],
    [
      "customer",
      new CustomerContextReadError({
        code: "NOT_FOUND",
        requestId: REQUEST_ID,
      }),
      "NOT_FOUND",
    ],
    [
      "operational overview",
      new OperationalOverviewReadError({
        code: "RESULT_TOO_LARGE",
        requestId: REQUEST_ID,
      }),
      "RESULT_TOO_LARGE",
    ],
    [
      "team availability",
      new TeamAvailabilityReadError({
        code: "INVALID_CURSOR",
        requestId: REQUEST_ID,
      }),
      "INVALID_ARGUMENT",
    ],
    [
      "sales documents",
      new SalesDocumentReadError({
        code: "NOT_FOUND",
        requestId: REQUEST_ID,
      }),
      "NOT_FOUND",
    ],
    [
      "catalog",
      new CatalogReadError({ code: "NOT_FOUND", requestId: REQUEST_ID }),
      "NOT_FOUND",
    ],
    [
      "payments",
      new PaymentReadError({
        code: "SOURCE_DATA_INVALID",
        requestId: REQUEST_ID,
      }),
      "TEMPORARILY_UNAVAILABLE",
    ],
    [
      "team directory",
      new TeamDirectoryReadError({
        code: "RESULT_TOO_LARGE",
        requestId: REQUEST_ID,
      }),
      "RESULT_TOO_LARGE",
    ],
    [
      "work queue",
      new WorkQueueReadError("INVALID_CURSOR", REQUEST_ID),
      "INVALID_ARGUMENT",
    ],
    [
      "integration health",
      new IntegrationHealthReadError({
        code: "TEMPORARILY_UNAVAILABLE",
        requestId: REQUEST_ID,
      }),
      "TEMPORARILY_UNAVAILABLE",
    ],
    [
      "tasks",
      new TaskReadError({ code: "NOT_FOUND", requestId: REQUEST_ID }),
      "NOT_FOUND",
    ],
    [
      "purchase orders",
      new PurchaseOrderReadError({
        code: "NOT_FOUND",
        requestId: REQUEST_ID,
      }),
      "NOT_FOUND",
    ],
    [
      "artifacts",
      new ArtifactReadError({ code: "NOT_FOUND", requestId: REQUEST_ID }),
      "NOT_FOUND",
    ],
    [
      "deck geometry",
      new DeckGeometryReadError({
        code: "INVALID_GEOMETRY",
        requestId: REQUEST_ID,
      }),
      "TEMPORARILY_UNAVAILABLE",
    ],
  ] as const)(
    "projects the %s domain error as a valid non-INTERNAL AgentError",
    (_name, error, expectedCode) => {
      const projected = error.toAgentError();

      expect(AgentErrorSchema.parse(projected)).toEqual(projected);
      expect(projected.code).toBe(expectedCode);
      expect(projected.code).not.toBe("INTERNAL");
      expect(projected.request_id).toBe(REQUEST_ID);
    }
  );

  it("maps an invalid cursor to INVALID_ARGUMENT with one safe cursor issue", () => {
    const error = new CatalogReadError({
      code: "INVALID_CURSOR",
      requestId: REQUEST_ID,
    });

    expect(AgentErrorSchema.parse(error.toAgentError())).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: REQUEST_ID,
      code: "INVALID_ARGUMENT",
      message: "This catalog page expired. Start again.",
      retryable: false,
      details: {
        field_issues: [
          {
            path: ["cursor"],
            code: "INVALID_CURSOR",
            message: "This catalog page expired. Start again.",
          },
        ],
      },
    });
  });

  it("replaces the work-queue enum token with safe recovery copy", () => {
    const projected = new WorkQueueReadError(
      "INVALID_CURSOR",
      REQUEST_ID
    ).toAgentError();

    expect(projected.message).toBe(
      "This work queue page expired. Start again."
    );
    expect(projected.message).not.toBe("INVALID_CURSOR");
  });

  it("does not fabricate a STALE_CONTEXT marker when the domain carries none", () => {
    const error = new CatalogReadError({
      code: "STALE_CONTEXT",
      requestId: REQUEST_ID,
    });

    expect(AgentErrorSchema.parse(error.toAgentError())).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: REQUEST_ID,
      code: "TEMPORARILY_UNAVAILABLE",
      message: "Catalog changed. Start the read again.",
      retryable: true,
    });
  });

  it("preserves STALE_CONTEXT when the producer supplies an authentic current marker", () => {
    const currentCatalogVersion = {
      source_domain: "catalog",
      source_type: "read_domain_revision",
      source_id: "private.agent_read_domain_revisions",
      version: "revision:19",
    } as const;

    expect(
      toP2ReadAgentError({
        code: "STALE_CONTEXT",
        requestId: REQUEST_ID,
        message: "Catalog changed. Start the read again.",
        retryable: true,
        currentSourceVersions: [currentCatalogVersion],
      })
    ).toEqual({
      contract_version: "2026-08-07.v1",
      request_id: REQUEST_ID,
      code: "STALE_CONTEXT",
      message: "Catalog changed. Start the read again.",
      retryable: true,
      details: { current_source_versions: [currentCatalogVersion] },
    });
  });

  it("keeps genuine internal read failures INTERNAL", () => {
    const error = new CatalogReadError({
      code: "INTERNAL",
      requestId: REQUEST_ID,
    });

    expect(AgentErrorSchema.parse(error.toAgentError()).code).toBe("INTERNAL");
  });
});

import { describe, expect, it } from "vitest";

import { CAPABILITY_MANIFEST } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  LIST_PAYMENTS_CANDIDATE,
  PAYMENT_AUTHORIZATION_VARIANT_KEYS,
  selectedListPaymentsVariantKeys,
} from "../payments";

describe("P2 payment candidate", () => {
  it("stays implementation-only, immutable, read-only, and bounded", () => {
    expect(LIST_PAYMENTS_CANDIDATE).toMatchObject({
      name: "list_payments",
      schemaRevision: "2026-08-22.v1",
      operation: "read",
      bounds: {
        maxInputBytes: 8_192,
        maxOutputCharacters: 60_000,
        maxResultItems: 25,
      },
      availability: { implementation: "available" },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(Object.isFrozen(LIST_PAYMENTS_CANDIDATE)).toBe(true);
    expect(
      CAPABILITY_MANIFEST.find(
        (entry) => entry.name === LIST_PAYMENTS_CANDIDATE.name
      )
    ).toBe(LIST_PAYMENTS_CANDIDATE);
  });

  it("requires payment OAuth, full finance, invoice all|assigned, and exact linked job authority", () => {
    expect(PAYMENT_AUTHORIZATION_VARIANT_KEYS).toEqual(["payment"]);
    const policy = LIST_PAYMENTS_CANDIDATE.authorization.variants[0]!.policy;
    expect(policy.requiredOAuthScopes).toEqual(["ops.payments.read"]);
    expect(policy.permissionRequirementGroups).toEqual([
      [
        { permission: "finances.view", allowedScopes: ["all"] },
        { permission: "invoices.view", allowedScopes: ["all", "assigned"] },
        { permission: "pipeline.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "finances.view", allowedScopes: ["all"] },
        { permission: "invoices.view", allowedScopes: ["all", "assigned"] },
        { permission: "projects.view", allowedScopes: ["all", "assigned"] },
      ],
      [
        { permission: "finances.view", allowedScopes: ["all"] },
        { permission: "invoices.view", allowedScopes: ["all"] },
      ],
    ]);
    expect(selectedListPaymentsVariantKeys({})).toEqual(["payment"]);
  });
});

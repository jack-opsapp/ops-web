import { describe, expect, it } from "vitest";

import {
  COMMIT_DAY_CLOSEOUT_CAPABILITY_DEFINITION,
  DAY_CLOSEOUT_CAPABILITY_DEFINITION,
} from "../day-closeout-capability";

describe("prepare_day_closeout capability", () => {
  it("is a bounded idempotent prepare action with no send or write scope", () => {
    const capability = DAY_CLOSEOUT_CAPABILITY_DEFINITION;

    expect(capability.name).toBe("prepare_day_closeout");
    expect(capability.operation).toBe("prepare");
    expect(capability.availability.implementation).toBe("available");
    expect(capability.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(capability.confirmationPolicy).toEqual({
      kind: "change_set_preview",
      exactPreviewRequired: true,
      expires: true,
    });
    expect(capability.idempotencyPolicy).toEqual({
      kind: "required",
      keyField: "idempotency_key",
      conflictOnArgumentsHashMismatch: true,
    });

    const scopes = capability.authorization.variants.flatMap(
      (variant) => variant.requiredOAuthScopes
    );
    expect(scopes).toContain("ops.operations.prepare");
    expect(scopes).not.toContain("ops.communications.send");
    expect(scopes.filter((scope) => /\.(write|send)$/.test(scope))).toEqual([]);
  });

  it("pairs the preview with one exact single-use filing commit", () => {
    const capability = COMMIT_DAY_CLOSEOUT_CAPABILITY_DEFINITION;

    expect(capability.name).toBe("commit_day_closeout");
    expect(capability.operation).toBe("commit");
    expect(capability.writeFamily).toBe("day_closeout");
    expect(capability.confirmationPolicy).toEqual({
      kind: "confirmation_receipt",
      prepareCapability: "prepare_day_closeout",
      exactPreviewRequired: true,
      singleUse: true,
    });
    expect(capability.annotations).toMatchObject({
      destructiveHint: false,
      openWorldHint: false,
    });
  });
});

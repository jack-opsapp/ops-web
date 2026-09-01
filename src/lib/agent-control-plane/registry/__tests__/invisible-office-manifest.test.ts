import { describe, expect, it } from "vitest";

import { isActiveManifestCapabilityPolicy } from "@/lib/agent-control-plane/actor/capability-policy-boundary";
import {
  CAPABILITY_MANIFEST,
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST,
  INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION,
  getInvisibleOfficeCapabilityManifestEntry,
} from "../capability-manifest";

describe("invisible-office capability manifest", () => {
  it("remints v8 without mutating it and appends only the closeout prepare/commit pair", () => {
    expect(INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-30.capability-manifest.v9"
    );
    expect(INVISIBLE_OFFICE_CAPABILITY_MANIFEST).toHaveLength(
      CAPABILITY_MANIFEST.length + 2
    );
    expect(
      INVISIBLE_OFFICE_CAPABILITY_MANIFEST.slice(
        0,
        CAPABILITY_MANIFEST.length
      ).map((entry) => entry.name)
    ).toEqual(CAPABILITY_MANIFEST.map((entry) => entry.name));
    expect(
      INVISIBLE_OFFICE_CAPABILITY_MANIFEST.slice(-2).map((entry) => [
        entry.name,
        entry.operation,
      ])
    ).toEqual([
      ["prepare_day_closeout", "prepare"],
      ["commit_day_closeout", "commit"],
    ]);
    expect(Object.isFrozen(INVISIBLE_OFFICE_CAPABILITY_MANIFEST)).toBe(true);

    for (const entry of INVISIBLE_OFFICE_CAPABILITY_MANIFEST) {
      for (const variant of entry.authorization.variants) {
        expect(variant.policy.capabilityManifestRevision).toBe(
          INVISIBLE_OFFICE_CAPABILITY_MANIFEST_REVISION
        );
        expect(isActiveManifestCapabilityPolicy(variant.policy)).toBe(true);
      }
    }
  });

  it("keeps commit implemented but out of MCP exposure with exact confirmation", () => {
    const commit = getInvisibleOfficeCapabilityManifestEntry(
      "commit_day_closeout"
    );
    expect(commit.availability.implementation).toBe("available");
    expect(commit.operation).toBe("commit");
    expect(commit.confirmationPolicy).toEqual({
      kind: "confirmation_receipt",
      prepareCapability: "prepare_day_closeout",
      exactPreviewRequired: true,
      singleUse: true,
    });
    expect(commit.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

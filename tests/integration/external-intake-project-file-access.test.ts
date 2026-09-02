import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const contractPath = resolve(
  process.cwd(),
  "tests/sql/external-intake-lead-file-access-contract.sql"
);
const contract = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8").toLowerCase()
  : "";

describe("external intake project file and privacy contract", () => {
  it("keeps an executable rollback-only convergence and erasure proof", () => {
    expect(existsSync(contractPath)).toBe(true);
    expect(contract).toContain("scan_before_conversion_projection_failed");
    expect(contract).toContain("conversion_before_scan_projection_failed");
    expect(contract).toContain("duplicate_projection_replayed");
    expect(contract).toContain("guarded_attachment_descriptor_failed");
    expect(contract).toContain("document_inline_resolution_failed");
    expect(contract).toContain("privacy_request_did_not_block_visibility");
    expect(contract).toContain("privacy_erasure_object_manifest_failed");
    expect(contract).toContain("privacy_erasure_projection_tombstone_failed");
    expect(contract.trimEnd()).toMatch(/rollback;$/);
  });
});

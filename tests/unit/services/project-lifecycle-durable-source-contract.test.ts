import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lifecycle = readFileSync(
  join(process.cwd(), "src/lib/api/services/project-lifecycle-service.ts"),
  "utf8"
);
const invoice = readFileSync(
  join(process.cwd(), "src/lib/api/services/invoice-suggestion-service.ts"),
  "utf8"
);

describe("durable project lifecycle source contract", () => {
  it("keys every Phase C proposal to the immutable lifecycle event", () => {
    expect(lifecycle).toContain(
      "`project-status-lifecycle:${lifecycleEventId}`"
    );
    expect(lifecycle).toContain(
      "`${lifecycleSourcePrefix}:task:${resolved.id ?? resolved.display}`"
    );
    expect(lifecycle).toContain(
      "`${lifecycleSourcePrefix}:historical-task:${ttId}`"
    );
    expect(lifecycle).toContain("`${lifecycleSourcePrefix}:invoice`");
    expect(invoice).toContain("sourceId: sourceIdOverride ?? estimateId");
    expect(invoice).toContain("sourceId: sourceIdOverride ?? projectId");
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const servicePath = join(
  process.cwd(),
  "src/lib/api/services/email-outbound-learning-service.ts"
);
const source = existsSync(servicePath) ? readFileSync(servicePath, "utf8") : "";

describe("email outbound learning service contract", () => {
  it("owns preparation, atomic application, and the bounded worker", () => {
    expect(existsSync(servicePath)).toBe(true);
    expect(source).toContain("export class EmailOutboundLearningService");
    expect(source).toContain('"prepare_email_outbound_learning"');
    expect(source).toContain('"apply_email_outbound_learning"');
    expect(source).toContain("runWorker(");
    expect(source).toContain("prepareOutboundEmailSample");
    expect(source).toContain("prepareOutboundEmailLearning");
    expect(source).toContain("prepareSentDraftOutcome");
    expect(source).toContain("p_draft_outcome");
    expect(source).toContain("authoredMessageBody");
    expect(source).not.toContain("WritingProfileService.updateFromEmail(");
    expect(source).not.toContain("MemoryService.processOutboundEmail(");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("project conversion notification boundary", () => {
  it("never creates a direct self-notification after conversion", () => {
    const conversion = source(
      "src/lib/api/services/project-conversion-service.ts"
    );

    expect(conversion).not.toContain("import { NotificationService }");
    expect(conversion).not.toContain("NotificationService.create");
    expect(conversion).not.toContain('title: "Project created"');
  });

  it("does not expose lead conversion through the client notification dispatcher", () => {
    const policy = source(
      "src/lib/notifications/notification-dispatch-policy.ts"
    );
    const resolver = source(
      "src/lib/notifications/notification-event-resolver.ts"
    );
    const client = source("src/lib/api/services/notification-dispatch.ts");

    expect(policy).not.toContain('eventType: "lead_converted"');
    expect(resolver).not.toContain('request.eventType === "lead_converted"');
    expect(client).not.toContain("dispatchLeadConverted");
  });
});

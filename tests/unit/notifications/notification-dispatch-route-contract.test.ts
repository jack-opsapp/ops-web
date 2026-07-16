import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "src/app/api/notifications/dispatch/route.ts"),
  "utf8"
);
const client = readFileSync(
  join(process.cwd(), "src/lib/api/services/notification-dispatch.ts"),
  "utf8"
);

describe("notification dispatch route contract", () => {
  it("resolves canonical actor, event authorization, recipients, and copy server-side", () => {
    expect(route).toContain("resolveNotificationRouteActor(req)");
    expect(route).toContain(
      "parseNotificationDispatchRequest(await req.json())"
    );
    expect(route).toContain("resolveNotificationEvent({");
    expect(route).toContain("resolveNotificationPreferences({");
    expect(route).toContain("createTrustedNotifications(");
    expect(route).not.toMatch(
      /const\s*\{[\s\S]*?companyId[\s\S]*?\}\s*=\s*(body|await req\.json)/
    );
    expect(route).not.toMatch(/recipientIds\s*=|title\s*=|actionUrl\s*=/);
  });

  it("client payloads contain persisted proof IDs, never identity, copy, or navigation", () => {
    expect(client).not.toMatch(/companyId:\s*params\./);
    expect(client).not.toMatch(
      /title:\s*params\.|body:\s*params\.|actionUrl:\s*params\.|actionLabel:\s*params\./
    );
    expect(client).not.toMatch(/recipientIds:\s/);
    expect(client).toContain('eventType: "mention", noteId: params.noteId');
    expect(client).toContain(
      'eventType: "expense_approved", batchId: params.batchId'
    );
  });
});

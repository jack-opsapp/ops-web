import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  join(process.cwd(), "src/lib/notifications/server-notification-service.ts"),
  "utf8"
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/notifications/dispatch/route.ts"),
  "utf8"
);

describe("notification push idempotency", () => {
  it("persists through the created-status RPC and exposes only newly created recipients", () => {
    expect(service).toContain("create_notification_if_new_with_status");
    expect(service).toContain("createdRecipientIds");
    expect(service).not.toContain('db.rpc("create_notification_if_new",');
  });

  it("pushes only for recipients whose rail row was newly created", () => {
    expect(route).toMatch(
      /preferences\.pushRecipientIds[\s\S]*?rail\.createdRecipientIds/
    );
    expect(route).toMatch(/recipientUserIds:\s*pushRecipientIds/);
  });

  it("does not push role-needed when rail persistence failed or deduped", () => {
    expect(service).toMatch(
      /rail\.errors === 0[\s\S]*?rail\.createdRecipientIds\.length > 0/
    );
    expect(service).toMatch(/pushed:\s*pushResult\?\.ok/);
  });
});

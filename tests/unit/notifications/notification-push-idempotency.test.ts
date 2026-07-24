import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  join(process.cwd(), "src/lib/notifications/server-notification-service.ts"),
  "utf8"
);
const dispatcher = readFileSync(
  join(process.cwd(), "src/lib/notifications/dispatch-notification-event.ts"),
  "utf8"
);

describe("notification push idempotency", () => {
  it("persists through the identity RPC and exposes only newly created durable rows", () => {
    expect(service).toContain("create_notification_if_new_with_identity");
    expect(service).toContain("createdRecipientIds");
    expect(service).toContain("createdNotifications");
    expect(service).not.toContain('db.rpc("create_notification_if_new",');
  });

  it("retries durable event pushes while keeping ordinary pushes new-rail-only", () => {
    expect(dispatcher).toContain(
      'params.request.eventType === "project_status_change"'
    );
    expect(dispatcher).toContain('params.request.eventType === "mention_edit"');
    expect(dispatcher).toMatch(
      /\? preferences\.pushRecipientIds[\s\S]*?: preferences\.pushRecipientIds\.filter/
    );
    expect(dispatcher).toContain("idempotencyKey: durablePushEventId");
    expect(dispatcher).toContain('reason: "Notification push failed"');
  });

  it("does not push role-needed when rail persistence failed or deduped", () => {
    expect(service).toMatch(
      /rail\.errors === 0[\s\S]*?rail\.createdRecipientIds\.length > 0/
    );
    expect(service).toMatch(/pushed:\s*pushResult\?\.ok/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "src/app/api/notifications/dispatch/route.ts"),
  "utf8"
);
const dispatcher = readFileSync(
  join(process.cwd(), "src/lib/notifications/dispatch-notification-event.ts"),
  "utf8"
);
const resolver = readFileSync(
  join(process.cwd(), "src/lib/notifications/notification-event-resolver.ts"),
  "utf8"
);
const client = readFileSync(
  join(process.cwd(), "src/lib/api/services/notification-dispatch.ts"),
  "utf8"
);

describe("notification dispatch route contract", () => {
  it("derives the canonical actor at the HTTP boundary and delegates only parsed proof", () => {
    expect(route).toContain("resolveNotificationRouteActor(req)");
    expect(route).toContain(
      "parseNotificationDispatchRequest(await req.json())"
    );
    expect(route).toContain("dispatchNotificationEvent({");
    expect(route).toContain("actor: actorResolution.actor");
    expect(route).toContain("request: parsed.value");
    expect(route).not.toMatch(
      /const\s*\{[\s\S]*?companyId[\s\S]*?\}\s*=\s*(body|await req\.json)/
    );
    expect(route).not.toMatch(/recipientIds\s*=|title\s*=|actionUrl\s*=/);
  });

  it("keeps authorization, recipient/copy resolution, persistence, and push in the canonical server dispatcher", () => {
    expect(dispatcher).toContain('import "server-only"');
    expect(dispatcher).toContain("resolveNotificationEvent(params)");
    expect(dispatcher).toContain("resolveNotificationPreferences({");
    expect(dispatcher).toContain("createTrustedNotifications(");
    expect(dispatcher).toContain("sendOneSignalPush({");
  });

  it("reauthorizes durable project events canonically and derives recipients from active task membership", () => {
    expect(resolver).toContain(
      '"resolve_project_status_notification_as_system"'
    );
    expect(resolver).toContain("eventId: request.projectStatusEventId");
    expect(resolver).toContain(
      "dedupeKey: `project-status-lifecycle:${proof.eventId}`"
    );
    const statusBranch = resolver.slice(
      resolver.indexOf('request.eventType === "project_status_change"'),
      resolver.indexOf('request.eventType === "mention"')
    );
    expect(statusBranch).not.toContain('.from("project_notes")');
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

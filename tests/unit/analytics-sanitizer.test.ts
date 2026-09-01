import { describe, expect, it } from "vitest";
import {
  sanitizeAnalyticsProperties,
  sanitizeClientAnalyticsEvent,
  templateAnalyticsPathname,
} from "@/lib/analytics/event-sanitizer";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    event_type: "action",
    event_name: "project_table_bulk_applied",
    session_id: SESSION_ID,
    properties: { action: "archive", row_count: 3 },
    duration_ms: 125,
    app_version: "2026.8.30",
    device_type: "desktop",
    os_version: "macOS",
    schema_version: 1,
    environment: "production",
    created_at: "2026-08-30T18:00:00.000Z",
    ...overrides,
  };
}

describe("sanitizeAnalyticsProperties", () => {
  it("keeps bounded decision-useful primitives", () => {
    expect(
      sanitizeAnalyticsProperties({
        action: "archive",
        row_count: 3,
        conflict: false,
        mode: null,
        steps_completed: ["identity", "company"],
      })
    ).toEqual({
      action: "archive",
      row_count: 3,
      conflict: false,
      mode: null,
      steps_completed: ["identity", "company"],
    });
  });

  it.each([
    ["email key", { customer_email: "owner@example.com" }],
    ["phone key", { phone_number: "+1 604 555 0188" }],
    ["name key", { client_name: "Jane Example" }],
    ["address key", { site_address: "12 Main Street" }],
    ["token key", { access_token: "secret" }],
    ["email value", { outcome: "owner@example.com" }],
    ["URL value", { outcome: "https://app.opsapp.co/projects/secret" }],
    ["UUID value", { outcome: EVENT_ID }],
    ["UUID path value", { outcome: `/projects/${EVENT_ID}/tasks` }],
    ["phone value", { outcome: "+1 (604) 555-0188" }],
  ])("removes the %s before persistence", (_label, properties) => {
    expect(sanitizeAnalyticsProperties(properties)).toEqual({});
  });

  it("drops nested objects and caps arrays, keys, and strings", () => {
    const result = sanitizeAnalyticsProperties({
      nested: { unsafe: true },
      values: Array.from({ length: 40 }, (_, index) => index),
      long_value: "x".repeat(600),
      ["k".repeat(80)]: "ignored",
    });

    expect(result.nested).toBeUndefined();
    expect(result.values).toHaveLength(25);
    expect(result.long_value).toHaveLength(256);
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("templateAnalyticsPathname", () => {
  it("templates resource identifiers and removes query/fragment data", () => {
    expect(templateAnalyticsPathname(`/projects/${EVENT_ID}/tasks/42?email=x#y`)).toBe(
      "/projects/:id/tasks/:id"
    );
  });
});

describe("sanitizeClientAnalyticsEvent", () => {
  it("accepts the versioned web contract and ignores claimed identity", () => {
    expect(
      sanitizeClientAnalyticsEvent(
        validEvent({
          user_id: "33333333-3333-4333-8333-333333333333",
          company_id: "44444444-4444-4444-8444-444444444444",
          role: "Admin",
          plan: "business",
          platform: "ios",
        }),
        new Date("2026-08-30T18:01:00.000Z").getTime()
      )
    ).toEqual(validEvent());
  });

  it.each([
    ["bad UUID", { id: "not-a-uuid" }],
    ["unknown type", { event_type: "debug" }],
    ["invalid name", { event_name: "Project Viewed!" }],
    ["future timestamp", { created_at: "2026-08-30T18:10:00.000Z" }],
    ["expired timestamp", { created_at: "2026-08-22T17:59:59.000Z" }],
    ["wrong schema", { schema_version: 2 }],
    ["negative duration", { duration_ms: -1 }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      sanitizeClientAnalyticsEvent(
        validEvent(overrides),
        new Date("2026-08-30T18:01:00.000Z").getTime()
      )
    ).toBeNull();
  });

  it("enforces property limits in UTF-8 bytes", () => {
    expect(
      sanitizeClientAnalyticsEvent(
        validEvent({ properties: { outcome: "é".repeat(9_000) } }),
        new Date("2026-08-30T18:01:00.000Z").getTime()
      )
    ).toBeNull();
  });
});

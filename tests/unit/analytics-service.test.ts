import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsService,
  ANALYTICS_QUEUE_STORAGE_KEY,
} from "@/lib/analytics/analytics-service";
import { ANALYTICS_KEEPALIVE_MAX_PAYLOAD_BYTES } from "@/lib/analytics/event-contract";

vi.mock("@/lib/firebase/auth", () => ({ getIdToken: vi.fn() }));

function uuidFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

function okResponse(events: Array<{ id: string }>) {
  return new Response(
    JSON.stringify({
      success: true,
      acceptedIds: events.map((event) => event.id),
      rejectedIds: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("AnalyticsService", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists ordered UUID events without client identity", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const events = JSON.parse(String(init?.body));
      return okResponse(events);
    });
    const service = new AnalyticsService({
      autoStart: false,
      now: () => new Date("2026-08-30T18:00:00.000Z").getTime(),
      randomUUID: uuidFactory(),
      getIdToken: async () => "firebase-token",
      fetch: fetchMock,
      environment: "production",
    });

    service.track("action", "first_event", { order: 1 });
    service.track("action", "second_event", { order: 2 });

    const persisted = JSON.parse(
      localStorage.getItem(ANALYTICS_QUEUE_STORAGE_KEY) ?? "[]"
    );
    expect(persisted.map((event: { event_name: string }) => event.event_name)).toEqual([
      "first_event",
      "second_event",
    ]);
    expect(persisted[0]).not.toHaveProperty("user_id");
    expect(persisted[0]).not.toHaveProperty("company_id");
    expect(persisted[0]).not.toHaveProperty("role");
    expect(persisted[0]).not.toHaveProperty("plan");

    await service.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.pendingCount).toBe(0);
  });

  it("keeps failed events and retries the identical IDs in order", async () => {
    const bodies: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(String(init?.body));
        throw new Error("offline");
      })
      .mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return okResponse(JSON.parse(String(init?.body)));
      });
    const service = new AnalyticsService({
      autoStart: false,
      now: () => new Date("2026-08-30T18:00:00.000Z").getTime(),
      randomUUID: uuidFactory(),
      getIdToken: async () => "firebase-token",
      fetch: fetchMock,
      environment: "production",
    });

    service.track("action", "first_event");
    service.track("action", "second_event");
    await service.flush();
    expect(service.pendingCount).toBe(2);
    await service.flush({ keepalive: true });

    expect(bodies[1]).toBe(bodies[0]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
    expect(service.pendingCount).toBe(0);
  });

  it("preserves events while offline and flushes them in order when connectivity returns", async () => {
    let online = false;
    const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      okResponse(JSON.parse(String(init?.body)))
    );
    const service = new AnalyticsService({
      now: () => new Date("2026-08-30T18:00:00.000Z").getTime(),
      randomUUID: uuidFactory(),
      getIdToken: async () => "firebase-token",
      fetch: fetchMock,
      environment: "production",
    });

    try {
      service.track("action", "first_event");
      service.track("action", "second_event");
      await service.flush();
      expect(fetchMock).not.toHaveBeenCalled();

      online = true;
      window.dispatchEvent(new Event("online"));
      await vi.waitFor(() => expect(service.pendingCount).toBe(0));
      const delivered = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(delivered.map((event: { event_name: string }) => event.event_name)).toEqual([
        "first_event",
        "second_event",
      ]);
    } finally {
      service.destroy();
      if (originalOnline) {
        Object.defineProperty(navigator, "onLine", originalOnline);
      } else {
        Reflect.deleteProperty(navigator, "onLine");
      }
    }
  });

  it("expires seven-day events and caps the durable queue at 1,000", () => {
    const now = new Date("2026-08-30T18:00:00.000Z").getTime();
    localStorage.setItem(
      ANALYTICS_QUEUE_STORAGE_KEY,
      JSON.stringify([
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          event_type: "action",
          event_name: "expired_event",
          session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          properties: {},
          duration_ms: null,
          app_version: null,
          device_type: "desktop",
          os_version: "macOS",
          schema_version: 1,
          environment: "production",
          created_at: "2026-08-22T17:59:59.000Z",
        },
      ])
    );
    const service = new AnalyticsService({
      autoStart: false,
      now: () => now,
      randomUUID: uuidFactory(),
      getIdToken: async () => "firebase-token",
      fetch: vi.fn(),
      environment: "production",
    });
    expect(service.pendingCount).toBe(0);

    for (let index = 0; index < 1001; index += 1) {
      service.track("action", "bounded_event", { index });
    }
    const persisted = JSON.parse(
      localStorage.getItem(ANALYTICS_QUEUE_STORAGE_KEY) ?? "[]"
    );
    expect(persisted).toHaveLength(1000);
    expect(persisted[0].properties.index).toBe(1);
    expect(persisted[999].properties.index).toBe(1000);
  });

  it("never queues properties containing PII or resource UUIDs", () => {
    const service = new AnalyticsService({
      autoStart: false,
      now: () => new Date("2026-08-30T18:00:00.000Z").getTime(),
      randomUUID: uuidFactory(),
      getIdToken: async () => "firebase-token",
      fetch: vi.fn(),
      environment: "production",
    });
    service.track("action", "safe_event", {
      action: "created",
      email: "owner@example.com",
      project_id: "11111111-1111-4111-8111-111111111111",
    });

    const [event] = JSON.parse(
      localStorage.getItem(ANALYTICS_QUEUE_STORAGE_KEY) ?? "[]"
    );
    expect(event.properties).toEqual({ action: "created" });
  });

  it("splits page-exit delivery into keepalive-safe UTF-8 batches", async () => {
    const bodySizes: number[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      bodySizes.push(new TextEncoder().encode(body).byteLength);
      return okResponse(JSON.parse(body));
    });
    const service = new AnalyticsService({
      autoStart: false,
      now: () => new Date("2026-08-30T18:00:00.000Z").getTime(),
      randomUUID: uuidFactory(),
      getIdToken: async () => "firebase-token",
      fetch: fetchMock,
      environment: "production",
    });

    for (let index = 0; index < 12; index += 1) {
      service.track("action", "large_event", {
        index,
        values: Array.from({ length: 25 }, () => "é".repeat(128)),
      });
    }
    await service.flush({ keepalive: true });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(bodySizes.every((size) => size <= ANALYTICS_KEEPALIVE_MAX_PAYLOAD_BYTES)).toBe(true);
    expect(service.pendingCount).toBe(0);
  });
});

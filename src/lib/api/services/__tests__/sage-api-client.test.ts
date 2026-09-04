import { describe, expect, it, vi } from "vitest";
import {
  createSageReadClient,
  createSageWriteClient,
  SageApiError,
} from "../sage-api-client";
import { sageIdempotencyKey } from "../sage-idempotency";

const QUEUE_ID = "11111111-2222-4333-8444-555555555555";

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function options(fetchFn: typeof fetch) {
  return {
    businessId: "business-a",
    getAccessToken: vi.fn(async () => "access-1"),
    refreshAccessToken: vi.fn(async () => "access-2"),
    onDisconnect: vi.fn(async () => undefined),
    fetchFn,
    now: () => new Date("2026-09-04T04:00:00.000Z"),
  };
}

describe("Sage business-bound API client", () => {
  it("rejects an empty business id before issuing a request", () => {
    expect(() =>
      createSageReadClient({ ...options(vi.fn()), businessId: "  " })
    ).toThrow(/business id/i);
  });

  it("sends the exact X-Business header on every accounting request", async () => {
    const fetchFn = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        json(200, { id: "contact-1" })
    );
    const client = createSageReadClient(options(fetchFn as typeof fetch));
    await client.get("contacts", "contact / 1");

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("contacts/contact%20%2F%201");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer access-1",
        "X-Business": "business-a",
      })
    );
  });

  it("refreshes and replays exactly once after a 401", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: "expired" }))
      .mockResolvedValueOnce(json(200, { id: "contact-1" }));
    const input = options(fetchFn as typeof fetch);
    const client = createSageReadClient(input);

    await expect(client.get("contacts", "contact-1")).resolves.toEqual({
      id: "contact-1",
    });
    expect(input.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-2" })
    );
  });

  it("classifies a persistent 403 as reconnect-required and discards the grant", async () => {
    const fetchFn = vi.fn(async () =>
      json(403, { token: "never-leak" }, { "x-request-id": " request-403 " })
    );
    const input = options(fetchFn as typeof fetch);
    const client = createSageReadClient(input);

    const error = await client
      .get("contacts", "contact-1")
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: "reconnect_required",
      requestId: "request-403",
    });
    expect(String(error)).not.toContain("never-leak");
    expect(input.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it.each([
    [408, "retryable_http"],
    [425, "retryable_http"],
    [500, "retryable_http"],
    [422, "validation_failed"],
  ])(
    "classifies HTTP %i without exposing the response body",
    async (status, code) => {
      const fetchFn = vi.fn(async () => json(status, { secret: "hidden" }));
      const client = createSageReadClient(options(fetchFn as typeof fetch));
      let error: SageApiError | undefined;
      try {
        await client.get("contacts", "x");
      } catch (caught) {
        error = caught as SageApiError;
      }
      if (!error) throw new Error("expected SageApiError");
      expect(error.code).toBe(code);
      expect(error.message).not.toContain("hidden");
    }
  );

  it("extracts Retry-After and request evidence from a 429", async () => {
    const fetchFn = vi.fn(async () =>
      json(429, {}, { "Retry-After": "7", "x-request-id": "sage-rate-1" })
    );
    const client = createSageReadClient(options(fetchFn as typeof fetch));
    const error = await client
      .get("contacts", "x")
      .catch((caught) => caught as SageApiError);
    expect(error).toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterMs: 7000,
      requestId: "sage-rate-1",
    });
  });

  it("accepts empty 204 responses and rejects invalid JSON", async () => {
    const noContent = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      createSageReadClient(options(noContent as typeof fetch)).get(
        "contacts",
        "x"
      )
    ).resolves.toBeUndefined();

    const invalid = vi.fn(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    await expect(
      createSageReadClient(options(invalid as typeof fetch)).get(
        "contacts",
        "x"
      )
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("paginates 201 records, carries the incremental cursor, and deduplicates overlap", async () => {
    const pageOne = Array.from({ length: 200 }, (_, index) => ({
      id: `c-${index}`,
    }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(200, { $items: pageOne }))
      .mockResolvedValueOnce(
        json(200, { $items: [{ id: "c-199" }, { id: "c-200" }] })
      );
    const client = createSageReadClient(options(fetchFn as typeof fetch));
    const records = await client.list("contacts", {
      updatedOrCreatedSince: "2026-09-03T00:00:00.000Z",
    });

    expect(records).toHaveLength(201);
    expect(fetchFn.mock.calls[0][0]).toContain("items_per_page=200");
    expect(fetchFn.mock.calls[0][0]).toContain(
      "updated_or_created_since=2026-09-03T00%3A00%3A00.000Z"
    );
    expect(fetchFn.mock.calls[1][0]).toContain("page=2");
  });

  it("rejects a repeated provider cursor instead of looping", async () => {
    const fetchFn = vi.fn(async () =>
      json(200, {
        $items: [{ id: "c-1" }],
        $next: "/v3.1/contacts?cursor=same",
      })
    );
    const client = createSageReadClient(options(fetchFn as typeof fetch));
    await expect(client.list("contacts")).rejects.toMatchObject({
      code: "repeated_cursor",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("injects a stable resource-scoped idempotency id and rejects mismatches", async () => {
    const fetchFn = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        json(201, { id: "contact-1" }, { "x-request-id": "sage-write-1" })
    );
    const client = createSageWriteClient(options(fetchFn as typeof fetch));
    const key = sageIdempotencyKey(QUEUE_ID, "contacts");
    const result = await client.create("contacts", { name: "Acme" }, key);

    const body = JSON.parse(String(fetchFn.mock.calls[0][1]?.body));
    expect(body.contact.idempotency_id).toBe(key.id);
    expect(result.evidence).toEqual({
      requestId: "sage-write-1",
      status: 201,
      acceptedAt: "2026-09-04T04:00:00.000Z",
    });
    await expect(
      client.create("sales_invoices", {}, key as never)
    ).rejects.toThrow(/resource/i);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

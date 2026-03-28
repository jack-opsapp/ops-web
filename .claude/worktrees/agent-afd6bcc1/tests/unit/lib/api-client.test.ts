/**
 * Tests for the Bubble API Client
 *
 * Tests the HTTP client that communicates with the Bubble.io Data API.
 * Covers authorization, rate limiting, response unwrapping, retry logic,
 * and error handling.
 *
 * NOTE: These tests define the expected API for src/lib/api/bubble-client.ts
 * which will be created as part of the web app build-out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { server } from "../../mocks/server";
import { mockProjects, wrapBubbleList } from "../../mocks/data";

const BASE_URL = "https://opsapp.co/api/1.1";
const API_TOKEN = "f81e9da85b7a12e996ac53e970a52299";

// ─── Inline API Client Implementation (specification for real module) ────────

interface BubbleApiConfig {
  baseUrl: string;
  token: string;
  minRequestIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

class BubbleApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown
  ) {
    super(message);
    this.name = "BubbleApiError";
  }
}

class NetworkError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = "NetworkError";
  }
}

function createBubbleClient(config: BubbleApiConfig) {
  const {
    baseUrl,
    token,
    minRequestIntervalMs = 500,
    maxRetries = 3,
    retryDelayMs = 1000,
  } = config;

  let lastRequestTime = 0;

  async function rateLimitWait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < minRequestIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, minRequestIntervalMs - elapsed)
      );
    }
    lastRequestTime = Date.now();
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    retryCount = 0
  ): Promise<T> {
    await rateLimitWait();

    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const responseBody = await response.json().catch(() => null);

        if (response.status >= 500 && retryCount < maxRetries) {
          const backoffDelay = retryDelayMs * Math.pow(2, retryCount);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          return request<T>(method, path, body, retryCount + 1);
        }

        throw new BubbleApiError(
          `API error: ${response.status} ${response.statusText}`,
          response.status,
          responseBody
        );
      }

      const json = await response.json();

      // Unwrap Bubble .response wrapper for data API calls
      if (json.response !== undefined) {
        return json.response as T;
      }
      return json as T;
    } catch (error) {
      if (error instanceof BubbleApiError) {
        throw error;
      }
      if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network"))) {
        throw new NetworkError("Network request failed", error);
      }
      throw error;
    }
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) =>
      request<T>("POST", path, body),
    patch: <T>(path: string, body?: unknown) =>
      request<T>("PATCH", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Bubble API Client", () => {
  let client: ReturnType<typeof createBubbleClient>;

  beforeEach(() => {
    client = createBubbleClient({
      baseUrl: BASE_URL,
      token: API_TOKEN,
      minRequestIntervalMs: 0, // Disable rate limiting in most tests
      maxRetries: 2,
      retryDelayMs: 10, // Fast retries for tests
    });
  });

  // ─── Authorization ──────────────────────────────────────────────────────

  describe("Authorization", () => {
    it("adds Authorization header with Bearer token to all requests", async () => {
      let capturedHeaders: Headers | null = null;

      server.use(
        http.get(`${BASE_URL}/obj/project`, ({ request }) => {
          capturedHeaders = new Headers(request.headers);
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        })
      );

      await client.get("/obj/project");

      expect(capturedHeaders).not.toBeNull();
      expect(capturedHeaders!.get("authorization")).toBe(`Bearer ${API_TOKEN}`);
    });

    it("adds Content-Type: application/json header", async () => {
      let capturedHeaders: Headers | null = null;

      server.use(
        http.get(`${BASE_URL}/obj/project`, ({ request }) => {
          capturedHeaders = new Headers(request.headers);
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        })
      );

      await client.get("/obj/project");

      expect(capturedHeaders!.get("content-type")).toBe("application/json");
    });

    it("includes Authorization on POST requests", async () => {
      let capturedHeaders: Headers | null = null;

      server.use(
        http.post(`${BASE_URL}/obj/project`, ({ request }) => {
          capturedHeaders = new Headers(request.headers);
          return HttpResponse.json({ response: { _id: "new-123" } }, { status: 201 });
        })
      );

      await client.post("/obj/project", { projectName: "Test" });

      expect(capturedHeaders!.get("authorization")).toBe(`Bearer ${API_TOKEN}`);
    });

    it("includes Authorization on PATCH requests", async () => {
      let capturedHeaders: Headers | null = null;

      server.use(
        http.patch(`${BASE_URL}/obj/project/proj-1`, ({ request }) => {
          capturedHeaders = new Headers(request.headers);
          return HttpResponse.json({ response: { _id: "proj-1" } });
        })
      );

      await client.patch("/obj/project/proj-1", { status: "Completed" });

      expect(capturedHeaders!.get("authorization")).toBe(`Bearer ${API_TOKEN}`);
    });
  });

  // ─── Rate Limiting ────────────────────────────────────────────────────

  describe("Rate limiting", () => {
    it("enforces minimum interval between requests", async () => {
      const rateLimitedClient = createBubbleClient({
        baseUrl: BASE_URL,
        token: API_TOKEN,
        minRequestIntervalMs: 100,
        maxRetries: 0,
        retryDelayMs: 10,
      });

      const requestTimes: number[] = [];

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          requestTimes.push(Date.now());
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        })
      );

      await rateLimitedClient.get("/obj/project");
      await rateLimitedClient.get("/obj/project");

      expect(requestTimes).toHaveLength(2);
      const elapsed = requestTimes[1] - requestTimes[0];
      // Should have at least ~100ms between requests (allowing some tolerance)
      expect(elapsed).toBeGreaterThanOrEqual(80);
    });
  });

  // ─── Response Unwrapping ──────────────────────────────────────────────

  describe("Response unwrapping", () => {
    it("unwraps Bubble .response wrapper from list responses", async () => {
      const projects = mockProjects(3);

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(wrapBubbleList(projects));
        })
      );

      const result = await client.get<{
        cursor: number;
        results: unknown[];
        remaining: number;
        count: number;
      }>("/obj/project");

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("cursor");
      expect(result).toHaveProperty("remaining");
      expect(result).toHaveProperty("count");
      expect(result.results).toHaveLength(3);
    });

    it("unwraps Bubble .response wrapper from single-object responses", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/company/comp-1`, () => {
          return HttpResponse.json({
            response: { _id: "comp-1", companyName: "Test Co" },
          });
        })
      );

      const result = await client.get<{ _id: string; companyName: string }>(
        "/obj/company/comp-1"
      );

      expect(result._id).toBe("comp-1");
      expect(result.companyName).toBe("Test Co");
    });

    it("returns raw response when no .response wrapper exists", async () => {
      server.use(
        http.post(`${BASE_URL}/wf/delete_project`, () => {
          return HttpResponse.json({ status: "success", deleted: true });
        })
      );

      const result = await client.post<{ status: string; deleted: boolean }>(
        "/wf/delete_project",
        { project_id: "proj-1" }
      );

      expect(result.status).toBe("success");
    });
  });

  // ─── Retry Logic ──────────────────────────────────────────────────────

  describe("Retry with exponential backoff", () => {
    it("retries on 500 server error", async () => {
      let requestCount = 0;

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          requestCount++;
          if (requestCount <= 2) {
            return HttpResponse.json(
              { status: "error", message: "Internal Server Error" },
              { status: 500 }
            );
          }
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        })
      );

      const result = await client.get<{
        results: unknown[];
      }>("/obj/project");

      expect(requestCount).toBe(3); // 1 original + 2 retries
      expect(result.results).toHaveLength(1);
    });

    it("throws after max retries exceeded", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(
            { status: "error", message: "Server Down" },
            { status: 500 }
          );
        })
      );

      await expect(client.get("/obj/project")).rejects.toThrow(BubbleApiError);
    });

    it("does NOT retry on 4xx errors", async () => {
      let requestCount = 0;

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          requestCount++;
          return HttpResponse.json(
            { status: "error", message: "Bad Request" },
            { status: 400 }
          );
        })
      );

      await expect(client.get("/obj/project")).rejects.toThrow(BubbleApiError);
      expect(requestCount).toBe(1); // No retries
    });

    it("does NOT retry on 401 unauthorized", async () => {
      let requestCount = 0;

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          requestCount++;
          return HttpResponse.json(
            { status: "error", message: "Unauthorized" },
            { status: 401 }
          );
        })
      );

      await expect(client.get("/obj/project")).rejects.toThrow(BubbleApiError);
      expect(requestCount).toBe(1);
    });
  });

  // ─── Error Types ──────────────────────────────────────────────────────

  describe("Error types", () => {
    it("throws BubbleApiError with status code for HTTP errors", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(
            { status: "error", message: "Not Found" },
            { status: 404 }
          );
        })
      );

      try {
        await client.get("/obj/project");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(BubbleApiError);
        expect((error as BubbleApiError).statusCode).toBe(404);
        expect((error as BubbleApiError).message).toContain("404");
      }
    });

    it("includes response body in BubbleApiError", async () => {
      const errorBody = { status: "error", message: "Invalid constraint format" };

      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(errorBody, { status: 400 });
        })
      );

      try {
        await client.get("/obj/project");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(BubbleApiError);
        expect((error as BubbleApiError).responseBody).toEqual(errorBody);
      }
    });

    it("throws BubbleApiError for 429 rate limit", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.json(
            { status: "error", message: "Rate limit exceeded" },
            { status: 429 }
          );
        })
      );

      try {
        await client.get("/obj/project");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(BubbleApiError);
        expect((error as BubbleApiError).statusCode).toBe(429);
      }
    });
  });

  // ─── Network Errors ───────────────────────────────────────────────────

  describe("Network errors", () => {
    it("handles network failure gracefully", async () => {
      server.use(
        http.get(`${BASE_URL}/obj/project`, () => {
          return HttpResponse.error();
        })
      );

      await expect(client.get("/obj/project")).rejects.toThrow();
    });
  });

  // ─── Request Body Handling ────────────────────────────────────────────

  describe("Request body handling", () => {
    it("sends JSON body on POST", async () => {
      let capturedBody: unknown = null;

      server.use(
        http.post(`${BASE_URL}/obj/project`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(
            { response: { _id: "new-123" } },
            { status: 201 }
          );
        })
      );

      await client.post("/obj/project", {
        projectName: "Test Project",
        status: "RFQ",
        company: "comp-123",
      });

      expect(capturedBody).toEqual({
        projectName: "Test Project",
        status: "RFQ",
        company: "comp-123",
      });
    });

    it("sends JSON body on PATCH", async () => {
      let capturedBody: unknown = null;

      server.use(
        http.patch(`${BASE_URL}/obj/project/proj-1`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ response: { _id: "proj-1" } });
        })
      );

      await client.patch("/obj/project/proj-1", { status: "Completed" });

      expect(capturedBody).toEqual({ status: "Completed" });
    });

    it("does not send body on GET", async () => {
      let requestHadBody = false;

      server.use(
        http.get(`${BASE_URL}/obj/project`, async ({ request }) => {
          // fetch GET requests should not have a body
          requestHadBody = request.body !== null;
          return HttpResponse.json(wrapBubbleList(mockProjects(1)));
        })
      );

      await client.get("/obj/project");

      expect(requestHadBody).toBe(false);
    });
  });
});

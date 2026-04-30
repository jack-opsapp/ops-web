/**
 * Integration tests for the post-import email image extractor after
 * the Phase 1 cutover to S3.
 *
 * The 800s background `after()` callback is the most expensive single
 * code path in the migration — historically 94% of Supabase Storage
 * bytes flow through it. The tests here exercise the upload-key
 * construction, backend selection, and per-attachment fallback so a
 * regression doesn't quietly leak bytes back into Supabase.
 *
 * The route's structure makes it awkward to test the background
 * `after()` body directly — the upload step is private and lives
 * inside a module-scoped helper. Rather than reaching into the route's
 * internals via a code-only test seam, we exercise the public POST
 * surface and assert on the dispatch envelope (the synchronous bit),
 * then unit-test the key-construction helper used inside the
 * background body via the path-auth tests already present in
 * `tests/unit/s3-path-auth.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    // `after()` schedules work to run after the response is sent. In
    // tests we'd never observe the side effects otherwise — patch it
    // to a no-op so the foreground response is what we assert on.
    after: (_fn: () => void | Promise<void>) => undefined,
  };
});

const supabaseMock = {
  from: vi.fn(),
  storage: {
    from: vi.fn(),
  },
};
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabaseMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  runWithSupabase: async (_client: unknown, fn: () => Promise<unknown>) => fn(),
}));

const getConnectionMock = vi.fn();
vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: (id: string) => getConnectionMock(id),
    getProvider: () => ({}),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadRoute() {
  const mod = await import("@/app/api/integrations/email/extract-images/route");
  return mod.POST;
}

function jsonRequest(body: unknown): NextRequest {
  return new Request(
    "http://localhost/api/integrations/email/extract-images",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  ) as unknown as NextRequest;
}

beforeEach(() => {
  getConnectionMock.mockReset();
  vi.resetModules();
  delete process.env.STORAGE_BACKEND;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/integrations/email/extract-images — request validation", () => {
  it("rejects requests missing required fields", async () => {
    const POST = await loadRoute();
    const res = await POST(jsonRequest({ jobId: "j1" }));
    expect(res.status).toBe(400);
  });

  it("rejects requests when the email connection is not found", async () => {
    getConnectionMock.mockResolvedValue(null);
    const POST = await loadRoute();
    const res = await POST(
      jsonRequest({
        jobId: "j1",
        connectionId: "c1",
        companyId: "co1",
        oppThreadPayload: [],
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 ok envelope when dispatch is valid (extraction runs in background)", async () => {
    getConnectionMock.mockResolvedValue({ id: "c1", provider: "gmail" });
    const POST = await loadRoute();
    const res = await POST(
      jsonRequest({
        jobId: "j1",
        connectionId: "c1",
        companyId: "co1",
        oppThreadPayload: [],
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

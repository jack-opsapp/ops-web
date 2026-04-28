/**
 * Integration tests for the three admin pause routes.
 * Stubs `withAdmin`/`requireAdmin` and the pause service layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { pauseSpy, resumeSpy, getActivePausesSpy, listAuditLogSpy } = vi.hoisted(
  () => ({
    pauseSpy: vi.fn(),
    resumeSpy: vi.fn(),
    getActivePausesSpy: vi.fn(),
    listAuditLogSpy: vi.fn(),
  })
);

vi.mock("@/lib/admin/api-auth", () => ({
  withAdmin: (handler: unknown) => handler,
  requireAdmin: vi.fn(async () => ({
    uid: "admin-uuid",
    email: "ops@opsapp.co",
    claims: {},
  })),
}));

vi.mock("@/lib/email/pause", () => ({
  pause: (...a: unknown[]) => pauseSpy(...a),
  resume: (...a: unknown[]) => resumeSpy(...a),
  getActivePauses: () => getActivePausesSpy(),
  listAuditLog: (...a: unknown[]) => listAuditLogSpy(...a),
}));

import { POST as pausePost } from "@/app/api/admin/email/pause/route";
import { POST as resumePost } from "@/app/api/admin/email/resume/route";
import { GET as pausesGet } from "@/app/api/admin/email/pauses/route";

beforeEach(() => {
  pauseSpy.mockReset();
  resumeSpy.mockReset();
  getActivePausesSpy.mockReset();
  listAuditLogSpy.mockReset();
  pauseSpy.mockResolvedValue({
    state: {
      scope: "global",
      isPaused: true,
      pauseReason: "ok",
      pausedUntil: null,
      pausedAt: new Date().toISOString(),
      pausedBy: "admin-uuid",
    },
    pauseAuditId: "audit-stub-id",
  });
  resumeSpy.mockResolvedValue(undefined);
  getActivePausesSpy.mockResolvedValue([]);
  listAuditLogSpy.mockResolvedValue([]);
});

function postReq(body: unknown): NextRequest {
  return new NextRequest("https://example.com/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function getReq(url: string): NextRequest {
  return new NextRequest(url);
}

describe("POST /api/admin/email/pause", () => {
  it("400 when reason missing", async () => {
    const r = await pausePost(postReq({ scope: "global" }));
    expect(r.status).toBe(400);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("400 when reason too short", async () => {
    const r = await pausePost(postReq({ scope: "global", reason: "ab" }));
    expect(r.status).toBe(400);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("400 when scope is invalid", async () => {
    const r = await pausePost(
      postReq({ scope: "bucket:typo", reason: "ok reason" })
    );
    expect(r.status).toBe(400);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("400 when paused_until is malformed", async () => {
    const r = await pausePost(
      postReq({ scope: "global", reason: "ok reason", paused_until: "garbage" })
    );
    expect(r.status).toBe(400);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it("200 with valid input — calls pause()", async () => {
    const r = await pausePost(
      postReq({ scope: "global", reason: "test reason long enough" })
    );
    expect(r.status).toBe(200);
    expect(pauseSpy).toHaveBeenCalledOnce();
    expect(pauseSpy.mock.calls[0][0]).toMatchObject({
      scope: "global",
      reason: "test reason long enough",
      actorUserId: "admin-uuid",
      actorEmail: "ops@opsapp.co",
    });
  });

  it("accepts bucket scope", async () => {
    const r = await pausePost(
      postReq({ scope: "bucket:gate", reason: "DNS misalign" })
    );
    expect(r.status).toBe(200);
    expect(pauseSpy).toHaveBeenCalledOnce();
  });

  it("accepts campaign scope with valid UUID", async () => {
    const r = await pausePost(
      postReq({
        scope: "campaign:11111111-2222-3333-4444-555555555555",
        reason: "operator stopped this one",
      })
    );
    expect(r.status).toBe(200);
  });
});

describe("POST /api/admin/email/resume", () => {
  it("400 when scope missing", async () => {
    const r = await resumePost(postReq({}));
    expect(r.status).toBe(400);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it("400 when scope invalid", async () => {
    const r = await resumePost(postReq({ scope: "fleet:bad" }));
    expect(r.status).toBe(400);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it("200 calls resume() with admin context", async () => {
    const r = await resumePost(postReq({ scope: "bucket:dispatch" }));
    expect(r.status).toBe(200);
    expect(resumeSpy).toHaveBeenCalledOnce();
    expect(resumeSpy.mock.calls[0][0]).toMatchObject({
      scope: "bucket:dispatch",
      actorUserId: "admin-uuid",
      actorEmail: "ops@opsapp.co",
    });
  });
});

describe("GET /api/admin/email/pauses", () => {
  it("returns active pauses without audit by default", async () => {
    getActivePausesSpy.mockResolvedValue([
      {
        scope: "global",
        isPaused: true,
        pauseReason: "test",
        pausedUntil: null,
        pausedAt: null,
        pausedBy: null,
      },
    ]);
    const r = await pausesGet(getReq("https://example.com/api/admin/email/pauses"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.active).toHaveLength(1);
    expect(body.audit).toBeNull();
    expect(listAuditLogSpy).not.toHaveBeenCalled();
  });

  it("returns audit log when ?audit=1", async () => {
    listAuditLogSpy.mockResolvedValue([
      {
        id: "x",
        scope: "global",
        action: "pause",
        reason: "y",
        paused_until: null,
        actor_email: "ops@opsapp.co",
        created_at: new Date().toISOString(),
      },
    ]);
    const r = await pausesGet(
      getReq("https://example.com/api/admin/email/pauses?audit=1")
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.audit).toHaveLength(1);
    expect(listAuditLogSpy).toHaveBeenCalledOnce();
  });
});

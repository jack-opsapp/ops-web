import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const handlers = vi.hoisted(() => ({
  listProposals: vi.fn(async () => NextResponse.json({ proposals: [] })),
  reviewProposal: vi.fn(async () => NextResponse.json({ ok: true })),
  getSettings: vi.fn(async () => NextResponse.json({ settings: {} })),
  patchSettings: vi.fn(async () => NextResponse.json({ settings: {} })),
  listTests: vi.fn(async () => NextResponse.json({ tests: [] })),
  listChanges: vi.fn(async () => NextResponse.json({ changes: [] })),
  funnel: vi.fn(async () => NextResponse.json({ rows: [] })),
  health: vi.fn(async () => NextResponse.json({ ok: true })),
}));
vi.mock("@/lib/admin/api-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/api-auth")>("@/lib/admin/api-auth");
  return { ...actual, requireAdmin: auth.requireAdmin };
});
vi.mock("@/lib/ads/engine/admin-runtime", () => ({ engineAdminHandlers: () => handlers }));

import { GET as listProposals } from "@/app/api/admin/google-ads/engine/proposals/route";
import { POST as review } from "@/app/api/admin/google-ads/engine/proposals/[id]/route";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/admin/google-ads/engine/settings/route";
import { GET as tests } from "@/app/api/admin/google-ads/engine/tests/route";
import { GET as changes } from "@/app/api/admin/google-ads/engine/changes/route";
import { GET as funnel } from "@/app/api/admin/google-ads/engine/funnel/route";
import { GET as health } from "@/app/api/admin/google-ads/engine/health/route";

const req = (method = "GET") => new NextRequest("http://localhost/api/admin/google-ads/engine/x", { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
const params = { params: Promise.resolve({ id: "pppppppp-pppp-4ppp-8ppp-000000000001" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("engine admin routes", () => {
  it("refuse every route without an admin, before any handler runs", async () => {
    auth.requireAdmin.mockRejectedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const responses = await Promise.all([
      listProposals(req()),
      review(req("POST"), params),
      getSettings(req()),
      patchSettings(req("PATCH")),
      tests(req()),
      changes(req()),
      funnel(req()),
      health(req()),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it("pass the admin's email as the reviewer on a decision", async () => {
    auth.requireAdmin.mockResolvedValue({ email: "jackson@opsapp.co", uid: "u1" });
    const response = await review(req("POST"), params);
    expect(response.status).toBe(200);
    expect(handlers.reviewProposal).toHaveBeenCalledWith(expect.any(NextRequest), "pppppppp-pppp-4ppp-8ppp-000000000001", "jackson@opsapp.co");
  });

  it("dispatch the readouts once the admin is verified", async () => {
    auth.requireAdmin.mockResolvedValue({ email: "jackson@opsapp.co", uid: "u1" });
    await Promise.all([listProposals(req()), getSettings(req()), patchSettings(req("PATCH")), tests(req()), changes(req()), funnel(req()), health(req())]);
    for (const handler of [handlers.listProposals, handlers.getSettings, handlers.patchSettings, handlers.listTests, handlers.listChanges, handlers.funnel, handlers.health])
      expect(handler).toHaveBeenCalledTimes(1);
  });
});

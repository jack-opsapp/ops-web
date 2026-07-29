/**
 * POST /api/data/export — the customer's own data, complete (bug 241830b2).
 *
 * The old route exported eleven entities, silently dropped every error, and
 * asked for `tasks`, `estimate_line_items` and `invoice_line_items` — none of
 * which exist — so tasks and all line items were missing from every export
 * ever produced. It now runs off the same manifest as the deletion cascade.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PostgrestStub } from "../utils/postgrest-stub";
import { MANIFEST_VERSION, exportPlan } from "@/lib/data/company-data-manifest";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const { verifyAuthMock, checkPermissionMock, findUserMock } = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  findUserMock: vi.fn(),
}));

let stub: PostgrestStub;

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => stub.client(),
}));
vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAuthToken: (token: string) => verifyAuthMock(token),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: (...args: unknown[]) => findUserMock(...args),
}));

import { POST } from "@/app/api/data/export/route";

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const validBody = { idToken: "firebase-token", companyId: COMPANY };

beforeEach(() => {
  stub = new PostgrestStub();
  stub.setRows("companies", [
    { id: COMPANY, name: "Norcut", deleted_at: null },
  ]);
  verifyAuthMock.mockReset().mockResolvedValue({
    uid: "firebase-1",
    email: "boss@ops.co",
  });
  checkPermissionMock.mockReset().mockResolvedValue(true);
  findUserMock
    .mockReset()
    .mockResolvedValue({ id: USER, company_id: COMPANY });
});

async function exportBody() {
  const res = await POST(request(validBody));
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

describe("POST /api/data/export — authorization gates are unchanged", () => {
  it("rejects a request missing idToken or companyId", async () => {
    expect((await POST(request({ idToken: "x" }))).status).toBe(400);
  });

  it("requires the settings.company permission", async () => {
    checkPermissionMock.mockResolvedValue(false);
    expect((await POST(request(validBody))).status).toBe(403);
  });

  it("requires the caller to belong to the company", async () => {
    findUserMock.mockResolvedValue({ id: USER, company_id: "other" });
    expect((await POST(request(validBody))).status).toBe(403);
  });

  it("404s when the company row is gone", async () => {
    stub.setRows("companies", []);
    expect((await POST(request(validBody))).status).toBe(404);
  });
});

describe("POST /api/data/export — download shape", () => {
  it("returns a JSON attachment with a dated filename", async () => {
    const res = await POST(request(validBody));
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="ops-export-\d{4}-\d{2}-\d{2}\.json"$/
    );
  });

  it("carries a manifest-version header block and keys data by table name", async () => {
    const body = await exportBody();
    expect(body.manifestVersion).toBe(MANIFEST_VERSION);
    expect(body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.companyId).toBe(COMPANY);
    expect(body.tableCount).toBe(exportPlan().length);
    expect(Object.keys(body.tables).sort()).toEqual(
      exportPlan()
        .map((e) => e.table)
        .sort()
    );
  });

  it("includes the company row under its table name", async () => {
    const body = await exportBody();
    expect(body.tables.companies).toEqual([
      { id: COMPANY, name: "Norcut", deleted_at: null },
    ]);
  });
});

describe("POST /api/data/export — coverage", () => {
  it("exports project_tasks and line_items, which the old route could never fetch", async () => {
    stub.setRows("project_tasks", [
      { id: "t1", company_id: COMPANY, title: "Frame deck", deleted_at: null },
    ]);
    stub.setRows("line_items", [
      { id: "l1", company_id: COMPANY, description: "2x8 joist" },
    ]);

    const body = await exportBody();
    expect(body.tables.project_tasks).toHaveLength(1);
    expect(body.tables.line_items).toEqual([
      { id: "l1", company_id: COMPANY, description: "2x8 joist" },
    ]);
  });

  it("excludes internal machinery and anything holding credentials", async () => {
    const body = await exportBody();
    for (const table of [
      "email_connections",
      "email_oauth_states",
      "portal_tokens",
      "portal_sessions",
      "accounting_connections",
      "accounting_sync_queue",
      "analytics_events",
      "wizard_analytics",
      "qbo_staging_estimates",
      "notifications",
    ]) {
      expect(body.tables, `${table} must not be exported`).not.toHaveProperty(
        table
      );
      expect(stub.opsFor(table), `${table} must not be read`).toEqual([]);
    }
  });

  it("exports the customer's own records the old route dropped", async () => {
    const body = await exportBody();
    for (const table of [
      "expenses",
      "project_photos",
      "project_notes",
      "site_visits",
      "sub_clients",
      "follow_ups",
      "activities",
      "calendar_user_events",
      "deck_designs",
      "payments",
      "catalog_items",
    ]) {
      expect(body.tables, `${table}`).toHaveProperty(table);
    }
  });
});

describe("POST /api/data/export — the deleted_at filter trap", () => {
  it("never filters deleted_at on a table that has no such column", async () => {
    await exportBody();
    for (const table of ["line_items", "payments", "follow_ups", "activities"]) {
      const ops = stub.opsFor(table);
      expect(ops.length, `${table} not read`).toBeGreaterThan(0);
      expect(
        ops.some((op) => op.filters.some((f) => f.column === "deleted_at")),
        `${table} has no deleted_at column`
      ).toBe(false);
    }
  });

  it("excludes tombstoned rows from soft-deletable tables", async () => {
    stub.setRows("projects", [
      { id: "p1", company_id: COMPANY, deleted_at: null },
      { id: "p2", company_id: COMPANY, deleted_at: "2026-01-01T00:00:00.000Z" },
    ]);
    const body = await exportBody();
    expect(body.tables.projects).toHaveLength(1);
    expect(body.tables.projects[0].id).toBe("p1");
  });
});

describe("POST /api/data/export — parent-scoped children", () => {
  it("fetches children through their parent ids", async () => {
    stub.setRows("products", [
      { id: "pr1", company_id: COMPANY, deleted_at: null },
    ]);
    stub.setRows("product_tax_rates", [
      { product_id: "pr1", tax_rate_id: "tr1" },
    ]);

    const body = await exportBody();
    expect(body.tables.product_tax_rates).toEqual([
      { product_id: "pr1", tax_rate_id: "tr1" },
    ]);
  });

  it("chunks parent ids past the 500 boundary", async () => {
    const ids = Array.from({ length: 1100 }, (_, i) => `pr-${i}`);
    stub.setRows(
      "products",
      ids.map((id) => ({ id, company_id: COMPANY, deleted_at: null }))
    );
    stub.setRows(
      "product_tax_rates",
      ids.map((id) => ({ product_id: id, tax_rate_id: "tr1" }))
    );

    const body = await exportBody();
    expect(body.tables.product_tax_rates).toHaveLength(1100);

    const reads = stub
      .opsFor("product_tax_rates")
      .filter((op) => op.filters.some((f) => f.op === "in"));
    expect(reads.length).toBe(3);
    for (const op of reads) {
      const filter = op.filters.find((f) => f.op === "in")!;
      expect((filter.value as unknown[]).length).toBeLessThanOrEqual(500);
    }
  });

  it("returns an empty array for a child whose parent has no rows", async () => {
    const body = await exportBody();
    expect(body.tables.product_tax_rates).toEqual([]);
    expect(stub.opsFor("product_tax_rates")).toEqual([]);
  });
});

describe("POST /api/data/export — failures are never swallowed", () => {
  it("500s naming the table that failed instead of returning an empty array", async () => {
    stub.failOn("project_tasks", "select", {
      message: "relation \"project_tasks\" does not exist",
      code: "42P01",
    });

    const res = await POST(request(validBody));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain("project_tasks");
    expect(body.error).toContain("does not exist");
    expect(body.failedStep.table).toBe("project_tasks");
  });

  it("does not stream a partial file when a table fails", async () => {
    stub.failOn("clients", "select", { message: "statement timeout" });
    const res = await POST(request(validBody));
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});

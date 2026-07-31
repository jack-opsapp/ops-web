/**
 * POST /api/data/delete-account — one manifest-driven database transaction.
 *
 * The route owns identity, authorization, Stripe, logging, and the API shape.
 * PostgreSQL owns the destructive cascade. The entire manifest plan crosses
 * that boundary in one RPC so a failure rolls every table back.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PostgrestStub } from "../utils/postgrest-stub";
import {
  FK_CYCLE_BREAKERS,
  MANIFEST_VERSION,
  deletionPlan,
  isDefinerPurged,
} from "@/lib/data/company-data-manifest";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PURGE_FUNCTION = "purge_company_data";

const {
  verifyAuthMock,
  checkPermissionMock,
  findUserMock,
  stripeListMock,
  stripeCancelMock,
} = vi.hoisted(() => ({
  verifyAuthMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  findUserMock: vi.fn(),
  stripeListMock: vi.fn(),
  stripeCancelMock: vi.fn(),
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
vi.mock("stripe", () => ({
  default: class {
    subscriptions = {
      list: (args: unknown) => stripeListMock(args),
      cancel: (id: string) => stripeCancelMock(id),
    };
  },
}));

import { POST } from "@/app/api/data/delete-account/route";

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const validBody = {
  idToken: "firebase-token",
  companyId: COMPANY,
  confirmText: "DELETE",
};

function seedCompany(stripeCustomerId: string | null = null) {
  stub.setRows("companies", [
    {
      id: COMPANY,
      admin_ids: [USER],
      stripe_customer_id: stripeCustomerId,
      deleted_at: null,
    },
  ]);
}

function successfulPurgeResult(counts: Record<string, number> = {}) {
  return {
    manifest_version: MANIFEST_VERSION,
    deleted_counts: Object.fromEntries(
      deletionPlan().map((entry) => [entry.table, counts[entry.table] ?? 0])
    ),
    completed_steps: deletionPlan().length,
    total_steps: deletionPlan().length,
  };
}

beforeEach(() => {
  stub = new PostgrestStub();
  seedCompany();
  stub.setRpcResult(PURGE_FUNCTION, successfulPurgeResult());
  verifyAuthMock.mockReset().mockResolvedValue({
    uid: "firebase-1",
    email: "boss@ops.co",
  });
  checkPermissionMock.mockReset().mockResolvedValue(true);
  findUserMock.mockReset().mockResolvedValue({
    id: USER,
    company_id: COMPANY,
    is_company_admin: true,
  });
  stripeListMock.mockReset().mockResolvedValue({ data: [] });
  stripeCancelMock.mockReset().mockResolvedValue({});
  process.env.STRIPE_SECRET_KEY = "sk_test_stub";
});

describe("POST /api/data/delete-account — authorization gates", () => {
  it("rejects a request missing idToken or companyId", async () => {
    expect((await POST(request({ confirmText: "DELETE" }))).status).toBe(400);
  });

  it("requires the literal DELETE confirmation", async () => {
    const res = await POST(request({ ...validBody, confirmText: "delete" }));
    expect(res.status).toBe(400);
    expect(stub.ops).toEqual([]);
  });

  it("requires the settings.company permission", async () => {
    checkPermissionMock.mockResolvedValue(false);
    const res = await POST(request(validBody));
    expect(res.status).toBe(403);
    expect(checkPermissionMock).toHaveBeenCalledWith(
      "firebase-1",
      "settings.company",
      "boss@ops.co"
    );
  });

  it("requires the caller to belong to the company", async () => {
    findUserMock.mockResolvedValue({ id: USER, company_id: "other" });
    expect((await POST(request(validBody))).status).toBe(403);
  });

  it("requires company-admin standing", async () => {
    findUserMock.mockResolvedValue({
      id: USER,
      company_id: COMPANY,
      is_company_admin: false,
    });
    stub.setRows("companies", [
      { id: COMPANY, admin_ids: [], stripe_customer_id: null, deleted_at: null },
    ]);
    expect((await POST(request(validBody))).status).toBe(403);
  });

  it("404s when the company row is already gone", async () => {
    stub.setRows("companies", []);
    expect((await POST(request(validBody))).status).toBe(404);
  });
});

describe("POST /api/data/delete-account — atomic cascade contract", () => {
  it("sends the complete ordered manifest and cycle breakers through one RPC", async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(200);

    const rpcOps = stub.ops.filter((op) => op.kind === "rpc");
    expect(rpcOps).toHaveLength(1);
    expect(rpcOps[0].fn).toBe(PURGE_FUNCTION);
    expect(rpcOps[0].args?.p_company_id).toBe(COMPANY);
    expect(rpcOps[0].args?.p_plan).toEqual({
      manifest_version: MANIFEST_VERSION,
      cycle_breakers: FK_CYCLE_BREAKERS,
      steps: deletionPlan().map((entry) => ({
        ...entry,
        definer_purged: isDefinerPurged(entry.table),
      })),
    });
  });

  it("does not issue direct mutations for any manifest table", async () => {
    await POST(request(validBody));
    const directManifestMutations = stub.ops.filter(
      (op) =>
        op.kind !== "select" &&
        op.kind !== "rpc" &&
        deletionPlan().some((entry) => entry.table === op.table)
    );
    expect(directManifestMutations).toEqual([]);
  });

  it("returns the exact counts committed by PostgreSQL", async () => {
    stub.setRpcResult(
      PURGE_FUNCTION,
      successfulPurgeResult({ project_tasks: 4, line_items: 9, expenses: 2 })
    );

    const body = await (await POST(request(validBody))).json();
    expect(body.success).toBe(true);
    expect(body.manifestVersion).toBe(MANIFEST_VERSION);
    expect(body.deletedCounts.project_tasks).toBe(4);
    expect(body.deletedCounts.line_items).toBe(9);
    expect(body.deletedCounts.expenses).toBe(2);
    expect(body.steps).toEqual({
      completed: deletionPlan().length,
      total: deletionPlan().length,
    });
  });

  it("reports zero completed steps when the transaction fails", async () => {
    stub.failOn(PURGE_FUNCTION, "rpc", {
      message:
        "purge_company_data: step 113/199 (soft-delete expenses) failed: permission denied for table expenses",
      code: "42501",
      details: "The transaction was rolled back.",
    });

    const res = await POST(request(validBody));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe(
      "Account deletion failed. No company data was deleted. Try again."
    );
    expect(body.failedStep).toMatchObject({
      index: 113,
      table: "expenses",
      operation: "soft-delete",
      code: "42501",
    });
    expect(body.steps).toEqual({ completed: 0, total: deletionPlan().length });
    expect(body.completedSteps).toEqual([]);
    expect(body.deletedCounts).toEqual({});
  });

  it("refuses a success payload that does not prove every step committed", async () => {
    stub.setRpcResult(PURGE_FUNCTION, {
      manifest_version: MANIFEST_VERSION,
      deleted_counts: {},
      completed_steps: deletionPlan().length - 1,
      total_steps: deletionPlan().length,
    });

    const res = await POST(request(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe(
      "Account deletion finished, but OPS could not verify the result. Contact support before trying again."
    );
    expect(body.databaseCommitted).toBe(true);
  });
});

describe("POST /api/data/delete-account — Stripe cancellation", () => {
  it("cancels active subscriptions and reports how many", async () => {
    seedCompany("cus_123");
    stripeListMock.mockResolvedValue({ data: [{ id: "sub_1" }, { id: "sub_2" }] });

    const body = await (await POST(request(validBody))).json();
    expect(stripeCancelMock).toHaveBeenCalledTimes(2);
    expect(body.stripe).toEqual({ cancelledSubscriptions: 2 });
    expect(body.warnings).toEqual([]);
  });

  it("returns the committed deletion with an explicit warning when Stripe fails", async () => {
    seedCompany("cus_123");
    stripeListMock.mockRejectedValue(new Error("Stripe is down"));

    const res = await POST(request(validBody));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0].step).toContain("stripe");
    expect(body.warnings[0].message).toContain("Stripe is down");
  });

  it("skips Stripe when the company has no customer id", async () => {
    await POST(request(validBody));
    expect(stripeListMock).not.toHaveBeenCalled();
  });
});

/**
 * POST /api/data/delete-account — the honest cascade (bug 241830b2).
 *
 * The old route soft-deleted eleven tables, two of which did not exist, and
 * swallowed every per-table error — so it answered `success: true` while
 * leaving virtually all modern data behind. These tests pin the two properties
 * that make that impossible now: the cascade is driven by the manifest, and a
 * failing step stops the run and is named in a 500.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PostgrestStub } from "../utils/postgrest-stub";
import {
  COMPANY_SCOPED_DATA,
  DEFINER_PURGED_TABLES,
  DEFINER_PURGE_FUNCTION,
  FK_CYCLE_BREAKERS,
  MANIFEST_VERSION,
  PARENT_SCOPED_DATA,
  deletionPlan,
  isDefinerPurged,
} from "@/lib/data/company-data-manifest";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

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

beforeEach(() => {
  stub = new PostgrestStub();
  seedCompany();
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

describe("POST /api/data/delete-account — authorization gates are unchanged", () => {
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

describe("POST /api/data/delete-account — the cascade covers the manifest", () => {
  it("walks every non-retained table and tombstones the company last", async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.manifestVersion).toBe(MANIFEST_VERSION);

    const planned = deletionPlan().map((e) => e.table);
    for (const table of planned) {
      expect(
        Object.prototype.hasOwnProperty.call(body.deletedCounts, table),
        `${table} missing from deletedCounts`
      ).toBe(true);
    }
    expect(body.steps.completed).toBe(body.steps.total);
  });

  it("includes the tables the frozen cascade forgot", async () => {
    const body = await (await POST(request(validBody))).json();
    for (const table of [
      "project_tasks",
      "line_items",
      "expenses",
      "project_photos",
      "project_notes",
      "site_visits",
      "sub_clients",
      "follow_ups",
      "activities",
      "calendar_user_events",
      "deck_designs",
    ]) {
      expect(body.deletedCounts, `${table}`).toHaveProperty(table);
    }
  });

  it("soft-deletes the company row itself, last", async () => {
    await POST(request(validBody));
    const update = stub
      .opsFor("companies")
      .find((op) => op.kind === "update");
    expect(update).toBeDefined();
    expect(update!.payload).toHaveProperty("deleted_at");
    expect(update!.seq).toBe(stub.ops[stub.ops.length - 1].seq);
    expect(stub.getRows("companies")[0].deleted_at).toBeTruthy();
  });

  it("never touches a retained table", async () => {
    await POST(request(validBody));
    for (const table of [
      "billing_events",
      "audit_log",
      "expense_categories",
      "expense_batches",
      "spec_projects",
      "spec_module_entitlements",
    ]) {
      expect(stub.opsFor(table), `${table} must be retained`).toEqual([]);
    }
  });

  it("reports real counts per table", async () => {
    stub.setRows("project_tasks", [
      { id: "t1", company_id: COMPANY, deleted_at: null },
      { id: "t2", company_id: COMPANY, deleted_at: null },
      { id: "t3", company_id: COMPANY, deleted_at: "2026-01-01T00:00:00.000Z" },
      { id: "t4", company_id: "other", deleted_at: null },
    ]);
    const body = await (await POST(request(validBody))).json();
    expect(body.deletedCounts.project_tasks).toBe(2);
  });
});

describe("POST /api/data/delete-account — soft vs hard, and the deleted_at trap", () => {
  it("hard-deletes tables that have no deleted_at column, with no deleted_at filter", async () => {
    await POST(request(validBody));
    for (const table of ["line_items", "payments", "follow_ups", "activities"]) {
      const ops = stub.opsFor(table);
      expect(ops.length, `${table} untouched`).toBeGreaterThan(0);
      expect(
        ops.some((op) => op.kind === "delete"),
        `${table} must be hard-deleted`
      ).toBe(true);
      expect(
        ops.some((op) => op.filters.some((f) => f.column === "deleted_at")),
        `${table} has no deleted_at column — it must never be filtered on it`
      ).toBe(false);
    }
  });

  it("soft-deletes tables that carry deleted_at and skips already-tombstoned rows", async () => {
    await POST(request(validBody));
    for (const table of ["projects", "clients", "project_tasks", "expenses"]) {
      const update = stub.opsFor(table).find((op) => op.kind === "update");
      expect(update, `${table} must be soft-deleted`).toBeDefined();
      expect(update!.payload).toHaveProperty("deleted_at");
      expect(
        update!.filters.some(
          (f) => f.op === "is" && f.column === "deleted_at" && f.value === null
        ),
        `${table} soft-delete must skip rows already tombstoned`
      ).toBe(true);
    }
  });

  it("scopes every company-scoped step by the tenant column", async () => {
    await POST(request(validBody));
    for (const entry of COMPANY_SCOPED_DATA) {
      if (entry.deleteStrategy === "retain") continue;

      // The definer detour carries the company as an argument rather than a
      // filter, but the tenant scoping is the same guarantee.
      if (isDefinerPurged(entry.table)) {
        const purge = stub
          .opsFor(entry.table)
          .find((op) => op.kind === "rpc");
        expect(purge, `${entry.table} not purged`).toBeDefined();
        expect(purge!.args?.p_company_id, `${entry.table}`).toBe(COMPANY);
        continue;
      }

      const mutation = stub
        .opsFor(entry.table)
        .find((op) => op.kind !== "select");
      expect(mutation, `${entry.table} not mutated`).toBeDefined();
      expect(
        mutation!.filters.some(
          (f) =>
            f.op === "eq" &&
            f.column === entry.companyColumn &&
            f.value === COMPANY
        ),
        `${entry.table} must filter on ${entry.companyColumn}`
      ).toBe(true);
    }
  });
});

describe("POST /api/data/delete-account — parent ids and chunking", () => {
  it("collects parent ids before the parent is deleted", async () => {
    stub.setRows("estimates", [
      { id: "e1", company_id: COMPANY, deleted_at: null },
    ]);
    await POST(request(validBody));

    const idSelect = stub
      .opsFor("estimates")
      .find((op) => op.kind === "select" && op.columns === "id");
    const parentMutation = stub
      .opsFor("estimates")
      .find((op) => op.kind !== "select");
    const childMutation = stub
      .opsFor("payment_milestones")
      .find((op) => op.kind !== "select");

    expect(idSelect).toBeDefined();
    expect(parentMutation).toBeDefined();
    expect(childMutation).toBeDefined();
    expect(idSelect!.seq).toBeLessThan(parentMutation!.seq);
    expect(childMutation!.seq).toBeLessThan(parentMutation!.seq);
  });

  it("collects parent ids without a deleted_at filter so orphans of prior deletions are swept", async () => {
    await POST(request(validBody));
    const idSelect = stub
      .opsFor("estimates")
      .find((op) => op.kind === "select" && op.columns === "id");
    expect(idSelect!.filters.some((f) => f.column === "deleted_at")).toBe(false);
  });

  it("chunks child deletes past the 500-id boundary and covers every id", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `estimate-${i}`);
    stub.setRows(
      "estimates",
      ids.map((id) => ({ id, company_id: COMPANY, deleted_at: null }))
    );
    stub.setRows(
      "payment_milestones",
      ids.map((id, i) => ({ id: `m-${i}`, estimate_id: id }))
    );

    const res = await POST(request(validBody));
    expect(res.status).toBe(200);

    const deletes = stub
      .opsFor("payment_milestones")
      .filter((op) => op.kind === "delete");
    expect(deletes.length).toBe(3);

    const covered: unknown[] = [];
    for (const op of deletes) {
      const filter = op.filters.find((f) => f.op === "in");
      expect(filter, "child delete must use an in() filter").toBeDefined();
      const values = filter!.value as unknown[];
      expect(values.length).toBeLessThanOrEqual(500);
      covered.push(...values);
    }
    expect(new Set(covered).size).toBe(1200);

    const body = await res.json();
    expect(body.deletedCounts.payment_milestones).toBe(1200);
  });

  it("skips a child table entirely when its parent has no rows", async () => {
    await POST(request(validBody));
    const ops = stub.opsFor("payment_milestones");
    expect(ops).toEqual([]);
  });

  it("resolves ids for children two levels deep", async () => {
    stub.setRows("catalog_items", [
      { id: "ci1", company_id: COMPANY, deleted_at: null },
    ]);
    stub.setRows("catalog_options", [
      { id: "co1", catalog_item_id: "ci1", deleted_at: null },
    ]);
    stub.setRows("catalog_option_values", [
      { id: "cov1", option_id: "co1", deleted_at: null },
    ]);

    const body = await (await POST(request(validBody))).json();
    expect(body.deletedCounts.catalog_option_values).toBe(1);
  });
});

describe("POST /api/data/delete-account — foreign-key cycle breakers", () => {
  it("nulls the cyclic references before either side of the cycle is deleted", async () => {
    stub.setRows("pending_auto_sends", [
      { id: "p1", company_id: COMPANY, send_intent_id: "s1" },
    ]);
    stub.setRows("email_send_intents", [{ id: "s1", company_id: COMPANY }]);

    await POST(request(validBody));

    const breaker = stub
      .opsFor("pending_auto_sends")
      .find((op) => op.kind === "update");
    expect(breaker).toBeDefined();
    expect(breaker!.payload).toEqual({ send_intent_id: null });
    // email_send_intents grants service_role SELECT and UPDATE but not DELETE,
    // so its purge is the definer call — the cycle must still break first.
    expect(breaker!.seq).toBeLessThan(
      stub.firstSeq("email_send_intents", "rpc")
    );
    expect(stub.firstSeq("email_send_intents", "rpc")).toBeLessThan(
      Number.POSITIVE_INFINITY
    );
    expect(breaker!.seq).toBeLessThan(
      stub.firstSeq("pending_auto_sends", "delete")
    );
  });

  it("nulls the assignment-suggestion cycle too", async () => {
    stub.setRows("opportunity_assignment_suggestions", [
      { id: "sg1", company_id: COMPANY, resolution_event_id: "ev1" },
    ]);
    await POST(request(validBody));

    const breaker = stub
      .opsFor("opportunity_assignment_suggestions")
      .find((op) => op.kind === "update");
    expect(breaker!.payload).toEqual({ resolution_event_id: null });
    expect(breaker!.seq).toBeLessThan(
      stub.firstSeq("opportunity_assignment_events", "rpc")
    );
    expect(
      stub.firstSeq("opportunity_assignment_events", "rpc")
    ).toBeLessThan(Number.POSITIVE_INFINITY);
  });
});

describe("POST /api/data/delete-account — failures are never swallowed", () => {
  it("stops at the first failing step and names it in a 500", async () => {
    stub.failOn("project_tasks", "update", {
      message: "permission denied for table project_tasks",
      code: "42501",
    });

    const res = await POST(request(validBody));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("project_tasks");
    expect(body.error).toContain("permission denied for table project_tasks");
    expect(body.failedStep.table).toBe("project_tasks");
    expect(body.failedStep.message).toBe(
      "permission denied for table project_tasks [42501]"
    );
    expect(body.failedStep.code).toBe("42501");
  });

  it("reports counts only for the steps that actually completed", async () => {
    stub.failOn("project_tasks", "update", { message: "boom" });
    const body = await (await POST(request(validBody))).json();

    expect(body.deletedCounts).not.toHaveProperty("project_tasks");
    expect(body.steps.completed).toBeLessThan(body.steps.total);
    expect(Object.keys(body.deletedCounts).length).toBe(body.steps.completed);
  });

  it("does not tombstone the company when a step failed", async () => {
    stub.failOn("project_tasks", "update", { message: "boom" });
    await POST(request(validBody));

    expect(
      stub.opsFor("companies").some((op) => op.kind === "update"),
      "company must not be tombstoned after a partial cascade"
    ).toBe(false);
    expect(stub.getRows("companies")[0].deleted_at).toBeNull();
  });

  it("propagates a failure raised while counting, not just while mutating", async () => {
    stub.failOn("line_items", "select", { message: "relation does not exist" });
    const res = await POST(request(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.failedStep.table).toBe("line_items");
  });

  it("propagates a failure raised while collecting parent ids", async () => {
    stub.failOn("estimates", "select", { message: "statement timeout" });
    const res = await POST(request(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("estimates");
    expect(body.error).toContain("statement timeout");
  });

  it("stops before running any later step", async () => {
    const plan = deletionPlan();
    const failIndex = plan.findIndex((e) => e.table === "project_tasks");
    expect(failIndex).toBeGreaterThan(-1);
    stub.failOn("project_tasks", "update", { message: "boom" });

    await POST(request(validBody));

    const laterTables = plan
      .slice(failIndex + 1)
      .map((e) => e.table)
      .filter((t) => t !== "companies");
    const mutatedLater = laterTables.filter((table) =>
      stub.opsFor(table).some((op) => op.kind !== "select")
    );
    expect(mutatedLater, "no step after the failure may run").toEqual([]);
  });
});

describe("POST /api/data/delete-account — tables service_role may not delete from", () => {
  // Twenty-nine manifest tables are granted to `postgres` alone. A live
  // rehearsal died at acting-step 23 of 198 on the first of them; the fourteen
  // that grant SELECT and withhold DELETE would have killed the next fourteen
  // attempts one at a time. They go through purge_company_rows instead.

  it("purges every unreachable table through the definer function, never directly", async () => {
    await POST(request(validBody));

    const cycleBreakers = new Set<string>(
      FK_CYCLE_BREAKERS.map((b) => b.table)
    );

    for (const { table } of DEFINER_PURGED_TABLES) {
      const ops = stub.opsFor(table);

      const purges = ops.filter((op) => op.kind === "rpc");
      expect(purges.length, `${table} must be purged exactly once`).toBe(1);
      expect(purges[0].fn).toBe(DEFINER_PURGE_FUNCTION);
      expect(purges[0].args).toEqual({
        p_table: table,
        p_company_id: COMPANY,
      });

      // The only direct call permitted on these tables is a cycle breaker's
      // UPDATE, which nulls a nullable column service_role may still write.
      const direct = ops.filter((op) => op.kind !== "rpc");
      expect(
        direct.map((op) => op.kind),
        `${table} was addressed directly, which service_role is not permitted to do`
      ).toEqual(cycleBreakers.has(table) ? ["update"] : []);
    }
  });

  it("collapses the count/mutate pair into one round trip", async () => {
    await POST(request(validBody));

    // Two calls per step for a directly-reachable table (count, then mutate),
    // one for these — which also closes the window between the two in which the
    // number could change. `clients` is not the parent of any parent-scoped
    // entry, so it carries no id-collection select to muddy the count.
    expect(stub.opsFor("clients").length).toBe(2);
    expect(stub.opsFor("task_mutation_events").length).toBe(1);
  });

  it("reports the row count the function returned, scoped to the company", async () => {
    stub.setRows("email_send_intents", [
      { id: "s1", company_id: COMPANY },
      { id: "s2", company_id: COMPANY },
      { id: "s3", company_id: "another-company" },
    ]);

    const body = await (await POST(request(validBody))).json();

    expect(body.deletedCounts.email_send_intents).toBe(2);
    expect(stub.getRows("email_send_intents")).toEqual([
      { id: "s3", company_id: "another-company" },
    ]);
  });

  it("counts every definer-purged table among the completed steps", async () => {
    const body = await (await POST(request(validBody))).json();
    expect(body.success).toBe(true);
    for (const { table } of DEFINER_PURGED_TABLES) {
      expect(body.deletedCounts, `${table}`).toHaveProperty(table);
    }
  });

  it("stops the cascade when the definer function refuses a table", async () => {
    stub.failOn("task_mutation_events", "rpc", {
      message: "purge_company_rows: task_mutation_events is not purgeable",
      code: "42501",
    });

    const res = await POST(request(validBody));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.failedStep.table).toBe("task_mutation_events");
    expect(body.failedStep.operation).toBe("purge");
    expect(body.failedStep.code).toBe("42501");
    expect(body.deletedCounts).not.toHaveProperty("task_mutation_events");
  });

  it("does not tombstone the company when a definer purge fails", async () => {
    stub.failOn("task_mutation_events", "rpc", { message: "boom" });
    await POST(request(validBody));
    expect(stub.getRows("companies")[0].deleted_at).toBeNull();
  });
});

describe("POST /api/data/delete-account — the database message is never blank", () => {
  // The rehearsal's 500 carried `"message": ""`, which is why diagnosis took
  // hours. A count is `head: true` — a HEAD request — and a HEAD response has
  // no body, so PostgREST's error payload never arrives and every field is
  // empty. `??` does not catch "", so the blank went straight through.

  it("surfaces a permission-shaped failure with its code, not an empty string", async () => {
    stub.failOn("email_outbound_edit_promotions", "rpc", {
      message: "permission denied for table email_outbound_edit_promotions",
      code: "42501",
    });

    const body = await (await POST(request(validBody))).json();

    expect(body.failedStep.message).not.toBe("");
    expect(body.failedStep.message).toContain("42501");
    expect(body.failedStep.message).toContain("permission denied");
    expect(body.error).toContain("42501");
  });

  it("explains an entirely empty driver payload instead of reporting nothing", async () => {
    // Exactly the shape the rehearsal hit: a HEAD count refused by the server.
    stub.failOn("project_tasks", "select", {
      message: "",
      code: "",
      details: "",
      hint: "",
    });

    const res = await POST(request(validBody));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.failedStep.message).not.toBe("");
    expect(body.failedStep.message).toContain("HEAD");
    expect(body.failedStep).not.toHaveProperty("code");
    expect(body.error).toContain("project_tasks");
  });

  it("keeps the code when it is the only thing the driver supplied", async () => {
    stub.failOn("project_tasks", "select", { message: "", code: "42501" });

    const body = await (await POST(request(validBody))).json();

    expect(body.failedStep.message).toContain("42501");
    expect(body.failedStep.code).toBe("42501");
  });

  it("carries details and hint through to the payload", async () => {
    stub.failOn("project_tasks", "update", {
      message: "update or delete violates foreign key constraint",
      code: "23503",
      details: 'Key (id)=(t1) is still referenced from table "task_materials".',
      hint: "Delete the referencing rows first.",
    });

    const body = await (await POST(request(validBody))).json();

    expect(body.failedStep.details).toContain("task_materials");
    expect(body.failedStep.hint).toBe("Delete the referencing rows first.");
    expect(body.failedStep.message).toContain("task_materials");
    expect(body.failedStep.message).toContain("Delete the referencing rows");
  });
});

describe("POST /api/data/delete-account — Stripe cancellation is surfaced, not swallowed", () => {
  it("cancels active subscriptions and reports how many", async () => {
    seedCompany("cus_123");
    stripeListMock.mockResolvedValue({ data: [{ id: "sub_1" }, { id: "sub_2" }] });

    const body = await (await POST(request(validBody))).json();
    expect(stripeCancelMock).toHaveBeenCalledTimes(2);
    expect(body.stripe).toEqual({ cancelledSubscriptions: 2 });
    expect(body.warnings).toEqual([]);
  });

  it("returns the deletion result with an explicit warning when Stripe fails", async () => {
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

  it("skips Stripe entirely when the company has no customer id", async () => {
    await POST(request(validBody));
    expect(stripeListMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/data/delete-account — plan shape", () => {
  it("plans one step per non-retained manifest entry", () => {
    const plan = deletionPlan();
    const expected =
      PARENT_SCOPED_DATA.filter((e) => e.deleteStrategy !== "retain").length +
      COMPANY_SCOPED_DATA.filter((e) => e.deleteStrategy !== "retain").length;
    expect(plan.length).toBe(expected);
    expect(plan.some((e) => e.deleteStrategy === "retain")).toBe(false);
  });

  it("runs every parent-scoped step before any company-scoped step", () => {
    const plan = deletionPlan();
    const lastParent = plan.map((e) => e.scope).lastIndexOf("parent");
    const firstCompany = plan.map((e) => e.scope).indexOf("company");
    expect(lastParent).toBeLessThan(firstCompany);
  });
});

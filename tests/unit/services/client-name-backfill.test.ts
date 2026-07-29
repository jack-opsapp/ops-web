import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  planClientNameBackfill,
  type ClientNameBackfillInput,
} from "@/lib/clients/name-backfill";

const routeSource = readFileSync(
  path.join(process.cwd(), "src/app/api/clients/name-backfill/route.ts"),
  "utf8"
);

const brokenClient = {
  id: "client-1",
  name: "canprojack",
  email: "canprojack@gmail.com",
};

function plan(overrides: Partial<ClientNameBackfillInput> = {}) {
  return planClientNameBackfill({
    clients: [brokenClient],
    candidates: [
      { clientId: "client-1", name: "Cecilia Reyes", origin: "thread" },
    ],
    provenance: [],
    ...overrides,
  });
}

describe("planClientNameBackfill", () => {
  it("renames a handle-named client from stored evidence", () => {
    expect(plan()).toEqual({
      checked: 1,
      eligible: 1,
      renames: [
        {
          clientId: "client-1",
          from: "canprojack",
          to: "Cecilia Reyes",
          origin: "thread",
        },
      ],
      refused: [],
    });
  });

  it("leaves a real name alone", () => {
    const result = plan({
      clients: [{ ...brokenClient, name: "Bob's Roofing" }],
    });
    expect(result.eligible).toBe(0);
    expect(result.renames).toEqual([]);
    expect(result.refused).toEqual([]);
  });

  it("refuses a client whose name an operator set", () => {
    const result = plan({
      provenance: [
        { clientId: "client-1", source: "operator", confirmedAt: null },
      ],
    });
    expect(result.renames).toEqual([]);
    expect(result.refused).toEqual([
      { clientId: "client-1", reason: "operator_owned" },
    ]);
  });

  it("refuses a client whose name an operator confirmed", () => {
    const result = plan({
      provenance: [{ clientId: "client-1", source: "ai", confirmedAt: "2026-07-01" }],
    });
    expect(result.refused).toEqual([
      { clientId: "client-1", reason: "operator_owned" },
    ]);
  });

  it("renames over machine-sourced provenance", () => {
    const result = plan({
      provenance: [
        { clientId: "client-1", source: "inbound", confirmedAt: null },
      ],
    });
    expect(result.renames).toHaveLength(1);
  });

  it("refuses when no usable replacement exists", () => {
    expect(plan({ candidates: [] }).refused).toEqual([
      { clientId: "client-1", reason: "no_candidate" },
    ]);
  });

  it("never adopts a candidate that is itself a placeholder", () => {
    const result = plan({
      candidates: [
        { clientId: "client-1", name: "canprojack", origin: "thread" },
        { clientId: "client-1", name: "canprojack@gmail.com", origin: "thread" },
        { clientId: "client-1", name: "Sales Team", origin: "opportunity" },
      ],
    });
    expect(result.refused).toEqual([
      { clientId: "client-1", reason: "no_candidate" },
    ]);
  });

  it("prefers opportunity evidence over sub-client and thread evidence", () => {
    const result = plan({
      candidates: [
        { clientId: "client-1", name: "Thread Name", origin: "thread" },
        { clientId: "client-1", name: "Sub Name", origin: "sub_client" },
        { clientId: "client-1", name: "Opportunity Name", origin: "opportunity" },
      ],
    });
    expect(result.renames[0]).toMatchObject({
      to: "Opportunity Name",
      origin: "opportunity",
    });
  });

  it("is idempotent — a candidate equal to the stored name is not a rename", () => {
    const result = plan({
      clients: [{ ...brokenClient, name: "Office" }],
      candidates: [
        { clientId: "client-1", name: "office", origin: "thread" },
      ],
    });
    expect(result.renames).toEqual([]);
    expect(result.refused).toEqual([
      { clientId: "client-1", reason: "no_candidate" },
    ]);
  });

  it("counts every client it looked at", () => {
    const result = plan({
      clients: [
        brokenClient,
        { id: "client-2", name: "Cecilia Reyes", email: "creyes@gmail.com" },
      ],
    });
    expect(result.checked).toBe(2);
    expect(result.eligible).toBe(1);
  });
});

describe("client name-backfill route", () => {
  it("is dry-run unless explicitly told to execute", () => {
    expect(routeSource).toMatch(/searchParams\.get\("execute"\)/);
    expect(routeSource).toContain('=== "true"');
    expect(routeSource).toMatch(/if\s*\(!execute\)|execute\s*\?/);
  });

  it("gates on the categorize permission and never on a role", () => {
    expect(routeSource).toContain('"inbox.categorize"');
    expect(routeSource).not.toMatch(/\.eq\("role"|user\.role ===/);
  });

  it("bounds each invocation the same way the inbox backfill does", () => {
    expect(routeSource).toContain("2000");
    expect(routeSource).toContain("500");
  });

  it("scopes every read and write to the caller's company", () => {
    expect(routeSource).toMatch(/\.eq\("company_id",\s*companyId\)/);
  });

  it("records provenance for every rename it performs", () => {
    expect(routeSource).toContain("writeFieldProvenance({");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const selects: Record<string, string[]> = {};

function builder(table: string) {
  const rows = tables[table] ?? [];
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = (cols: string) => {
    (selects[table] ??= []).push(cols);
    return chain;
  };
  chain.eq = self;
  chain.order = self;
  chain.limit = self;
  chain.in = self;
  chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return chain;
}

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({ from: (table: string) => builder(table) }),
}));

import { getMilestoneFireability } from "../spec-queries";

const project = (tier: string, locked: number | null): Row => ({
  id: "5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4",
  tier,
  original_tier: null,
  status: "building",
  is_test: false,
  buyer_user_id: "u-buyer",
  account_holder_user_id: null,
  linked_company_id: "c-1",
  customer_email: "ray@cascadedeck.ca",
  customer_name: "Ray Cascade",
  walkthrough_completed_at: null,
  locked_total_cents: locked,
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(selects)) delete selects[k];
});

describe("getMilestoneFireability (live wiring)", () => {
  it("reads the locked total off the engagement row", async () => {
    tables.spec_projects = [project("spec03", 3_100_000)];
    tables.spec_payments = [];
    tables.spec_acceptance_events = [{ id: "a1", event_type: "scope_signoff" }];

    const r = await getMilestoneFireability("5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4", "scope_signoff");

    expect(selects.spec_projects?.[0]).toContain("locked_total_cents");
    expect(r.fireable).toBe(true);
    expect(r.amountCents).toBe(825_000);
  });

  it("fails closed for a checkpoint the tier never invoices", async () => {
    tables.spec_projects = [project("spec01", null)];
    tables.spec_payments = [];
    tables.spec_acceptance_events = [{ id: "a1", event_type: "scope_signoff" }];

    const r = await getMilestoneFireability("5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4", "scope_signoff");

    expect(r.fireable).toBe(false);
    expect(r.reason).toBe("No payment at this checkpoint for SPEC-01");
    expect(r.amountCents).toBeNull();
  });

  it("fails closed for an unlocked SPEC-03 checkpoint", async () => {
    tables.spec_projects = [project("spec03", null)];
    tables.spec_payments = [];
    tables.spec_acceptance_events = [{ id: "a1", event_type: "scope_signoff" }];

    const r = await getMilestoneFireability("5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4", "scope_signoff");

    expect(r.fireable).toBe(false);
    expect(r.reason).toBe("Total not locked — lock it on the scope doc");
  });
});

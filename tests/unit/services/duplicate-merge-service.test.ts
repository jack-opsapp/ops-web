import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase helper so requireSupabase() returns our controllable fake.
const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

import { DuplicateDetectionService } from "@/lib/api/services/duplicate-detection-service";

const { _detectFieldConflicts, _computeReconciliation, _isBlank } =
  DuplicateDetectionService;

// ─── Conflict detection (Q2) ─────────────────────────────────────────────────

describe("field conflict detection (Q2)", () => {
  it("treats null / empty / whitespace as blank", () => {
    expect(_isBlank(null)).toBe(true);
    expect(_isBlank(undefined)).toBe(true);
    expect(_isBlank("")).toBe(true);
    expect(_isBlank("   ")).toBe(true);
    expect(_isBlank("x")).toBe(false);
    expect(_isBlank(0)).toBe(false);
  });

  it("does NOT flag a conflict when the winner field is blank (that is fill-blank)", () => {
    const conflicts = _detectFieldConflicts(
      { contact_email: "" },
      { contact_email: "loser@x.com" },
      ["contact_email"]
    );
    expect(conflicts).toHaveLength(0);
  });

  it("does NOT flag a conflict when both sides match", () => {
    const conflicts = _detectFieldConflicts(
      { address: "12 Main St" },
      { address: "12 Main St " },
      ["address"]
    );
    expect(conflicts).toHaveLength(0);
  });

  it("flags a conflict when both sides are non-blank and differ", () => {
    const conflicts = _detectFieldConflicts(
      { contact_email: "win@x.com", address: "A" },
      { contact_email: "lose@x.com", address: "A" },
      ["contact_email", "address"]
    );
    expect(conflicts).toEqual([
      { field: "contact_email", winnerValue: "win@x.com", loserValue: "lose@x.com" },
    ]);
  });

  it("computeReconciliation splits fill-blank (auto) from conflicts (operator-gated)", () => {
    const rec = _computeReconciliation(
      { contact_name: "", contact_email: "win@x.com" },
      { contact_name: "Jane", contact_email: "lose@x.com" },
      "opportunity"
    );
    // winner blank → fill-blank
    expect(rec.fieldFill).toEqual({ contact_name: "Jane" });
    // both non-blank + differ → conflict, never auto-applied
    expect(rec.conflicts).toEqual([
      { field: "contact_email", winnerValue: "win@x.com", loserValue: "lose@x.com" },
    ]);
  });
});

// ─── Chainable supabase fake ─────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakeOpts {
  /** rows returned by `.from(table).select()...single()` keyed by id */
  tables?: Record<string, Row[]>;
  /** rpc implementation; defaults to returning { applied: true } */
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
}

function makeFakeSupabase(opts: FakeOpts) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Row }> = [];

  function from(table: string) {
    const rows = opts.tables?.[table] ?? [];
    let filtered = [...rows];
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    Object.assign(builder, {
      select: self,
      eq: (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] === val);
        return builder;
      },
      neq: () => builder,
      in: (col: string, vals: unknown[]) => {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return builder;
      },
      or: () => builder,
      order: () => builder,
      is: () => builder,
      update: (payload: Row) => {
        updates.push({ table, payload });
        return builder;
      },
      delete: () => builder,
      single: async () => ({ data: filtered[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: filtered, error: null }).then(resolve),
    });
    return builder;
  }

  const client = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (opts.rpc) return opts.rpc(name, args);
      return { data: { applied: true, merge_id: "m1" }, error: null };
    },
  };

  return { client, rpcCalls, updates };
}

const COMPANY = "11111111-1111-1111-1111-111111111111";
const WINNER = "22222222-2222-2222-2222-222222222222";
const LOSER = "33333333-3333-3333-3333-333333333333";
const REVIEW = "44444444-4444-4444-4444-444444444444";
const OPERATOR = "55555555-5555-5555-5555-555555555555";

describe("mergeEntities → guarded RPC wrapper (opportunity)", () => {
  beforeEach(() => {
    requireSupabaseMock.mockReset();
  });

  it("calls execute_opportunity_merge_guarded with merge_key, snapshot stages, and fill-blank (no overrides)", async () => {
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          {
            id: REVIEW,
            company_id: COMPANY,
            entity_type: "opportunity",
            entity_a_id: WINNER,
            entity_b_id: LOSER,
          },
        ],
        opportunities: [
          { id: WINNER, stage: "quoting", contact_name: "", contact_email: "win@x.com" },
          { id: LOSER, stage: "follow_up", contact_name: "Jane", contact_email: "lose@x.com" },
        ],
        notifications: [],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await DuplicateDetectionService.mergeEntities(REVIEW, WINNER, OPERATOR);

    const call = fake.rpcCalls.find((c) => c.name === "execute_opportunity_merge_guarded");
    expect(call).toBeTruthy();
    expect(call!.args.p_company_id).toBe(COMPANY);
    expect(call!.args.p_winner_id).toBe(WINNER);
    expect(call!.args.p_loser_id).toBe(LOSER);
    expect(call!.args.p_merge_key).toBe(`${REVIEW}:${LOSER}`);
    expect(call!.args.p_expected_winner_stage).toBe("quoting");
    expect(call!.args.p_expected_loser_stage).toBe("follow_up");
    // fill-blank computed from blank winner field
    expect(call!.args.p_field_fill).toEqual({ contact_name: "Jane" });
    // no operator override ⇒ empty (never silently overwrites win@x.com)
    expect(call!.args.p_confirmed_overrides).toEqual({});
  });

  it("passes operator-confirmed overrides straight through to p_confirmed_overrides", async () => {
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          { id: REVIEW, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: LOSER },
        ],
        opportunities: [
          { id: WINNER, stage: "quoting", contact_email: "win@x.com" },
          { id: LOSER, stage: "quoting", contact_email: "lose@x.com" },
        ],
        notifications: [],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await DuplicateDetectionService.mergeEntities(REVIEW, WINNER, OPERATOR, {
      contact_email: "lose@x.com",
    });

    const call = fake.rpcCalls.find((c) => c.name === "execute_opportunity_merge_guarded");
    expect(call!.args.p_confirmed_overrides).toEqual({ contact_email: "lose@x.com" });
  });

  it("surfaces the idempotency no-op result returned by the RPC (same merge_key)", async () => {
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          { id: REVIEW, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: LOSER },
        ],
        opportunities: [
          { id: WINNER, stage: "quoting" },
          { id: LOSER, stage: "quoting" },
        ],
        notifications: [],
      },
      rpc: () => ({
        data: { applied: false, guard_reason: "duplicate_applied_merge", merge_id: "existing" },
        error: null,
      }),
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await DuplicateDetectionService.mergeEntities(REVIEW, WINNER, OPERATOR);
    expect(result).toMatchObject({ applied: false, guard_reason: "duplicate_applied_merge" });
  });

  it("propagates a hard RPC error (no swallow)", async () => {
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          { id: REVIEW, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: LOSER },
        ],
        opportunities: [
          { id: WINNER, stage: "quoting" },
          { id: LOSER, stage: "quoting" },
        ],
        notifications: [],
      },
      rpc: () => ({ data: null, error: { message: "constraint violation mid-merge" } }),
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      DuplicateDetectionService.mergeEntities(REVIEW, WINNER, OPERATOR)
    ).rejects.toThrow(/constraint violation mid-merge/);
  });
});

describe("mergeCluster → one guarded RPC call per loser (each its own merge_key + transaction)", () => {
  beforeEach(() => requireSupabaseMock.mockReset());

  const L2 = "66666666-6666-6666-6666-666666666666";
  const R2 = "77777777-7777-7777-7777-777777777777";

  it("issues a separate RPC call (distinct loser, shared merge_key prefix) for each loser", async () => {
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          { id: REVIEW, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: LOSER },
          { id: R2, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: L2 },
        ],
        opportunities: [
          { id: WINNER, stage: "quoting" },
          { id: LOSER, stage: "quoting" },
          { id: L2, stage: "follow_up" },
        ],
        notifications: [],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await DuplicateDetectionService.mergeCluster([REVIEW, R2], WINNER, OPERATOR);

    const mergeCalls = fake.rpcCalls.filter((c) => c.name === "execute_opportunity_merge_guarded");
    expect(mergeCalls).toHaveLength(2);
    const losers = mergeCalls.map((c) => c.args.p_loser_id).sort();
    expect(losers).toEqual([LOSER, L2].sort());
    // every loser uses its own merge_key (prefix is the lead review id)
    for (const c of mergeCalls) {
      expect(c.args.p_merge_key).toBe(`${REVIEW}:${c.args.p_loser_id}`);
    }
  });

  it("a failure on loser N propagates — losers merged before it stay merged (each was atomic)", async () => {
    let calls = 0;
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          { id: REVIEW, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: LOSER },
          { id: R2, company_id: COMPANY, entity_type: "opportunity", entity_a_id: WINNER, entity_b_id: L2 },
        ],
        opportunities: [
          { id: WINNER, stage: "quoting" },
          { id: LOSER, stage: "quoting" },
          { id: L2, stage: "quoting" },
        ],
        notifications: [],
      },
      rpc: () => {
        calls += 1;
        if (calls === 2) return { data: null, error: { message: "second loser failed" } };
        return { data: { applied: true }, error: null };
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      DuplicateDetectionService.mergeCluster([REVIEW, R2], WINNER, OPERATOR)
    ).rejects.toThrow(/second loser failed/);
    // first loser's RPC was issued and succeeded before the failure surfaced
    expect(calls).toBe(2);
  });
});

describe("legacy project/task merge path (out of P5 scope) does NOT call a merge RPC", () => {
  beforeEach(() => requireSupabaseMock.mockReset());

  it("project merge uses the in-process re-point path, not execute_*_merge_guarded", async () => {
    const fake = makeFakeSupabase({
      tables: {
        duplicate_reviews: [
          { id: REVIEW, company_id: COMPANY, entity_type: "project", entity_a_id: WINNER, entity_b_id: LOSER },
        ],
        projects: [
          { id: WINNER },
          { id: LOSER },
        ],
        notifications: [],
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await DuplicateDetectionService.mergeEntities(REVIEW, WINNER, OPERATOR);
    expect(fake.rpcCalls.filter((c) => c.name.includes("merge_guarded"))).toHaveLength(0);
  });
});

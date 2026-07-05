import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findConflictingActiveProvider,
  providerLabel,
} from "@/lib/api/services/accounting-connection-guard";

/**
 * Mock the Supabase query builder chain used by the guard:
 *   from(...).select(...).eq(...).eq(...).neq(...).limit(1) → { data, error }
 * Records the .neq argument so the "different provider only" filter is asserted.
 */
function mockSupabase(result: { data: unknown; error: unknown }) {
  const calls: { neq?: [string, unknown] } = {};
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: (col: string, val: unknown) => {
      calls.neq = [col, val];
      return builder;
    },
    limit: () => Promise.resolve(result),
  };
  const supabase = { from: () => builder } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe("findConflictingActiveProvider", () => {
  it("returns null when no other provider is connected", async () => {
    const { supabase } = mockSupabase({ data: [], error: null });
    const conflict = await findConflictingActiveProvider(supabase, "co-1", "quickbooks");
    expect(conflict).toBeNull();
  });

  it("returns the conflicting provider when a different one is connected", async () => {
    const { supabase, calls } = mockSupabase({
      data: [{ provider: "sage" }],
      error: null,
    });
    const conflict = await findConflictingActiveProvider(supabase, "co-1", "quickbooks");
    expect(conflict).toBe("sage");
    // The filter must exclude the SAME provider (reconnect / sandbox+prod are OK).
    expect(calls.neq).toEqual(["provider", "quickbooks"]);
  });

  it("fails open (null) on a transient read error so the callback can re-check", async () => {
    const { supabase } = mockSupabase({ data: null, error: { message: "boom" } });
    const conflict = await findConflictingActiveProvider(supabase, "co-1", "sage");
    expect(conflict).toBeNull();
  });
});

describe("providerLabel", () => {
  it("maps provider strings to operator-facing labels", () => {
    expect(providerLabel("quickbooks")).toBe("QuickBooks");
    expect(providerLabel("sage")).toBe("Sage");
    expect(providerLabel("xero")).toBe("xero");
  });
});

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Hits the live SUPABASE service-role connection. Skipped unless
 * RUN_DB_INTEGRATION=1 + SUPABASE_SERVICE_ROLE_KEY are set.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !key || process.env.RUN_DB_INTEGRATION !== "1";

(skip ? describe.skip : describe)("email_audience_filter RPC", () => {
  const db = createClient(url!, key!);

  it("empty filter = active emailable users", async () => {
    const { data, error } = await db.rpc("email_audience_count", {
      p_filter: { and: [] },
    });
    expect(error).toBeNull();
    expect(typeof data).toBe("number");
    expect(data).toBeGreaterThan(0);
  });

  it("trialing subscription_status is a non-empty subset", async () => {
    const { data: trialing } = await db.rpc("email_audience_count", {
      p_filter: {
        and: [{ field: "subscription_status", op: "eq", value: "trialing" }],
      },
    });
    const { data: total } = await db.rpc("email_audience_count", {
      p_filter: { and: [] },
    });
    expect(trialing).toBeLessThanOrEqual(total!);
  });

  it("rejects non-allowlisted field", async () => {
    const { error } = await db.rpc("email_audience_filter", {
      p_filter: { field: "password", op: "eq", value: "x" },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/allowlist|not in/i);
  });

  it("nested OR/AND resolves", async () => {
    const filter = {
      or: [
        { field: "plan", op: "eq", value: "team" },
        {
          and: [
            { field: "plan", op: "eq", value: "business" },
            { field: "is_company_admin", op: "eq", value: true },
          ],
        },
      ],
    };
    const { data, error } = await db.rpc("email_audience_count", {
      p_filter: filter,
    });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(0);
  });

  it("in op with array value", async () => {
    const { error } = await db.rpc("email_audience_count", {
      p_filter: {
        field: "plan",
        op: "in",
        value: ["team", "business"],
      },
    });
    expect(error).toBeNull();
  });
});

import { describe, it, expect } from "vitest";

/**
 * Validates the JSONB filter shape that lands in our types — the same shape
 * the UI produces and that the email_audience_filter() RPC parses. Real RPC
 * tests live in tests/integration/email-audience-rpc.test.ts (gated by env).
 */
type Node = Record<string, unknown>;

function isNode(n: Node): boolean {
  if ("group" in n) return isNode(n.group as Node);
  if ("field" in n) return typeof n.field === "string" && typeof n.op === "string";
  if ("and" in n || "or" in n) {
    const arr = (n.and ?? n.or) as unknown;
    return Array.isArray(arr) && arr.every((x) => isNode(x as Node));
  }
  return false;
}

describe("audience filter shape", () => {
  it("accepts simple AND of two leaves", () => {
    expect(
      isNode({
        and: [
          { field: "plan", op: "eq", value: "team" },
          { field: "is_company_admin", op: "eq", value: true },
        ],
      })
    ).toBe(true);
  });

  it("accepts nested OR-of-AND", () => {
    expect(
      isNode({
        or: [
          { and: [{ field: "plan", op: "eq", value: "team" }] },
          { field: "subscription_status", op: "eq", value: "trialing" },
        ],
      })
    ).toBe(true);
  });

  it("accepts a wrapped group", () => {
    expect(
      isNode({
        group: {
          and: [{ field: "role", op: "eq", value: "admin" }],
        },
      })
    ).toBe(true);
  });

  it("rejects malformed leaf", () => {
    expect(isNode({ field: "x" } as Node)).toBe(false);
  });

  it("rejects non-array combinator", () => {
    expect(isNode({ and: { field: "x", op: "eq" } } as Node)).toBe(false);
  });
});

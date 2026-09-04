import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL_KEY = process.env.QB_TOKEN_ENC_KEY;
const QUEUE_ID = "11111111-2222-4333-8444-555555555555";

describe("Sage idempotency ids", () => {
  beforeEach(() => {
    process.env.QB_TOKEN_ENC_KEY =
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.QB_TOKEN_ENC_KEY;
    else process.env.QB_TOKEN_ENC_KEY = ORIGINAL_KEY;
  });

  it("derives the documented 32-character deterministic identifier", async () => {
    const { sageIdempotencyId } = await import("../sage-idempotency");

    expect(sageIdempotencyId(QUEUE_ID, "sales_invoices")).toBe(
      "c9621db1921b5e8056c0edbbd25c18d7"
    );
    expect(sageIdempotencyId(QUEUE_ID, "sales_invoices")).toMatch(
      /^[0-9a-f]{32}$/
    );
  });

  it("cannot collide across provider resources or queue jobs", async () => {
    const { sageIdempotencyId } = await import("../sage-idempotency");

    expect(sageIdempotencyId(QUEUE_ID, "sales_quotes")).not.toBe(
      sageIdempotencyId(QUEUE_ID, "sales_invoices")
    );
    expect(
      sageIdempotencyId(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        "sales_invoices"
      )
    ).not.toBe(sageIdempotencyId(QUEUE_ID, "sales_invoices"));
  });

  it("rejects malformed queue identities", async () => {
    const { sageIdempotencyId } = await import("../sage-idempotency");

    expect(() => sageIdempotencyId("queue-1", "contacts")).toThrow(/queue id/i);
  });

  it("rejects unsupported resource namespaces", async () => {
    const { sageIdempotencyId } = await import("../sage-idempotency");

    expect(() =>
      sageIdempotencyId(QUEUE_ID, "bank_transfers" as never)
    ).toThrow(/resource/i);
  });

  it("fails closed when the accounting encryption key is unavailable", async () => {
    delete process.env.QB_TOKEN_ENC_KEY;
    const { sageIdempotencyId } = await import("../sage-idempotency");

    expect(() => sageIdempotencyId(QUEUE_ID, "contacts")).toThrow(
      /QB_TOKEN_ENC_KEY/
    );
  });
});

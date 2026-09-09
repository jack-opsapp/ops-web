/**
 * `fetchInvoice` / `fetchEstimate` — the fetch error carries its HTTP status.
 *
 * Books opens a document from a link (`/books?invoice=<id>`). When the id is
 * not visible, PostgREST answers `.single()` with `PGRST116` at status 406.
 * If the service rethrows that as a bare `Error`, the global retry policy in
 * `query-client.ts` cannot see a status, so it retries twice with 1s + 2s
 * backoff — three requests and ~3 seconds of dead air before the operator is
 * told the invoice is not there. Attaching `status` (and `code`) is what lets
 * the policy decline a 4xx immediately, and what lets the open-by-link door
 * tell "not found" apart from "the network failed".
 */

import { describe, expect, it, vi } from "vitest";

const { requireSupabaseMock } = vi.hoisted(() => ({
  requireSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/helpers")>()),
  requireSupabase: requireSupabaseMock,
}));

import { InvoiceService } from "@/lib/api/services/invoice-service";
import { EstimateService } from "@/lib/api/services/estimate-service";

interface PostgrestLike {
  data: unknown;
  error: { code: string; message: string } | null;
  status: number;
}

/**
 * A supabase double whose builder is one thenable object per table: every
 * chained method (`select`/`eq`/`is`/`order`/`single`) returns the same object,
 * and awaiting it yields that table's canned PostgREST response — the shape
 * `fetchInvoice` / `fetchEstimate` destructure.
 */
function supabaseDouble(tables: Record<string, PostgrestLike>) {
  return {
    from(table: string) {
      const response = tables[table];
      if (!response) throw new Error(`unexpected table: ${table}`);
      const builder: Record<string, unknown> = {
        then: (resolve: (value: PostgrestLike) => unknown) =>
          Promise.resolve(response).then(resolve),
      };
      for (const method of ["select", "eq", "is", "order", "single"]) {
        builder[method] = () => builder;
      }
      return builder;
    },
  };
}

const OK: PostgrestLike = { data: [], error: null, status: 200 };
const NOT_VISIBLE: PostgrestLike = {
  data: null,
  error: {
    code: "PGRST116",
    message: "JSON object requested, multiple (or no) rows returned",
  },
  status: 406,
};

/** Resolve to the rejection so the assertions can inspect the thrown value. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the fetch to reject, but it resolved");
    },
    (error: unknown) => error,
  );
}

describe("document fetch errors carry their PostgREST status", () => {
  it("fetchInvoice rethrows PGRST116 with status and code attached", async () => {
    requireSupabaseMock.mockReturnValue(
      supabaseDouble({
        invoices: NOT_VISIBLE,
        line_items: OK,
        payments: OK,
      }),
    );

    const error = await rejection(InvoiceService.fetchInvoice("i1"));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Failed to fetch invoice");
    expect(error).toMatchObject({ status: 406, code: "PGRST116" });
    // The retry policy's own test: it only declines a 4xx it can see.
    expect("status" in (error as object)).toBe(true);
  });

  it("fetchEstimate rethrows PGRST116 with status and code attached", async () => {
    requireSupabaseMock.mockReturnValue(
      supabaseDouble({
        estimates: NOT_VISIBLE,
        line_items: OK,
      }),
    );

    const error = await rejection(EstimateService.fetchEstimate("e9"));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Failed to fetch estimate");
    expect(error).toMatchObject({ status: 406, code: "PGRST116" });
    expect("status" in (error as object)).toBe(true);
  });
});

/**
 * P4-E — applyCorrectionToSimilar fan-out cap.
 *
 * A single recategorization correction could previously trigger up to
 * SIMILAR_CAP (50) reclassifications, each an LLM classify + Phase C router
 * fire. P4-E hard-caps the actual fan-out at MAX_RECLASSIFY_PER_CORRECTION
 * (10). This test seeds many exact-sender matches and asserts no more than 10
 * classifyAndUpdate calls happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { classifyMock, hashMock } = vi.hoisted(() => ({
  classifyMock: vi.fn(async () => ({})),
  hashMock: vi.fn(() => "hash-xyz"),
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { classifyAndUpdate: classifyMock },
  hashParticipants: hashMock,
}));

vi.mock("@/lib/types/email-thread", async () => {
  const actual = await vi.importActual<typeof import("@/lib/types/email-thread")>(
    "@/lib/types/email-thread"
  );
  return {
    ...actual,
    mapCategoryCorrectionFromDb: (row: Record<string, unknown>) => ({
      id: row.id,
      companyId: "co-1",
      threadId: "src-thread",
      toCategory: "VENDOR",
      senderEmail: "bulk@vendor.com",
      senderDomain: "vendor.com",
      participantsHash: null,
      userId: "u-1",
    }),
    mapEmailThreadFromDb: (row: Record<string, unknown>) => ({
      id: row.id,
      participants: [],
    }),
  };
});

// Supabase double: correction lookup + 25 exact-sender candidate rows.
let candidateRows: Array<{ id: string }>;
vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/helpers")>(
    "@/lib/supabase/helpers"
  );
  function builder(table: string) {
    let op: "select" | "update" = "select";
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    chain.select = ret;
    chain.eq = ret;
    chain.lt = ret;
    chain.ilike = ret;
    chain.update = () => { op = "update"; return chain; };
    chain.single = async () => {
      if (table === "email_thread_category_corrections") {
        return { data: { id: "corr-1" }, error: null };
      }
      return { data: null, error: null };
    };
    chain.limit = async () => {
      if (table === "email_threads") return { data: candidateRows, error: null };
      return { data: [], error: null };
    };
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
      void op;
      resolve({ data: null, error: null });
    };
    return chain;
  }
  return { ...actual, requireSupabase: () => ({ from: (t: string) => builder(t) }) };
});

import { PhaseCLearningService } from "@/lib/api/services/phase-c-learning-service";

beforeEach(() => {
  classifyMock.mockClear();
  candidateRows = Array.from({ length: 25 }, (_, i) => ({ id: `thr-${i}` }));
});

afterEach(() => vi.clearAllMocks());

describe("P4-E — fan-out cap", () => {
  it("caps reclassifications at 10 even with 25 candidates", async () => {
    const result = await PhaseCLearningService.applyCorrectionToSimilar("corr-1");
    expect(classifyMock.mock.calls.length).toBeLessThanOrEqual(10);
    expect(result.reclassified).toBeLessThanOrEqual(10);
  }, 20000);
});

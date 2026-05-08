/**
 * useProjectPipeline — workspace ACCOUNTING tab 4-cell aggregate.
 *
 * Calls the project_pipeline_summary(uuid) RPC and reshapes the row into
 * a typed pipeline summary the UI consumes directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface RpcRow {
  quoted_total: string | number;
  quoted_record_id: string | null;
  invoiced_total: string | number;
  invoiced_record_id: string | null;
  change_orders_count: number;
  received_total: string | number;
  received_record_id: string | null;
  deposit_pct: number | null;
  outstanding_total: string | number;
  outstanding_due_date: string | null;
  days_aged: number | null;
}

let rpcResult: { data: RpcRow[] | null; error: unknown };
let lastRpcArgs: { fn: string; params: unknown } | null = null;

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    rpc: (fn: string, params: unknown) => {
      lastRpcArgs = { fn, params };
      return Promise.resolve(rpcResult);
    },
  }),
}));

import { useProjectPipeline } from "@/lib/hooks/use-project-pipeline";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  rpcResult = { data: null, error: null };
  lastRpcArgs = null;
});

describe("useProjectPipeline", () => {
  it("calls project_pipeline_summary with the project id", async () => {
    rpcResult = {
      data: [
        {
          quoted_total: "0",
          quoted_record_id: null,
          invoiced_total: "0",
          invoiced_record_id: null,
          change_orders_count: 0,
          received_total: "0",
          received_record_id: null,
          deposit_pct: null,
          outstanding_total: "0",
          outstanding_due_date: null,
          days_aged: null,
        },
      ],
      error: null,
    };

    const { result } = renderHook(() => useProjectPipeline("proj-xyz"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastRpcArgs).toEqual({
      fn: "project_pipeline_summary",
      params: { p_project_id: "proj-xyz" },
    });
  });

  it("coerces NUMERIC strings into numbers and exposes the 4 cells", async () => {
    rpcResult = {
      data: [
        {
          quoted_total: "12500.00",
          quoted_record_id: "EST-00128",
          invoiced_total: "11982.72",
          invoiced_record_id: "INV-2026-00002",
          change_orders_count: 1,
          received_total: "3482.72",
          received_record_id: "ET-20260202",
          deposit_pct: 29,
          outstanding_total: "8500.00",
          outstanding_due_date: "2026-05-15",
          days_aged: null,
        },
      ],
      error: null,
    };

    const { result } = renderHook(() => useProjectPipeline("p-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.quoted).toEqual({ total: 12500, recordId: "EST-00128" });
    expect(data.invoiced).toEqual({
      total: 11982.72,
      recordId: "INV-2026-00002",
      changeOrdersCount: 1,
    });
    expect(data.received).toEqual({
      total: 3482.72,
      recordId: "ET-20260202",
      depositPct: 29,
    });
    expect(data.outstanding).toEqual({
      total: 8500,
      dueDate: "2026-05-15",
      daysAged: null,
    });
  });

  it("returns zeroed cells when the project has no finance records", async () => {
    rpcResult = {
      data: [
        {
          quoted_total: "0",
          quoted_record_id: null,
          invoiced_total: "0",
          invoiced_record_id: null,
          change_orders_count: 0,
          received_total: "0",
          received_record_id: null,
          deposit_pct: null,
          outstanding_total: "0",
          outstanding_due_date: null,
          days_aged: null,
        },
      ],
      error: null,
    };

    const { result } = renderHook(() => useProjectPipeline("p-empty"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.quoted.total).toBe(0);
    expect(data.invoiced.total).toBe(0);
    expect(data.received.total).toBe(0);
    expect(data.outstanding.total).toBe(0);
    expect(data.received.depositPct).toBeNull();
    expect(data.outstanding.dueDate).toBeNull();
    expect(data.outstanding.daysAged).toBeNull();
  });

  it("propagates RPC errors", async () => {
    rpcResult = { data: null, error: { message: "rpc boom" } };

    const { result } = renderHook(() => useProjectPipeline("p-err"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("does not fetch when projectId is null", async () => {
    rpcResult = { data: [], error: null };

    const { result } = renderHook(() => useProjectPipeline(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isFetching).toBe(false);
    expect(lastRpcArgs).toBeNull();
  });

  it("handles empty RPC payload defensively (zeroed cells, no crash)", async () => {
    rpcResult = { data: [], error: null };

    const { result } = renderHook(() => useProjectPipeline("p-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.quoted.total).toBe(0);
    expect(data.invoiced.total).toBe(0);
    expect(data.received.total).toBe(0);
    expect(data.outstanding.total).toBe(0);
  });
});

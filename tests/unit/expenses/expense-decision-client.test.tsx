import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpc, invoke, dispatchApproved } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  dispatchApproved: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ rpc, functions: { invoke } }),
}));
vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchExpenseApproved: dispatchApproved,
  dispatchExpensePaid: vi.fn(),
}));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: vi.fn() }));
vi.mock("@/lib/store/permissions-store", () => ({ usePermissionStore: vi.fn() }));

import {
  useApproveBatch,
  useEarlyClearLine,
} from "@/lib/hooks/use-expense-approval";
import { queryKeys } from "@/lib/api/query-client";

const decision = {
  batchId: "batch-a",
  expenseIds: ["expense-a", "expense-b"],
  reviewedBy: "reviewer-a",
  approvedAmount: 105,
};

let queryClient: QueryClient;
let providerCompletions: Array<() => void> = [];

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  rpc.mockResolvedValue({ data: null, error: null });
  // Deliberately never resolves during a decision. Provider availability must
  // have no effect on the real hook/service's success or cache invalidation.
  invoke.mockImplementation(() => new Promise((resolve) => {
    providerCompletions.push(() => resolve({ data: null, error: null }));
  }));
});

afterEach(() => {
  providerCompletions.forEach((finish) => finish());
  providerCompletions = [];
  cleanup();
  queryClient.clear();
});

describe("expense decisions after durable server enqueue", () => {
  it("finishes approval and invalidates the expense cache without waiting for providers", async () => {
    const key = queryKeys.expenseBatches.list("company-a");
    queryClient.setQueryData(key, []);
    const { result } = renderHook(() => useApproveBatch(), { wrapper });

    act(() => result.current.mutate(decision));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("approve_expense_batch", { p_batch_id: "batch-a" });
    expect(invoke).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(dispatchApproved).toHaveBeenCalledTimes(1);
    expect(dispatchApproved).toHaveBeenCalledWith({ batchId: "batch-a" });
  });

  it("keeps approval pending until its authoritative decision returns", async () => {
    let finishDecision!: (value: { data: null; error: null }) => void;
    rpc.mockImplementation(() => new Promise((resolve) => { finishDecision = resolve; }));
    const { result } = renderHook(() => useApproveBatch(), { wrapper });

    act(() => result.current.mutate(decision));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(dispatchApproved).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();

    act(() => finishDecision({ data: null, error: null }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dispatchApproved).toHaveBeenCalledOnce();
  });

  it("preserves a database approval failure without publishing a saved decision", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Permission denied" } });
    const key = queryKeys.expenseBatches.list("company-a");
    queryClient.setQueryData(key, []);
    const { result } = renderHook(() => useApproveBatch(), { wrapper });

    act(() => result.current.mutate(decision));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("Failed to approve batch: Permission denied");
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    expect(dispatchApproved).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("finishes early clear without dispatching client accounting work", async () => {
    const { result } = renderHook(() => useEarlyClearLine(), { wrapper });

    act(() => result.current.mutate("expense-a"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("early_clear_expense_line", { p_expense_id: "expense-a" });
    expect(invoke).not.toHaveBeenCalled();
    expect(dispatchApproved).not.toHaveBeenCalled();
  });

  it("preserves a failed early clear without client accounting work", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Expense is stale" } });
    const { result } = renderHook(() => useEarlyClearLine(), { wrapper });

    act(() => result.current.mutate("expense-a"));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("Failed to clear expense: Expense is stale");
    expect(invoke).not.toHaveBeenCalled();
    expect(dispatchApproved).not.toHaveBeenCalled();
  });
});
